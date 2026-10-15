"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { now, trDayKey } from "@/lib/clock";
import { commissionCashAmount, decideCollectionAccount, recordCollectionCashResult, voidCollectionCash } from "@/lib/finance/cash/collection-link";
import { isApprovalExemptRole } from "@/lib/team/assignable-roles";

/**
 * Paylaşım satırı. `party` verilirse taraf kimliği AÇIKTIR (Konsey #0+#8): "staff" = ofis personeli (profileId zorunlu),
 * "office" = ofis payı, "external" = dış taraf (label = ad). `party` yoksa (eski kapanış sihirbazı) serbest metin
 * kalır; DB tetikleyicisi ad -> profil eşlemesini dener, eşleşmeyen satırı `unresolved` işaretler.
 */
export type CommissionSplitInput = {
  label: string;
  rate: number;
  party?: "staff" | "office" | "external";
  profileId?: string | null;
};
export type CommissionResult = {
  ok?: boolean;
  error?: string;
  info?: string;
  /** Tahsil edilmiş komisyonun paylaşımı değişiyor: arayüz "Değişiklik gerekçesi" alanını göstermeli. */
  needsReason?: boolean;
  /** Ofiste hesap yok: tahsilatı kasaya yazmadan işaretlemek için bilinçli onay gerekir (SK6/B109). */
  needsCashConfirm?: boolean;
};

const SPLIT_REASON_MIN = 5;

/**
 * Komisyon paylaşımını (çok taraflı split) günceller. Oranlar (%) verilir,
 * tutarlar brüt komisyondan otomatik hesaplanır. Toplam oran %100'ü aşamaz.
 * Tahsil edilmiş (paid/collected) komisyonda yalnız owner/gm değiştirebilir ve gerekçe (en az 5 karakter) zorunludur;
 * her başarılı değişiklik eski/yeni paylarla denetim kaydına yazılır. `reason` opsiyoneldir (eski çağrılar bozulmaz).
 */
export async function updateCommissionSplits(
  commissionId: string,
  rows: CommissionSplitInput[],
  reason?: string,
): Promise<CommissionResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const clean = rows
    .map((r) => ({
      label: String(r.label ?? "").trim(),
      rate: Number(r.rate) || 0,
      party: r.party,
      profileId: r.profileId ? String(r.profileId) : null,
    }))
    .filter((r) => (r.party === "staff" ? Boolean(r.profileId) : Boolean(r.label) || r.party === "office") && r.rate > 0);

  if (clean.length === 0) return { error: "En az bir geçerli paylaşım satırı girin." };
  const totalRate = clean.reduce((s, r) => s + r.rate, 0);
  if (totalRate > 100.01) return { error: `Toplam oran %100'ü aşamaz (şu an %${totalRate.toFixed(1)}).` };

  const supabase = await createClient();
  const { data: commission } = await supabase
    .from("commissions")
    .select("gross_amount, status, splits")
    .eq("id", commissionId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!commission) return { error: "Komisyon kaydı bulunamadı." };

  const settled = commission.status === "paid" || commission.status === "collected";
  const cleanReason = String(reason ?? "").trim();
  if (settled) {
    if (!isApprovalExemptRole(gate.role)) {
      return { error: "Tahsil edilmiş komisyonun paylaşımını yalnız ofis sahibi veya genel müdür değiştirebilir." };
    }
    if (cleanReason.length < SPLIT_REASON_MIN) {
      return { error: `Tahsil edilmiş komisyonun paylaşımını değiştirmek için en az ${SPLIT_REASON_MIN} karakterlik bir gerekçe yazın.`, needsReason: true };
    }
  }

  const gross = Number(commission.gross_amount) || 0;

  // Ofis personeli seçimi: profil bu ofise ait olmalı (çapraz-ofis kimlik yazılamaz); etiket güncel ad olur.
  const staffIds = Array.from(new Set(clean.filter((r) => r.party === "staff").map((r) => r.profileId as string)));
  const nameById = new Map<string, string>();
  if (staffIds.length > 0) {
    const { data: staff } = await supabase.from("profiles").select("id, full_name").eq("tenant_id", gate.tenantId).in("id", staffIds);
    for (const p of staff ?? []) nameById.set(p.id as string, String(p.full_name ?? "").trim());
    if (staffIds.some((id) => !nameById.has(id))) return { error: "Seçilen ofis personeli bulunamadı." };
  }

  const splits = clean.map((r) => {
    const amount = Math.round(gross * (r.rate / 100) * 100) / 100;
    if (r.party === "staff") return { label: nameById.get(r.profileId as string) || r.label, rate: r.rate, amount, profile_id: r.profileId, kind: "advisor" };
    if (r.party === "office") return { label: "Ofis", rate: r.rate, amount, kind: "office" };
    if (r.party === "external") return { label: r.label, rate: r.rate, amount, kind: "other" };
    return { label: r.label, rate: r.rate, amount };
  });

  const { error } = await supabase
    .from("commissions")
    .update({ splits })
    .eq("id", commissionId)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateCommissionSplits", error);
    return { error: actionErrorMessage(error, "Paylaşım güncellenemedi.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "commission.splits_updated",
    entityType: "commission",
    entityId: commissionId,
    oldValue: { splits: commission.splits ?? [], status: commission.status },
    newValue: { splits, reason: cleanReason || null },
  });

  revalidatePath("/app/komisyon");
  revalidateTenantData(gate.tenantId);
  return { ok: true };
}

/**
 * Seçilen komisyonları topluca "tahsil edildi" (paid) işaretler —
 * workflow.ts'teki tekil mark_commission_paid akışının toplu hali.
 * Zaten tahsil edilmiş kayıtlar sessizce atlanır.
 *
 * SK6/B109: ofiste hesap varsa hesap ZORUNLU (işaretleme ile kasa kopmaz); ofiste hesap yoksa yalnız bilinçli
 * `skipCash` onayıyla kasaya yazmadan işaretlenir (`needsCashConfirm`). Kasaya KDV DAHİL tutar yazılır.
 */
export async function markCommissionsPaidBulk(
  ids: string[],
  accountId: string | null,
  opts?: { skipCash?: boolean },
): Promise<CommissionResult & { updated?: number; cashFailedIds: string[]; cashFailedCount: number }> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error, cashFailedIds: [], cashFailedCount: 0 };

  const clean = Array.from(
    new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ).slice(0, 200);
  if (clean.length === 0) return { error: "En az bir kayıt seçin.", cashFailedIds: [], cashFailedCount: 0 };

  const supabase = await createClient();
  const decision = await decideCollectionAccount(supabase, { accountId, skipCash: opts?.skipCash });
  if (!decision.ok) {
    return { error: decision.error, needsCashConfirm: decision.code === "confirm_no_cash" || undefined, cashFailedIds: [], cashFailedCount: 0 };
  }
  const { data, error } = await supabase
    .from("commissions")
    .update({ status: "paid" })
    .in("id", clean)
    .eq("tenant_id", gate.tenantId)
    .not("status", "in", "(paid,collected)")
    .select("id, gross_amount, vat_amount");

  if (error) {
    console.error("markCommissionsPaidBulk", error);
    return { error: actionErrorMessage(error, "Kayıtlar güncellenemedi."), cashFailedIds: [], cashFailedCount: 0 };
  }

  const updatedIds = (data ?? []).map((r) => r.id as string);
  // Her tahsilat için ofis hesabına bir hareket (aynı komisyon iki kez yazılmaz; RPC hesaptan bağımsız mükerrer denetler).
  let info: string | undefined;
  const cashFailedIds: string[] = [];
  if (decision.accountId) {
    const today = trDayKey(now());
    for (const row of data ?? []) {
      const res = await recordCollectionCashResult(supabase, {
        accountId: decision.accountId, sourceType: "commission", sourceId: row.id as string, amount: commissionCashAmount(row), date: today, title: "Komisyon tahsilatı",
      });
      if (!res.ok) {
        cashFailedIds.push(row.id as string);
        info = res.warning; // gösterim metni; asıl bilgi cashFailedIds / cashFailedCount
      }
    }
  }
  if (updatedIds.length > 0) {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "commission.paid_bulk",
      entityType: "commission",
      entityId: updatedIds[0],
      newValue: { ids: updatedIds, count: updatedIds.length, account_id: decision.accountId, cash_skipped: decision.accountId === null },
    });
  }

  revalidatePath("/app/komisyon");
  revalidateTenantData(gate.tenantId);
  return { ok: true, updated: updatedIds.length, info, cashFailedIds, cashFailedCount: cashFailedIds.length };
}

/**
 * Toplu tahsilatta kasaya yazılamayan komisyonlar için hareket yazımını yeniden dener.
 * Yalnız bu ofisin paid/collected komisyonları; en çok 200 kayıt. Yeniden deneme güvenlidir (idempotent):
 * hareket zaten varsa (duplicate) başarı sayılır.
 */
export async function retryCommissionCash(
  ids: string[],
  accountId: string,
): Promise<CommissionResult & { failedIds: string[]; failedCount: number; recorded: number }> {
  const none = { failedIds: [] as string[], failedCount: 0, recorded: 0 };
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error, ...none };

  const clean = Array.from(new Set((ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (clean.length === 0) return { error: "Yeniden denenecek kayıt yok.", ...none };
  if (clean.length > 200) return { error: "Tek seferde en çok 200 kayıt yeniden denenebilir.", ...none };
  if (!String(accountId ?? "").trim()) return { error: "Hareketin yazılacağı hesabı seçin.", ...none };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commissions")
    .select("id, gross_amount, vat_amount")
    .in("id", clean)
    .eq("tenant_id", gate.tenantId)
    .in("status", ["paid", "collected"]);
  if (error) {
    console.error("retryCommissionCash", error);
    return { error: actionErrorMessage(error, "Kayıtlar okunamadı."), ...none };
  }

  const today = trDayKey(now());
  const failedIds: string[] = [];
  let recorded = 0;
  for (const row of data ?? []) {
    const res = await recordCollectionCashResult(supabase, {
      accountId, sourceType: "commission", sourceId: row.id as string, amount: commissionCashAmount(row), date: today, title: "Komisyon tahsilatı",
    });
    if (res.ok) recorded += 1; // recorded ya da duplicate
    else failedIds.push(row.id as string);
  }

  revalidatePath("/app/komisyon");
  revalidatePath("/app/giderler");
  revalidateTenantData(gate.tenantId);
  if (failedIds.length > 0) {
    return {
      ok: false,
      error: `${failedIds.length} tahsilat kasaya yazılamadı.`,
      failedIds,
      failedCount: failedIds.length,
      recorded,
    };
  }
  return { ok: true, failedIds, failedCount: 0, recorded };
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
    return { error: actionErrorMessage(error, "Tahsilat geri alınamadı.") };
  }
  if (!updated || updated.length === 0) {
    return { error: "Kayıt bu sırada değişti. Sayfayı yenileyip tekrar deneyin." };
  }

  // Bu tahsilat bir hesaba hareket olarak yazildiysa o hareket de iptal olur (bakiye/ozet tutarli kalir).
  await voidCollectionCash(supabase, "commission", id, "Komisyon tahsilatı geri alındı");

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
  revalidateTenantData(gate.tenantId);
  return { ok: true };
}
