"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { parseMoneyInput } from "@/lib/money-input";
import { isIsoDate } from "@/lib/workflow-state";
import { now, trDayKey } from "@/lib/clock";
import { revalidateTenantData } from "@/lib/revalidate";
import { formatTryDecimal } from "@/lib/format";
import { formatIban, isValidTrIban, normalizeIban } from "@/lib/property-management/iban";
import { exceedsBalance } from "@/lib/property-management/ledger";
import { loadOwnerFinance } from "@/lib/property-management/load";
import { isPaymentMethod, isPayoutMethod } from "@/lib/property-management/payments";
import { recordCollectionCash, voidCollectionCash } from "@/lib/finance/cash/collection-link";

/**
 * Mülk yönetimi (M1) server action'ları. Tümü `rentals` modülü kapısında; yazma yolları veritabanı RPC'leridir
 * (tutar/tahakkuk kilidi, makbuz sırası, denetim kaydı tek transaction) ve JWT kimliğiyle çalışır — service_role YOK.
 * Yetki ayrıntısı: tahsilat kaydı/ödeme/sözleşme = `rentals:edit`; tahsilat veya mülk sahibi ödemesi İPTALİ = `rentals:delete`.
 */

export type PmResult = { ok?: boolean; error?: string; id?: string; receiptNo?: number; info?: string; iban?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING_MSG = "Mülk yönetimi için veritabanı güncellemesi henüz uygulanmamış.";

function isMissingSchema(e: { code?: string | null; message?: string | null } | null): boolean {
  if (!e) return false;
  const code = String(e.code ?? "");
  return code === "42P01" || code === "42883" || code === "42703" || code === "PGRST202" || code === "PGRST204" || code === "PGRST205" ||
    /does not exist|schema cache|could not find/i.test(String(e.message ?? ""));
}

const money = (n: number) => formatTryDecimal(n, 2);

function outcomeError(outcome: string, extra?: { remaining?: number }): string {
  switch (outcome) {
    case "unauthorized": return "Oturum bulunamadı. Yeniden giriş yapın.";
    case "forbidden": return "Bu işlem için yetkiniz yok.";
    case "invalid_input": return "Girdiğiniz bilgileri kontrol edin (tutar, tarih ve yöntem).";
    case "not_found": return "Kayıt bulunamadı.";
    case "already_paid": return "Bu tahakkuk zaten tamamen ödenmiş.";
    case "overpayment": return `Tutar kalan borcu${extra?.remaining != null ? ` (${money(extra.remaining)})` : ""} aşıyor.`;
    case "already_voided": return "Bu kayıt zaten iptal edilmiş.";
    case "not_managed": return "Bu kira için yönetim sözleşmesi etkin değil.";
    default: return "İşlem tamamlanamadı. Sayfayı yenileyip tekrar deneyin.";
  }
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function refresh(tenantId: string, rentalId: string) {
  revalidateTenantData(tenantId, ["/app/kiralama", `/app/kiralama/${rentalId}`, "/app/raporlar/kar-zarar"]);
}

/** Tahakkuka tahsilat kaydı (kısmi ödeme dahil): makbuz no otomatik sıralı, durum ödenen toplamdan türer. */
export async function recordRentPayment(input: {
  chargeId: string;
  rentalId: string;
  amount: string | number;
  paidOn: string;
  method: string;
  bankNote?: string;
  accountId?: string | null;
}): Promise<PmResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(input.chargeId) || !UUID_RE.test(input.rentalId)) return { error: "Tahakkuk bulunamadı." };
  const amount = parseMoneyInput(input.amount, { max: 1_000_000_000 });
  if (!amount.ok || amount.value == null || amount.value <= 0) return { error: "Geçerli, en çok iki ondalık haneli bir tutar girin." };
  if (!isIsoDate(input.paidOn)) return { error: "Geçerli bir tahsilat tarihi girin." };
  if (input.paidOn > trDayKey(now())) return { error: "Tahsilat tarihi gelecekte olamaz." };
  if (!isPaymentMethod(input.method)) return { error: "Ödeme yöntemini seçin." };
  const note = (input.bankNote ?? "").trim();
  if (note.length > 300) return { error: "Banka / açıklama en fazla 300 karakter olabilir." };

  const supabase = await createClient();
  // Tahakkuk bu kiraya ve bu ofise ait olmalı (RPC ofis kapsamını da doğrular; burada kira eşleşmesi).
  const { data: charge } = await supabase.from("rent_charges").select("id").eq("id", input.chargeId).eq("rental_id", input.rentalId).eq("tenant_id", gate.tenantId).maybeSingle();
  if (!charge) return { error: "Tahakkuk bulunamadı." };

  const { data, error } = await supabase.rpc("record_rent_payment", {
    p_charge_id: input.chargeId,
    p_amount: amount.value,
    p_paid_on: input.paidOn,
    p_method: input.method,
    p_bank_note: note || null,
  });
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("recordRentPayment", { code: error.code });
    return { error: actionErrorMessage(error, "Tahsilat kaydedilemedi.") };
  }
  const res = asObject(data);
  const outcome = typeof res.outcome === "string" ? res.outcome : "invalid_result";
  if (outcome !== "recorded") return { error: outcomeError(outcome, { remaining: typeof res.remaining === "number" ? res.remaining : undefined }) };

  const paymentId = String(res.payment_id ?? "");
  const info = paymentId
    ? await recordCollectionCash(supabase, { accountId: input.accountId, sourceType: "rent", sourceId: paymentId, amount: amount.value, date: input.paidOn, title: "Kira tahsilatı" })
    : null;
  refresh(gate.tenantId, input.rentalId);
  return { ok: true, id: paymentId, receiptNo: Number(res.receipt_no) || undefined, info: info ?? undefined };
}

/** Tahsilat iptali (geri alma): silinmez; neden zorunlu, durum yeniden türetilir, denetim kaydı yazılır. */
export async function voidRentPayment(input: { paymentId: string; rentalId: string; reason: string }): Promise<PmResult> {
  const gate = await requirePermission("rentals", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(input.paymentId) || !UUID_RE.test(input.rentalId)) return { error: "Tahsilat kaydı bulunamadı." };
  const reason = input.reason.trim();
  if (reason.length < 3) return { error: "İptal nedenini yazın (en az 3 karakter)." };
  if (reason.length > 300) return { error: "İptal nedeni en fazla 300 karakter olabilir." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("void_rent_payment", { p_payment_id: input.paymentId, p_reason: reason });
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("voidRentPayment", { code: error.code });
    return { error: actionErrorMessage(error, "Tahsilat iptal edilemedi.") };
  }
  const outcome = typeof asObject(data).outcome === "string" ? String(asObject(data).outcome) : "invalid_result";
  if (outcome !== "voided") return { error: outcomeError(outcome) };
  await voidCollectionCash(supabase, "rent", input.paymentId, "Kira tahsilatı iptal edildi");

  refresh(gate.tenantId, input.rentalId);
  return { ok: true };
}

/** Yönetim sözleşmesi (kira başına): yönetiyor mu, ücret (% veya sabit TL/ay), ödeme günü, mülk sahibi IBAN'ı. */
export async function saveManagementAgreement(_prev: PmResult, fd: FormData): Promise<PmResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };

  const rentalId = String(fd.get("rental_id") ?? "").trim();
  if (!UUID_RE.test(rentalId)) return { error: "Kira kaydı bulunamadı." };
  const managed = fd.get("managed") === "1";
  const feeType = String(fd.get("fee_type") ?? "percent");
  if (feeType !== "percent" && feeType !== "fixed") return { error: "Ücret türünü seçin." };
  const feeResult = parseMoneyInput(fd.get("fee_value"), { allowZero: true, max: feeType === "percent" ? 100 : 1_000_000_000 });
  if (!feeResult.ok) return { error: feeType === "percent" ? "Yönetim ücreti oranı 0 ile 100 arasında olmalı." : "Geçerli bir yönetim ücreti tutarı girin." };
  const feeValue = feeResult.value ?? 0;
  const payoutDay = parseInt(String(fd.get("payout_day") ?? "5"), 10);
  if (!Number.isInteger(payoutDay) || payoutDay < 1 || payoutDay > 28) return { error: "Ödeme günü 1-28 arasında olmalı." };
  const holder = String(fd.get("owner_account_holder") ?? "").trim();
  if (holder.length > 120) return { error: "Hesap sahibi en fazla 120 karakter olabilir." };
  const notes = String(fd.get("notes") ?? "").trim();
  if (notes.length > 1000) return { error: "Not en fazla 1000 karakter olabilir." };

  // IBAN: boş bırakılırsa mevcut değer KORUNUR; "iban_clear" ile silinir; girilirse sağlaması yapılır.
  const ibanRaw = String(fd.get("owner_iban") ?? "").trim();
  const ibanClear = fd.get("iban_clear") === "1";
  let ibanPatch: { owner_iban: string | null } | null = null;
  if (ibanClear) ibanPatch = { owner_iban: null };
  else if (ibanRaw) {
    if (!isValidTrIban(ibanRaw)) return { error: "Geçerli bir TR IBAN girin (TR + 24 rakam, sağlama doğru olmalı)." };
    ibanPatch = { owner_iban: normalizeIban(ibanRaw) };
  }

  const supabase = await createClient();
  const { data: rental } = await supabase.from("rentals").select("id").eq("id", rentalId).eq("tenant_id", gate.tenantId).maybeSingle();
  if (!rental) return { error: "Kira kaydı bulunamadı." };

  const nowIso = new Date(now()).toISOString();
  const { data: existing } = await supabase.from("rental_management_agreements").select("id, managed, fee_type, fee_value, payout_day").eq("rental_id", rentalId).eq("tenant_id", gate.tenantId).maybeSingle();
  const patch = {
    managed,
    fee_type: feeType,
    fee_value: feeValue,
    payout_day: payoutDay,
    owner_account_holder: holder || null,
    notes: notes || null,
    ...(ibanPatch ?? {}),
    updated_by: gate.userId,
    updated_at: nowIso,
  };
  const write = existing
    ? await supabase.from("rental_management_agreements").update(patch).eq("id", existing.id).eq("tenant_id", gate.tenantId).select("id").maybeSingle()
    : await supabase.from("rental_management_agreements").insert({ ...patch, tenant_id: gate.tenantId, rental_id: rentalId, created_by: gate.userId }).select("id").single();
  if (write.error || !write.data) {
    if (isMissingSchema(write.error)) return { error: MISSING_MSG };
    console.error("saveManagementAgreement", { code: write.error?.code });
    return { error: actionErrorMessage(write.error, "Yönetim sözleşmesi kaydedilemedi.") };
  }

  // Denetim kaydında IBAN YOK: yalnız "değişti" bilgisi.
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: existing ? "rental_management.update" : "rental_management.create",
    entityType: "rental",
    entityId: rentalId,
    oldValue: existing ? { managed: existing.managed, fee_type: existing.fee_type, fee_value: existing.fee_value, payout_day: existing.payout_day } : null,
    newValue: { managed, fee_type: feeType, fee_value: feeValue, payout_day: payoutDay, iban_changed: ibanPatch != null },
  });
  refresh(gate.tenantId, rentalId);
  return { ok: true, id: String(write.data.id) };
}

/** Mülk sahibi IBAN'ının açık değeri: yalnız bu denetimli eylemle (her gösterim audit kaydı bırakır). */
export async function revealOwnerIban(rentalId: string): Promise<PmResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(rentalId)) return { error: "Kira kaydı bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("rental_management_agreements").select("owner_iban").eq("rental_id", rentalId).eq("tenant_id", gate.tenantId).maybeSingle();
  if (error && isMissingSchema(error)) return { error: MISSING_MSG };
  const iban = (data as { owner_iban: string | null } | null)?.owner_iban;
  if (!iban) return { error: "Kayıtlı IBAN yok." };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "owner_iban.reveal", entityType: "rental", entityId: rentalId, newValue: {} });
  return { ok: true, iban: formatIban(iban) };
}

/** Mülk sahibine ödeme kaydı. Tutar bakiyeyi aşıyorsa (peşin ödeme) açık onay ister. */
export async function recordOwnerPayout(_prev: PmResult, fd: FormData): Promise<PmResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };

  const rentalId = String(fd.get("rental_id") ?? "").trim();
  if (!UUID_RE.test(rentalId)) return { error: "Kira kaydı bulunamadı." };
  const amount = parseMoneyInput(fd.get("amount"), { max: 1_000_000_000 });
  if (!amount.ok || amount.value == null || amount.value <= 0) return { error: "Geçerli, en çok iki ondalık haneli bir tutar girin." };
  const paidOn = String(fd.get("paid_on") ?? "").trim();
  if (!isIsoDate(paidOn)) return { error: "Geçerli bir ödeme tarihi girin." };
  if (paidOn > trDayKey(now())) return { error: "Ödeme tarihi gelecekte olamaz." };
  const method = String(fd.get("method") ?? "");
  if (!isPayoutMethod(method)) return { error: "Ödeme yöntemini seçin." };
  const reference = String(fd.get("reference") ?? "").trim();
  if (reference.length > 60) return { error: "Dekont no en fazla 60 karakter olabilir." };
  const note = String(fd.get("note") ?? "").trim();
  if (note.length > 300) return { error: "Not en fazla 300 karakter olabilir." };

  const supabase = await createClient();
  const { data: rental } = await supabase.from("rentals").select("id, property_id").eq("id", rentalId).eq("tenant_id", gate.tenantId).maybeSingle();
  if (!rental) return { error: "Kira kaydı bulunamadı." };

  const finance = await loadOwnerFinance(supabase, { tenantId: gate.tenantId, rentalId, propertyId: null });
  if (!finance.available) return { error: MISSING_MSG };
  if (!finance.agreement?.managed) return { error: outcomeError("not_managed") };
  if (exceedsBalance(finance.ledger.totals.balance, amount.value) && fd.get("confirm_advance") !== "1") {
    return { error: `Tutar bakiyeyi (${money(Math.max(0, finance.ledger.totals.balance))}) aşıyor. Peşin ödeme olarak kaydetmek için onay kutusunu işaretleyin.` };
  }

  const { data, error } = await supabase.rpc("record_owner_payout", {
    p_rental_id: rentalId,
    p_amount: amount.value,
    p_paid_on: paidOn,
    p_method: method,
    p_reference: reference || null,
    p_note: note || null,
  });
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("recordOwnerPayout", { code: error.code });
    return { error: actionErrorMessage(error, "Mülk sahibi ödemesi kaydedilemedi.") };
  }
  const res = asObject(data);
  const outcome = typeof res.outcome === "string" ? res.outcome : "invalid_result";
  if (outcome !== "recorded") return { error: outcomeError(outcome) };

  refresh(gate.tenantId, rentalId);
  return { ok: true, id: String(res.payout_id ?? "") };
}

/** Mülk sahibi ödemesi iptali (silinmez; neden zorunlu). */
export async function voidOwnerPayout(input: { payoutId: string; rentalId: string; reason: string }): Promise<PmResult> {
  const gate = await requirePermission("rentals", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(input.payoutId) || !UUID_RE.test(input.rentalId)) return { error: "Ödeme kaydı bulunamadı." };
  const reason = input.reason.trim();
  if (reason.length < 3) return { error: "İptal nedenini yazın (en az 3 karakter)." };
  if (reason.length > 300) return { error: "İptal nedeni en fazla 300 karakter olabilir." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("void_owner_payout", { p_payout_id: input.payoutId, p_reason: reason });
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("voidOwnerPayout", { code: error.code });
    return { error: actionErrorMessage(error, "Ödeme iptal edilemedi.") };
  }
  const outcome = typeof asObject(data).outcome === "string" ? String(asObject(data).outcome) : "invalid_result";
  if (outcome !== "voided") return { error: outcomeError(outcome) };

  refresh(gate.tenantId, input.rentalId);
  return { ok: true };
}

/**
 * Mülke ait gideri / aidatı hakedişe yansıtır ya da geri alır. Yalnız bu kiranın portföyüne ait ve henüz başka hakedişe
 * bağlanmamış kalemler; ofis gideri olarak kâr/zarardan düşer (mülk sahibinden geri alınır → çift sayım yok).
 */
export async function setOwnerCharge(input: { rentalId: string; kind: "expense" | "due"; refId: string; link: boolean }): Promise<PmResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(input.rentalId) || !UUID_RE.test(input.refId) || (input.kind !== "expense" && input.kind !== "due")) return { error: "Kayıt bulunamadı." };

  const supabase = await createClient();
  const { data: rental } = await supabase.from("rentals").select("id, property_id").eq("id", input.rentalId).eq("tenant_id", gate.tenantId).maybeSingle();
  if (!rental) return { error: "Kira kaydı bulunamadı." };

  if (!input.link) {
    const { error } = await supabase.from("owner_charge_links").delete().eq("rental_id", input.rentalId).eq("tenant_id", gate.tenantId).eq("kind", input.kind).eq("ref_id", input.refId);
    if (error) {
      if (isMissingSchema(error)) return { error: MISSING_MSG };
      return { error: actionErrorMessage(error, "Yansıtma geri alınamadı.") };
    }
    await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "owner_charge.unlink", entityType: "rental", entityId: input.rentalId, newValue: { kind: input.kind, ref_id: input.refId } });
    refresh(gate.tenantId, input.rentalId);
    return { ok: true };
  }

  // Yansıtma için ek kapı: gider/aidat modülünü görebilmeli.
  const expGate = await requirePermission("expenses", "view");
  if (!expGate.ok) return { error: expGate.error };

  const { data: agreement } = await supabase.from("rental_management_agreements").select("managed").eq("rental_id", input.rentalId).eq("tenant_id", gate.tenantId).maybeSingle();
  if (!agreement?.managed) return { error: outcomeError("not_managed") };

  let amount = 0;
  let date = "";
  let label = "";
  if (input.kind === "expense") {
    const { data: e } = await supabase.from("expenses").select("id, title, amount, currency, expense_date, property_id").eq("id", input.refId).eq("tenant_id", gate.tenantId).maybeSingle();
    if (!e || e.property_id !== rental.property_id) return { error: "Gider bu kiranın portföyüne ait değil." };
    if (String(e.currency ?? "TRY") !== "TRY") return { error: "Yalnız TL giderler hakedişe yansıtılabilir." };
    amount = Number(e.amount);
    date = String(e.expense_date).slice(0, 10);
    label = String(e.title);
  } else {
    const { data: d } = await supabase.from("property_dues").select("id, title, amount, period, property_id").eq("id", input.refId).eq("tenant_id", gate.tenantId).maybeSingle();
    if (!d || d.property_id !== rental.property_id) return { error: "Aidat bu kiranın portföyüne ait değil." };
    amount = Number(d.amount);
    date = String(d.period).slice(0, 10);
    label = `Aidat: ${String(d.title)}`;
  }
  if (!(amount > 0)) return { error: "Tutarı sıfır olan kalem yansıtılamaz." };

  const { error } = await supabase.from("owner_charge_links").insert({
    tenant_id: gate.tenantId,
    rental_id: input.rentalId,
    kind: input.kind,
    ref_id: input.refId,
    amount,
    entry_date: date,
    label: label.slice(0, 160),
    created_by: gate.userId,
  });
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    if (error.code === "23505") return { error: "Bu kalem zaten bir hakedişe yansıtılmış." };
    console.error("setOwnerCharge", { code: error.code });
    return { error: actionErrorMessage(error, "Kalem hakedişe yansıtılamadı.") };
  }
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "owner_charge.link", entityType: "rental", entityId: input.rentalId, newValue: { kind: input.kind, ref_id: input.refId, amount } });
  refresh(gate.tenantId, input.rentalId);
  return { ok: true };
}

/** Gecikme bedeli ofis ayarı (KAPALI doğar). Yalnız ofis sahibi, genel müdür veya şube müdürü. */
export async function saveLateFeeSettings(input: { enabled: boolean; monthlyPercent: number; graceDays: number }): Promise<PmResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!["owner", "gm", "branch_manager"].includes(gate.role)) return { error: "Gecikme bedeli ayarını yalnız ofis sahibi, genel müdür veya şube müdürü değiştirebilir." };
  const pct = Number(input.monthlyPercent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 20 || Math.round(pct * 100) !== pct * 100) return { error: "Aylık gecikme oranı 0 ile 20 arasında, en çok iki ondalık haneli olmalı." };
  const grace = Number(input.graceDays);
  if (!Number.isInteger(grace) || grace < 0 || grace > 30) return { error: "Hoşgörü günü 0 ile 30 arasında olmalı." };
  if (input.enabled === true && !(pct > 0)) return { error: "Gecikme bedelini açmak için aylık oranı girin." };

  const supabase = await createClient();
  const { error } = await supabase.from("property_management_settings").upsert(
    {
      tenant_id: gate.tenantId,
      late_fee_enabled: input.enabled === true,
      late_fee_monthly_percent: pct,
      late_fee_grace_days: grace,
      updated_by: gate.userId,
      updated_at: new Date(now()).toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("saveLateFeeSettings", { code: error.code });
    return { error: actionErrorMessage(error, "Gecikme bedeli ayarı kaydedilemedi.") };
  }
  revalidateTenantData(gate.tenantId, ["/app/kiralama"]);
  return { ok: true };
}
