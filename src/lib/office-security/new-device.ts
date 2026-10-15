import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deviceLabel } from "@/lib/account/device-label";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { notifyTenant } from "@/lib/notify";
import { publicEvidenceHash } from "@/lib/public-request-security";
import { MANAGER_ROLES } from "@/lib/team/assignable-roles";
import { readOfficeSecurityPolicyCached } from "./policy-cache";

/**
 * DG7 yeni cihazdan giriş bildirimi (kullanıcıya ve ofis sahibi/yöneticilerine — MANAGER_ROLES). Başarılı giriş günlüğe yazılmadan ÖNCE çağrılır (`logLoginEvent`); politika
 * kapalıysa (önbellekli görüntü) hiçbir sorgu yapılmaz. Cihaz = işletim sistemi + tarayıcı etiketi (IP değişimi tek
 * başına "yeni cihaz" sayılmaz; mobil ağda sürekli değişir). Kendi istemcisini OLUŞTURMAZ: günlük yazarının
 * service_role istemcisi verilir. Hata girişi asla engellemez (best-effort).
 */
export const NEW_DEVICE_LOOKBACK = 50;
/** Bu süreden eski girişler "görülmüş cihaz" sayılmaz (90 gün sonra aynı cihaz yeniden bildirilir). */
export const NEW_DEVICE_WINDOW_DAYS = 90;
/** Giriş denetim kaydının aksiyon kodu (işlem akışı "Güvenlik / giriş" kategorisi). */
export const AUTH_LOGIN_ACTION = "auth.login";

/** Accept-Language'in birincil dil alt etiketi ("tr-TR,tr;q=0.9" → "tr"); yoksa/bozuksa boş. */
export function primaryLanguage(acceptLanguage: string | null | undefined): string {
  const first = String(acceptLanguage ?? "").split(",")[0]?.split(";")[0]?.trim().toLowerCase() ?? "";
  const primary = first.split("-")[0] ?? "";
  return /^[a-z]{2,8}$/.test(primary) ? primary : "";
}

/**
 * Cihaz parmak izi (SAF): cihaz etiketi (işletim sistemi + tarayıcı) + birincil dil → kısa SHA-256. Ham user-agent
 * denetim kaydına YAZILMAZ; sürüm güncellemesi parmak izini değiştirmez (yalnız etiket alanları girer).
 */
export function deviceFingerprint(userAgent: string | null | undefined, acceptLanguage: string | null | undefined): string {
  return createHash("sha256").update(`${deviceLabel(userAgent)}|${primaryLanguage(acceptLanguage)}`).digest("hex").slice(0, 32);
}

/** `auth.login` denetim kaydının `new_value` gövdesi (SAF): parmak izi, okunur cihaz etiketi ve IP özeti (ham IP yok). */
export function loginAuditValue(input: {
  userAgent: string | null | undefined;
  acceptLanguage: string | null | undefined;
  ip: string | null | undefined;
  method?: "password" | "two_factor";
}): Record<string, string | null> {
  return {
    device_hash: deviceFingerprint(input.userAgent, input.acceptLanguage),
    device: deviceLabel(input.userAgent),
    ip_hash: input.ip && input.ip !== "unknown" ? publicEvidenceHash(input.ip) : null,
    method: input.method ?? "password",
  };
}

/** Başarılı ofis girişi denetim kaydı (best-effort; çağıran `afterSafe` ile yanıttan sonra çalıştırır). */
export async function recordLoginAudit(input: {
  tenantId: string;
  userId: string;
  userAgent: string | null;
  acceptLanguage: string | null;
  ip: string | null;
  method?: "password" | "two_factor";
}): Promise<void> {
  await logActivity({
    tenantId: input.tenantId,
    actorId: input.userId,
    action: AUTH_LOGIN_ACTION,
    entityType: "profile",
    entityId: input.userId,
    newValue: loginAuditValue(input),
  });
}

/** Saf karar: önceki başarılı girişler varsa ve hiçbiri bu cihaz etiketinde değilse yeni cihaz. İlk giriş sayılmaz. */
export function isNewDevice(previousUserAgents: readonly (string | null)[], currentUserAgent: string | null): boolean {
  if (previousUserAgents.length === 0) return false;
  const label = deviceLabel(currentUserAgent);
  return !previousUserAgents.some((ua) => deviceLabel(ua) === label);
}

/**
 * Saf karar (pencereli): kullanıcının hiç önceki girişi yoksa yeni sayılmaz (ilk giriş); varsa ve son `windowDays`
 * gün içindeki girişlerin hiçbiri bu cihaz etiketinde değilse yeni cihaz. Tarihi okunamayan satır pencere dışı sayılır.
 */
export function isNewDeviceInWindow(
  previous: readonly { userAgent: string | null; createdAt: string | null }[],
  currentUserAgent: string | null,
  nowMs: number,
  windowDays: number = NEW_DEVICE_WINDOW_DAYS,
): boolean {
  if (previous.length === 0) return false;
  const cutoff = nowMs - windowDays * 86_400_000;
  const recent = previous.filter((p) => {
    const t = p.createdAt ? Date.parse(p.createdAt) : NaN;
    return Number.isFinite(t) && t >= cutoff;
  });
  const label = deviceLabel(currentUserAgent);
  return !recent.some((p) => deviceLabel(p.userAgent) === label);
}

export async function notifyIfNewDevice(
  admin: SupabaseClient,
  input: { userId: string; tenantId: string; ip: string | null; userAgent: string | null },
): Promise<void> {
  try {
    const policy = await readOfficeSecurityPolicyCached(input.tenantId);
    if (!policy?.newDeviceAlert) return;
    const { data: prev, error } = await admin
      .from("login_events")
      .select("user_agent, created_at")
      .eq("user_id", input.userId)
      .eq("result", "success")
      .order("created_at", { ascending: false })
      .limit(NEW_DEVICE_LOOKBACK);
    if (error) return;
    const previous = ((prev ?? []) as { user_agent: string | null; created_at: string | null }[]).map((r) => ({
      userAgent: r.user_agent,
      createdAt: r.created_at,
    }));
    if (!isNewDeviceInWindow(previous, input.userAgent, now())) return;

    const { data: people } = await admin
      .from("profiles")
      .select("id, full_name, role")
      .eq("tenant_id", input.tenantId)
      .eq("is_active", true)
      .or(`id.eq.${input.userId},role.in.(${MANAGER_ROLES.join(",")})`)
      .limit(20);
    const rows = (people ?? []) as { id: string; full_name: string | null; role: string | null }[];
    const who = rows.find((p) => p.id === input.userId)?.full_name?.trim() || "Bir kullanıcı";
    const device = deviceLabel(input.userAgent);
    const ipText = input.ip ? ` (IP ${input.ip})` : "";
    const targets = new Set([input.userId, ...rows.filter((p) => (MANAGER_ROLES as readonly string[]).includes(p.role ?? "")).map((p) => p.id)]);
    await Promise.all(
      [...targets].map((id) =>
        notifyTenant({
          tenantId: input.tenantId,
          userId: id,
          kind: "warning",
          title: "Yeni cihazdan giriş",
          body:
            id === input.userId
              ? `Hesabınıza ${device} cihazından giriş yapıldı${ipText}. Siz değilseniz parolanızı değiştirin ve diğer oturumları kapatın.`
              : `${who}, ${device} cihazından giriş yaptı${ipText}. Tanımıyorsanız oturumu Ayarlar > Güvenlik'ten kapatın.`,
          href: id === input.userId ? "/app/hesabim?sekme=oturumlar" : "/app/ayarlar/guvenlik#oturumlar",
        }).catch(() => undefined),
      ),
    );
  } catch (e) {
    console.error("notifyIfNewDevice", e instanceof Error ? e.message : e);
  }
}
