"use server";

import { revalidatePath, updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardPlatformAction } from "@/lib/platform-guards";
import { requirePlatformModule, type PlatformStaff } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";
import { resetPlatformFlagsCache } from "@/lib/platform-flags-cache";
import { DAY_MS, now, parseTrLocalDateTime } from "@/lib/clock";
import {
  DEMO_LOGIN_SETTING_KEY,
  DEMO_MODES,
  DEMO_PLATFORM_MAX_HOURS,
  demoEnvCeiling,
  type DemoMode,
} from "@/lib/platform-security/demo-policy";
import { MFA_ENFORCED_SETTING_KEY, MFA_GRACE_SETTING_KEY, mfaEnvMode } from "@/lib/platform-security/mfa-policy";
import {
  MAINTENANCE_SCOPE_SETTING_KEY,
  MAINTENANCE_SCOPES,
  type MaintenanceScope,
} from "@/lib/platform-security/maintenance-scope";
import { getFeatureFlagDef } from "@/lib/feature-flags/registry";
import { growthFlagOpenError } from "@/lib/growth/flag-gate";
import { getSettingDef, storageKeyOf } from "@/lib/settings/registry";
import { SETTINGS_PLATFORM_TAG } from "@/lib/settings/read";
import { applyPlatformWrites, writeSetting } from "@/lib/settings/write";
import { actionErrorMessage } from "@/lib/action-errors";

/**
 * GÜVENLİK TEMELİ (AP1) eylemleri: demo girişi anahtarı, personel MFA zorunluluğu, personel doğrulayıcı sıfırlama,
 * bakım kapsamı ve bayrak ekranındaki satır içi anahtar. Hepsi:
 *  - modül kapısı (requirePlatformModule) + yalnız süper admin (guardPlatformAction: rol + hız sınırı),
 *  - gerekçe zorunlu (en az 10 karakter),
 *  - ayar yazımı `setPlatformSetting` + `write_setting` RPC (değer + settings_history aynı işlemde),
 *  - platform_audit_logs'a ÖNCE/SONRA değeri (logPlatformActivity).
 * service_role (createAdminClient) yalnız Supabase Auth yönetim API'si (MFA faktörleri) için kullanılır.
 */

export type SecurityActionResult = { ok?: boolean; error?: string };

const RATE = { key: "platform-security", limit: 20, windowSec: 600 } as const;
const MIN_REASON = 10;
const HOUR_MS = 3_600_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type DemoModeInput = DemoMode | "default";

function reasonError(reason: string | undefined): string | null {
  return (reason ?? "").trim().length < MIN_REASON ? `Gerekçe en az ${MIN_REASON} karakter olmalı.` : null;
}

function invalidateSecurity() {
  resetPlatformFlagsCache();
  try {
    updateTag(SETTINGS_PLATFORM_TAG);
  } catch {
    /* sunucu eylemi dışı bağlam */
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/giris");
}

/** Ayar yazımı + önce/sonra denetim satırı. */
async function writeAudited(
  staff: Pick<PlatformStaff, "id">,
  key: string,
  value: string | null,
  reason: string,
  action: string,
): Promise<{ ok: boolean; before: string | null }> {
  const before = await getPlatformSetting(key);
  if ((before ?? null) === value) return { ok: true, before };
  const ok = await setPlatformSetting(key, value, staff.id, {
    scope: "platform",
    actorType: "platform_staff",
    reason,
    summary: value === null ? "varsayılana dönüldü" : null,
  });
  if (ok) {
    await logPlatformActivity({
      actorId: staff.id,
      action,
      entityType: "platform_settings",
      meta: { key, before, after: value, reason },
    });
  }
  return { ok, before };
}

const ceilingClosedMessage = (vars: string) =>
  `Sunucu bunu kapatmış; açmak için /root/emlaksoft/.env.production içinde ${vars} yapıp yeniden yayınlayın.`;

/**
 * Demo girişi modu. "default" = satırı temizle (sunucu ortamı davranışı). "tenant_platform" süreli
 * (1–24 saat); env tavanı kapalı bir mod seçilemez.
 */
export async function setDemoLoginMode(input: { mode: DemoModeInput; hours?: number; reason: string }): Promise<SecurityActionResult> {
  await requirePlatformModule("personel");
  const gate = await guardPlatformAction({ module: "personel", roles: ["super_admin"], rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const bad = reasonError(input.reason);
  if (bad) return { error: bad };
  const mode = input.mode;
  if (mode !== "default" && !DEMO_MODES.includes(mode)) return { error: "Geçersiz demo modu." };

  const ceiling = demoEnvCeiling();
  if ((mode === "tenant" || mode === "tenant_platform") && !ceiling.tenant) {
    return { error: ceilingClosedMessage("PRODUCTION_DEMO_LOGIN_OPT_IN=true") };
  }
  if (mode === "tenant_platform" && !ceiling.platform) {
    return { error: ceilingClosedMessage("PRODUCTION_PLATFORM_DEMO_OPT_IN=true") };
  }

  let until: string | null = null;
  if (mode === "tenant_platform") {
    const hours = Number(input.hours);
    if (!Number.isInteger(hours) || hours < 1) return { error: "Platform demo girişi için süre (saat) zorunludur." };
    if (hours > DEMO_PLATFORM_MAX_HOURS) {
      return { error: `Platform demo girişi en çok ${DEMO_PLATFORM_MAX_HOURS} saat açılabilir.` };
    }
    until = new Date(now() + hours * HOUR_MS).toISOString();
  }

  const reason = input.reason.trim();
  const value = mode === "default" ? null : JSON.stringify({ mode, until, reason, by: gate.staff.email });
  const res = await writeAudited(gate.staff, DEMO_LOGIN_SETTING_KEY, value, reason, "security.demo_login_mode");
  if (!res.ok) return { error: actionErrorMessage(null, "Ayar kaydedilemedi") };
  invalidateSecurity();
  return { ok: true };
}

/** Doğrulanmış TOTP faktörleri (Supabase Auth yönetim API'si). Hata: null. */
async function verifiedTotpFactors(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<{ id: string; friendly_name?: string; created_at: string }[] | null> {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) {
    console.error("platform-security listFactors", error.message);
    return null;
  }
  return (data?.factors ?? []).filter((f) => f.factor_type === "totp" && f.status === "verified");
}

/**
 * Personel MFA zorunluluğu. AÇMADAN ÖNCE çağıranın kendi doğrulanmış TOTP'si aranır (kendini kilitleme koruması).
 * Hem 'platform.mfa_enforced' (SQL kapıları da okur) hem geçiş süresi yazılır.
 */
export async function setMfaEnforcement(input: { on: boolean; graceDays: number; reason: string }): Promise<SecurityActionResult> {
  await requirePlatformModule("personel");
  const gate = await guardPlatformAction({ module: "personel", roles: ["super_admin"], rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const bad = reasonError(input.reason);
  if (bad) return { error: bad };
  const graceDays = Number(input.graceDays);
  if (graceDays !== 0 && graceDays !== 7) return { error: "Geçiş süresi 0 veya 7 gün olmalı." };
  // env "on" iken DB'ye 'off' yazılmaz: aksi halde SQL personel kapıları AAL2 istemez (env/DB ayrışması).
  if (!input.on && mfaEnvMode(process.env.PLATFORM_MFA_ENFORCEMENT) === "on") {
    return { error: "Sunucu ortamı zorunlu tutuyor (PLATFORM_MFA_ENFORCEMENT=on); buradan kapatılamaz." };
  }

  if (input.on) {
    const own = await verifiedTotpFactors(createAdminClient(), gate.staff.id);
    if (own === null) return { error: "Doğrulayıcı bilgisi okunamadı; lütfen tekrar deneyin." };
    if (own.length === 0) return { error: "Önce Hesabım > Güvenlik'ten doğrulayıcı kurun." };
  }

  const reason = input.reason.trim();
  const graceUntil = input.on && graceDays > 0 ? new Date(now() + graceDays * DAY_MS).toISOString() : null;
  const enforced = await writeAudited(gate.staff, MFA_ENFORCED_SETTING_KEY, input.on ? "on" : "off", reason, "security.mfa_enforcement");
  if (!enforced.ok) return { error: actionErrorMessage(null, "Ayar kaydedilemedi") };
  const grace = await writeAudited(gate.staff, MFA_GRACE_SETTING_KEY, graceUntil, reason, "security.mfa_grace");
  if (!grace.ok) return { error: actionErrorMessage(null, "Geçiş süresi kaydedilemedi") };
  invalidateSecurity();
  revalidatePath("/admin/personel/guvenlik");
  return { ok: true };
}

/** Personelin tüm TOTP doğrulayıcılarını siler (kaybedilen telefon). Kişi kendi doğrulayıcısını buradan sıfırlayamaz. */
export async function resetStaffMfa(input: { staffId: string; reason: string }): Promise<SecurityActionResult> {
  await requirePlatformModule("personel");
  const gate = await guardPlatformAction({ module: "personel", roles: ["super_admin"], rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const bad = reasonError(input.reason);
  if (bad) return { error: bad };
  const staffId = (input.staffId ?? "").trim();
  if (!UUID_RE.test(staffId)) return { error: "Personel ID gerekli." };
  if (staffId === gate.staff.id) {
    return { error: "Kendi doğrulayıcınızı buradan sıfırlayamazsınız; başka bir süper admin sıfırlamalıdır." };
  }

  const admin = createAdminClient();
  const { data: target } = await admin.from("platform_staff").select("email").eq("id", staffId).maybeSingle();
  if (!target) return { error: "Personel bulunamadı." };

  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: staffId });
  if (error) return { error: actionErrorMessage(error, "Doğrulayıcılar okunamadı.") };
  const factors = data?.factors ?? [];
  if (factors.length === 0) return { error: "Bu personelin kayıtlı doğrulayıcısı yok." };
  let deleted = 0;
  for (const f of factors) {
    const res = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: staffId });
    if (res.error) {
      console.error("resetStaffMfa deleteFactor", res.error.message);
      continue;
    }
    deleted += 1;
  }

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "personel.mfa_reset",
    entityType: "platform_staff",
    entityId: staffId,
    meta: { email: target.email, before: factors.length, after: factors.length - deleted, reason: input.reason.trim() },
  });
  revalidatePath(`/admin/personel/${staffId}`);
  revalidatePath("/admin/personel/guvenlik");
  if (deleted < factors.length) return { error: "Bazı doğrulayıcılar silinemedi; lütfen tekrar deneyin." };
  return { ok: true };
}

export type StaffMfaEntry = { verified: number; name: string; email: string; active: boolean };
export type StaffMfaStatus = Record<string, StaffMfaEntry | null>;

/** Personel → doğrulanmış TOTP sayısı (okunamazsa null). Personel modülü görenler okur. */
export async function listStaffMfaStatus(): Promise<StaffMfaStatus> {
  await requirePlatformModule("personel");
  const gate = await guardPlatformAction({ module: "personel" });
  if ("error" in gate) return {};
  const admin = createAdminClient();
  const { data: staff } = await admin.from("platform_staff").select("id, full_name, email, is_active").limit(500);
  const rows = await Promise.all(
    (staff ?? []).map(async (m) => [m, await verifiedTotpFactors(admin, m.id as string)] as const),
  );
  const out: StaffMfaStatus = {};
  for (const [m, factors] of rows) {
    out[m.id as string] =
      factors === null
        ? null
        : { verified: factors.length, name: String(m.full_name ?? ""), email: String(m.email ?? ""), active: m.is_active === true };
  }
  return out;
}

/** Bakım kapsamı + zaman penceresi (+ isteğe bağlı mesaj, mevcut 'platform.maintenance_message' ayarına yazılır). */
export async function setMaintenanceScope(input: {
  scope: MaintenanceScope;
  startsAt?: string;
  endsAt?: string;
  message?: string;
  reason: string;
}): Promise<SecurityActionResult> {
  await requirePlatformModule("sistem");
  const gate = await guardPlatformAction({ module: "sistem", roles: ["super_admin"], rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const bad = reasonError(input.reason);
  if (bad) return { error: bad };
  if (!MAINTENANCE_SCOPES.includes(input.scope)) return { error: "Geçersiz bakım kapsamı." };

  const parse = (raw: string | undefined, label: string): { iso: string | null } | { error: string } => {
    if (!raw || !raw.trim()) return { iso: null };
    const d = parseTrLocalDateTime(raw);
    return d ? { iso: d.toISOString() } : { error: `${label} geçersiz.` };
  };
  const start = parse(input.startsAt, "Başlangıç");
  if ("error" in start) return { error: start.error };
  const end = parse(input.endsAt, "Bitiş");
  if ("error" in end) return { error: end.error };
  if (start.iso && end.iso && end.iso <= start.iso) return { error: "Bitiş başlangıçtan sonra olmalı." };

  // Düz metin: kontrol karakterleri atılır; HTML olarak işlenmez (React kaçışı).
  const message = (input.message ?? "").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
  if (message.length > 280) return { error: "Mesaj en çok 280 karakter olabilir." };

  const reason = input.reason.trim();
  const value = JSON.stringify({ scope: input.scope, startsAt: start.iso, endsAt: end.iso });
  const res = await writeAudited(gate.staff, MAINTENANCE_SCOPE_SETTING_KEY, value, reason, "security.maintenance_scope");
  if (!res.ok) return { error: actionErrorMessage(null, "Bakım kapsamı kaydedilemedi") };

  if (input.message !== undefined) {
    const msg = await applyPlatformWrites(gate.staff, [{ key: "platform.maintenance_message", value: message }], { reason });
    if (!msg.ok) return { error: msg.error ?? actionErrorMessage(null, "Bakım mesajı kaydedilemedi") };
  }
  invalidateSecurity();
  revalidatePath("/admin/ayarlar/bayraklar");
  return { ok: true };
}

/** Bayrak ekranındaki satır içi anahtar: yalnız ayar kaynaklı ve merkezden düzenlenebilen bayraklar. */
export async function setFeatureFlagFromAdmin(input: { flagKey: string; on: boolean; reason: string }): Promise<SecurityActionResult> {
  await requirePlatformModule("sistem");
  const gate = await guardPlatformAction({ module: "sistem", roles: ["super_admin"], rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const bad = reasonError(input.reason);
  if (bad) return { error: bad };
  const flag = getFeatureFlagDef(input.flagKey);
  if (!flag || flag.source !== "setting" || !flag.settingKey) return { error: "Bu bayrak buradan değiştirilemez." };
  const def = getSettingDef(flag.settingKey);
  if (!def || def.editMode !== "center") return { error: "Bu bayrak kendi ekranından düzenlenir." };
  // Büyüme programı bayrakları: açarken hazırlık kontrolü (eskiden Ortaklık ekranındaki ayrı formdaydı).
  const growthBlock = await growthFlagOpenError(flag.key, Boolean(input.on));
  if (growthBlock) return { error: growthBlock };

  const storage = storageKeyOf(def);
  const before = await getPlatformSetting(storage);
  const res = await writeSetting({ key: flag.settingKey, value: Boolean(input.on), reason: input.reason.trim() });
  if (!res.ok) return { error: res.error ?? actionErrorMessage(null, "Bayrak kaydedilemedi") };
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "security.feature_flag",
    entityType: "platform_settings",
    meta: { flag: flag.key, key: flag.settingKey, before, after: await getPlatformSetting(storage), reason: input.reason.trim() },
  });
  invalidateSecurity();
  revalidatePath("/admin/ayarlar/bayraklar");
  return { ok: true };
}
