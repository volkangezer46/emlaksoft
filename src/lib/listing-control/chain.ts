/**
 * Portal ilan ZİNCİRİ (SAF): aynı portföy + portal için ilan no değişimlerinde her harici ilan no ayrı
 * `portal_listings` satırıdır; `supersedes_id` halef→önceki bağıdır. Toplam yayın süresi = zincirdeki satırların
 * published_at..removed_at (açıksa şimdi) aralıklarının BİRLEŞİMİ (örtüşen süre iki kez sayılmaz).
 */

export type ChainRow = {
  id: string;
  portal: string;
  externalId: string | null;
  status: string;
  publishedAt: string | null;
  removedAt: string | null;
  supersedesId: string | null;
};

export type ChainStats = {
  portal: string;
  rows: ChainRow[];
  /** Eskiden yeniye sıralı. */
  idChanges: number;
  totalPublishedDays: number;
  firstPublishedAt: string | null;
  currentLiveId: string | null;
};

const DAY = 86_400_000;

/** [start,end] aralıklarının birleşim uzunluğu (ms). */
export function unionMs(intervals: readonly [number, number][]): number {
  const sorted = intervals.filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curS = 0;
  let curE = -1;
  let open = false;
  for (const [s, e] of sorted) {
    if (!open) {
      curS = s;
      curE = e;
      open = true;
    } else if (s <= curE) curE = Math.max(curE, e);
    else {
      total += curE - curS;
      curS = s;
      curE = e;
    }
  }
  if (open) total += curE - curS;
  return total;
}

export function buildChainStats(rows: readonly ChainRow[], nowMs: number): ChainStats[] {
  const byPortal = new Map<string, ChainRow[]>();
  for (const r of rows) {
    const k = r.portal.trim().toLowerCase();
    byPortal.set(k, [...(byPortal.get(k) ?? []), r]);
  }
  const out: ChainStats[] = [];
  for (const [, list] of byPortal) {
    const sorted = [...list].sort((a, b) => Date.parse(a.publishedAt ?? "9999") - Date.parse(b.publishedAt ?? "9999"));
    const intervals: [number, number][] = [];
    for (const r of sorted) {
      if (!r.publishedAt) continue;
      intervals.push([Date.parse(r.publishedAt), r.removedAt ? Date.parse(r.removedAt) : nowMs]);
    }
    out.push({
      portal: sorted[0].portal,
      rows: sorted,
      idChanges: sorted.filter((r) => r.supersedesId !== null).length,
      totalPublishedDays: Math.round((unionMs(intervals) / DAY) * 10) / 10,
      firstPublishedAt: sorted.find((r) => r.publishedAt)?.publishedAt ?? null,
      currentLiveId: sorted.find((r) => r.status === "live")?.id ?? null,
    });
  }
  return out;
}
