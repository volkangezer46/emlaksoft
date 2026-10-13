"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { guardPlatformAction } from "@/lib/platform-guards";
import { clientIpFrom, logPlatformActivity } from "@/lib/platform-activity";
import { applyPlatformWrites } from "@/lib/settings/write";
import {
  ADMIN_IP_ALLOWLIST_KEY,
  SESSION_IDLE_MINUTES_KEY,
  SESSION_MAX_HOURS_KEY,
  ipMatches,
  parseAllowlist,
  validateAllowlist,
} from "@/lib/platform-security/admin-access";
import { resetAdminAccessCache } from "@/lib/platform-security/admin-access-cache";
import { STEP_UP_REQUIRED_KEY } from "@/lib/platform-security/step-up-policy";
import { requireStepUp } from "@/lib/platform-security/step-up";
import { actionErrorMessage } from "@/lib/action-errors";

/**
 * AD11 yönetim erişim politikası eylemleri (Personel > Güvenlik politikası): IP izin listesi, boşta kalma süresi,
 * oturum ömrü, kritik işlem doğrulaması ve personel oturumu kapatma. Hepsi modül kapısı + YALNIZ süper admin + hız
 * sınırı + gerekçe; ayarlar tek yazma yolundan (`applyPlatformWrites`: değer + geçmiş + denetim izi) yazılır.
 */

export type AccessPolicyResult = { ok?: boolean; error?: string; code?: "lockout" };

const RATE = { key: "platform-access-policy", limit: 20, windowSec: 600 } as const;
const MIN_REASON = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveAdminAccessPolicy(input: {
  allowlist: string;
  idleMinutes: number;
  maxHours: number;
  stepUp: boolean;
  reason: string;
  confirmLockout?: boolean;
  stepUpCode?: string;
}): Promise<AccessPolicyResult> {
  await requirePlatformModule("personel");
  const gate = await guardPlatformAction({ module: "personel", roles: ["super_admin"], rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const reason = (input.reason ?? "").trim();
  if (reason.length < MIN_REASON) return { error: `Gerekçe en az ${MIN_REASON} karakter olmalı.` };
  const allowlist = String(input.allowlist ?? "").trim();
  const bad = validateAllowlist(allowlist);
  if (bad) return { error: bad };

  // Kendini kilitleme koruması: liste doluysa ve şu anki IP içinde değilse açık onay ister.
  const ip = clientIpFrom(await headers());
  const { rules } = parseAllowlist(allowlist);
  if (rules.length > 0 && !ipMatches(rules, ip) && !input.confirmLockout) {
    return {
      code: "lockout",
      error: `Şu anki IP adresiniz (${ip ?? "bilinmiyor"}) listede yok; kaydederseniz bu cihazdan panele erişemezsiniz. Önce IP'nizi ekleyin ya da bilerek onaylayın.`,
    };
  }
  // Kritik işlem doğrulamasını KAPATMAK da doğrulayıcı kodu ister.
  if (input.stepUp === false) {
    const su = await requireStepUp({ code: input.stepUpCode }, "security_policy", gate.staff.id);
    if (!su.ok) return { error: su.error };
  }

  const res = await applyPlatformWrites(
    gate.staff,
    [
      { key: ADMIN_IP_ALLOWLIST_KEY, value: allowlist === "" ? null : allowlist },
      { key: SESSION_IDLE_MINUTES_KEY, value: Number(input.idleMinutes) },
      { key: SESSION_MAX_HOURS_KEY, value: Number(input.maxHours) },
      { key: STEP_UP_REQUIRED_KEY, value: input.stepUp !== false },
    ],
    { reason },
  );
  if (!res.ok) return { error: res.error };
  resetAdminAccessCache();
  revalidatePath("/admin/personel/guvenlik");
  return { ok: true };
}

/** Tek personel oturumunu kapatır (yenileme anahtarı geçersiz; açık erişim anahtarı en geç 1 saatte düşer). */
export async function revokeStaffSession(input: { sessionId: string; reason: string }): Promise<AccessPolicyResult> {
  await requirePlatformModule("personel");
  const gate = await guardPlatformAction({ module: "personel", roles: ["super_admin"], rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const reason = (input.reason ?? "").trim();
  if (reason.length < MIN_REASON) return { error: `Gerekçe en az ${MIN_REASON} karakter olmalı.` };
  if (!UUID_RE.test(input.sessionId ?? "")) return { error: "Geçersiz oturum." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("platform_revoke_staff_session", { p_session_id: input.sessionId });
  if (error) {
    return {
      error:
        error.code === "PGRST202"
          ? "Oturum kapatma servisi henüz kurulmadı (veritabanı güncellemesi bekleniyor)."
          : actionErrorMessage(error, "Oturum kapatılamadı."),
    };
  }
  if (data !== true) return { error: "Oturum bulunamadı (zaten kapanmış olabilir)." };
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform.session.revoke",
    entityType: "auth_session",
    meta: { session_id: input.sessionId, reason },
  });
  revalidatePath("/admin/personel/guvenlik");
  return { ok: true };
}
