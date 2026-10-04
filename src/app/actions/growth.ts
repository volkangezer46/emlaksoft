"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/require-permission";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { setPlatformSetting } from "@/lib/platform-settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureReferralCode, getGrowthFlags } from "@/lib/growth/store";
import { GROWTH_SETTING_KEYS, isMissingTableError } from "@/lib/growth/settings";
import { isPartnerCode } from "@/lib/growth/attribution";

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

/** Program anahtarları (varsayılan KAPALI). Yalnız süper admin. */
export async function saveGrowthFlags(fd: FormData): Promise<GrowthResult> {
  const gate = await guardPlatformAction(ADMIN_GATE);
  if ("error" in gate) return { error: gate.error };
  const before = await getGrowthFlags();
  const referral = fd.get("referral_enabled") === "on";
  const partner = fd.get("partner_enabled") === "on";
  const a = await setPlatformSetting(GROWTH_SETTING_KEYS.referralEnabled, referral ? "on" : "off", gate.staff.id);
  const b = await setPlatformSetting(GROWTH_SETTING_KEYS.partnerEnabled, partner ? "on" : "off", gate.staff.id);
  if (!a || !b) return { error: "Ayarlar kaydedilemedi." };
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "growth.flags_update",
    entityType: "platform_settings",
    meta: { old: before, new: { referralEnabled: referral, partnerEnabled: partner } },
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
  if (rewardType !== "fixed_try" && rewardType !== "percent_of_payment") return { error: "Ödül tipi seçin." };
  if (!name || name.length > 80) return { error: "Kural adı 1-80 karakter olmalı." };
  if (value === null || Number.isNaN(value) || value < 0 || (rewardType === "percent_of_payment" && value > 100)) {
    return { error: "Ödül değeri geçerli değil." };
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
      is_active: fd.get("is_active") === "on",
      created_by: null,
    })
    .select("id")
    .single();
  if (error) {
    console.error("createRewardRule", error.message);
    return { error: isMissingTableError(error) ? TABLES_OFF : "Kural kaydedilemedi." };
  }
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "growth.rule_create",
    entityType: "growth_reward_rules",
    entityId: data?.id as string | undefined,
    meta: { kind, rewardType, value, duration, hold, cap },
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
  if (error) return { error: isMissingTableError(error) ? TABLES_OFF : "Kural güncellenemedi." };
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
    return { error: isMissingTableError(error) ? TABLES_OFF : "Ortak kaydedilemedi." };
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
  if (error) return { error: isMissingTableError(error) ? TABLES_OFF : "Durum güncellenemedi." };
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
