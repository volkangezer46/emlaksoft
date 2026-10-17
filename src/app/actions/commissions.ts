"use server";

import { financePath } from "@/lib/finance/routes";
import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import {
  commissionLedgerDenied,
  dealWriteScopeFilter,
  isDealSelfScopeRole,
  OUT_OF_SCOPE_RECORD,
  scopeFilterAllowsOwner,
} from "@/lib/permission-data-scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { needsMandatoryApproval, splitsFingerprint } from "@/lib/approvals";
import { checkMandatoryApproval, consumeMandatoryApproval } from "@/lib/approval-mandatory";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { now, trDayKey } from "@/lib/clock";
import {
  commissionCashAmount,
  decideCollectionAccount,
  loadCommissionCollection,
  recordCollectionCashResult,
  reverseSourceCash,
} from "@/lib/finance/cash/collection-link";
import { isUuid } from "@/lib/finance/cash/input";
import { isApprovalExemptRole } from "@/lib/team/assignable-roles";
import { isIsoDate, postgrestInList, SETTLED_COMMISSION_STATUSES } from "@/lib/workflow-state";

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
    .select("gross_amount, status, splits, deal_id")
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

  // WP2 (sahip kararı): owner/gm dışındaki roller paylaşımı yönetici onayıyla değiştirir. Onay satır özetine bağlıdır
  // (başka paylaşım için kullanılamaz) ve tek kullanımlıktır; kendi kapsamlı rol yalnız kendi anlaşmasının komisyonunda.
  let approvalId: string | null = null;
  if (needsMandatoryApproval(gate.role)) {
    const dealId = (commission as { deal_id?: string | null }).deal_id ?? null;
    if (isDealSelfScopeRole(gate.role)) {
      const { data: deal } = dealId
        ? await supabase.from("deals").select("assigned_to").eq("id", dealId).eq("tenant_id", gate.tenantId).maybeSingle()
        : { data: null };
      if (!scopeFilterAllowsOwner(await dealWriteScopeFilter(gate), [(deal?.assigned_to as string | null | undefined) ?? null])) {
        return { error: OUT_OF_SCOPE_RECORD };
      }
    }
    const pct = (n: number) => `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n)}`;
    const approval = await checkMandatoryApproval({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      role: gate.role,
      action: "commission_split",
      entityId: commissionId,
      entityType: dealId ? "deal" : null,
      linkId: dealId,
      variant: splitsFingerprint(clean),
      title: splits.map((r) => `${r.label} ${pct(r.rate)}`).join(", ").slice(0, 150) || "paylaşım",
      detail: `Yeni paylaşım: ${splits.map((r) => `${r.label} ${pct(r.rate)}`).join(", ")}.`,
    });
    if (approval.status === "pending" || approval.status === "requested" || approval.status === "error") {
      return { error: approval.message };
    }
    if (approval.status === "approved") approvalId = approval.approvalId;
  }

  // Onaylı yol: talep sahibi komisyon defterine doğrudan yazamayabilir (DB kısıtı commission_ledger_writer); karar
  // verilmiş ve satır özetine bağlı onay yetkidir, yazım sunucuda service_role ile tek satıra yapılır.
  const viaAdmin = Boolean(approvalId) && Boolean(await commissionLedgerDenied(gate));
  const { error } = viaAdmin
    ? await createAdminClient().from("commissions").update({ splits }).eq("id", commissionId).eq("tenant_id", gate.tenantId)
    : await supabase.from("commissions").update({ splits }).eq("id", commissionId).eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateCommissionSplits", error);
    return { error: actionErrorMessage(error, "Paylaşım güncellenemedi.") };
  }

  if (approvalId) await consumeMandatoryApproval(gate.tenantId, gate.userId, approvalId);

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "commission.splits_updated",
    entityType: "commission",
    entityId: commissionId,
    oldValue: { splits: commission.splits ?? [], status: commission.status },
    newValue: { splits, reason: cleanReason || null, ...(approvalId ? { approval_id: approvalId } : {}) },
  });

  revalidatePath(financePath("komisyon"));
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
  const ledger = await commissionLedgerDenied(gate);
  if (ledger) return { error: ledger, cashFailedIds: [], cashFailedCount: 0 };

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
    .not("status", "in", postgrestInList(SETTLED_COMMISSION_STATUSES))
    .select("id, gross_amount, vat_amount");

  if (error) {
    console.error("markCommissionsPaidBulk", error);
    return { error: actionErrorMessage(error, "Kayıtlar güncellenemedi."), cashFailedIds: [], cashFailedCount: 0 };
  }

  const updatedIds = (data ?? []).map((r) => r.id as string);
  // Her tahsilat için ofis hesabına bir hareket (`commission:{id}:col:{n}`): önceki kısmi tahsilatlar düşülür, kalan yazılır;
  // tamamı yazılmışsa yeni hareket yazılmaz.
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

  revalidatePath(financePath("komisyon"));
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
  const ledger = await commissionLedgerDenied(gate);
  if (ledger) return { error: ledger, ...none };

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
    .in("status", [...SETTLED_COMMISSION_STATUSES]);
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

  revalidatePath(financePath("komisyon"));
  revalidatePath(financePath(), "layout");
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

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Kısmi tahsilat (WP3): müşteriden komisyonun bir kısmı tahsil edildi. Seçilen ofis hesabına `commission:{id}:col:{n}` olayı
 * yazılır (kayıt servisi); tutar KDV dahil kalan tutarı aşamaz. Kalan sıfırlanınca komisyon "tahsil edildi" (paid) olur.
 * Hesap zorunludur (kısmi tahsilat yalnız kasada izlenir).
 */
export async function recordCommissionCollection(
  commissionId: string,
  input: { accountId: string; amount: number; date?: string | null },
): Promise<CommissionResult & { remaining?: number; fullyCollected?: boolean }> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };
  const ledger = await commissionLedgerDenied(gate);
  if (ledger) return { error: ledger };
  const id = String(commissionId ?? "").trim();
  if (!isUuid(id)) return { error: "Komisyon kaydı bulunamadı." };
  const accountId = String(input.accountId ?? "").trim();
  if (!isUuid(accountId)) return { error: "Tahsilatın girdiği hesabı seçin." };
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount < 0.01) return { error: "Tahsil edilen tutarı girin." };
  const today = trDayKey(now());
  const date = String(input.date ?? "").trim() || today;
  if (!isIsoDate(date) || date > today) return { error: "Geçerli, gelecekte olmayan bir tarih girin." };

  const supabase = await createClient();
  const { data: commission } = await supabase
    .from("commissions")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!commission) return { error: "Komisyon kaydı bulunamadı." };
  if ((SETTLED_COMMISSION_STATUSES as readonly string[]).includes(String(commission.status))) {
    return { error: "Bu komisyon zaten tahsil edildi olarak işaretli." };
  }
  const state = await loadCommissionCollection(supabase, id);
  if (!state) return { error: "Tahsilat durumu okunamadı. Hesap yetkinizi kontrol edip tekrar deneyin." };
  if (state.remaining < 0.01) return { error: "Bu komisyonun tahsil edilecek tutarı kalmadı." };
  if (amount > state.remaining + 0.005) {
    return { error: `Tutar kalan tahsilatı (${state.remaining.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺) aşamaz.` };
  }

  const res = await recordCollectionCashResult(supabase, {
    accountId, sourceType: "commission", sourceId: id, amount, date, title: "Komisyon tahsilatı (kısmi)",
  });
  if (!res.ok) return { error: res.warning };
  // Aynı sıra numarası başka oturumda kullanıldı: bu tutar yazılmadı.
  if (res.duplicate) return { error: "Bu sırada başka bir tahsilat kaydedildi. Sayfayı yenileyip kalan tutarı kontrol edin." };

  const remaining = Math.max(0, round2(state.remaining - amount));
  const fullyCollected = remaining < 0.005;
  if (fullyCollected) {
    const { error } = await supabase
      .from("commissions")
      .update({ status: "paid" })
      .eq("id", id)
      .eq("tenant_id", gate.tenantId)
      .not("status", "in", postgrestInList(SETTLED_COMMISSION_STATUSES));
    if (error) console.error("recordCommissionCollection status", error);
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "commission.collection_recorded",
    entityType: "commission",
    entityId: id,
    newValue: { amount, date, account_id: accountId, remaining, fully_collected: fullyCollected },
  });

  revalidatePath(financePath("komisyon"));
  revalidatePath(financePath(), "layout");
  revalidateTenantData(gate.tenantId);
  return { ok: true, remaining, fullyCollected };
}

/**
 * Tahsilatı geri alır: `paid`/`collected` → `calculated`; kasaya yazılmış tahsilat hareketleri kayıt servisiyle geri alınır
 * (`finance_reverse`: açık ayda iptal, kilitli ayda ilk açık aya ayna kayıt; hiçbir şey silinmez).
 * Henüz "tahsil edildi" işaretlenmemiş ama kısmi tahsilatı olan komisyonda yalnız kısmi tahsilat hareketleri geri alınır.
 *
 * NEDEN (denetim P0): komisyonu `paid` yapan yollar vardı ama geri döndüren yoktu; tek yanlış tıklama cüzdan/hakediş
 * rakamlarını kalıcı bozuyordu. Hedef durum `calculated` (ilk yazıldığı durum). Tutar/paylaşım alanlarına DOKUNULMAZ.
 * Kasa hareketi geri alınamazsa (ör. açık ay yok) durum DEĞİŞMEZ: kasa ile komisyon birbirinden kopmaz.
 */
export async function revertCommissionPayment(commissionId: string): Promise<CommissionResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };
  const ledger = await commissionLedgerDenied(gate);
  if (ledger) return { error: ledger };

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

  const paid = (SETTLED_COMMISSION_STATUSES as readonly string[]).includes(String(commission.status));
  const partial = paid ? null : await loadCommissionCollection(supabase, id);
  // Sessiz no-op yerine anlamlı hata: kullanıcı neden bir şey olmadığını görsün.
  if (!paid && !(partial && partial.collected > 0)) return { error: "Bu komisyon zaten tahsil edilmiş görünmüyor." };

  // Danışman hakedişi ödenmiş komisyonun tahsilatı geri alınamaz (ödenmiş hakediş geri çevrilemez; para izi korunur).
  const { data: paidPayouts } = await supabase
    .from("commission_payouts")
    .select("id")
    .eq("tenant_id", gate.tenantId)
    .eq("commission_id", id)
    .eq("status", "paid")
    .limit(1);
  if ((paidPayouts ?? []).length > 0) {
    return { error: "Bu komisyonun danışman hakedişi ödenmiş; tahsilat geri alınamaz." };
  }

  // Önce kasa: hareketler geri alınamazsa komisyon durumu değişmez.
  const cash = await reverseSourceCash(supabase, "commission", id, "Komisyon tahsilatı geri alındı");
  if (!cash.ok) {
    return { error: cash.message ?? "Tahsilatın kasa hareketi geri alınamadı; Finans > Hareketler'den kontrol edin." };
  }

  if (paid) {
    const { data: updated, error } = await supabase
      .from("commissions")
      .update({ status: "calculated" })
      .eq("id", id)
      .eq("tenant_id", gate.tenantId)
      .in("status", [...SETTLED_COMMISSION_STATUSES]) // yarış koşulu: bu arada değiştiyse dokunma
      .select("id");

    if (error) {
      console.error("revertCommissionPayment", error);
      return { error: actionErrorMessage(error, "Tahsilat geri alınamadı.") };
    }
    if (!updated || updated.length === 0) {
      return { error: "Kayıt bu sırada değişti. Sayfayı yenileyip tekrar deneyin." };
    }
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "commission.payment_reverted",
    entityType: "commission",
    entityId: id,
    oldValue: { status: commission.status },
    newValue: { status: "calculated", cash_reversed: cash.reversed, cash_mirrored: cash.mirrored },
  });

  revalidatePath(financePath("komisyon"));
  revalidatePath("/app/raporlar");
  revalidatePath(financePath(), "layout");
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
  return { ok: true, info: cash.mirrored > 0 ? "Kapatılmış aya düşen tahsilat hareketi ilk açık ayda ters kayıtla geri alındı." : undefined };
}
