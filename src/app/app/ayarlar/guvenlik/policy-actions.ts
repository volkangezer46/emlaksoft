"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { actionErrorMessage } from "@/lib/action-errors";
import { logActivity } from "@/lib/activity";
import { isTenantSmsAvailable } from "@/lib/messaging/tenant-providers";
import { ipMatches, parseAllowlist, validateAllowlist } from "@/lib/platform-security/admin-access";
import {
  IDLE_MAX_MINUTES,
  OFFICE_EXPORT_ROLES_KEY,
  OFFICE_IDLE_MINUTES_KEY,
  OFFICE_IP_ALLOWLIST_KEY,
  OFFICE_IP_OWNER_EXEMPT_KEY,
  OFFICE_MAX_HOURS_KEY,
  OFFICE_MFA_ROLES_KEY,
  OFFICE_NEW_DEVICE_ALERT_KEY,
  OFFICE_SECURITY_KEYS,
  SESSION_MAX_HOURS_LIMIT,
  normalizeExportRoles,
  officePolicyIp,
  parseRoleList,
} from "@/lib/office-security/policy";
import { writeOfficeSecurity } from "@/lib/settings/office-security-write";

/**
 * DG7 ofis güvenlik politikası eylemleri (Ayarlar > Güvenlik). YALNIZ ofis sahibi (destek oturumu salt okunur);
 * ayarlar tek korumalı yoldan yazılır (`writeOfficeSecurity`: kayıt defteri doğrulaması + settings_history).
 * Kilitlenme koruması: IP listesi doluysa ve sahip muafiyeti kapalıysa şu anki IP listede değilse açık onay ister.
 */
export type OfficePolicyResult = { ok?: boolean; error?: string; code?: "lockout" };

const OWNER_ONLY = "Güvenlik politikasını yalnız ofis sahibi değiştirebilir.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ownerGate(rateKey: string) {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error } as const;
  if (gate.impersonating || gate.role !== "owner") return { error: OWNER_ONLY } as const;
  const { allowed } = await checkRateLimit(`${rateKey}:${gate.tenantId}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok sık deneme. Lütfen birkaç dakika sonra tekrar deneyin." } as const;
  return gate;
}

function intIn(v: unknown, max: number): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

export async function saveOfficeSecurityPolicy(input: {
  mfaRoles: string[];
  ipAllowlist: string;
  ipOwnerExempt: boolean;
  idleMinutes: number;
  maxHours: number;
  newDeviceAlert: boolean;
  /** Eksikse (eski istemci) dokunulmaz: tüm roller varsayılanı. Sahip her zaman eklenir. */
  exportRoles?: string[];
  confirmLockout?: boolean;
}): Promise<OfficePolicyResult> {
  const gate = await ownerGate("office-security-policy");
  if ("error" in gate) return { error: gate.error };

  const roles = parseRoleList((input.mfaRoles ?? []).join(","));
  const allowlist = String(input.ipAllowlist ?? "").trim();
  const bad = validateAllowlist(allowlist);
  if (bad) return { error: bad };
  const idle = intIn(input.idleMinutes, IDLE_MAX_MINUTES);
  if (idle === null) return { error: `Boşta kalma süresi 0-${IDLE_MAX_MINUTES} dakika olmalı.` };
  const maxHours = intIn(input.maxHours, SESSION_MAX_HOURS_LIMIT);
  if (maxHours === null) return { error: `En uzun oturum süresi 0-${SESSION_MAX_HOURS_LIMIT} saat olmalı.` };
  const ownerExempt = input.ipOwnerExempt !== false;
  const exportRoles = input.exportRoles ? normalizeExportRoles(input.exportRoles.join(",")) : null;

  // 2FA zorunluluğu SMS ister: gönderici yoksa kullanıcılar kurulum ekranında takılır.
  if (roles.length > 0 && !(await isTenantSmsAvailable(gate.tenantId).catch(() => false))) {
    return { error: "İki adımlı doğrulamayı zorunlu kılmak için önce Ayarlar > Entegrasyonlar'dan SMS gönderimini kurun." };
  }

  const { rules } = parseAllowlist(allowlist);
  if (rules.length > 0 && !ownerExempt && !input.confirmLockout) {
    // Proxy ile aynı IP kaynağı (x-real-ip → XFF): onay kararı uygulanacak IP ile aynı olmalı.
    const ip = officePolicyIp(await headers());
    if (!ipMatches(rules, ip)) {
      return {
        code: "lockout",
        error: `Şu anki IP adresiniz (${ip || "bilinmiyor"}) listede yok ve sahip muafiyeti kapalı; kaydederseniz bu ağdan panele giremezsiniz. Önce IP'nizi ekleyin ya da bilerek onaylayın.`,
      };
    }
  }

  // Değişmeyen anahtar yeniden yazılmasın (geçmiş gürültüsü): mevcut değerler kendi ofis satırlarından (RLS).
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("tenant_settings")
    .select("key, value")
    .eq("tenant_id", gate.tenantId)
    .in("key", [...OFFICE_SECURITY_KEYS]);
  const current: Record<string, string | null> = Object.fromEntries(OFFICE_SECURITY_KEYS.map((k) => [k, null]));
  for (const r of (rows ?? []) as { key: string; value: unknown }[]) {
    current[r.key] = r.value === null || r.value === undefined ? null : typeof r.value === "string" ? r.value : String(r.value);
  }

  const res = await writeOfficeSecurity(
    { id: gate.userId, tenantId: gate.tenantId, actorType: "tenant_user" },
    [
      { key: OFFICE_MFA_ROLES_KEY, value: roles.join(",") },
      { key: OFFICE_IP_ALLOWLIST_KEY, value: allowlist },
      { key: OFFICE_IP_OWNER_EXEMPT_KEY, value: ownerExempt },
      { key: OFFICE_IDLE_MINUTES_KEY, value: idle },
      { key: OFFICE_MAX_HOURS_KEY, value: maxHours },
      { key: OFFICE_NEW_DEVICE_ALERT_KEY, value: input.newDeviceAlert === true },
      ...(exportRoles ? [{ key: OFFICE_EXPORT_ROLES_KEY, value: exportRoles.join(",") }] : []),
    ],
    { reason: "Ayarlar > Güvenlik: ofis güvenlik politikası güncellendi", current },
  );
  if (!res.ok) return { error: res.error };
  if (res.changed) {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "security.policy.update",
      entityType: "office_security_policy",
      newValue: { mfa_roles: roles, ip_rules: rules.length, ip_owner_exempt: ownerExempt, idle_minutes: idle, max_hours: maxHours, new_device_alert: input.newDeviceAlert === true, export_roles: exportRoles },
    });
  }
  revalidatePath("/app/ayarlar/guvenlik");
  return { ok: true };
}

/** Ofisteki tek oturumu kapatır (yenileme anahtarı geçersiz; açık erişim anahtarı en geç 1 saatte düşer). */
export async function revokeOfficeSession(input: { sessionId: string }): Promise<OfficePolicyResult> {
  const gate = await ownerGate("office-session-revoke");
  if ("error" in gate) return { error: gate.error };
  if (!UUID_RE.test(input.sessionId ?? "")) return { error: "Geçersiz oturum." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("office_revoke_session", { p_tenant_id: gate.tenantId, p_session_id: input.sessionId });
  if (error) {
    return {
      error:
        error.code === "PGRST202"
          ? "Oturum kapatma servisi henüz kurulmadı (veritabanı güncellemesi bekleniyor)."
          : actionErrorMessage(error, "Oturum kapatılamadı."),
    };
  }
  if (data !== true) return { error: "Oturum bulunamadı (zaten kapanmış olabilir)." };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "security.session.revoke",
    entityType: "auth_session",
    newValue: { session_id: input.sessionId },
  });
  revalidatePath("/app/ayarlar/guvenlik");
  return { ok: true };
}
