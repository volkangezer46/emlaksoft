import "server-only";

import { now } from "@/lib/clock";
import { getOpenAiKey } from "@/lib/ai-advisor";
import { getOpenAiChatModel, openAiChat } from "@/lib/ai/openai-client";
import { canAutoCallAi } from "@/lib/ai/auto-call-gate";
import { externalErrorMetadata } from "@/lib/external-fetch";
import { getSetting } from "@/lib/settings/read";
import { AI_VOICE_NOTES_KEY } from "@/lib/settings/registry/tenant";
import { loadNlNeighborhoods, loadNlProvincesAndDistricts } from "@/lib/nl-search/geo-source";
import type { NlGeo } from "@/lib/nl-search/parse";
import {
  aiFieldsFromJson,
  buildNoteFieldsMessages,
  extractNoteFields,
  mergeNoteFields,
  type NoteFieldSuggestions,
} from "./note-fields";

export const NOTE_FIELDS_MAX_TEXT = 2000;

/** Konum listeleriyle kural tabanlı ayrıştırma; ilçe bulunduysa o ilçenin mahalleleriyle ikinci geçiş. */
async function ruleExtract(text: string, nowMs: number): Promise<{ result: NoteFieldSuggestions; geo: NlGeo }> {
  const base = await loadNlProvincesAndDistricts();
  const geo: NlGeo = { provinces: base.provinces, districts: base.districts };
  let result = extractNoteFields(text, { nowMs, geo });
  if (result.region?.districtId) {
    const neighborhoods = await loadNlNeighborhoods(result.region.districtId);
    const withN = extractNoteFields(text, { nowMs, geo: { ...geo, neighborhoods } });
    if (withN.region?.neighborhoodId) result = withN;
    return { result, geo: { ...geo, neighborhoods } };
  }
  return { result, geo };
}

/** AI tamamlaması kullanılabilir mi: ofis ayarı (sesli not ve AI) + anahtar + kota. */
export async function noteFieldsAiAvailable(tenantId: string): Promise<boolean> {
  try {
    if ((await getSetting<boolean>(AI_VOICE_NOTES_KEY, { tenantId })) !== true) return false;
  } catch {
    return false;
  }
  return Boolean(await getOpenAiKey());
}

/**
 * Not / sesli not dökümü → alan önerileri. Önce KURAL; ofiste AI açık + anahtar + kota varsa AI yalnız EKSİK alanları
 * tamamlar (metin `openai-client` üzerinden maskelenerek gider; çıktı doğrulanır). AI hatası kural sonucunu bozmaz.
 */
export async function extractNoteFieldsForTenant(
  rawText: string,
  ctx: { tenantId: string; userId: string; allowAi: boolean },
): Promise<{ fields: NoteFieldSuggestions; ai: "kapali" | "kullanildi" | "gerek-yok" | "hata" }> {
  const text = String(rawText ?? "").slice(0, NOTE_FIELDS_MAX_TEXT);
  const nowMs = now();
  const { result, geo } = await ruleExtract(text, nowMs);
  const complete = Boolean(result.rooms && (result.budgetMax != null || result.budgetMin != null) && result.region);
  if (!ctx.allowAi || !(await noteFieldsAiAvailable(ctx.tenantId))) return { fields: result, ai: "kapali" };
  if (complete || text.trim().length < 8) return { fields: result, ai: "gerek-yok" };
  const apiKey = await getOpenAiKey();
  if (!apiKey || !(await canAutoCallAi(ctx.tenantId))) return { fields: result, ai: "kapali" };
  try {
    const { system, user } = buildNoteFieldsMessages(text, nowMs);
    const { content } = await openAiChat({
      apiKey,
      purpose: "field_note_extract",
      audit: { tenantId: ctx.tenantId, actorId: ctx.userId },
      timeoutMs: 20_000,
      maxResponseBytes: 64 * 1024,
      body: {
        model: getOpenAiChatModel(),
        temperature: 0,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
    });
    let json: unknown = null;
    try {
      json = JSON.parse(content ?? "");
    } catch {
      json = null;
    }
    const ai = aiFieldsFromJson(json, { nowMs, geo, sourceText: text });
    return { fields: mergeNoteFields(result, ai), ai: "kullanildi" };
  } catch (e) {
    console.error("extractNoteFieldsForTenant", externalErrorMetadata(e));
    return { fields: result, ai: "hata" };
  }
}
