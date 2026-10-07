"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/require-permission";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { setPlatformSetting } from "@/lib/platform-settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ensureReferralCode, getAdminGrowthOverview, getGrowthFlags } from "@/lib/growth/store";
import { GROWTH_RPC, SETTINGS_KEYS, decisionErrorText, staffRpc } from "@/lib/growth/engine";
import { readinessBlockers } from "@/lib/growth/program";
import { GROWTH_SETTING_KEYS, isMissingTableError } from "@/lib/growth/settings";
import { isPartnerCode } from "@/lib/growth/attribution";
import { actionErrorMessage } from "@/lib/action-errors";

export type GrowthResult = { ok?: boolean; error?: string };

const PARTNER_TYPES = ["trainer", "agency", "accountant", "creator", "institution", "other"] as const;
const PARTNER_STATUSES = ["draft", "active", "suspended", "ended"] as const;
const TABLES_OFF = "Büyüme tabloları henüz etkin değil (migration uygulanmadı).";

/* ------------------------------------------------------------ ofis tarafı ------------------------------------------------------------ */

/** Ofise opak davet kodu üretir. Yalnız program açıkken; ayar düzenleme yetkisi ister. */
export async function createMyReferralCode(): Promise<GrowthResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda davet kodu üretilemez." };
  const flags = await getGrowthFlags();
  if (!flags.referralEnabled) return { error: "Davet programı şu an açık değil." };
  const res = await ensureReferralCode(gate.tenantId);
  if ("error" in res) return { error: res.error };
  revalidatePath("/app/buyume");
  return { ok: true };
}

/* ------------------------------------------------------------ admin tarafı ------------------------------------------------------------ */

const ADMIN_GATE = {
  module: "sales",
  roles: ["super_admin"],
  rate: { key: "platform-growth", limit: 40, windowSec: 600 },
} as const;

/**
 * Program anahtarları (varsayılan KAPALI). Yalnız süper admin.
 * KAPALI -> AÇIK geçişinde "hazırlık kontrolü" ZORUNLUDUR: engelleyici madde (migration/cüzdan/kural) varsa açılmaz.
 * Nakit ödeme bayrağı ortak programı açık değilse açılamaz.
 */
export async function saveGrowthFlags(fd: FormData): Promise<GrowthResult> {
  const gate = await guardPlatformAction(ADMIN_GATE);
  if ("error" in gate) return { error: gate.error };
  const before = await getGrowthFlags();
  const referral = fd.get("referral_enabled") === "on";
  const partner = fd.get("partner_enabled") === "on";
  const cash = fd.get("cash_payout_enabled") === "on";
  if (cash && !partner) return { error: "Nakit ödeme yalnız ortak programı açıkken açılabilir." };

  const opening = (referral && !before.referralEnabled) || (partner && !before.partnerEnabled) || (cash && !before.cashPayoutEnabled);
  if (opening) {
    const ov = await getAdminGrowthOverview();
    const checks = [
      ...(referral && !before.referralEnabled ? ov.readiness.referral : []),
      ...(partner && !before.partnerEnabled ? ov.readiness.partner : []),
      ...(cash && !before.cashPayoutEnabled ? ov.readiness.cash : []),
    ];
    const blockers = readinessBlockers(checks);
    if (blockers.length) {
      const names = [...new Set(blockers.map((b) => b.label))].join("; ");
      return { error: `Hazırlık kontrolü geçmedi, program açılamaz: ${names}.` };
    }
  }

  const a = await setPlatformSetting(GROWTH_SETTING_KEYS.referralEnabled, referral ? "on" : "off", gate.staff.id);
  const b = await setPlatformSetting(GROWTH_SETTING_KEYS.partnerEnabled, partner ? "on" : "off", gate.staff.id);
  const c = await setPlatformSetting(GROWTH_SETTING_KEYS.cashPayoutEnabled, cash ? "on" : "off", gate.staff.id);
  if (!a || !b || !c) return { error: actionErrorMessage(null, "Ayarlar kaydedilemedi.") };
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "growth.flags_update",
    entityType: "platform_settings",
    meta: { old: before, new: { referralEnabled: referral, partnerEnabled: partner, cashPayoutEnabled: cash } },
  });
  revalidatePath("/admin/growth");
  revalidatePath("/app/buyume");
  return { ok: true };
}

function num(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Ödül kuralı ekler (tutar/oran yalnız buradan, admin kararıyla girilir; kodda sabit yok). */
export async function createRewardRule(fd: FormData): Promise<GrowthResult> {
  const gate = await guardPlatformAction(ADMIN_GATE);
  if ("error" in gate) return { error: gate.error };
  const kind = String(fd.get("kind") ?? "");
  const rewardType = String(fd.get("reward_type") ?? "");
  const name = String(fd.get("name") ?? "").trim();
  const value = num(fd.get("reward_value"));
  const duration = num(fd.get("duration_months"));
  const hold = num(fd.get("hold_days"));
  const cap = num(fd.get("monthly_cap_try"));
  if (kind !== "referral" && kind !== "partner") return { error: "Kural türü seçin." };
  if (rewardType !== "fixed_try" && rewardType !== "percent_of_payment" && rewardType !== "monthly_multiple") {
    return { error: "Ödül tipi seçin." };
  }
  if (!name || name.length > 80) return { error: "Kural adı 1-80 karakter olmalı." };
  if (
    value === null ||
    Number.isNaN(value) ||
    value < 0 ||
    (rewardType === "percent_of_payment" && value > 100) ||
    (rewardType === "monthly_multiple" && value > 24)
  ) {
    return { error: "Ödül değeri geçerli değil." };
  }
  const creditExpires = num(fd.get("credit_expires_days"));
  if (creditExpires !== null && (!Number.isInteger(creditExpires) || creditExpires < 1 || creditExpires > 3650)) {
    return { error: "Kredi vadesi 1-3650 gün olmalı." };
  }
  if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 60)) return { error: "Süre 1-60 ay olmalı." };
  if (hold === null || !Number.isInteger(hold) || hold < 0 || hold > 180) return { error: "Bekleme günü 0-180 olmalı." };
  if (cap !== null && (Number.isNaN(cap) || cap < 0)) return { error: "Aylık tavan geçerli değil." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("growth_reward_rules")
    .insert({
      kind,
      name,
      reward_type: rewardType,
      reward_value: value,
      duration_months: duration,
      hold_days: hold,
      monthly_cap_try: cap,
      credit_expires_days: creditExpires,
      is_active: fd.get("is_active") === "on",
      created_by: null,
    })
    .select("id")
    .single();
  if (error) {
    console.error("createRewardRule", error.message);
    return { error: isMissingTableError(error) ? TABLES_OFF : actionErrorMessage(error, "Kural kaydedilemedi.") };
  }
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "growth.rule_create",
    entityType: "growth_reward_rules",
    entityId: data?.id as string | undefined,
    meta: { kind, rewardType, value, duration, hold, cap, creditExpires },
  });
  revalidatePath("/admin/growth");
  return { ok: true };
}

/** Kuralı aç/kapat (kayıt silinmez; eski kayıtlar eski kuralla değerlendirilir). */
export async function setRewardRuleActive(id: string, active: boolean): Promise<GrowthResult> {
  const gate = await guardPlatformAction(ADMIN_GATE);
  if ("error" in gate) return { error: gate.error };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Geçersiz kural." };
  const admin = createAdminClient();
  const { error } = await admin.from("growth_reward_rules").update({ is_active: active }).eq("id", id);
  if (error) return { error: isMissingTableError(error) ? TABLES_OFF : actionErrorMessage(error, "Kural güncellenemedi.") };
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "growth.rule_toggle",
    entityType: "growth_reward_rules",
    entityId: id,
    meta: { active },
  });
  revalidatePath("/admin/growth");
  return { ok: true };
}

/** Ortak (partner) tanımı ekler. Sonradan durum değişir; kod değişmez. */
export async function createPartner(fd: FormData): Promise<GrowthResult> {
  const gate = await guardPlatformAction(ADMIN_GATE);
  if ("error" in gate) return { error: gate.error };
  const name = String(fd.get("name") ?? "").trim();
  const type = String(fd.get("partner_type") ?? "");
  const code = String(fd.get("code") ?? "").trim().toLowerCase();
  if (!name || name.length > 80) return { error: "Ortak adı 1-80 karakter olmalı." };
  if (!(PARTNER_TYPES as readonly string[]).includes(type)) return { error: "Ortak türü seçin." };
  if (!isPartnerCode(code)) return { error: "Kod 3-40 karakter; küçük harf, rakam ve tire olmalı." };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("growth_partners")
    .insert({ name, partner_type: type, code, status: "draft" })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { error: "Bu kod zaten kullanılıyor." };
    console.error("createPartner", error.message);
    return { error: isMissingTableError(error) ? TABLES_OFF : actionErrorMessage(error, "Ortak kaydedilemedi.") };
  }
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "growth.partner_create",
    entityType: "growth_partners",
    entityId: data?.id as string | undefined,
    meta: { type, code },
  });
  revalidatePath("/admin/growth");
  return { ok: true };
}

export async function setPartnerStatus(id: string, status: string): Promise<GrowthResult> {
  const gate = await guardPlatformAction(ADMIN_GATE);
  if ("error" in gate) return { error: gate.error };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Geçersiz ortak." };
  if (!(PARTNER_STATUSES as readonly string[]).includes(status)) return { error: "Geçersiz durum." };
  const admin = createAdminClient();
  const { error } = await admin.from("growth_partners").update({ status }).eq("id", id);
  if (error) return { error: isMissingTableError(error) ? TABLES_OFF : actionErrorMessage(error, "Durum güncellenemedi.") };
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "growth.partner_status",
    entityType: "growth_partners",
    entityId: id,
    meta: { status },
  });
  revalidatePath("/admin/growth");
  return { ok: true };
}

/* ------------------------------------------------------------ inceleme / ayar / ortak (DB içinde super_admin doğrulaması) ------------------------------------------------------------ */
// Bu işlemler personel OTURUMUYLA RPC çağırır (service_role değil): yetki DB'de de doğrulanır, kredi YAZIMI yapılmaz
// (onaylanan talebin kredisini growth-claims işleyicisi yükler).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Talep kararı: approve (yalnız inceleme kuyruğu) | reject | reverse. Neden zorunlu; audit log yazılır. */
export async function decideClaim(claimId: string, decision: string, reason: string): Promise<GrowthResult> {
  const gate = await guardPlatformAction(ADMIN_GATE);
  if ("error" in gate) return { error: gate.error };
  if (!UUID_RE.test(claimId)) return { error: "Geçersiz talep." };
  if (decision !== "approve" && decision !== "reject" && decision !== "reverse") return { error: "Geçersiz karar." };
  const why = String(reason ?? "").trim().slice(0, 300);
  if (why.length < 3) return { error: "Neden en az 3 karakter olmalı." };
  const res = await staffRpc(await createClient(), GROWTH_RPC.decide, { p_claim: claimId, p_decision: decision, p_reason: why });
  if (!res.ok) return { error: decisionErrorText(res.code) };
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: `growth.claim_${decision}`,
    entityType: "growth_reward_claims",
    entityId: claimId,
    meta: { decision, reason: why, status: res.status ?? null },
  });
  revalidatePath("/admin/growth");
  return { ok: true };
}

/** Program ayarları (kademe, rozet, tavan, hız sınırı, ortak kademeleri/eşik). Boş alan = değişmez. */
export async function saveReferralSettings(fd: FormData): Promise<GrowthResult> {
  const gate = await guardPlatformAction(ADMIN_GATE);
  if ("error" in gate) return { error: gate.error };
  const values: Record<string, string | number> = {};
  for (const key of SETTINGS_KEYS) {
    const raw = String(fd.get(key) ?? "").trim();
    if (!raw) continue;
    if (key === "tier1_badge" || key === "tier2_badge") {
      if (raw.length > 40) return { error: "Rozet adı en fazla 40 karakter." };
      values[key] = raw;
      continue;
    }
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return { error: `Geçersiz değer: ${key}.` };
    values[key] = n;
  }
  if (Object.keys(values).length === 0) return { error: "Değiştirilecek alan yok." };
  const res = await staffRpc(await createClient(), GROWTH_RPC.saveSettings, { p_values: values });
  if (!res.ok) return { error: decisionErrorText(res.code) };
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "growth.settings_update",
    entityType: "growth_referral_settings",
    meta: { keys: Object.keys(values), values },
  });
  revalidatePath("/admin/growth");
  revalidatePath("/app/buyume");
  return { ok: true };
}

/** Ortak: vergi mükellefi bilgisi, ofis sahibi (hesap kredisi için), kural, sözleşme tarihi. */
export async function updatePartnerDetails(partnerId: string, fd: FormData): Promise<GrowthResult> {
  const gate = await guardPlatformAction(ADMIN_GATE);
  if ("error" in gate) return { error: gate.error };
  if (!UUID_RE.test(partnerId)) return { error: "Geçersiz ortak." };
  const taxNo = String(fd.get("tax_no") ?? "").replace(/\D/g, "");
  if (taxNo && !/^\d{10,11}$/.test(taxNo)) return { error: "Vergi/TC numarası 10 veya 11 hane olmalı." };
  const owner = String(fd.get("owner_tenant_id") ?? "").trim();
  const rule = String(fd.get("rule_id") ?? "").trim();
  if (owner && !UUID_RE.test(owner)) return { error: "Ofis kimliği geçersiz." };
  if (rule && !UUID_RE.test(rule)) return { error: "Kural kimliği geçersiz." };
  const contract = String(fd.get("contract_signed_at") ?? "").trim();
  if (contract && !/^\d{4}-\d{2}-\d{2}$/.test(contract)) return { error: "Sözleşme tarihi geçersiz." };
  const values = {
    is_tax_payer: fd.get("is_tax_payer") === "on",
    tax_no: taxNo,
    owner_tenant_id: owner,
    rule_id: rule,
    contract_signed_at: contract,
  };
  if (values.is_tax_payer && !taxNo) return { error: "Vergi mükellefi için vergi/TC numarası girin." };
  const res = await staffRpc(await createClient(), GROWTH_RPC.partnerUpdate, { p_partner: partnerId, p_values: values });
  if (!res.ok) return { error: decisionErrorText(res.code) };
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "growth.partner_update",
    entityType: "growth_partners",
    entityId: partnerId,
    // Vergi numarası denetim kaydına YAZILMAZ (yalnız var/yok).
    meta: { isTaxPayer: values.is_tax_payer, hasTaxNo: Boolean(taxNo), owner: owner || null, rule: rule || null },
  });
  revalidatePath("/admin/growth");
  return { ok: true };
}

/**
 * Ortak ödemesi (Faz 2). account_credit: işleyici cüzdana yazar. bank_transfer_external: YALNIZ nakit bayrağı açık,
 * vergi mükellefi ortak, belge no + tarih zorunlu (para bu ekrandan gönderilmez; dış ödemenin kaydıdır).
 */
export async function createPartnerPayout(partnerId: string, fd: FormData): Promise<GrowthResult> {
  const gate = await guardPlatformAction(ADMIN_GATE);
  if ("error" in gate) return { error: gate.error };
  if (!UUID_RE.test(partnerId)) return { error: "Geçersiz ortak." };
  const method = String(fd.get("method") ?? "");
  if (method !== "account_credit" && method !== "bank_transfer_external") return { error: "Ödeme yöntemi seçin." };
  const doc = String(fd.get("document_no") ?? "").trim().slice(0, 80);
  const paidAt = String(fd.get("paid_at") ?? "").trim();
  if (method === "bank_transfer_external" && (doc.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(paidAt))) {
    return { error: "Fatura/belge no ve ödeme tarihi zorunludur." };
  }
  const note = String(fd.get("note") ?? "").trim().slice(0, 300);
  const res = await staffRpc(await createClient(), GROWTH_RPC.payoutCreate, {
    p_partner: partnerId,
    p_method: method,
    p_document_no: method === "bank_transfer_external" ? doc : null,
    p_paid_at: method === "bank_transfer_external" ? paidAt : null,
    p_note: note || null,
  });
  if (!res.ok) return { error: decisionErrorText(res.code) };
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "growth.partner_payout",
    entityType: "growth_partners",
    entityId: partnerId,
    meta: { method, amount: res.amount ?? null, documentNo: method === "bank_transfer_external" ? doc : null, payoutId: res.payout_id ?? null },
  });
  revalidatePath("/admin/growth");
  return { ok: true };
}
