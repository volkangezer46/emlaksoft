import { now } from "@/lib/clock";
import { isDemoLoginEnabled, isPlatformDemoPersonaAllowed } from "@/lib/demo-environment";
import { readPlatformFlagsCached, SECURITY_SETTING_KEYS } from "@/lib/platform-flags-cache";

/**
 * DEMO GİRİŞİ POLİTİKASI — env TAVANI + yönetimden anahtar.
 *
 * Tavan (sunucu ortamı, `.env.production`): `isDemoLoginEnabled` (ofis kartları) ve `isPlatformDemoPersonaAllowed`
 * (süper admin/platform kartları). Tavan kapalıysa yönetimden HİÇBİR şey açılamaz.
 *
 * Anahtar (`platform_settings` 'platform.demo_login' = {mode, until, reason, by}):
 *  - satır YOK → env davranışı aynen (SAHİP KARARI: demo kartları "ben diyene kadar" açık; yayın davranışı değişmez)
 *  - "off"             → hiçbir demo kartı yok
 *  - "tenant"          → yalnız ofis kartları (platform kapalı)
 *  - "tenant_platform" → ofis + platform kartları; yalnız `until` gelecekte ve en çok 24 saat sonra ise
 *    (süre dolunca platform kendiliğinden kapanır; cron gerekmez, okuma anında değerlendirilir).
 */

export const DEMO_LOGIN_SETTING_KEY = SECURITY_SETTING_KEYS.demoLogin;
export const DEMO_PLATFORM_MAX_HOURS = 24;
const HOUR_MS = 3_600_000;

export const DEMO_MODES = ["off", "tenant", "tenant_platform"] as const;
export type DemoMode = (typeof DEMO_MODES)[number];

export type DemoPolicyRow = { mode: DemoMode; until: string | null; reason?: string; by?: string };
export type DemoCeiling = { tenant: boolean; platform: boolean };
export type DemoPolicy = { tenant: boolean; platform: boolean };

export const DEMO_MODE_LABELS: Record<DemoMode, string> = {
  off: "Kapalı",
  tenant: "Yalnız ofis kartları",
  tenant_platform: "Ofis + platform (süper admin) kartları",
};

/** Ham ayar → satır. Bozuk/eksik = null (satır yok sayılır → env davranışı). */
export function parseDemoPolicyRow(raw: string | null | undefined): DemoPolicyRow | null {
  if (!raw || !raw.trim()) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== "object" || !DEMO_MODES.includes(v.mode as DemoMode)) return null;
    const until = typeof v.until === "string" && Number.isFinite(new Date(v.until).getTime()) ? v.until : null;
    return {
      mode: v.mode as DemoMode,
      until,
      reason: typeof v.reason === "string" ? v.reason : undefined,
      by: typeof v.by === "string" ? v.by : undefined,
    };
  } catch {
    return null;
  }
}

/** Platform demosu süresi geçerli mi: gelecekte ve en çok now+24 sa. */
export function demoUntilValid(until: string | null, nowMs: number): boolean {
  if (!until) return false;
  const t = new Date(until).getTime();
  return Number.isFinite(t) && t > nowMs && t <= nowMs + DEMO_PLATFORM_MAX_HOURS * HOUR_MS;
}

/** Saf karar: env tavanı ∧ DB anahtarı. */
export function effectiveDemoPolicy(
  envCeiling: DemoCeiling,
  db: Pick<DemoPolicyRow, "mode" | "until"> | null,
  nowMs: number,
): DemoPolicy {
  const tenantCeiling = envCeiling.tenant;
  const platformCeiling = envCeiling.tenant && envCeiling.platform;
  if (!db) return { tenant: tenantCeiling, platform: platformCeiling };
  if (db.mode === "off") return { tenant: false, platform: false };
  if (db.mode === "tenant") return { tenant: tenantCeiling, platform: false };
  return { tenant: tenantCeiling, platform: platformCeiling && demoUntilValid(db.until, nowMs) };
}

/** Env tavanı (senkron, mevcut okuyucular). */
export function demoEnvCeiling(): DemoCeiling {
  return { tenant: isDemoLoginEnabled(), platform: isPlatformDemoPersonaAllowed() };
}

export type DemoPolicyNow = DemoPolicy & { ceiling: DemoCeiling; row: DemoPolicyRow | null };

/** Şu anki etkin politika (DB bayrak önbelleğinden; okuma hatasında satır yok = env davranışı). */
export async function getDemoPolicyNow(): Promise<DemoPolicyNow> {
  const ceiling = demoEnvCeiling();
  const row = parseDemoPolicyRow((await readPlatformFlagsCached()).demoLoginRaw);
  // Tavan tamamen kapalıysa karar kesin kapalı; satır yalnız gösterim için (yönetim ekranı) döner.
  if (!ceiling.tenant) return { tenant: false, platform: false, ceiling, row };
  return { ...effectiveDemoPolicy(ceiling, row, now()), ceiling, row };
}
