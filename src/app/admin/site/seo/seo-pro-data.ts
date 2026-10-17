import "server-only";
import { cache } from "react";
import { getSeoPage } from "@/lib/seo/registry";
import { aggregateQueries, cannibalization, opportunities } from "@/lib/seo/keywords";
import { gscPathMaps, recommend, type Recommendation } from "@/lib/seo/recommend";
import { loadScoreContext, scoreAll, type ScoreContext } from "@/lib/seo/score-runner";
import type { PageScore, SiteScore } from "@/lib/seo/score";
import type { PageSnapshot } from "@/lib/seo/page-snapshot";
import { readSeoScores, type SeoScoreState } from "@/lib/seo/store";

/**
 * SEO merkezi ekran verisi (istek başına bir kez; React `cache`). Puan GERÇEK robot anlık görüntüsünden canlı
 * hesaplanır (bağlam: hız ölçümü, Search Console, sitemap lastmod); geçmiş/trend saklanan `seo.audit.scores`'tandır.
 */

export type ScoreView = {
  ctx: ScoreContext | null;
  pages: { score: PageScore; snap: PageSnapshot }[];
  site: SiteScore | null;
  stored: SeoScoreState | null;
  recommendations: Recommendation[];
};

export const loadScoreView = cache(async (): Promise<ScoreView> => {
  const [ctx, stored] = await Promise.all([loadScoreContext().catch(() => null), readSeoScores()]);
  if (!ctx) return { ctx: null, pages: [], site: null, stored, recommendations: [] };
  const { pages, site } = scoreAll(ctx);
  const items = pages.map((score, i) => ({ score, snap: ctx.snaps[i]! }));
  const maps = gscPathMaps(ctx.pairs);
  const rows = aggregateQueries(ctx.pairs);
  const recommendations = recommend({
    pages: items.map(({ score, snap }) => ({ score, inSitemap: snap.inSitemap, noindex: snap.noindex, isRegistry: Boolean(getSeoPage(score.path)) })),
    impressionsByPath: maps.impressions,
    topQueryByPath: maps.topQuery,
    opportunities: opportunities(rows, { limit: 10 }),
    cannibals: cannibalization(ctx.pairs, { limit: 10 }),
    limit: 60,
  });
  return { ctx, pages: items, site, stored, recommendations };
});
