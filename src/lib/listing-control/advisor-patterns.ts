/**
 * DANIŞMAN BAŞINA ÖRÜNTÜ (SAF). "Sürekli kaybolan ilanlar" tek bir olay değil, tekrar eden bir davranıştır: aynı danışmanın
 * son `windowDays` günde FARKLI en az `minDistinct` portföyünde onaylı/olası portal kaybı uyarısı açıldıysa örüntü sayılır.
 * Bu bir skor DEĞİL, sayımdır (sahte puan yok); her örüntü tıklanınca ilgili uyarı kuyruğuna gider. Danışmanı değil olguyu
 * gösterir: nedeni (portal hatası, ilan no değişimi, gerçek kaldırma) uyarı açıklamasından okunur.
 */

export type MissingEvent = { advisorId: string | null; propertyId: string; atMs: number };

export type AdvisorPattern = {
  advisorId: string;
  distinctProperties: number;
  events: number;
  lastAtMs: number;
};

export const PATTERN_DEFAULTS = { windowDays: 30, minDistinct: 3 } as const;

export function detectAdvisorPatterns(
  events: readonly MissingEvent[],
  nowMs: number,
  opts: { windowDays?: number; minDistinct?: number } = {},
): AdvisorPattern[] {
  const windowDays = opts.windowDays ?? PATTERN_DEFAULTS.windowDays;
  const minDistinct = Math.max(opts.minDistinct ?? PATTERN_DEFAULTS.minDistinct, 2);
  const since = nowMs - windowDays * 86_400_000;
  const byAdvisor = new Map<string, { props: Set<string>; events: number; last: number }>();
  for (const e of events) {
    if (!e.advisorId || e.atMs < since || e.atMs > nowMs) continue;
    const cur = byAdvisor.get(e.advisorId) ?? { props: new Set<string>(), events: 0, last: 0 };
    cur.props.add(e.propertyId);
    cur.events += 1;
    cur.last = Math.max(cur.last, e.atMs);
    byAdvisor.set(e.advisorId, cur);
  }
  return [...byAdvisor.entries()]
    .filter(([, v]) => v.props.size >= minDistinct)
    .map(([advisorId, v]) => ({ advisorId, distinctProperties: v.props.size, events: v.events, lastAtMs: v.last }))
    .sort((a, b) => b.distinctProperties - a.distinctProperties || b.lastAtMs - a.lastAtMs);
}
