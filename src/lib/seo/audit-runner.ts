import { createHash } from "node:crypto";
import { getBaseUrl } from "@/lib/base-url";
import { trDayKey } from "@/lib/clock";
import { discardExternalResponse, fetchExternal, fetchOwnOriginInspect, readExternalText } from "@/lib/external-fetch";
import {
  auditPage,
  extractFacts,
  findDuplicates,
  isDisallowedByRobots,
  resolveInternalLink,
  summarize,
  type Finding,
  type PageFacts,
} from "./audit-rules";
import { ALWAYS_DISALLOW } from "./registry";
import { INDEXNOW_DAILY_LIMIT, type SeoIndexNowSettings } from "./schema";
import { parseLocs } from "./sitemap-rules";
import { readIndexNow, readIndexNowSeen, writeAuditRun, writeIndexNow, writeIndexNowSeen, type AuditRun } from "./store";

/**
 * Otomatik SEO robotu (sunucu). SADECE kendi alan adını (getBaseUrl) tarar: harici site, rakip ya da portal taraması YOKTUR.
 * Kibar: eşzamanlılık 3, istekler arası bekleme, istek zaman aşımı, toplam zaman ve sayfa/bağlantı bütçesi.
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

async function fetchLimited(
  url: string,
  init: { method?: "GET" | "HEAD" } = {},
): Promise<{ status: number; text: string; headers: Headers } | null> {
  try {
    const res = await fetchOwnOriginInspect(
      url,
      {
        method: init.method ?? "GET",
        cache: "no-store",
        headers: { "User-Agent": UA, Accept: "text/html,application/xml,text/plain;q=0.9,*/*;q=0.5" },
      },
      { timeoutMs: ROBOT_LIMITS.requestTimeoutMs },
    );
    let text = "";
    if (init.method !== "HEAD") {
      try {
        text = await readExternalText(res, ROBOT_LIMITS.maxBodyBytes);
      } catch {
        text = ""; // çok büyük/okunamayan gövde: durum kodu yine de geçerli
      }
    }
    return { status: res.status, text, headers: res.headers };
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

export async function runSeoAudit(trigger: "cron" | "manual"): Promise<AuditRun> {
  const started = Date.now();
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

  // Sayfaları gez (eşzamanlılık 3, kibar bekleme)
  const facts: PageFacts[] = [];
  const inSitemap = new Set(urls);
  let cursor = 0;
  let timedOut = false;
  const worker = async () => {
    for (;;) {
      if (Date.now() - started > ROBOT_LIMITS.totalBudgetMs * 0.7) {
        timedOut = true;
        return;
      }
      const i = cursor;
      cursor += 1;
      const url = urls[i];
      if (!url) return;
      const res = await fetchLimited(url);
      if (!res) {
        facts.push({ url, status: 0, title: null, description: null, canonical: null, ogTitle: null, ogDescription: null, ogImage: null, h1Count: 0, robotsMeta: null, xRobotsTag: null, noindex: false, jsonLdCount: 0, jsonLdParseErrors: 0, jsonLdErrors: [], links: [], lang: null });
      } else {
        facts.push(extractFacts(url, res.status, res.text, { xRobotsTag: res.headers.get("x-robots-tag") }));
      }
      await sleep(ROBOT_LIMITS.pauseMs);
    }
  };
  await Promise.all(Array.from({ length: ROBOT_LIMITS.concurrency }, () => worker()));
  if (timedOut) {
    truncated = true;
    notes.push("Zaman bütçesi dolduğu için bazı sayfalar denetlenemedi.");
  }

  for (const f of facts) findings.push(...auditPage(f, origin, { inSitemap: inSitemap.has(f.url) }));
  findings.push(...findDuplicates(facts));

  // İç bağlantı örneklemesi (sayfa başına en çok N, toplam bütçe)
  const linkCache = new Map<string, number>();
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
      if (Date.now() - started > ROBOT_LIMITS.totalBudgetMs) return;
      if (linkCache.size >= ROBOT_LIMITS.maxLinkChecks) return;
      const job = linkJobs[linkCursor];
      linkCursor += 1;
      if (!job) return;
      if (!linkCache.has(job.target)) {
        let res = await fetchLimited(job.target, { method: "HEAD" });
        if (!res || res.status === 405 || res.status === 501) res = await fetchLimited(job.target);
        linkCache.set(job.target, res ? res.status : 0);
        await sleep(ROBOT_LIMITS.pauseMs);
      }
      const status = linkCache.get(job.target) ?? 0;
      if (status === 0 || status >= 400) {
        findings.push({
          code: "broken-link",
          severity: status === 404 || status === 410 ? "critical" : "warning",
          url: job.page,
          message: `Kırık iç bağlantı: ${new URL(job.target).pathname} (${status === 0 ? "yanıt yok" : `HTTP ${status}`}).`,
          fix: "Bağlantıyı düzeltin ya da /admin/seo Yönlendirmeler'den eski yolu yönlendirin.",
        });
      }
    }
  };
  await Promise.all(Array.from({ length: ROBOT_LIMITS.concurrency }, () => linkWorker()));

  const h1: Record<string, number> = {};
  for (const f of facts) if (f.status >= 200 && f.status < 300) h1[f.url] = f.h1Count;

  const run: AuditRun = {
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    trigger,
    summary: summarize(findings, facts.length, linkCache.size),
    findings,
    h1,
    truncated,
    notes,
  };
  await writeAuditRun(run);
  return run;
}

/* ------------------------------ IndexNow ------------------------------ */

const fp = (url: string, lastmod?: string) => createHash("sha1").update(`${url}|${lastmod ?? ""}`).digest("hex").slice(0, 10);

export type IndexNowOutcome = { sent: number; status: string; skipped?: string };

/**
 * Yeni/değişen URL'leri IndexNow'a bildirir. DIŞ ÇAĞRIDIR: yalnız ayar AÇIKSA (varsayılan KAPALI) çalışır.
 * Yalnız sitemap'teki (yani indekslenebilir) ve robotun hata/noindex/yönlendirme bulmadığı adresler gönderilir.
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

  const origin = getBaseUrl();
  const host = new URL(origin).host;
  const seen = await readIndexNowSeen();
  const today = trDayKey(nowMs);
  const usedToday = s.dayKey === today ? s.dayCount : 0;
  const remaining = Math.max(0, INDEXNOW_DAILY_LIMIT - usedToday);

  const candidates = entries
    .filter((e) => !excludeUrls.has(e.url))
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
  let status = "";
  try {
    const res = await fetchExternal(
      "https://api.indexnow.org/indexnow",
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host, key: s.key, keyLocation: `${origin}/${s.key}.txt`, urlList: batch.map((b) => b.url) }),
        cache: "no-store",
      },
      { timeoutMs: 10_000 },
    );
    await discardExternalResponse(res);
    status = `HTTP ${res.status}`;
    if (res.status === 200 || res.status === 202) {
      for (const b of batch) seen.add(b.print);
      await writeIndexNowSeen(seen);
      await writeIndexNow({
        ...s,
        lastHash,
        lastSentAt: new Date(nowMs).toISOString(),
        lastCount: batch.length,
        lastStatus: status,
        dayKey: today,
        dayCount: usedToday + batch.length,
      });
      return { sent: batch.length, status };
    }
  } catch {
    status = "bağlantı hatası";
  }
  await writeIndexNow({ ...s, lastStatus: status, lastSentAt: new Date(nowMs).toISOString(), lastCount: 0 });
  return { sent: 0, status };
}
