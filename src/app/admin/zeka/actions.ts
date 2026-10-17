"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { applyPlatformWrites, SETTINGS_RATE } from "@/lib/settings/write";
import { getSettingDef } from "@/lib/settings/registry";
import { classifyOpenAiError, openAiChat } from "@/lib/ai/openai-client";
import { platformQuotaGateOpen } from "@/lib/ai/platform-quota";
import { now } from "@/lib/clock";
import { invalidateKnowledgeCache } from "@/lib/ai/zeka/knowledge/store";
import { runZekaIndex } from "@/lib/ai/zeka/knowledge/index-job";
import { readZekaConfig, zekaApiKey } from "@/lib/ai/zeka/settings";
import { ZEKA_CENTER_GROUPS, isZekaCenterGroup, zekaTestErrorMessage } from "@/lib/ai/zeka/center";
import type { ActionOutcome } from "@/lib/action-outcome";

/**
 * Yapay zeka merkezi eylemleri (/admin/zeka). YAZMA yalnız SÜPER ADMİN (`advisor:write` + rol); modülü gören diğer
 * personel ekranı salt okunur görür. Ayarlar registry üzerinden yazılır (`applyPlatformWrites`: doğrulama + atomik
 * değer/geçmiş + platform denetim satırı). Bağlantı testi tek, küçük ve ölçülen bir çağrıdır (openai-client: maskeleme +
 * denetim); yanıt içeriği döndürülmez, yalnız başarı ve süre. Soru-cevap yazımı oturumlu istemciyle (RLS); service_role yok
 * (dizin işi kendi kabul listesindeki istemciyi kullanır).
 */

const SURFACES = new Set(["all", "app", "public", "vitrin", "admin"]);
const HREF_RE = /^\/(?![\/\\])[^\s\\]{0,299}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gateZekaWrite(rate?: { key: string; limit: number; windowSec: number }) {
  return guardPlatformAction({ module: "advisor", action: "write", roles: ["super_admin"], rate });
}

/** Bir sekmenin ayarlarını toplu yazar (hepsi doğrulanır; biri geçersizse hiçbiri yazılmaz). */
export async function saveZekaSettings(formData: FormData): Promise<ActionOutcome> {
  const gate = await gateZekaWrite(SETTINGS_RATE);
  if ("error" in gate) return { error: gate.error };
  const group = String(formData.get("group") ?? "");
  if (!isZekaCenterGroup(group)) return { error: "Geçersiz bölüm." };
  const writes: { key: string; value: unknown }[] = [];
  for (const key of ZEKA_CENTER_GROUPS[group]) {
    const def = getSettingDef(key);
    if (!def) continue;
    if (def.type === "bool") writes.push({ key, value: formData.get(key) === "on" });
    else {
      const raw = formData.get(key);
      if (typeof raw !== "string") continue;
      writes.push({ key, value: raw });
    }
  }
  const res = await applyPlatformWrites(gate.staff, writes, { reason: "Yapay zeka merkezi" });
  if (!res.ok) return { error: res.error };
  revalidatePath("/admin/zeka");
  return { ok: true };
}

export type ZekaConnectionTest = { ok: boolean; latencyMs: number | null; model: string; message: string };

/** "Bağlantıyı test et": seçili modelle tek, en küçük çağrı (1 sözcük). İçerik döndürülmez; süre ve sonuç döner. */
export async function testZekaConnection(): Promise<ZekaConnectionTest> {
  const gate = await gateZekaWrite({ key: "zeka-test", limit: 10, windowSec: 600 });
  if ("error" in gate) return { ok: false, latencyMs: null, model: "", message: gate.error };
  const cfg = await readZekaConfig("admin");
  const key = await zekaApiKey();
  if (!key) return { ok: false, latencyMs: null, model: cfg.model, message: "OpenAI anahtarı tanımlı değil. Önce anahtarı kaydedin." };
  if (!(await platformQuotaGateOpen("zeka.admin"))) return { ok: false, latencyMs: null, model: cfg.model, message: "Platform AI kotası (zeka.admin) bu ay doldu." };
  const started = now();
  try {
    await openAiChat({
      apiKey: key,
      purpose: "zeka.test",
      audit: { platform: true, purpose: "zeka.test", actorId: gate.staff.id },
      timeoutMs: 15_000,
      maxResponseBytes: 64 * 1024,
      retries: 0,
      body: { model: cfg.model, temperature: 0, max_tokens: 5, messages: [{ role: "user", content: "Yalnız 'tamam' yaz." }] },
    });
    const latencyMs = Math.round(now() - started);
    await logPlatformActivity({ actorId: gate.staff.id, action: "zeka.connection_test", entityType: "ai", meta: { ok: true, model: cfg.model, latency_ms: latencyMs } });
    return { ok: true, latencyMs, model: cfg.model, message: "Bağlantı çalışıyor." };
  } catch (e) {
    const latencyMs = Math.round(now() - started);
    const kind = classifyOpenAiError(e);
    await logPlatformActivity({ actorId: gate.staff.id, action: "zeka.connection_test", entityType: "ai", meta: { ok: false, model: cfg.model, kind, latency_ms: latencyMs } });
    return { ok: false, latencyMs, model: cfg.model, message: zekaTestErrorMessage(kind) };
  }
}

/** "Yeniden oluştur": süreç içi bilgi tabanını boşaltır ve mevcut dizin işini (gece bakımı adımı) hemen çalıştırır. */
export async function rebuildZekaIndex(): Promise<ActionOutcome & { detail?: string }> {
  const gate = await gateZekaWrite({ key: "zeka-index", limit: 6, windowSec: 3600 });
  if ("error" in gate) return { error: gate.error };
  invalidateKnowledgeCache();
  const report = await runZekaIndex();
  await logPlatformActivity({ actorId: gate.staff.id, action: "zeka.index_run", entityType: "zeka_index", meta: { status: report.status, embedded: report.embedded, total: report.total } });
  revalidatePath("/admin/zeka");
  if (report.status === "error") return { error: `Dizin oluşturulamadı: ${report.detail}.` };
  return { ok: true, detail: report.status === "skipped" ? `Bilgi tabanı tazelendi; anlamsal dizin atlandı (${report.detail}).` : `Bilgi tabanı tazelendi; ${report.detail}.` };
}

export async function addZekaQa(formData: FormData): Promise<ActionOutcome> {
  const gate = await gateZekaWrite({ key: "zeka-qa", limit: 60, windowSec: 600 });
  if ("error" in gate) return { error: gate.error };
  const question = String(formData.get("question") ?? "").trim().slice(0, 300);
  const answer = String(formData.get("answer") ?? "").trim().slice(0, 2000);
  const surface = String(formData.get("surface") ?? "all");
  const href = String(formData.get("href") ?? "").trim();
  const sourceLogId = String(formData.get("source_log_id") ?? "").trim();
  if (question.length < 3 || answer.length < 3) return { error: "Soru ve yanıt en az 3 karakter olmalı." };
  if (!SURFACES.has(surface)) return { error: "Geçersiz yüzey." };
  if (href && !HREF_RE.test(href)) return { error: "Bağlantı site içi bir yol olmalı (/ ile başlar)." };
  const supabase = await createClient();
  const { error } = await supabase.from("zeka_qa").insert({
    question,
    answer,
    surface,
    href: href || null,
    source_log_id: UUID_RE.test(sourceLogId) ? sourceLogId : null,
    created_by: gate.staff.id,
  });
  if (error) return { error: "Kaydedilemedi (Zeka öğrenme tabloları kurulu mu?)." };
  await logPlatformActivity({ actorId: gate.staff.id, action: "zeka.qa_add", entityType: "zeka_qa", meta: { surface } });
  invalidateKnowledgeCache();
  revalidatePath("/admin/zeka");
  return { ok: true };
}

export async function archiveZekaQa(formData: FormData): Promise<ActionOutcome> {
  const gate = await gateZekaWrite();
  if ("error" in gate) return { error: gate.error };
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz kayıt." };
  const supabase = await createClient();
  const { error } = await supabase.from("zeka_qa").update({ status: "archived", updated_at: new Date(now()).toISOString() }).eq("id", id);
  if (error) return { error: "Arşivlenemedi." };
  await logPlatformActivity({ actorId: gate.staff.id, action: "zeka.qa_archive", entityType: "zeka_qa", entityId: id });
  invalidateKnowledgeCache();
  revalidatePath("/admin/zeka");
  return { ok: true };
}
