"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { parseMoneyInput } from "@/lib/money-input";
import { suggestCrmClosure, validateExplanation } from "@/lib/listing-control/closure-checklist";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { sanitizeObserved } from "@/lib/listing-control/server/process-check";
import { actionErrorMessage } from "@/lib/action-errors";

/**
 * İlan kontrol KULLANICI eylemleri. Hepsi `requirePermission("portals", ...)` kapısından geçer ve KULLANICI OTURUMU
 * istemcisiyle çalışır (service_role YOK): ilgili SECURITY DEFINER RPC'ler ofisi/kullanıcıyı JWT'den çıkarır, kapsamı
 * (`lc_row_visible`) ve izni (`has_effective_permission`) kendisi de doğrular (savunma derinliği). Anomali açıklaması
 * ZORUNLUDUR (kodlu neden; "diğer" için not); "Satıldı/Kiralandı" seçilince CRM kapanışı ÖNERİLİR, otomatik değişiklik
 * yapılmaz. service_role gerektiren yazımlar (bağlama/ilan no değişimi) mevcut kabul edilmiş `createPortalListing`
 * yolundadır (`supersedes_id` / `candidate_id` alanları).
 */

export type ControlActionResult = { ok?: boolean; error?: string; suggestClosure?: { kind: "sold" | "rented"; label: string } | null; state?: string };

const OUTCOME_ERRORS: Record<string, string> = {
  forbidden: "Bu işlem için yetkiniz yok.",
  not_found: "Kayıt bulunamadı.",
  not_live: "Yalnız yayındaki ilan doğrulanabilir.",
  already_closed: "Bu uyarı zaten kapatılmış.",
  not_open: "Bu uyarı artık açık değil.",
  reason_required: "Açıklama nedeni seçin.",
  note_required: "Bu seçim için açıklama notu zorunlu.",
  note_too_long: "Not en fazla 500 karakter olabilir.",
  explanation_required: "Kapatmadan önce açıklama girin.",
  invalid_input: "Geçersiz istek.",
  paused: "Bu ilanın kontrolü duraklatılmış.",
};

function failure(error: { code?: string | null } | null, outcome?: string): ControlActionResult {
  if (error) {
    console.error("listing-control action", { code: error.code });
    return { error: isMissingSchema(error) ? "İlan kontrol sistemi henüz etkin değil." : actionErrorMessage(error, "İşlem tamamlanamadı.") };
  }
  return { error: OUTCOME_ERRORS[outcome ?? ""] ?? actionErrorMessage(null, "İşlem tamamlanamadı.") };
}

function refresh() {
  revalidatePath("/app/portallar");
  revalidatePath("/app/portfoyler");
}

/** Danışmanın elle doğrulaması: "Yayında" (present) ya da "Portalda yok" (absent) + isteğe bağlı portal fiyatı. */
export async function submitManualCheck(formData: FormData): Promise<ControlActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  const listingId = String(formData.get("portal_listing_id") ?? "").trim();
  const result = String(formData.get("result") ?? "").trim();
  if (!listingId || (result !== "present" && result !== "absent")) return { error: "Geçersiz istek." };

  const priceRaw = formData.get("portal_price");
  const observed: Record<string, unknown> = {};
  if (typeof priceRaw === "string" && priceRaw.trim() !== "") {
    const price = parseMoneyInput(priceRaw, { max: 100_000_000_000 });
    if (!price.ok) return { error: "Geçerli bir portal fiyatı girin." };
    observed.price = price.value;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lc_submit_manual_check", {
    p_listing_id: listingId,
    p_result: result,
    p_observed: sanitizeObserved(observed),
  });
  if (error) return failure(error);
  const r = (data ?? {}) as { outcome?: string; state_after?: string };
  if (r.outcome !== "applied") return failure(null, r.outcome);
  refresh();
  return { ok: true, state: r.state_after };
}

export async function acknowledgeAnomaly(formData: FormData): Promise<ControlActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("anomaly_id") ?? "").trim();
  if (!id) return { error: "Geçersiz istek." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lc_acknowledge_anomaly", { p_anomaly_id: id });
  if (error) return failure(error);
  const outcome = (data as { outcome?: string } | null)?.outcome;
  if (outcome !== "ok") return failure(null, outcome);
  refresh();
  return { ok: true };
}

/** Açıklama ZORUNLU (kodlu neden). "Satıldı/Kiralandı" → CRM kapanışı önerisi döner (otomatik değişiklik yok). */
export async function explainAnomaly(formData: FormData): Promise<ControlActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("anomaly_id") ?? "").trim();
  const checked = validateExplanation(String(formData.get("reason_code") ?? ""), String(formData.get("note") ?? ""));
  if (!id) return { error: "Geçersiz istek." };
  if (!checked.ok) return { error: checked.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lc_explain_anomaly", {
    p_anomaly_id: id,
    p_reason_code: checked.reason,
    p_note: checked.note,
  });
  if (error) return failure(error);
  const outcome = (data as { outcome?: string } | null)?.outcome;
  if (outcome !== "ok") return failure(null, outcome);
  const s = suggestCrmClosure(checked.reason);
  refresh();
  return { ok: true, suggestClosure: s.suggest && s.kind && s.label ? { kind: s.kind, label: s.label } : null };
}

/** Kapatma: açıklama yoksa reddedilir; "yanlış alarm" yalnız yönetim kademesi + not ile. */
export async function resolveAnomaly(formData: FormData): Promise<ControlActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("anomaly_id") ?? "").trim();
  const resolution = String(formData.get("resolution") ?? "resolved").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!id || (resolution !== "resolved" && resolution !== "false_positive")) return { error: "Geçersiz istek." };
  if (note.length > 500) return { error: "Not en fazla 500 karakter olabilir." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lc_resolve_anomaly", {
    p_anomaly_id: id,
    p_resolution: resolution,
    p_note: note || null,
  });
  if (error) return failure(error);
  const outcome = (data as { outcome?: string } | null)?.outcome;
  if (outcome !== "ok") return failure(null, outcome);
  refresh();
  return { ok: true };
}
