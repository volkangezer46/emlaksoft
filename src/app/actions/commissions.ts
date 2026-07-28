"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";

export type CommissionSplitInput = { label: string; rate: number };
export type CommissionResult = { ok?: boolean; error?: string };

/**
 * Komisyon paylaşımını (çok taraflı split) günceller. Oranlar (%) verilir,
 * tutarlar brüt komisyondan otomatik hesaplanır. Toplam oran %100'ü aşamaz.
 */
export async function updateCommissionSplits(
  commissionId: string,
  rows: CommissionSplitInput[],
): Promise<CommissionResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const clean = rows
    .map((r) => ({ label: String(r.label ?? "").trim(), rate: Number(r.rate) || 0 }))
    .filter((r) => r.label && r.rate > 0);

  if (clean.length === 0) return { error: "En az bir geçerli paylaşım satırı girin." };
  const totalRate = clean.reduce((s, r) => s + r.rate, 0);
  if (totalRate > 100.01) return { error: `Toplam oran %100'ü aşamaz (şu an %${totalRate.toFixed(1)}).` };

  const supabase = await createClient();
  const { data: commission } = await supabase
    .from("commissions")
    .select("gross_amount")
    .eq("id", commissionId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!commission) return { error: "Komisyon kaydı bulunamadı." };

  const gross = Number(commission.gross_amount) || 0;
  const splits = clean.map((r) => ({
    label: r.label,
    rate: r.rate,
    amount: Math.round(gross * (r.rate / 100) * 100) / 100,
  }));

  const { error } = await supabase
    .from("commissions")
    .update({ splits })
    .eq("id", commissionId)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateCommissionSplits", error);
    return { error: "Paylaşım güncellenemedi." };
  }

  revalidatePath("/app/komisyon");
  return { ok: true };
}

/**
 * Seçilen komisyonları topluca "tahsil edildi" (paid) işaretler —
 * workflow.ts'teki tekil mark_commission_paid akışının toplu hali.
 * Zaten tahsil edilmiş kayıtlar sessizce atlanır.
 */
export async function markCommissionsPaidBulk(
  ids: string[],
): Promise<CommissionResult & { updated?: number }> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const clean = Array.from(
    new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ).slice(0, 200);
  if (clean.length === 0) return { error: "En az bir kayıt seçin." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commissions")
    .update({ status: "paid" })
    .in("id", clean)
    .eq("tenant_id", gate.tenantId)
    .not("status", "in", "(paid,collected)")
    .select("id");

  if (error) {
    console.error("markCommissionsPaidBulk", error);
    return { error: "Kayıtlar güncellenemedi." };
  }

  const updatedIds = (data ?? []).map((r) => r.id as string);
  if (updatedIds.length > 0) {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "commission.paid_bulk",
      entityType: "commission",
      entityId: updatedIds[0],
      newValue: { ids: updatedIds, count: updatedIds.length },
    });
  }

  revalidatePath("/app/komisyon");
  return { ok: true, updated: updatedIds.length };
}

/**
 * Tahsilatı geri alır: `paid`/`collected` → `calculated`.
 *
 * NEDEN (denetim P0): Repoda komisyonu `paid` yapan ÜÇ yol vardı
 * (workflow.ts `mark_commission_paid`, buradaki toplu işaretleme ve ödeme
 * linki webhook'u) ama `paid` durumundan GERİ DÖNDÜREN hiçbir update yoktu.
 * Tek yanlış tıklama cüzdan/hakediş rakamlarını kalıcı bozuyor, düzeltmek
 * için DB'ye elle girmek gerekiyordu.
 *
 * Hedef durum `calculated`: komisyonun ilk yazıldığı durum (deals.ts ve
 * workflow.ts insert'lerinde `status: "calculated"`), yani "hesaplandı ama
 * tahsil edilmedi". Tutar/paylaşım alanlarına DOKUNULMAZ — yalnız tahsilat
 * bayrağı geri alınır.
 */
export async function revertCommissionPayment(commissionId: string): Promise<CommissionResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(commissionId ?? "").trim();
  if (!id) return { error: "Komisyon kaydı bulunamadı." };

  const supabase = await createClient();
  const { data: commission } = await supabase
    .from("commissions")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!commission) return { error: "Komisyon kaydı bulunamadı." };

  const paid = commission.status === "paid" || commission.status === "collected";
  // Sessiz no-op yerine anlamlı hata: kullanıcı neden bir şey olmadığını görsün.
  if (!paid) return { error: "Bu komisyon zaten tahsil edilmiş görünmüyor." };

  const { data: updated, error } = await supabase
    .from("commissions")
    .update({ status: "calculated" })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .in("status", ["paid", "collected"]) // yarış koşulu: bu arada değiştiyse dokunma
    .select("id");

  if (error) {
    console.error("revertCommissionPayment", error);
    return { error: "Tahsilat geri alınamadı." };
  }
  if (!updated || updated.length === 0) {
    return { error: "Kayıt bu sırada değişti. Sayfayı yenileyip tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "commission.payment_reverted",
    entityType: "commission",
    entityId: id,
    oldValue: { status: commission.status },
    newValue: { status: "calculated" },
  });

  revalidatePath("/app/komisyon");
  revalidatePath("/app/raporlar");
  revalidatePath("/app");
  return { ok: true };
}
