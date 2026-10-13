import { COLLECTORS, AREA_META } from "@/lib/site-issues/collectors";
import { canDraft, executorFor, screenFallback } from "@/lib/site-issues/executors";
import { areaScore, areaSentence, siteScore, topGains, type ScoredIssue } from "@/lib/site-issues/score";
import { isActiveStatus } from "@/lib/site-issues/state";
import { ISSUE_AREAS, type IssueArea, type IssueSeverity, type SiteIssue } from "@/lib/site-issues/types";
import type { OptimizerAction } from "@/lib/site-issues/store";

/**
 * Kokpit GÖRÜNÜM MODELİ (SAF; render sırasında dış çağrı yok): toplanmış tablolardan Site notu, kutucuklar, kuyruk
 * ve Otopilot özeti üretilir. Veri yoksa sayı yoktur ("Veri birikiyor"); toplayıcısı olmayan alan "Henüz bağlı değil".
 */

export type TileArea = Exclude<IssueArea, "icerik">;
export const TILE_AREAS: readonly TileArea[] = ["seo", "hiz", "olcum", "reklam"];

export type Tile = {
  area: TileArea;
  label: string;
  connected: boolean;
  hasData: boolean;
  score: number | null;
  sentence: string;
  /** İkincil satır (teknik terimler yalnız burada). */
  secondary: string | null;
  open: number;
  href: string;
  setupHref: string;
  setupLabel: string;
};

export type QueueRow = SiteIssue & { canDraft: boolean; fallback: { href: string; label: string } | null };

export type KokpitModel = {
  available: boolean;
  hasData: boolean;
  score: number | null;
  gain: number;
  gainPicks: { id: string; title: string; url: string; href: string | null }[];
  tiles: Tile[];
  queue: QueueRow[];
  ignored: QueueRow[];
  filter: IssueArea | null;
  counts: Record<IssueArea, number>;
  lastSyncAt: string | null;
  collectorIds: { id: string; label: string }[];
};

const SEV_RANK: Record<IssueSeverity, number> = { kritik: 0, uyari: 1, bilgi: 2 };

export function parseAreaFilter(v: string | string[] | undefined): IssueArea | null {
  const s = Array.isArray(v) ? v[0] : v;
  return ISSUE_AREAS.includes(s as IssueArea) ? (s as IssueArea) : null;
}

type SyncAfter = { sourceAt?: string | null; issues?: number };

export function buildKokpitModel(input: { available: boolean; issues: readonly SiteIssue[]; syncs: readonly OptimizerAction[]; filter: IssueArea | null }): KokpitModel {
  const lastOk = new Map<string, OptimizerAction>();
  for (const a of input.syncs) if (a.kind === "sync" && a.status === "ok" && !lastOk.has(a.target)) lastOk.set(a.target, a);

  const areaState = (area: IssueArea) => {
    const cs = COLLECTORS.filter((c) => c.area === area);
    const hasData = cs.some((c) => {
      const s = lastOk.get(c.id);
      return Boolean(s && (s.after as SyncAfter | null)?.sourceAt);
    });
    return { connected: cs.length > 0, hasData: input.available && hasData };
  };

  const scored: ScoredIssue[] = input.issues.map((i) => ({ id: i.id, area: i.area, severity: i.severity, status: i.status, url: i.url, title: i.title }));
  const withData = ISSUE_AREAS.filter((a) => areaState(a).hasData);
  const anyData = withData.length > 0;
  const counted = scored.filter((i) => withData.includes(i.area));
  const gains = topGains(counted);
  const byId = new Map(input.issues.map((i) => [i.id, i]));

  const tiles: Tile[] = TILE_AREAS.map((area) => {
    const st = areaState(area);
    const meta = AREA_META[area];
    const open = scored.filter((i) => i.area === area && isActiveStatus(i.status));
    const last = COLLECTORS.filter((c) => c.area === area)
      .map((c) => (lastOk.get(c.id)?.after as SyncAfter | null)?.sourceAt)
      .find(Boolean);
    return {
      area,
      label: meta.label,
      connected: st.connected,
      hasData: st.hasData,
      score: areaScore(scored, area, st.hasData),
      sentence: areaSentence(area, scored, st),
      secondary: st.hasData && area === "seo" && last ? `Kaynak: SEO robotunun son taraması` : null,
      open: open.length,
      href: `/admin/site?alan=${area}#kuyruk`,
      setupHref: meta.setupHref,
      setupLabel: meta.setupLabel,
    };
  });

  const toRow = (i: SiteIssue): QueueRow => {
    const known = executorFor(i.proposal?.kind);
    return { ...i, canDraft: canDraft(i), fallback: i.proposal && !known ? screenFallback(i) : null };
  };
  const visible = input.issues.filter((i) => !input.filter || i.area === input.filter);
  const queue = visible
    .filter((i) => isActiveStatus(i.status))
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.last_seen.localeCompare(a.last_seen) || a.url.localeCompare(b.url))
    .map(toRow);
  const ignored = visible.filter((i) => i.status === "yoksayildi").map(toRow);
  const counts = Object.fromEntries(ISSUE_AREAS.map((a) => [a, input.issues.filter((i) => i.area === a && isActiveStatus(i.status)).length])) as Record<IssueArea, number>;
  const lastSyncAt = [...lastOk.values()].map((a) => a.created_at).sort().at(-1) ?? null;

  return {
    available: input.available,
    hasData: anyData,
    score: siteScore(counted, anyData),
    gain: gains.gain,
    gainPicks: gains.picks.map((p) => ({ id: p.id, title: p.title, url: p.url, href: byId.get(p.id)?.href ?? null })),
    tiles,
    queue,
    ignored,
    filter: input.filter,
    counts,
    lastSyncAt,
    collectorIds: COLLECTORS.map((c) => ({ id: c.id, label: c.label })),
  };
}

export type AutopilotSummary = { at: string; prepared: number; published: number; failed: number } | null;

/** Son 24 saatteki en yeni Otopilot koşusu ("Dün gece 3 düzeltme hazırladı"). */
export function lastAutopilotRun(actions: readonly OptimizerAction[]): AutopilotSummary {
  const run = actions.find((a) => a.kind === "autopilot_run");
  if (!run) return null;
  const a = (run.after ?? {}) as { prepared?: number; published?: number; failed?: number };
  return { at: run.created_at, prepared: a.prepared ?? 0, published: a.published ?? 0, failed: a.failed ?? 0 };
}
