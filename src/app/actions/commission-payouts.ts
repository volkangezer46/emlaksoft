"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { afterSafe } from "@/lib/after-safe";
import { actionErrorMessage } from "@/lib/action-errors";
import { isApprovalExemptRole } from "@/lib/team/assignable-roles";
import { planPayouts, type PayoutSplit, type ExistingPayout } from "@/lib/finance/commission-payouts";

/**
 * Danışman hakediş ödemesi (commission_payouts, migration 20260816000400).
 *
 * - commissions.status müşteriden TAHSİLATTIR; hakediş ayrı yaşam döngüsüdür (pending → approved → paid).
 *   Yalnız tahsil edilmiş (paid/collected) komisyonun danışman payları ödenir.
 * - Yazma RLS'i yalnız owner/gm'e açıktır; eylem aynı kuralı önceden uygular (commissions:edit + owner/gm).
 *   Owner/gm onaydan muaf olduğundan "öde" tek adımda onay + ödeme alanlarını birlikte doldurur
 *   (approved_by/approved_at + paid_by/paid_at; tablo check'leri bunu zorunlu kılar).
 * - Çift ödeme engeli DB'dedir (split başına iptal edilmemiş tek hakediş, kısmi unique index); eylem ayrıca
 *   mevcut hakedişleri okuyup yalnız ödenmemiş payları yazar, yarışta 23505'i "zaten ödendi" sayar.
 * - Denetim: tablo tetikleyicisi her satırı audit_logs'a yazar; eylem ayrıca toplu özet kaydı düşer.
 * - Kasa/banka hareketi YAZILMAZ (ayrı karar: gider kaydı Muhasebe'den girilir).
 */

export type PayoutResult = {
  ok?: boolean;
  error?: string;
  /** Ödenen pay (hakediş satırı) sayısı. */
  paidCount?: number;
  paidAmount?: number;
  /** Tahsil edilmemiş ya da ödenecek payı olmadığı için atlanan komisyon sayısı. */
  skipped?: number;
  info?: string;
};

const MAX_BULK = 100;
const ROLE_ERROR = "Hakediş ödemesini yalnız ofis sahibi veya genel müdür yapabilir.";

export async function payCommissionPayout(commissionId: string, paymentRef?: string): Promise<PayoutResult> {
  return payCommissionPayouts([commissionId], paymentRef);
}

export async function payCommissionPayouts(commissionIds: string[], paymentRef?: string): Promise<PayoutResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isApprovalExemptRole(gate.role)) return { error: ROLE_ERROR };

  const ids = Array.from(new Set((commissionIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))).slice(0, MAX_BULK);
  if (ids.length === 0) return { error: "Ödenecek komisyon seçilmedi." };
  const ref = String(paymentRef ?? "").trim();
  if (ref.length > 200) return { error: "Ödeme açıklaması en fazla 200 karakter olabilir." };

  const supabase = await createClient();
  const { data: commissions, error: commErr } = await supabase
    .from("commissions")
    .select("id, status")
    .eq("tenant_id", gate.tenantId)
    .in("id", ids)
    .in("status", ["paid", "collected"]);
  if (commErr) {
    console.error("payCommissionPayouts commissions", commErr);
    return { error: actionErrorMessage(commErr, "Komisyon kayıtları okunamadı.") };
  }
  const collectedIds = (commissions ?? []).map((c) => c.id as string);
  if (collectedIds.length === 0) {
    return { error: ids.length === 1 ? "Komisyon tahsil edilmeden hakediş ödenemez." : "Seçili komisyonların hiçbiri tahsil edilmemiş." };
  }

  const [splitRes, payoutRes] = await Promise.all([
    supabase
      .from("commission_splits")
      .select("id, commission_id, profile_id, amount, label")
      .eq("tenant_id", gate.tenantId)
      .in("commission_id", collectedIds)
      .eq("kind", "advisor")
      .eq("unresolved", false)
      .not("profile_id", "is", null),
    supabase
      .from("commission_payouts")
      .select("id, split_id, status, approved_at")
      .eq("tenant_id", gate.tenantId)
      .in("commission_id", collectedIds)
      .neq("status", "cancelled"),
  ]);
  if (splitRes.error || payoutRes.error) {
    console.error("payCommissionPayouts read", splitRes.error ?? payoutRes.error);
    return { error: "Paylaşım ve hakediş kayıtları okunamadı. Sayfayı yenileyip tekrar deneyin." };
  }

  const plan = planPayouts(
    (splitRes.data ?? []) as PayoutSplit[],
    (payoutRes.data ?? []) as ExistingPayout[],
  );
  if (plan.inserts.length === 0 && plan.promotes.length === 0) {
    return { error: "Ödenecek hakediş yok: danışman payları zaten ödenmiş ya da paylaşımda danışman yok." };
  }

  const nowIso = new Date().toISOString();
  const paidByProfile = new Map<string, number>();
  const payoutIds: string[] = [];
  const touchedCommissions = new Set<string>();
  let raced = 0;
  let failed = 0;

  // Önceden açılmış (bekleyen/onaylı) hakediş: ödenmiş durumuna geçer; onay alanı boşsa ödeyen onaylamış sayılır.
  for (const p of plan.promotes) {
    const { data, error } = await supabase
      .from("commission_payouts")
      .update({
        status: "paid",
        ...(p.approvedAt ? {} : { approved_by: gate.userId, approved_at: nowIso }),
        paid_by: gate.userId,
        paid_at: nowIso,
        ...(ref ? { payment_ref: ref } : {}),
      })
      .eq("tenant_id", gate.tenantId)
      .eq("id", p.payoutId)
      .in("status", ["pending", "approved"])
      .select("id");
    if (error || !(data ?? []).length) {
      if (error) console.error("payCommissionPayouts promote", error);
      failed += 1;
      continue;
    }
    payoutIds.push(p.payoutId);
    touchedCommissions.add(p.split.commission_id);
    paidByProfile.set(p.split.profile_id, (paidByProfile.get(p.split.profile_id) ?? 0) + Number(p.split.amount));
  }

  // Yeni hakediş satırı: satır satır (bir yarış/çakışma diğer payları düşürmesin).
  for (const s of plan.inserts) {
    const { data, error } = await supabase
      .from("commission_payouts")
      .insert({
        tenant_id: gate.tenantId,
        commission_id: s.commission_id,
        split_id: s.id,
        profile_id: s.profile_id,
        amount: Number(s.amount),
        status: "paid",
        approved_by: gate.userId,
        approved_at: nowIso,
        paid_by: gate.userId,
        paid_at: nowIso,
        payment_ref: ref || null,
        created_by: gate.userId,
      })
      .select("id")
      .single();
    if (error) {
      // 23505: aynı pay başka oturumda ödendi (çift ödeme engeli) — başarı sayılmaz ama hata da değildir.
      if (error.code === "23505") raced += 1;
      else {
        console.error("payCommissionPayouts insert", error);
        failed += 1;
      }
      continue;
    }
    payoutIds.push(data.id as string);
    touchedCommissions.add(s.commission_id);
    paidByProfile.set(s.profile_id, (paidByProfile.get(s.profile_id) ?? 0) + Number(s.amount));
  }

  const paidCount = payoutIds.length;
  const paidAmount = Array.from(paidByProfile.values()).reduce((a, b) => a + b, 0);
  if (paidCount === 0) {
    return { error: raced > 0 ? "Bu hakedişler başka bir oturumda zaten ödendi." : "Hakediş ödemesi kaydedilemedi; sayfayı yenileyip ödenmemiş payları kontrol edin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "commission_payout.pay",
    entityType: "commission",
    entityId: Array.from(touchedCommissions)[0],
    newValue: {
      commission_ids: Array.from(touchedCommissions),
      payout_ids: payoutIds,
      count: paidCount,
      amount: paidAmount,
      payment_ref: ref || null,
    },
  });

  const fmt = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
  for (const [profileId, amount] of paidByProfile) {
    afterSafe(() => notifyTenant({
      tenantId: gate.tenantId,
      userId: profileId,
      title: "Hakedişiniz ödendi",
      body: `${fmt.format(amount)} tutarındaki komisyon payınız ödendi olarak kaydedildi.`,
      href: "/app/cuzdan#odenen-hakedis",
      kind: "success",
      prefKey: "commission",
    }), "hakediş bildirimi");
  }

  revalidatePath("/app/komisyon");
  revalidatePath("/app/cuzdan");
  revalidateTenantData(gate.tenantId);

  const skipped = ids.length - touchedCommissions.size;
  const notes: string[] = [];
  if (raced > 0) notes.push(`${raced} pay başka oturumda zaten ödenmişti`);
  if (failed > 0) notes.push(`${failed} pay kaydedilemedi`);
  return {
    ok: true,
    paidCount,
    paidAmount,
    skipped,
    info: notes.length ? `${notes.join(", ")}.` : undefined,
  };
}
