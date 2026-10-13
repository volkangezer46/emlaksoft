import { SITE_DOMAIN, SITE_ORIGIN } from "./keys";
import { googleJson, type GoogleDeps } from "./http";
import { QuotaExceededError } from "./quotas";

/**
 * Search Console (yalnız okuma). Site listesi, mülk önerisi, searchAnalytics sayfalı çekimi.
 *
 * İki çekim yapılır (aynı tablo `seo_gsc_daily`):
 *  - boyutlar date+page+query+device → sorgu satırları,
 *  - boyutlar date+page+device → SAYFA TOPLAMI satırları (`query = ''`).
 * Google nadir sorguları gizlediği için sorgu satırlarının toplamı sayfa toplamından küçüktür; ekranda bu not gösterilir.
 * Son 3 gün her senkronda yeniden çekilir (Google verisi geç olgunlaşır).
 */

export const GSC_API = "https://searchconsole.googleapis.com/webmasters/v3";
export const GSC_ROW_LIMIT = 25_000;
/** Bir senkronda en çok sayfa (25.000 × 40 = 1 milyon satır) — sonsuz döngü koruması. */
export const GSC_MAX_PAGES = 40;
export const GSC_REFETCH_DAYS = 3;
/** İlk bağlantıda geriye dönük çekim (90 günlük ekran için). */
export const GSC_BACKFILL_DAYS = 90;

export type GscSite = { siteUrl: string; permissionLevel: string };

export type GscRow = {
  day: string;
  page: string;
  query: string;
  device: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscQuotaGate = { tryConsume(n?: number): boolean };

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export async function listSites(accessToken: string, deps: GoogleDeps = {}): Promise<GscSite[]> {
  const res = await googleJson<{ siteEntry?: GscSite[] }>(`${GSC_API}/sites`, { headers: auth(accessToken), cache: "no-store" }, deps);
  return (res.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser");
}

/** Alan (Domain) mülkü önerilir: sc-domain:emlaksoft.com.tr; yoksa https önek mülkü; yoksa ilk mülk. */
export function suggestProperty(sites: readonly GscSite[]): string | null {
  const urls = sites.map((s) => s.siteUrl);
  const domain = `sc-domain:${SITE_DOMAIN}`;
  if (urls.includes(domain)) return domain;
  const prefix = `${SITE_ORIGIN}/`;
  if (urls.includes(prefix)) return prefix;
  return urls[0] ?? null;
}

export function isDomainProperty(siteUrl: string): boolean {
  return siteUrl.startsWith("sc-domain:");
}

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Çekim aralığı (UTC gün anahtarları). Son kayıtlı günün 3 gün gerisinden (yeniden çekim) dünkü güne;
 * hiç veri yoksa 90 gün geriye. Başlangıç bitişten sonra olamaz.
 */
export function gscFetchRange(lastStoredDay: string | null, nowMs: number): { startDate: string; endDate: string } {
  const end = nowMs - DAY;
  const backfill = end - (GSC_BACKFILL_DAYS - 1) * DAY;
  let start = backfill;
  if (lastStoredDay && /^\d{4}-\d{2}-\d{2}$/.test(lastStoredDay)) {
    const last = Date.parse(`${lastStoredDay}T00:00:00Z`);
    start = Math.max(backfill, Math.min(end, last - (GSC_REFETCH_DAYS - 1) * DAY));
  }
  return { startDate: isoDay(Math.min(start, end)), endDate: isoDay(end) };
}

type ApiRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };

function toRow(r: ApiRow, withQuery: boolean): GscRow | null {
  const k = r.keys ?? [];
  const [day, page] = k;
  const query = withQuery ? (k[2] ?? "") : "";
  const device = (withQuery ? k[3] : k[2]) ?? "";
  if (!day || !page || !device || (withQuery && !query)) return null;
  return {
    day,
    page: page.slice(0, 2000),
    query: query.slice(0, 500),
    device: device.toLowerCase().slice(0, 16),
    clicks: Math.max(0, Math.round(r.clicks ?? 0)),
    impressions: Math.max(0, Math.round(r.impressions ?? 0)),
    ctr: Number.isFinite(r.ctr) ? Number(r.ctr) : 0,
    position: Number.isFinite(r.position) ? Number(r.position) : 0,
  };
}

/**
 * searchAnalytics sorgusu, `startRow` ile 25.000'lik sayfalar halinde; tam sayfa gelmedikçe durur.
 * Her istek önce kota kapısından geçer (dakikalık %80); kapı reddederse `QuotaExceededError`.
 */
export async function fetchSearchAnalytics(
  input: {
    property: string;
    accessToken: string;
    startDate: string;
    endDate: string;
    withQuery: boolean;
    quota?: GscQuotaGate;
  },
  deps: GoogleDeps = {},
): Promise<{ rows: GscRow[]; pages: number; truncated: boolean }> {
  const url = `${GSC_API}/sites/${encodeURIComponent(input.property)}/searchAnalytics/query`;
  const dimensions = input.withQuery ? ["date", "page", "query", "device"] : ["date", "page", "device"];
  const rows: GscRow[] = [];
  for (let page = 0; page < GSC_MAX_PAGES; page += 1) {
    if (input.quota && !input.quota.tryConsume(1)) throw new QuotaExceededError("gsc");
    const res = await googleJson<{ rows?: ApiRow[] }>(
      url,
      {
        method: "POST",
        headers: { ...auth(input.accessToken), "content-type": "application/json" },
        body: JSON.stringify({
          startDate: input.startDate,
          endDate: input.endDate,
          dimensions,
          type: "web",
          rowLimit: GSC_ROW_LIMIT,
          startRow: page * GSC_ROW_LIMIT,
        }),
        cache: "no-store",
      },
      deps,
      32 * 1024 * 1024,
    );
    const got = res.rows ?? [];
    for (const r of got) {
      const row = toRow(r, input.withQuery);
      if (row) rows.push(row);
    }
    if (got.length < GSC_ROW_LIMIT) return { rows, pages: page + 1, truncated: false };
  }
  return { rows, pages: GSC_MAX_PAGES, truncated: true };
}

/** Tam URL → site içi yol (yalnız kendi alan adımız; değilse null). */
export function pathOfPage(page: string): string | null {
  try {
    const u = new URL(page);
    if (u.hostname !== SITE_DOMAIN && u.hostname !== `www.${SITE_DOMAIN}`) return null;
    return u.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}
