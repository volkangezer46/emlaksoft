import { fetchExternal, readExternalText } from "@/lib/external-fetch";
import { SITE_DOMAIN, SITE_ORIGIN } from "./keys";
import { googleJson, type GoogleDeps } from "./http";
import { INSPECTION_DAILY_CAP } from "./quotas";

/**
 * URL Inspection (Search Console). Günde en çok 50 URL (Q2): önce hiç incelenmemiş (yeni), sonra `lastmod`'u son
 * incelemeden yeni olan (değişen), sonra en eski incelenenler. Sitemap CANLI adresten (/sitemap.xml) okunur; dizin
 * sitemap'i ise yalnız kendi alan adımızdaki alt sitemap'ler izlenir.
 */

export const INSPECTION_ENDPOINT = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
export const LIVE_SITEMAP_URL = `${SITE_ORIGIN}/sitemap.xml`;
const MAX_CHILD_SITEMAPS = 10;

export type SitemapEntry = { url: string; lastmod: string | null };
export type InspectionRecord = { url: string; checked_at: string };

export type InspectionResult = {
  url: string;
  verdict: string;
  coverage: string | null;
  google_canonical: string | null;
  user_canonical: string | null;
};

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

/** Sitemap XML ayrıştırma (saf). `kind`: urlset ya da sitemapindex. */
export function parseSitemap(xml: string): { kind: "urlset" | "index"; entries: SitemapEntry[] } {
  const kind = /<sitemapindex[\s>]/i.test(xml) ? "index" : "urlset";
  const tag = kind === "index" ? "sitemap" : "url";
  const entries: SitemapEntry[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
  for (const m of xml.matchAll(re)) {
    const body = m[1] ?? "";
    const loc = /<loc>([\s\S]*?)<\/loc>/i.exec(body)?.[1];
    if (!loc) continue;
    const lastmod = /<lastmod>([\s\S]*?)<\/lastmod>/i.exec(body)?.[1];
    entries.push({ url: decodeXml(loc), lastmod: lastmod ? decodeXml(lastmod) : null });
  }
  return { kind, entries };
}

function isOwnUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === SITE_DOMAIN || u.hostname === `www.${SITE_DOMAIN}`);
  } catch {
    return false;
  }
}

function ms(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

/**
 * İncelenecek URL'leri seçer (saf). Sıra: yeni → değişen (lastmod > checked_at) → en eski incelenen.
 * `limit` en çok 50 (Q2) ve kota payıyla sınırlanır.
 */
export function selectUrlsToInspect(
  sitemap: readonly SitemapEntry[],
  inspected: readonly InspectionRecord[],
  limit: number = INSPECTION_DAILY_CAP,
): string[] {
  const cap = Math.max(0, Math.min(INSPECTION_DAILY_CAP, Math.floor(limit)));
  if (cap === 0) return [];
  const last = new Map(inspected.map((r) => [r.url, r.checked_at] as const));
  const seen = new Set<string>();
  const fresh: string[] = [];
  const changed: { url: string; lastmod: number }[] = [];
  const old: { url: string; checked: number }[] = [];
  for (const e of sitemap) {
    if (seen.has(e.url) || !isOwnUrl(e.url)) continue;
    seen.add(e.url);
    const checked = last.get(e.url);
    if (!checked) {
      fresh.push(e.url);
      continue;
    }
    const lm = ms(e.lastmod);
    const ck = ms(checked);
    if (Number.isFinite(lm) && (!Number.isFinite(ck) || lm > ck)) changed.push({ url: e.url, lastmod: lm });
    else old.push({ url: e.url, checked: Number.isFinite(ck) ? ck : 0 });
  }
  changed.sort((a, b) => b.lastmod - a.lastmod);
  old.sort((a, b) => a.checked - b.checked);
  return [...fresh, ...changed.map((c) => c.url), ...old.map((o) => o.url)].slice(0, cap);
}

type OwnFetch = (url: string) => Promise<string>;

async function defaultOwnFetch(url: string): Promise<string> {
  // Kendi canlı adresimiz (kimlik bilgisi YOK). Yönlendirme reddi + süre sınırı fetchExternal'da.
  const res = await fetchExternal(url, { headers: { accept: "application/xml,text/xml" }, cache: "no-store" }, { timeoutMs: 15_000 });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`sitemap okunamadı (${res.status})`);
  }
  return readExternalText(res, 8 * 1024 * 1024);
}

/** Canlı sitemap (dizin ise alt sitemap'leri de, yalnız kendi alan adımızdan). */
export async function readLiveSitemap(fetchText: OwnFetch = defaultOwnFetch): Promise<SitemapEntry[]> {
  const root = parseSitemap(await fetchText(LIVE_SITEMAP_URL));
  if (root.kind === "urlset") return root.entries;
  const out: SitemapEntry[] = [];
  for (const child of root.entries.filter((e) => isOwnUrl(e.url)).slice(0, MAX_CHILD_SITEMAPS)) {
    out.push(...parseSitemap(await fetchText(child.url)).entries);
  }
  return out;
}

type ApiInspection = {
  inspectionResult?: {
    indexStatusResult?: { verdict?: string; coverageState?: string; googleCanonical?: string; userCanonical?: string };
  };
};

export async function inspectUrl(
  input: { property: string; url: string; accessToken: string },
  deps: GoogleDeps = {},
): Promise<InspectionResult> {
  const res = await googleJson<ApiInspection>(
    INSPECTION_ENDPOINT,
    {
      method: "POST",
      headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ inspectionUrl: input.url, siteUrl: input.property, languageCode: "tr-TR" }),
      cache: "no-store",
    },
    deps,
  );
  const s = res.inspectionResult?.indexStatusResult ?? {};
  return {
    url: input.url,
    verdict: (s.verdict ?? "VERDICT_UNSPECIFIED").slice(0, 40),
    coverage: s.coverageState ? s.coverageState.slice(0, 200) : null,
    google_canonical: s.googleCanonical ? s.googleCanonical.slice(0, 2000) : null,
    user_canonical: s.userCanonical ? s.userCanonical.slice(0, 2000) : null,
  };
}
