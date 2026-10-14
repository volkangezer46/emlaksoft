/**
 * BAKIM KAPSAMI (saf, yan etkisiz; proxy + yönetim ekranı ortak).
 *
 * Depo: `platform_settings` 'platform.maintenance_scope' = JSON {scope, startsAt, endsAt}. Satır yoksa / bozuksa
 * kapsam "app" (yalnız ofis paneli) sayılır: bakım modu açılsa bile ANA SAYFA ve vitrin açık kalır. Eski davranış
 * (tüm site) yalnız açıkça "site" seçilince geçerlidir. Açık/kapalı anahtarı ayrıdır ('maintenance_mode');
 * bu ayar yalnız NEREYİ ve NE ZAMAN kapsayacağını söyler.
 */

export const MAINTENANCE_SCOPE_SETTING_KEY = "platform.maintenance_scope";

export const MAINTENANCE_SCOPES = ["app", "app_vitrin", "site"] as const;
export type MaintenanceScope = (typeof MAINTENANCE_SCOPES)[number];

export type MaintenanceWindow = { startsAt: string | null; endsAt: string | null };
export type MaintenanceScopeSetting = MaintenanceWindow & { scope: MaintenanceScope };

export const DEFAULT_MAINTENANCE_SCOPE: MaintenanceScopeSetting = { scope: "app", startsAt: null, endsAt: null };

export const MAINTENANCE_SCOPE_LABELS: Record<MaintenanceScope, string> = {
  app: "Yalnız ofis paneli (/app)",
  app_vitrin: "Ofis paneli + vitrin",
  site: "Tüm site",
};

/** Varsayılan Retry-After (sn); bitiş zamanı verilmemişse kullanılır. */
export const DEFAULT_RETRY_AFTER_SEC = 600;

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Ham ayar metni → kapsam. Bozuk/eksik = varsayılan ("app"). */
export function parseMaintenanceScope(raw: string | null | undefined): MaintenanceScopeSetting {
  if (!raw || !raw.trim()) return DEFAULT_MAINTENANCE_SCOPE;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== "object") return DEFAULT_MAINTENANCE_SCOPE;
    const scope = MAINTENANCE_SCOPES.includes(v.scope as MaintenanceScope) ? (v.scope as MaintenanceScope) : "app";
    return { scope, startsAt: isoOrNull(v.startsAt), endsAt: isoOrNull(v.endsAt) };
  } catch {
    return DEFAULT_MAINTENANCE_SCOPE;
  }
}

/** Bakım sayfası gösterilmeyen yollar: süper admin, giriş (MFA dahil), durum sayfası, sağlık, cron, API, statik. */
export function isMaintenanceExemptPath(path: string): boolean {
  // Durum sayfası bakım sırasında da açık kalır (bakımı ve kesintiyi duyuran yer).
  if (path === "/bakim" || path === "/durum") return true;
  const prefixes = ["/admin", "/giris", "/api", "/_next"];
  if (prefixes.some((p) => path === p || path.startsWith(`${p}/`))) return true;
  if (path === "/favicon.ico" || path === "/robots.txt" || path === "/sitemap.xml") return true;
  // Dosya uzantılı yollar (statik varlıklar)
  return /\.[a-zA-Z0-9]{1,8}$/.test(path);
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Zaman penceresi şu an etkin mi (başlangıç gelmemişse / bitiş geçmişse hayır). */
export function maintenanceWindowActive(window: MaintenanceWindow, nowMs: number): boolean {
  const start = window.startsAt ? new Date(window.startsAt).getTime() : NaN;
  const end = window.endsAt ? new Date(window.endsAt).getTime() : NaN;
  if (Number.isFinite(start) && nowMs < start) return false;
  if (Number.isFinite(end) && nowMs >= end) return false;
  return true;
}

/**
 * Bakım modu AÇIKKEN bu yol bakım kapsamında mı? Muaf yollar her kapsamda muaftır.
 *  - "app"        → yalnız /app/**
 *  - "app_vitrin" → /app/** ve /vitrin/**
 *  - "site"       → muaf olmayan her yol (eski davranış)
 * Ana sayfa "/" yalnız "site" kapsamında bakıma düşer.
 */
export function isPathUnderMaintenance(
  path: string,
  scope: MaintenanceScope,
  window: MaintenanceWindow,
  nowMs: number,
): boolean {
  if (isMaintenanceExemptPath(path)) return false;
  if (!maintenanceWindowActive(window, nowMs)) return false;
  if (scope === "site") return true;
  if (under(path, "/app")) return true;
  return scope === "app_vitrin" && under(path, "/vitrin");
}

/** Retry-After: bitiş zamanı varsa kalan saniye (en az 60), yoksa varsayılan. */
export function maintenanceRetryAfterSec(window: MaintenanceWindow, nowMs: number): number {
  const end = window.endsAt ? new Date(window.endsAt).getTime() : NaN;
  if (!Number.isFinite(end) || end <= nowMs) return DEFAULT_RETRY_AFTER_SEC;
  return Math.max(60, Math.ceil((end - nowMs) / 1000));
}

/** Yönetim ekranı önizlemesi: seçilen kapsamın bugünkü etkisi (düz metin). */
export function maintenanceImpactPreview(scope: MaintenanceScope): string[] {
  if (scope === "site") {
    return [
      "Ana sayfa, vitrinler, kayıt ve ofis paneli bakım sayfasını gösterir.",
      "Yönetim paneli, giriş ve API açık kalır.",
    ];
  }
  return [
    "Ana sayfa açık kalır.",
    scope === "app_vitrin" ? "Ofis paneli ve vitrin sayfaları bakım sayfasını gösterir." : "Yalnız ofis paneli (/app) bakım sayfasını gösterir; vitrin açık kalır.",
    "Platform personeli ofis panelinde çalışmaya devam eder; yönetim paneli ve giriş açık kalır.",
  ];
}
