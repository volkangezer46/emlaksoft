"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { afterSafe } from "@/lib/after-safe";
import { actionErrorMessage } from "@/lib/action-errors";
import { now, trDayKey } from "@/lib/clock";
import { isApprovalExemptRole } from "@/lib/team/assignable-roles";
import { isUuid } from "@/lib/finance/cash/input";
import { financePost } from "@/lib/finance/posting/client";
import { payoutPersonalKey, splitKey } from "@/lib/finance/posting/keys";
import {
  parsePayoutPayInput,
  payoutPaidEvent,
  planPayouts,
  type ExistingPayout,
  type PayoutPayInput,
  type PayoutSplit,
} from "@/lib/finance/commission-payouts";
import {
  OPEN_FINANCE_ITEM_STATUSES,
  SETTLED_COMMISSION_STATUSES,
  UNPAID_COMMISSION_PAYOUT_STATUSES,
  type FinanceOpenItemStatus,
} from "@/lib/workflow-state";

/**
 * Danışman hakediş ödemesi (commission_payouts, migration 20260816000400) + deftere kayıt (WP3, `payout.paid`).
 *
 * - commissions.status müşteriden TAHSİLATTIR; hakediş ayrı yaşam döngüsüdür (pending → approved → paid).
 *   Yalnız tahsil edilmiş (paid/collected) komisyonun danışman payları ödenir.
 * - Ödeme bir ofis hesabı İSTER: her hakediş tek kayıt servisiyle (`finance_post`, anahtar `payout:{id}`) hesaptan NET
 *   çıkış olarak yazılır; stopaj (oran verildiyse) vergi dairesine borç açık kalemi olur (muhtasar günü vadeli).
 *   Sıra: hakediş önce "approved" (hazırlandı) olur → deftere yazılır → "paid". Defter yazılamazsa hakediş ödenmiş
 *   sayılmaz (hazırlanmış kalır); yeniden denemede aynı anahtar `duplicate` döner, çift çıkış olmaz.
 * - Yazma RLS'i yalnız owner/gm'e açıktır; eylem aynı kuralı önceden uygular (commissions:edit + owner/gm). Muhasebe rolü
 *   hakedişi "hazırlayamaz": commission_payouts yazma RLS'i yalnız owner/gm (ayrı karar + migration gerekir).
 * - Çift ödeme engeli DB'dedir (split başına iptal edilmemiş tek hakediş, kısmi unique index); yarışta 23505 "zaten ödendi".
 * - Denetim: tablo tetikleyicisi her satırı audit_logs'a yazar; kayıt servisi defter satırlarını; eylem toplu özet kaydı.
 */

export type PayoutResult = {
  ok?: boolean;
  error?: string;
  /** Ödenen pay (hakediş satırı) sayısı. */
  paidCount?: number;
  /** Ödenen brüt hakediş (stopaj dahil). */
  paidAmount?: number;
  /** Danışmanlara ödenen net (hesaptan çıkan). */
  netAmount?: number;
  /** Kesilen stopaj (vergi dairesine borç). */
  withheldAmount?: number;
  /** Tahsil edilmemiş ya da ödenecek payı olmadığı için atlanan komisyon sayısı. */
  skipped?: number;
  info?: string;
};

const MAX_BULK = 100;
const ROLE_ERROR = "Hakediş ödemesini yalnız ofis sahibi veya genel müdür yapabilir.";

const round2 = (n: number) => Math.round(n * 100) / 100;

type Target = { payoutId: string; split: PayoutSplit; prior: "pending" | "approved" | null; approvedAt: string | null };

export async function payCommissionPayout(commissionId: string, input: PayoutPayInput): Promise<PayoutResult> {
  return payCommissionPayouts([commissionId], input);
}

export async function payCommissionPayouts(commissionIds: string[], input: PayoutPayInput): Promise<PayoutResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isApprovalExemptRole(gate.role)) return { error: ROLE_ERROR };

  const ids = Array.from(new Set((commissionIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))).slice(0, MAX_BULK);
  if (ids.length === 0) return { error: "Ödenecek komisyon seçilmedi." };
  const today = trDayKey(now());
  const parsed = parsePayoutPayInput(input, today);
  if (!parsed.ok) return { error: parsed.error };
  const pay = parsed.value;

  const supabase = await createClient();
  const { data: account } = await supabase
    .from("finance_accounts")
    .select("id, owner_scope, archived_at")
    .eq("id", pay.accountId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!account || account.owner_scope !== "office" || account.archived_at) {
    return { error: "Seçilen ofis hesabı bulunamadı ya da arşivde." };
  }

  const { data: commissions, error: commErr } = await supabase
    .from("commissions")
    .select("id, status")
    .eq("tenant_id", gate.tenantId)
    .in("id", ids)
    .in("status", [...SETTLED_COMMISSION_STATUSES]);
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

  const existing = (payoutRes.data ?? []) as ExistingPayout[];
  const plan = planPayouts((splitRes.data ?? []) as PayoutSplit[], existing);
  if (plan.inserts.length === 0 && plan.promotes.length === 0) {
    return { error: "Ödenecek hakediş yok: danışman payları zaten ödenmiş ya da paylaşımda danışman yok." };
  }

  // Danışman adları (karşı taraf metni) ve WP2 pay tahakkuk kalemleri (`split:{id}`; varsa ödeme onu kapatır).
  const allSplits = [...plan.inserts, ...plan.promotes.map((p) => p.split)];
  const profileIds = Array.from(new Set(allSplits.map((s) => s.profile_id)));
  const splitKeys = allSplits.filter((s) => isUuid(s.id)).map((s) => splitKey(s.id));
  const [{ data: profiles }, { data: splitItems }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("tenant_id", gate.tenantId).in("id", profileIds),
    splitKeys.length
      ? supabase
          .from("finance_open_items")
          .select("id, posting_key, amount, paid_amount, status")
          .eq("tenant_id", gate.tenantId)
          .in("posting_key", splitKeys)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const nameOf = new Map(((profiles ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, String(p.full_name ?? "").trim()]));
  const itemOf = new Map<string, { id: string; open: number }>();
  for (const it of (splitItems ?? []) as { id: string; posting_key: string; amount: unknown; paid_amount: unknown; status: FinanceOpenItemStatus }[]) {
    if (OPEN_FINANCE_ITEM_STATUSES.includes(it.status)) itemOf.set(it.posting_key, { id: it.id, open: Number(it.amount) - Number(it.paid_amount ?? 0) });
  }
  const priorStatus = new Map(existing.map((p) => [p.id, p.status]));

  const nowIso = new Date(now()).toISOString();
  const paidAtIso = pay.date === today ? nowIso : `${pay.date}T12:00:00+03:00`;
  const targets: Target[] = [];
  let raced = 0;
  let failed = 0;
  let firstMessage: string | null = null;

  // 1) Hazırla: hakediş "approved" (onaylayan = ödeyen). Bekleyen satır yükselir; payı olmayan için yeni satır açılır.
  for (const p of plan.promotes) {
    const prior = priorStatus.get(p.payoutId) === "approved" ? "approved" : "pending";
    if (prior === "pending") {
      const { data, error } = await supabase
        .from("commission_payouts")
        .update({ status: "approved", approved_by: gate.userId, approved_at: p.approvedAt ?? nowIso })
        .eq("tenant_id", gate.tenantId)
        .eq("id", p.payoutId)
        .eq("status", "pending")
        .select("id");
      if (error || !(data ?? []).length) {
        if (error) console.error("payCommissionPayouts approve", error);
        failed += 1;
        continue;
      }
    }
    targets.push({ payoutId: p.payoutId, split: p.split, prior, approvedAt: p.approvedAt });
  }
  for (const s of plan.inserts) {
    const id = randomUUID();
    const { error } = await supabase
      .from("commission_payouts")
      .insert({
        id,
        tenant_id: gate.tenantId,
        commission_id: s.commission_id,
        split_id: s.id,
        profile_id: s.profile_id,
        amount: Number(s.amount),
        status: "approved",
        approved_by: gate.userId,
        approved_at: nowIso,
        payment_ref: pay.paymentRef || null,
        created_by: gate.userId,
      })
      .select("id")
      .single();
    if (error) {
      // 23505: aynı pay başka oturumda hakedişe bağlandı (çift ödeme engeli) — başarı sayılmaz ama hata da değildir.
      if (error.code === "23505") raced += 1;
      else {
        console.error("payCommissionPayouts insert", error);
        failed += 1;
      }
      continue;
    }
    targets.push({ payoutId: id, split: s, prior: null, approvedAt: nowIso });
  }

  // 2) Deftere yaz (`payout:{id}`), 3) ödenmiş işaretle. Defter yazılamayan hakediş hazırlanmış kalır.
  const paidByProfile = new Map<string, { gross: number; withheld: number }>();
  const payoutIds: string[] = [];
  const touchedCommissions = new Set<string>();
  let net = 0;
  let withheldTotal = 0;
  for (const t of targets) {
    let built: ReturnType<typeof payoutPaidEvent>;
    try {
      const item = isUuid(t.split.id) ? itemOf.get(splitKey(t.split.id)) : undefined;
      built = payoutPaidEvent({
        payoutId: t.payoutId,
        accountId: pay.accountId,
        amount: Number(t.split.amount),
        withholdingRate: pay.withholdingRate,
        date: pay.date,
        advisorName: nameOf.get(t.split.profile_id) ?? t.split.label ?? null,
        splitItemId: item && item.open + 0.005 >= Number(t.split.amount) ? item.id : null,
        paymentRef: pay.paymentRef,
      });
    } catch {
      failed += 1;
      continue;
    }
    const res = await financePost(supabase, built.event);
    if (!res.ok || res.reversed) {
      failed += 1;
      firstMessage ??= res.reversed ? "Bu hakedişin ödeme kaydı daha önce geri alınmış; Finans'tan kontrol edin." : res.message;
      continue;
    }
    const { data, error } = await supabase
      .from("commission_payouts")
      .update({ status: "paid", paid_by: gate.userId, paid_at: paidAtIso, ...(pay.paymentRef ? { payment_ref: pay.paymentRef } : {}) })
      .eq("tenant_id", gate.tenantId)
      .eq("id", t.payoutId)
      .in("status", [...UNPAID_COMMISSION_PAYOUT_STATUSES])
      .select("id");
    if (error || !(data ?? []).length) {
      // Defter yazıldı ama durum güncellenemedi: yeniden ödeme aynı anahtarla duplicate görür ve yalnız durumu tamamlar.
      if (error) console.error("payCommissionPayouts paid", error);
      failed += 1;
      continue;
    }
    payoutIds.push(t.payoutId);
    touchedCommissions.add(t.split.commission_id);
    const prev = paidByProfile.get(t.split.profile_id) ?? { gross: 0, withheld: 0 };
    paidByProfile.set(t.split.profile_id, { gross: prev.gross + Number(t.split.amount), withheld: prev.withheld + built.withheld });
    net += built.net;
    withheldTotal += built.withheld;
  }

  const paidCount = payoutIds.length;
  const paidAmount = round2(Array.from(paidByProfile.values()).reduce((a, b) => a + b.gross, 0));
  if (paidCount === 0) {
    if (firstMessage) return { error: `Hakediş ödemesi deftere yazılamadı: ${firstMessage} Hakediş hazırlandı; sorunu giderip yeniden ödeyin.` };
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
      net: round2(net),
      withheld: round2(withheldTotal),
      withholding_rate: pay.withholdingRate,
      account_id: pay.accountId,
      date: pay.date,
      payment_ref: pay.paymentRef || null,
    },
  });

  const fmt = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
  for (const [profileId, sum] of paidByProfile) {
    const body =
      sum.withheld > 0
        ? `${fmt.format(sum.gross)} tutarındaki komisyon payınız ödendi (stopaj ${fmt.format(sum.withheld)}, net ${fmt.format(sum.gross - sum.withheld)}).`
        : `${fmt.format(sum.gross)} tutarındaki komisyon payınız ödendi olarak kaydedildi.`;
    afterSafe(() => notifyTenant({
      tenantId: gate.tenantId,
      userId: profileId,
      title: "Hakedişiniz ödendi",
      body,
      href: "/app/cuzdan#odenen-hakedis",
      kind: "success",
      prefKey: "commission",
    }), "hakediş bildirimi");
  }

  revalidatePath("/app/komisyon");
  revalidatePath("/app/cuzdan");
  revalidatePath("/app/giderler");
  revalidateTenantData(gate.tenantId);

  const skipped = ids.length - touchedCommissions.size;
  const notes: string[] = [];
  if (raced > 0) notes.push(`${raced} pay başka oturumda zaten ödenmişti`);
  if (failed > 0) notes.push(`${failed} pay ödenemedi${firstMessage ? ` (${firstMessage.replace(/\.$/, "")})` : ""}`);
  return {
    ok: true,
    paidCount,
    paidAmount,
    netAmount: round2(net),
    withheldAmount: round2(withheldTotal),
    skipped,
    info: notes.length ? `${notes.join(", ")}.` : undefined,
  };
}

/**
 * "Kasama işle" (WP3, isteğe bağlı): danışman kendisine ödenmiş hakedişi KİŞİSEL hesabına (Kasam) giriş olarak yazar
 * (`payout.personal`, anahtar `payout:{id}:personal`; ofis kâr/zararı dışında). Yalnız kendi ödenmiş hakedişi ve kendi
 * kişisel hesabı; tutar varsayılan brüt hakediştir, stopaj kesildiyse danışman net tutarı girer (hakedişi aşamaz).
 */
export async function recordPayoutToPersonal(
  payoutId: string,
  input: { accountId: string; amount?: number | null; date?: string | null },
): Promise<{ ok?: boolean; error?: string; info?: string }> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return { error: gate.error };
  const id = String(payoutId ?? "").trim();
  const accountId = String(input.accountId ?? "").trim();
  if (!isUuid(id)) return { error: "Hakediş kaydı bulunamadı." };
  if (!isUuid(accountId)) return { error: "Kişisel hesabınızı seçin." };

  const supabase = await createClient();
  const [{ data: payout }, { data: account }] = await Promise.all([
    supabase
      .from("commission_payouts")
      .select("id, amount, paid_at, status")
      .eq("id", id)
      .eq("tenant_id", gate.tenantId)
      .eq("profile_id", gate.userId)
      .eq("status", "paid")
      .maybeSingle(),
    supabase
      .from("finance_accounts")
      .select("id, owner_scope, owner_user_id, archived_at")
      .eq("id", accountId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle(),
  ]);
  if (!payout) return { error: "Size ödenmiş bu hakediş bulunamadı." };
  if (!account || account.owner_scope !== "user" || account.owner_user_id !== gate.userId || account.archived_at) {
    return { error: "Seçilen kişisel hesap bulunamadı ya da arşivde." };
  }
  const gross = Number(payout.amount) || 0;
  const amount = input.amount == null || String(input.amount).trim() === "" ? gross : round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount < 0.01 || amount > gross + 0.005) {
    return { error: "Tutar sıfırdan büyük olmalı ve hakediş tutarını aşmamalı." };
  }
  const today = trDayKey(now());
  const date = String(input.date ?? "").trim() || (payout.paid_at ? trDayKey(payout.paid_at as string) : today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return { error: "Geçerli, gelecekte olmayan bir tarih girin." };

  const res = await financePost(supabase, {
    eventType: "payout.personal",
    postingKey: payoutPersonalKey(id),
    date,
    sourceId: id,
    title: "Hakediş (ofisten)",
    entries: [{ accountId, amount, title: "Hakediş (ofisten)" }],
  });
  if (!res.ok) return { error: res.message ?? "Hakediş Kasam'a yazılamadı; kişisel hesabınızı kontrol edip tekrar deneyin." };
  if (res.outcome === "duplicate") {
    if (res.reversed) return { error: "Bu hakediş Kasam'a işlenip geri alınmış; gerekirse Kasam'dan elle ekleyin." };
    return { ok: true, info: "Bu hakediş zaten Kasam'a işlenmiş." };
  }
  revalidatePath("/app/cuzdan");
  revalidatePath("/app/hesabim");
  return { ok: true };
}
