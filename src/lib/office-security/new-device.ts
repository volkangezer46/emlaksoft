import type { SupabaseClient } from "@supabase/supabase-js";
import { deviceLabel } from "@/lib/account/device-label";
import { notifyTenant } from "@/lib/notify";
import { readOfficeSecurityPolicyCached } from "./policy-cache";

/**
 * DG7 yeni cihazdan giriş bildirimi. Başarılı giriş günlüğe yazılmadan ÖNCE çağrılır (`logLoginEvent`); politika
 * kapalıysa (önbellekli görüntü) hiçbir sorgu yapılmaz. Cihaz = işletim sistemi + tarayıcı etiketi (IP değişimi tek
 * başına "yeni cihaz" sayılmaz; mobil ağda sürekli değişir). Kendi istemcisini OLUŞTURMAZ: günlük yazarının
 * service_role istemcisi verilir. Hata girişi asla engellemez (best-effort).
 */
export const NEW_DEVICE_LOOKBACK = 50;

/** Saf karar: önceki başarılı girişler varsa ve hiçbiri bu cihaz etiketinde değilse yeni cihaz. İlk giriş sayılmaz. */
export function isNewDevice(previousUserAgents: readonly (string | null)[], currentUserAgent: string | null): boolean {
  if (previousUserAgents.length === 0) return false;
  const label = deviceLabel(currentUserAgent);
  return !previousUserAgents.some((ua) => deviceLabel(ua) === label);
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
      .select("user_agent")
      .eq("user_id", input.userId)
      .eq("result", "success")
      .order("created_at", { ascending: false })
      .limit(NEW_DEVICE_LOOKBACK);
    if (error) return;
    if (!isNewDevice(((prev ?? []) as { user_agent: string | null }[]).map((r) => r.user_agent), input.userAgent)) return;

    const { data: people } = await admin
      .from("profiles")
      .select("id, full_name, role")
      .eq("tenant_id", input.tenantId)
      .eq("is_active", true)
      .or(`id.eq.${input.userId},role.eq.owner`)
      .limit(10);
    const rows = (people ?? []) as { id: string; full_name: string | null; role: string | null }[];
    const who = rows.find((p) => p.id === input.userId)?.full_name?.trim() || "Bir kullanıcı";
    const device = deviceLabel(input.userAgent);
    const ipText = input.ip ? ` (IP ${input.ip})` : "";
    const targets = new Set([input.userId, ...rows.filter((p) => p.role === "owner").map((p) => p.id)]);
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
