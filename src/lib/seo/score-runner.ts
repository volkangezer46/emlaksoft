import "server-only";
import { now, trDayKey } from "@/lib/clock";
import { gscKeywordPairs } from "@/lib/google/db";
import { listLabRuns } from "@/lib/perf/store";
import { urlKey } from "./discovery";
import { topQueryByPage, type KwPair } from "./keywords";
import type { PageSnapshot } from "./page-snapshot";
import { explainDrop, scorePage, scoreSite, toLite, type PageScore, type PerfInput, type SiteScore } from "./score";
import { loadSitemapFresh } from "./sitemap-data";
import { readAuditLatest, readAuditPages, readSeoScores, writeSeoScores, type SeoScoreState } from "./store";

/**
 * SEO puanı hesaplayıcısı (sunucu). Robot koşusundan sonra (`executeSeoRobot`) ve yönetim ekranında çalışır.
 * Bağlam yalnız GERÇEK kaynaklardan gelir: sitemap lastmod, `perf_lab_runs` (son 30 gün, mobil), Search Console
 * sorgu × sayfa özeti. Kaynak okunamazsa o bağlam boş kalır (puan yine hesaplanır; ilgili kontrol uygulanamaz/tahmini).
 */

export type ScoreContext = {
  snaps: PageSnapshot[];
  snapAt: string;
  lastmod: Map<string, string>;
  perf: Map<string, PerfInput>;
  topQuery: Map<string, string>;
  pairs: KwPair[];
  gscAvailable: boolean;
  siteCritical: string[];
};

const pathKey = (url: string) => {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url;
  }
};

export async function loadScoreContext(): Promise<ScoreContext | null> {
  const snapshot = await readAuditPages();
  if (!snapshot || snapshot.pages.length === 0) return null;
  const sinceDay = trDayKey(now() - 30 * 86_400_000);
  const [sitemap, lab, kw, run] = await Promise.all([
    loadSitemapFresh().catch(() => null),
    listLabRuns({ limit: 500, sinceDay }).catch(() => ({ rows: [], tableMissing: true })),
    gscKeywordPairs(28).catch(() => ({ available: false, rows: [] as KwPair[] })),
    readAuditLatest(),
  ]);
  const lastmod = new Map<string, string>();
  for (const e of sitemap?.chunks.flat() ?? []) if (e.lastModified) lastmod.set(urlKey(e.url), e.lastModified);
  const perf = new Map<string, PerfInput>();
  // listLabRuns yeniden eskiye sıralı: yol başına ilk mobil koşu en yenisidir.
  for (const r of lab.rows) {
    if (r.device !== "mobile" || r.score === null || perf.has(r.path)) continue;
    perf.set(r.path, { score: Math.max(0, Math.min(100, Number(r.score))), source: r.source });
  }
  return {
    snaps: snapshot.pages,
    snapAt: snapshot.at,
    lastmod,
    perf,
    topQuery: topQueryByPage(kw.rows),
    pairs: kw.rows,
    gscAvailable: kw.available && kw.rows.length > 0,
    siteCritical: (run?.findings ?? []).map((f) => f.code),
  };
}

export function scoreAll(ctx: ScoreContext, nowMs: number = now()): { pages: PageScore[]; site: SiteScore | null } {
  const pages = ctx.snaps.map((s) =>
    scorePage(s, {
      nowMs,
      lastmod: ctx.lastmod.get(urlKey(s.url)) ?? null,
      perf: ctx.perf.get(pathKey(s.url)) ?? null,
      topQuery: ctx.topQuery.get(s.url.replace(/\/+$/, "")) ?? null,
    }),
  );
  const site = scoreSite(
    pages.map((score, i) => ({ score, snap: ctx.snaps[i]! })),
    ctx.siteCritical,
  );
  return { pages, site };
}

/** Puanı hesaplayıp geçmişe ekler ("neden düştü" önceki kayıtla karşılaştırılır). Anlık görüntü yoksa null. */
export async function recordSeoScores(): Promise<SeoScoreState | null> {
  const ctx = await loadScoreContext();
  if (!ctx) return null;
  const { pages, site } = scoreAll(ctx);
  if (!site) return null;
  const prev = await readSeoScores();
  const lites = pages.map(toLite);
  const at = new Date(now()).toISOString();
  const state: SeoScoreState = {
    at,
    site,
    pages: lites,
    drop: prev ? explainDrop(prev.pages, lites) : [],
    history: [...(prev?.history ?? []), { at, total: site.total, categories: site.categories }],
  };
  await writeSeoScores(state);
  return state;
}
