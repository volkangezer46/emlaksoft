import { createHash } from "node:crypto";
import { getBaseUrl } from "@/lib/base-url";
import { now, trDayKey } from "@/lib/clock";
import { fetchOwnOriginInspect, readExternalText } from "@/lib/external-fetch";
import {
  auditPage,
  auditPageDeep,
  classifyOgImage,
  extractDeepFacts,
  extractFacts,
  findDuplicates,
  findOrphans,
  isDisallowedByRobots,
  ogImageFinding,
  resolveInternalLink,
  summarize,
  type DeepFacts,
  type Finding,
  type PageFacts,
} from "./audit-rules";
import { discoveryFindings, inboundLinks, nextFrontier, urlKey } from "./discovery";
import { indexNowPrint, postIndexNow } from "./indexnow-events";
import { ALWAYS_DISALLOW } from "./registry";
import { INDEXNOW_DAILY_LIMIT, type SeoIndexNowSettings } from "./schema";
import { isPublicScope, pathOfUrl } from "./scope";
import { loadSitemapFresh } from "./sitemap-data";
import { parseLocs } from "./sitemap-rules";
import { SEO_THRESHOLDS } from "./thresholds";
import { readAuditLatest, readIndexNow, readIndexNowSeen, writeAuditRun, writeIndexNow, writeIndexNowSeen, type AuditRun } from "./store";

/**
 * Otomatik SEO robotu (sunucu). SADECE kendi alan adını (getBaseUrl) tarar: harici site, rakip ya da portal taraması YOKTUR.
 * Kibar: eşzamanlılık 3, istekler arası bekleme, istek zaman aşımı, toplam zaman ve sayfa/bağlantı bütçesi.
 * KEŞİF (SP2): ana sayfa + sitemap sayfalarından iç bağlantılarla en çok 2 seviye ilerlenir (discovery.ts; yalnız aynı köken).
 */

export const ROBOT_LIMITS = {
  concurrency: 3,
  maxPages: 200,
  maxLinksPerPage: 5,
  maxLinkChecks: 100,
  requestTimeoutMs: 6000,
  pauseMs: 80,
  // Vercel işlev süresi 60 sn (cron route maxDuration); 50 sn bütçe geri kalanı kayıt ve bildirim içindir.
  totalBudgetMs: 50_000,
  maxBodyBytes: 1_500_000,
  maxSitemapChildren: 10,
} as const;

const UA = "EmlakSoftSEORobot/1.0 (kendi sitemizin denetimi)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Fetched = { status: number; text: string; headers: Headers; ttfbMs: number; rawBytes: number };

async function fetchLimited(url: string, init: { method?: "GET" | "HEAD" } = {}): Promise<Fetched | null> {
  try {
    const t0 = performance.now();
    const res = await fetchOwnOriginInspect(
      url,
      {
        method: init.method ?? "GET",
        cache: "no-store",
        headers: { "User-Agent": UA, Accept: "text/html,application/xml,text/plain;q=0.9,*/*;q=0.5" },
      },
      { timeoutMs: ROBOT_LIMITS.requestTimeoutMs },
    );
    const ttfbMs = performance.now() - t0;
    let text = "";
    let rawBytes = 0;
    if (init.method !== "HEAD") {
      try {
        text = await readExternalText(res, ROBOT_LIMITS.maxBodyBytes);
        rawBytes = Buffer.byteLength(text, "utf8");
      } catch {
        text = ""; // çok büyük/okunamayan gövde: durum kodu yine de geçerli
        rawBytes = ROBOT_LIMITS.maxBodyBytes + 1;
      }
    } else {
      try {
        await res.body?.cancel();
      } catch {
        /* sessiz */
      }
    }
    return { status: res.status, text, headers: res.headers, ttfbMs, rawBytes };
  } catch {
    return null;
  }
}

async function collectSitemapUrls(origin: string, notes: string[]): Promise<{ urls: string[]; findings: Finding[] }> {
  const findings: Finding[] = [];
  const root = await fetchLimited(`${origin}/sitemap.xml`);
  if (!root || root.status !== 200) {
    findings.push({
      code: "sitemap-unreachable",
      severity: "critical",
      url: `${origin}/sitemap.xml`,
      message: `sitemap.xml okunamadı (${root ? `HTTP ${root.status}` : "yanıt yok"}).`,
      fix: "Sitemap rotasını ve sitemap kapsam ayarlarını kontrol edin.",
    });
    return { urls: [], findings };
  }
  let locs = parseLocs(root.text);
  if (/<sitemapindex/i.test(root.text)) {
    const children = locs.slice(0, ROBOT_LIMITS.maxSitemapChildren);
    locs = [];
    for (const child of children) {
      const res = await fetchLimited(child);
      if (res?.status === 200) locs.push(...parseLocs(res.text));
      else notes.push(`Sitemap parçası okunamadı: ${child}`);
    }
  }
  const host = new URL(origin).host.toLowerCase();
  const urls: string[] = [];
  for (const loc of locs) {
    try {
      const u = new URL(loc);
      if (u.host.toLowerCase() !== host) {
        findings.push({
          code: "sitemap-foreign-host",
          severity: "critical",
          url: loc,
          message: "Sitemap başka bir alan adına ait adres içeriyor (www/apex tutarsızlığı olabilir).",
          fix: "Uygulamanın genel adres ortam değişkenini ana alan adıyla eşitleyin (docs/DEPLOY.md).",
        });
        continue;
      }
      urls.push(loc);
    } catch {
      findings.push({ code: "sitemap-bad-url", severity: "warning", url: loc, message: "Sitemap'te geçersiz adres.", fix: "Adresi düzeltin." });
    }
  }
  return { urls: [...new Set(urls)], findings };
}

const emptyFacts = (url: string): PageFacts => ({
  url,
  status: 0,
  title: null,
  description: null,
  canonical: null,
  ogTitle: null,
  ogDescription: null,
  ogImage: null,
  h1Count: 0,
  robotsMeta: null,
  xRobotsTag: null,
  noindex: false,
  jsonLdCount: 0,
  jsonLdParseErrors: 0,
  jsonLdErrors: [],
  links: [],
  lang: null,
});

export type Crawled = { facts: PageFacts; deep: DeepFacts | null };

/**
 * Adres listesini eşzamanlılık 3 ve kibar beklemeyle çeker. `deadline` aşılınca yeni istek başlatmaz.
 * Dönen dizi istek sırasından bağımsızdır; çağıran adresle eşler.
 */
async function crawl(urls: readonly string[], origin: string, deadline: number): Promise<{ pages: Crawled[]; timedOut: boolean }> {
  const pages: Crawled[] = [];
  let cursor = 0;
  let timedOut = false;
  const worker = async () => {
    for (;;) {
      if (now() > deadline) {
        if (cursor < urls.length) timedOut = true;
        return;
      }
      const url = urls[cursor];
      cursor += 1;
      if (!url) return;
      const res = await fetchLimited(url);
      if (!res) pages.push({ facts: emptyFacts(url), deep: null });
      else {
        const facts = extractFacts(url, res.status, res.text, { xRobotsTag: res.headers.get("x-robots-tag") });
        const deep = res.status >= 200 && res.status < 300 ? extractDeepFacts(url, res.text, origin, { rawBytes: res.rawBytes, ttfbMs: res.ttfbMs }) : null;
        pages.push({ facts, deep });
      }
      await sleep(ROBOT_LIMITS.pauseMs);
    }
  };
  await Promise.all(Array.from({ length: ROBOT_LIMITS.concurrency }, () => worker()));
  return { pages, timedOut };
}

/** Sayfa başına kurallar: temel (auditPage) + genişletilmiş (auditPageDeep). Saf; yeniden denetim de kullanır. */
function pageFindings(c: Crawled, origin: string, inSitemap: boolean): Finding[] {
  const out = auditPage(c.facts, origin, { inSitemap });
  if (c.deep) out.push(...auditPageDeep(c.facts, c.deep, { inSitemap }));
  return out;
}

/** Kendi kökenimizdeki OG görsellerini HEAD ile yoklar; dış görsel ASLA çekilmez (yalnız bilgi bulgusu). */
export async function ogImageFindings(pages: readonly Crawled[], origin: string, deadline: number): Promise<Finding[]> {
  const out: Finding[] = [];
  const statusByImage = new Map<string, number>();
  for (const { facts } of pages) {
    if (facts.status < 200 || facts.status >= 300) continue;
    const og = classifyOgImage(facts.ogImage, facts.url, origin);
    if (!og) continue;
    if (og.kind === "external") {
      const f = ogImageFinding(facts.url, "external", null);
      if (f) out.push(f);
      continue;
    }
    if (!statusByImage.has(og.url)) {
      if (statusByImage.size >= SEO_THRESHOLDS.maxOgImageChecks || now() > deadline) continue;
      let res = await fetchLimited(og.url, { method: "HEAD" });
      if (!res || res.status === 405 || res.status === 501) res = await fetchLimited(og.url);
      statusByImage.set(og.url, res ? res.status : 0);
      await sleep(ROBOT_LIMITS.pauseMs);
    }
    const f = ogImageFinding(facts.url, "own", statusByImage.get(og.url) ?? 0);
    if (f) out.push(f);
  }
  return out;
}

export async function runSeoAudit(trigger: "cron" | "manual"): Promise<AuditRun> {
  const started = now();
  const origin = getBaseUrl();
  const notes: string[] = [];
  const findings: Finding[] = [];
  let truncated = false;

  const { urls: allUrls, findings: sitemapFindings } = await collectSitemapUrls(origin, notes);
  findings.push(...sitemapFindings);
  const urls = allUrls.slice(0, ROBOT_LIMITS.maxPages);
  if (allUrls.length > urls.length) {
    truncated = true;
    notes.push(`Sitemap ${allUrls.length} adres içeriyor; ilk ${urls.length} tanesi denetlendi.`);
  }

  // robots.txt
  const robots = await fetchLimited(`${origin}/robots.txt`);
  const robotsText = robots && robots.status === 200 ? robots.text : "";
  if (!robotsText) {
    findings.push({ code: "robots-unreachable", severity: "critical", url: `${origin}/robots.txt`, message: "robots.txt okunamadı.", fix: "robots rotasını kontrol edin." });
  } else {
    if (!/^sitemap:/im.test(robotsText)) {
      findings.push({ code: "robots-no-sitemap", severity: "warning", url: `${origin}/robots.txt`, message: "robots.txt içinde Sitemap satırı yok.", fix: "Sitemap adresini robots.txt'e ekleyin." });
    }
    for (const must of ALWAYS_DISALLOW.slice(0, 3)) {
      if (!isDisallowedByRobots(robotsText, must.replace(/\/$/, "/x"))) {
        findings.push({ code: "robots-missing-guard", severity: "critical", url: `${origin}/robots.txt`, message: `${must} taramaya açık görünüyor.`, fix: "Güvenlik Disallow kurallarını geri getirin." });
      }
    }
    for (const u of urls) {
      const p = new URL(u).pathname;
      if (isDisallowedByRobots(robotsText, p)) {
        findings.push({ code: "sitemap-disallowed", severity: "critical", url: u, message: "Sitemap'teki adres robots.txt ile engellenmiş.", fix: "Adresi sitemap'ten çıkarın ya da robots kuralını kaldırın." });
      }
    }
  }

  // 1) Tohum: ana sayfa + sitemap sayfaları. 2) Keşif: iç bağlantılarla en çok 2 seviye (aynı köken, kapsam içi).
  const sitemapKeys = new Set(urls.map(urlKey));
  const home = `${origin.replace(/\/+$/, "")}/`;
  const seeds = sitemapKeys.has(urlKey(home)) ? urls : [home, ...urls].slice(0, ROBOT_LIMITS.maxPages);
  const crawlDeadline = started + ROBOT_LIMITS.totalBudgetMs * 0.7;
  const first = await crawl(seeds, origin, crawlDeadline);
  const crawled: Crawled[] = [...first.pages];
  let timedOut = first.timedOut;
  const known = new Set(seeds.map(urlKey));
  let discovered = 0;
  let layer = crawled;
  for (let depth = 1; depth <= SEO_THRESHOLDS.discoveryDepth && !timedOut; depth += 1) {
    const budget = ROBOT_LIMITS.maxPages - crawled.length;
    if (budget <= 0) {
      truncated = true;
      notes.push(`Keşif taraması ${ROBOT_LIMITS.maxPages} sayfa sınırında durdu.`);
      break;
    }
    const frontier = nextFrontier(
      layer.map((c) => c.facts),
      known,
      origin,
      { perPage: ROBOT_LIMITS.maxLinksPerPage, budget },
    );
    if (frontier.length === 0) break;
    for (const u of frontier) known.add(urlKey(u));
    const next = await crawl(frontier, origin, crawlDeadline);
    timedOut = timedOut || next.timedOut;
    crawled.push(...next.pages);
    discovered += next.pages.length;
    layer = next.pages;
  }
  if (timedOut) {
    truncated = true;
    notes.push("Zaman bütçesi dolduğu için bazı sayfalar denetlenemedi.");
  }
  if (discovered > 0) notes.push(`Keşif: sitemap dışından ${discovered} sayfa iç bağlantılarla tarandı.`);

  const facts = crawled.map((c) => c.facts);
  for (const c of crawled) findings.push(...pageFindings(c, origin, sitemapKeys.has(urlKey(c.facts.url))));
  findings.push(...findDuplicates(facts));
  const inbound = inboundLinks(facts, origin);
  findings.push(...discoveryFindings({ pages: facts, sitemapKeys, inbound }));
  // Yetim sayfa ancak tüm sitemap tarandıysa anlamlıdır (kısmi taramada yanlış alarm verir).
  if (!truncated) findings.push(...findOrphans(urls, inbound, origin));
  findings.push(...(await ogImageFindings(crawled, origin, started + ROBOT_LIMITS.totalBudgetMs * 0.8)));

  // İç bağlantı örneklemesi (sayfa başına en çok N, toplam bütçe). Taranan sayfaların durumu önbelleğe önceden yazılır.
  const linkCache = new Map<string, number>();
  const crawledStatus = new Map(facts.map((f) => [f.url, f.status] as const));
  const linkJobs: { page: string; target: string }[] = [];
  for (const f of facts) {
    if (f.status < 200 || f.status >= 300) continue;
    const seen = new Set<string>();
    for (const href of f.links) {
      const target = resolveInternalLink(href, f.url, origin);
      if (!target || target === f.url || seen.has(target)) continue;
      seen.add(target);
      linkJobs.push({ page: f.url, target });
      if (seen.size >= ROBOT_LIMITS.maxLinksPerPage) break;
    }
  }
  let linkCursor = 0;
  const linkWorker = async () => {
    for (;;) {
      if (now() - started > ROBOT_LIMITS.totalBudgetMs) return;
      if (linkCache.size >= ROBOT_LIMITS.maxLinkChecks) return;
      const job = linkJobs[linkCursor];
      linkCursor += 1;
      if (!job) return;
      if (!linkCache.has(job.target)) {
        const prior = crawledStatus.get(job.target);
        if (prior !== undefined) linkCache.set(job.target, prior);
        else {
          let res = await fetchLimited(job.target, { method: "HEAD" });
          if (!res || res.status === 405 || res.status === 501) res = await fetchLimited(job.target);
          linkCache.set(job.target, res ? res.status : 0);
          await sleep(ROBOT_LIMITS.pauseMs);
        }
      }
      const status = linkCache.get(job.target) ?? 0;
      if (status === 0 || status >= 400) {
        findings.push({
          code: "broken-link",
          severity: status === 404 || status === 410 ? "critical" : "warning",
          url: job.page,
          message: `Kırık iç bağlantı: ${new URL(job.target).pathname} (${status === 0 ? "yanıt yok" : `HTTP ${status}`}).`,
          fix: "Bağlantıyı düzeltin ya da /admin/site/seo Yönlendirmeler'den eski yolu yönlendirin.",
        });
      }
    }
  };
  await Promise.all(Array.from({ length: ROBOT_LIMITS.concurrency }, () => linkWorker()));

  const h1: Record<string, number> = {};
  for (const f of facts) if (f.status >= 200 && f.status < 300) h1[f.url] = f.h1Count;

  const run: AuditRun = {
    at: new Date(now()).toISOString(),
    durationMs: now() - started,
    trigger,
    summary: summarize(findings, facts.length, linkCache.size),
    findings,
    h1,
    truncated,
    notes,
    scanned: facts.map((f) => f.url),
    discovered,
  };
  await writeAuditRun(run);
  return run;
}

/**
 * YENİDEN DENETİM (yayın sonrası): yalnız verilen kendi kökenimizdeki adresler çekilir ve son koşunun o adreslere ait
 * sayfa bulguları yenisiyle değiştirilir (sitemap/robots/kırık bağlantı bulguları korunur). Geçmiş grafiğine nokta eklenmez.
 */
export async function reauditUrls(urls: readonly string[]): Promise<{ checked: string[]; findings: Finding[] }> {
  const origin = getBaseUrl();
  const own = [...new Set(urls)].filter((u) => {
    try {
      const p = pathOfUrl(u);
      return new URL(u).origin === new URL(origin).origin && p !== null && isPublicScope(p);
    } catch {
      return false;
    }
  }).slice(0, 20);
  if (own.length === 0) return { checked: [], findings: [] };
  const [latest, sitemap] = await Promise.all([readAuditLatest(), loadSitemapFresh().catch(() => null)]);
  const sitemapKeys = new Set((sitemap?.chunks.flat() ?? []).map((e) => urlKey(e.url)));
  const { pages } = await crawl(own, origin, now() + 20_000);
  const fresh: Finding[] = [];
  for (const c of pages) fresh.push(...pageFindings(c, origin, sitemapKeys.has(urlKey(c.facts.url))));
  if (latest) {
    const pageCodes = new Set(fresh.map((f) => f.code));
    const touched = new Set(own.map(urlKey));
    const kept = latest.findings.filter((f) => !(touched.has(urlKey(f.url)) && (pageCodes.has(f.code) || PAGE_LEVEL_CODES.has(f.code))));
    const merged = [...kept, ...fresh];
    await writeAuditRun(
      { ...latest, findings: merged, summary: summarize(merged, latest.summary.pagesChecked, latest.summary.linksChecked), notes: [...latest.notes.filter((n) => !n.startsWith("Yeniden denetim:")), `Yeniden denetim: ${own.length} adres (${new Date(now()).toISOString().slice(0, 16)} UTC).`] },
      { appendHistory: false },
    );
  }
  return { checked: own, findings: fresh };
}

/** Sayfa düzeyindeki (adres başına yeniden üretilebilen) bulgu kodları. */
const PAGE_LEVEL_CODES = new Set([
  "http-error",
  "sitemap-redirect",
  "missing-title",
  "long-title",
  "missing-description",
  "long-description",
  "missing-canonical",
  "relative-canonical",
  "canonical-host-mismatch",
  "canonical-mismatch",
  "missing-og-image",
  "missing-og-title",
  "missing-h1",
  "multiple-h1",
  "noindex-in-sitemap",
  "jsonld-parse",
  "jsonld-forbidden",
  "jsonld-fields",
  "img-missing-alt",
  "heading-skip",
  "thin-content",
  "slow-ttfb",
  "html-too-large",
  "meta-not-in-head",
  "internal-link-nofollow",
  "mixed-content",
]);

/* ------------------------------ IndexNow ------------------------------ */

const fp = indexNowPrint;

export type IndexNowOutcome = { sent: number; status: string; skipped?: string };

/**
 * Yeni/değişen URL'leri IndexNow'a bildirir. DIŞ ÇAĞRIDIR: yalnız ayar AÇIKSA (varsayılan KAPALI) çalışır.
 * Yalnız sitemap'teki (yani indekslenebilir), kapsam içi ve robotun hata/noindex/yönlendirme bulmadığı adresler gönderilir.
 * Değişiklik tespiti: `url|lastmod` parmak izi daha önce gönderildi mi (seo.indexnow.seen). Günlük sınır: 2000 URL.
 */
export async function runIndexNow(
  entries: readonly { url: string; lastModified?: string }[],
  excludeUrls: ReadonlySet<string>,
  nowMs: number,
): Promise<IndexNowOutcome> {
  const s: SeoIndexNowSettings = await readIndexNow();
  if (!s.enabled) return { sent: 0, status: "kapalı", skipped: "IndexNow etkin değil" };
  if (!/^[a-f0-9]{32}$/.test(s.key)) return { sent: 0, status: "anahtar yok", skipped: "IndexNow anahtarı üretilmemiş" };

  const seen = await readIndexNowSeen();
  const today = trDayKey(nowMs);
  const usedToday = s.dayKey === today ? s.dayCount : 0;
  const remaining = Math.max(0, INDEXNOW_DAILY_LIMIT - usedToday);

  const candidates = entries
    .filter((e) => !excludeUrls.has(e.url))
    .filter((e) => {
      const p = pathOfUrl(e.url);
      return p !== null && isPublicScope(p);
    })
    .map((e) => ({ url: e.url, print: fp(e.url, e.lastModified) }))
    .filter((e) => !seen.has(e.print));

  const allPrints = entries.map((e) => fp(e.url, e.lastModified)).sort().join("");
  const lastHash = createHash("sha256").update(allPrints).digest("hex");

  if (candidates.length === 0) {
    await writeIndexNow({ ...s, lastHash, lastStatus: "değişiklik yok" });
    return { sent: 0, status: "değişiklik yok" };
  }
  if (remaining === 0) return { sent: 0, status: "günlük sınır doldu", skipped: "Günlük IndexNow sınırı doldu" };

  const batch = candidates.slice(0, Math.min(remaining, 10000));
  const res = await postIndexNow(s.key, batch.map((b) => b.url), "sitemap", nowMs);
  if (res.ok) {
    for (const b of batch) seen.add(b.print);
    await writeIndexNowSeen(seen);
    await writeIndexNow({
      ...s,
      lastHash,
      lastSentAt: new Date(nowMs).toISOString(),
      lastCount: batch.length,
      lastStatus: res.status,
      dayKey: today,
      dayCount: usedToday + batch.length,
    });
    return { sent: batch.length, status: res.status };
  }
  await writeIndexNow({ ...s, lastStatus: res.status, lastSentAt: new Date(nowMs).toISOString(), lastCount: 0 });
  return { sent: 0, status: res.status };
}
