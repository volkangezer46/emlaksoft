import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleExtraction, compactForStorage, readStoredExtraction, withSuggestions } from "../assemble";
import { duplicateKeysOf, findDuplicates, matchParty, receiptCategoryText, suggestCategory, type AttachmentLite, type EntryLite, type PartyLite } from "../suggest";
import { mergeLayers } from "../merge";
import { validateFields, toLegacySuggestion } from "../validate";
import type { AiState, LayerFields, LayerReport, ReceiptExtraction } from "../types";
import { aiConfigured, readWithAi } from "./ai";
import { runLocalPipeline } from "./pipeline";

/**
 * Fiş okuma servisi: ayar okuma, yerel hat + öneriler (kategori, cari, mükerrer), saklama ve isteğe bağlı yapay zekâ turu.
 * Tüm sorgular OTURUMLU istemciyle (RLS) yapılır; service_role yok. Ham metin saklanmaz/loglanmaz.
 */

export type ReceiptReadingSettings = { enabled: boolean; aiEnabled: boolean; aiConfigured: boolean };

/** Ayar: tablo/sütun yoksa ya da hata varsa KAPALI (fail-closed). `ocr_ai_enabled` sütunu yoksa yapay zekâ kapalı sayılır. */
export async function readReceiptSettings(supabase: SupabaseClient, tenantId: string): Promise<ReceiptReadingSettings> {
  const off = { enabled: false, aiEnabled: false, aiConfigured: aiConfigured() };
  try {
    const full = await supabase.from("finance_settings").select("ocr_enabled, ocr_ai_enabled").eq("tenant_id", tenantId).maybeSingle();
    if (!full.error) {
      const d = full.data as { ocr_enabled?: boolean | null; ocr_ai_enabled?: boolean | null } | null;
      return { enabled: d?.ocr_enabled === true, aiEnabled: d?.ocr_enabled === true && d?.ocr_ai_enabled === true, aiConfigured: aiConfigured() };
    }
    const base = await supabase.from("finance_settings").select("ocr_enabled").eq("tenant_id", tenantId).maybeSingle();
    if (base.error || !base.data) return off;
    return { enabled: (base.data as { ocr_enabled?: boolean | null }).ocr_enabled === true, aiEnabled: false, aiConfigured: aiConfigured() };
  } catch {
    return off;
  }
}

export function aiStateFor(s: ReceiptReadingSettings): AiState {
  if (!s.aiEnabled) return "off";
  return s.aiConfigured ? "available" : "unavailable";
}

async function loadSuggestionContext(supabase: SupabaseClient, x: ReceiptExtraction, selfId: string | null) {
  const f = x.fields;
  const total = f.total?.value ?? null;
  const date = f.date?.value ?? null;
  const shift = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
  const [partiesRes, attRes, entriesRes, ruleRes] = await Promise.all([
    supabase.from("finance_parties").select("id, name, tax_id").is("archived_at", null).order("updated_at", { ascending: false }).limit(1000),
    supabase.from("finance_attachments").select("id, entry_id, extraction").not("extraction", "is", null).order("created_at", { ascending: false }).limit(500),
    total != null && date
      ? supabase.from("cash_entries").select("id, amount, entry_date, counterparty, title").is("voided_at", null).eq("amount", total).gte("entry_date", shift(date, -1)).lte("entry_date", shift(date, 1)).limit(10)
      : Promise.resolve({ data: [], error: null }),
    receiptCategoryText(f).length >= 3
      ? supabase.rpc("finance_rule_suggest", { p_text: receiptCategoryText(f).slice(0, 200), p_amount: total, p_iban_last4: null, p_direction: "out" })
      : Promise.resolve({ data: null, error: null }),
  ]);
  const parties: PartyLite[] = ((partiesRes.data as { id: string; name: string; tax_id: string | null }[] | null) ?? []).map((p) => ({ id: p.id, name: p.name, taxId: p.tax_id }));
  const attachments: AttachmentLite[] = attRes.error
    ? []
    : ((attRes.data as { id: string; entry_id: string | null; extraction: unknown }[] | null) ?? []).map((a) => ({ id: a.id, entryId: a.entry_id, extraction: duplicateKeysOf(a.extraction) }));
  const entries: EntryLite[] = ((entriesRes.data as { id: string; amount: number | string; entry_date: string; counterparty: string | null; title: string }[] | null) ?? []).map((e) => ({
    id: e.id,
    amount: Number(e.amount),
    date: e.entry_date,
    counterparty: e.counterparty,
    title: e.title,
  }));
  const ruleRow = Array.isArray(ruleRes.data) ? (ruleRes.data[0] as { category?: string | null } | undefined) : undefined;
  const party = matchParty(f, parties);
  let history: { category: string; count: number }[] = [];
  if (party) {
    const h = await supabase.from("cash_entries").select("category").eq("party_id", party.id).eq("direction", "out").is("voided_at", null).order("entry_date", { ascending: false }).limit(60);
    const counts = new Map<string, number>();
    for (const r of (h.data as { category: string | null }[] | null) ?? []) if (r.category) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    history = [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
  }
  const category = suggestCategory({ fields: f, rule: ruleRow?.category ? { category: ruleRow.category } : null, history });
  const duplicates = findDuplicates(f, { selfId, attachments, entries });
  return { category, party, duplicates };
}

export async function enrich(supabase: SupabaseClient, x: ReceiptExtraction, selfId: string | null): Promise<ReceiptExtraction> {
  try {
    return withSuggestions(x, await loadSuggestionContext(supabase, x, selfId));
  } catch {
    return x;
  }
}

/** Ek satırına yazar: yeni RPC (extraction sütunu) yoksa eski `ocr_json`'a yalnız eski biçim öneri yazılır. */
export async function storeExtraction(supabase: SupabaseClient, attachmentId: string, x: ReceiptExtraction): Promise<void> {
  const compact = compactForStorage(x);
  const legacy = toLegacySuggestion(compact.fields);
  const res = await supabase.rpc("finance_attachment_set_extraction", { p_id: attachmentId, p_extraction: compact, p_legacy: legacy });
  if (res.error) await supabase.rpc("finance_attachment_set_ocr", { p_id: attachmentId, p_status: "done", p_json: legacy });
}

export async function extractOnUpload(input: {
  supabase: SupabaseClient;
  attachmentId: string;
  type: string;
  bytes: Uint8Array;
  settings: ReceiptReadingSettings;
  todayIso: string;
  nowIso: string;
}): Promise<ReceiptExtraction> {
  const local = await runLocalPipeline({ type: input.type, bytes: input.bytes });
  const reports: LayerReport[] = [...local.reports];
  const ai = aiStateFor(input.settings);
  if (ai === "off") reports.push({ source: "ai", status: "skipped", reason: "off" });
  // Yapay zekâ burada ÇAĞRILMAZ (yanıt hızlı dönsün): istemci, yerel sonuç eksik/zayıfsa ayrı uçla ister.
  let x = assembleExtraction({ layers: local.layers, reports, todayIso: input.todayIso, nowIso: input.nowIso, ai });
  x = await enrich(input.supabase, x, input.attachmentId);
  await storeExtraction(input.supabase, input.attachmentId, x);
  return x;
}

/** Yapay zekâ turu: saklanan çıkarım + (yeniden kurulan) metin/görsel → AI katmanı → birleştir → doğrula → sakla. */
export async function extractWithAi(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  attachmentId: string;
  type: string;
  bytes: Uint8Array;
  stored: ReceiptExtraction | null;
  todayIso: string;
  nowIso: string;
}): Promise<ReceiptExtraction> {
  let base = input.stored;
  let textLines: string[] | null = null;
  if (input.type === "application/pdf" || !base) {
    // PDF metni saklanmadığı için yeniden çıkarılır (yalnız bellekte).
    const local = await runLocalPipeline({ type: input.type, bytes: input.bytes, budgetMs: 20_000 });
    textLines = local.textLines;
    if (!base) base = assembleExtraction({ layers: local.layers, reports: local.reports, todayIso: input.todayIso, nowIso: input.nowIso, ai: "available" });
  }
  const image = input.type.startsWith("image/") ? { type: input.type, bytes: input.bytes } : null;
  const t0 = Date.now();
  const out = await readWithAi({ tenantId: input.tenantId, userId: input.userId, todayIso: input.todayIso, image, textLines: input.type === "application/pdf" ? textLines : null });
  const reports = base.layers.filter((l) => l.source !== "ai");
  let ai: AiState;
  const layers: LayerFields[] = [base.fields];
  if (out.status === "done") {
    layers.push(out.fields);
    reports.push({ source: "ai", status: Object.keys(out.fields).length ? "done" : "empty", ms: Date.now() - t0 });
    ai = "done";
  } else {
    reports.push({ source: "ai", status: out.status === "failed" ? "failed" : "skipped", reason: out.status === "unavailable" ? out.reason : "error", ms: Date.now() - t0 });
    ai = out.status === "failed" ? "failed" : "unavailable";
  }
  const merged = mergeLayers(layers);
  const checked = validateFields(merged.fields, input.todayIso);
  let x: ReceiptExtraction = {
    version: 1,
    fields: checked.fields,
    layers: reports,
    warnings: [...checked.warnings, ...merged.warnings],
    duplicates: [],
    ai,
    extractedAt: input.nowIso,
  };
  x = await enrich(input.supabase, x, input.attachmentId);
  await storeExtraction(input.supabase, input.attachmentId, x);
  return x;
}

export { readStoredExtraction };
