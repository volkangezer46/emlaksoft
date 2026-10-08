"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now, parseTrLocalDateTime } from "@/lib/clock";
import { isDealProcessKey, isMissingDealProcessTable, parseDealProcessInput } from "@/lib/deal-process";

export type DealProcessResult = { ok?: boolean; error?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Satış anlaşmasının tapu süreci adımını kaydeder (tarih, sorumlu, not, yapıldı).
 * Yetki: commissions.edit (anlaşma düzenleme çizgisi). Tablo yoksa (20261008001500 uygulanmadı) "etkin değil" döner.
 * Sorumlu aynı ofisin aktif kullanıcısı olmalıdır; tarih `datetime-local` (TR saati) ya da ISO kabul edilir.
 */
export async function saveDealProcessStep(_prev: DealProcessResult, formData: FormData): Promise<DealProcessResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const dealId = String(formData.get("deal_id") ?? "").trim();
  const stepKey = String(formData.get("step_key") ?? "").trim();
  if (!UUID_RE.test(dealId)) return { error: "Anlaşma bulunamadı." };
  if (!isDealProcessKey(stepKey)) return { error: "Geçersiz adım." };

  const plannedRaw = String(formData.get("planned_at") ?? "").trim();
  const planned = plannedRaw ? parseTrLocalDateTime(plannedRaw) : null;
  if (plannedRaw && !planned) return { error: "Tarih geçerli değil." };
  const parsed = parseDealProcessInput({
    plannedAt: planned ? planned.toISOString() : null,
    assignedTo: String(formData.get("assigned_to") ?? ""),
    note: String(formData.get("note") ?? ""),
    done: formData.get("done") === "on" || formData.get("done") === "true",
  });
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, deal_type, assigned_to")
    .eq("id", dealId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!deal) return { error: "Anlaşma bulunamadı." };
  if (deal.deal_type !== "sale") return { error: "Tapu süreci yalnız satış anlaşmalarında izlenir." };

  if (parsed.value.assignedTo) {
    const { data: member } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", parsed.value.assignedTo)
      .eq("tenant_id", gate.tenantId)
      .eq("is_active", true)
      .maybeSingle();
    if (!member) return { error: "Sorumlu bu ofiste aktif bir kullanıcı olmalı." };
  }

  const { data: existing, error: readErr } = await supabase
    .from("deal_process_steps")
    .select("id, done_at")
    .eq("deal_id", dealId)
    .eq("step_key", stepKey)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (readErr) {
    if (isMissingDealProcessTable(readErr)) return { error: "Tapu süreci takibi henüz etkin değil (veritabanı güncellemesi bekleniyor)." };
    console.error("saveDealProcessStep read", readErr.code);
    return { error: "Kaydedilemedi." };
  }

  const nowIso = new Date(now()).toISOString();
  // Yapıldı işareti: daha önce yapılmışsa ilk damga korunur; kaldırılırsa temizlenir.
  const doneAt = parsed.value.done ? ((existing?.done_at as string | null | undefined) ?? nowIso) : null;
  const payload = {
    tenant_id: gate.tenantId,
    deal_id: dealId,
    step_key: stepKey,
    planned_at: parsed.value.plannedAt,
    assigned_to: parsed.value.assignedTo,
    note: parsed.value.note,
    done_at: doneAt,
    updated_by: gate.userId,
    updated_at: nowIso,
  };
  const { error } = await supabase.from("deal_process_steps").upsert(payload, { onConflict: "deal_id,step_key" });
  if (error) {
    if (isMissingDealProcessTable(error)) return { error: "Tapu süreci takibi henüz etkin değil (veritabanı güncellemesi bekleniyor)." };
    console.error("saveDealProcessStep", error.code);
    return { error: "Kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "deal.process_step",
    entityType: "deal",
    entityId: dealId,
    newValue: { step: stepKey, done: Boolean(doneAt), planned_at: parsed.value.plannedAt },
  });
  revalidatePath(`/app/anlasmalar/${dealId}`);
  return { ok: true };
}
