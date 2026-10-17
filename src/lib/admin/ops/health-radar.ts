import { HEALTH_DEFAULT_RISK_THRESHOLD, healthBand, type HealthBand } from "@/lib/admin/health-score";

/**
 * OFİS SAĞLIĞI VE KAYIP RİSKİ (saf, yan etkisiz). Kaynak `tenant_health_daily` (gece işi `runTenantHealthDaily`; skor
 * 0-100, kullanım/ödeme/destek bileşenleri ve gerekçeler `inputs.reasons`). Bu modül yalnız SON gün ile karşılaştırma
 * gününü kıyaslar ve haftalık ortalamayı çıkarır; skor hesabı `health-score.ts`'tedir (tek kaynak).
 */

export type HealthComponent = "usage" | "payment" | "support";

export const HEALTH_COMPONENT_LABELS: Record<HealthComponent, string> = {
  usage: "Kullanım",
  payment: "Ödeme",
  support: "Destek",
};

export type HealthRow = {
  tenantId: string;
  day: string;
  score: number;
  usage: number;
  payment: number;
  support: number;
  reasons?: readonly string[];
};

export type HealthMover = HealthRow & {
  previous: number | null;
  delta: number | null;
  band: HealthBand;
  previousBand: HealthBand | null;
  weakest: HealthComponent;
};

export type HealthRadar = {
  latestDay: string | null;
  compareDay: string | null;
  scored: number;
  average: number | null;
  previousAverage: number | null;
  bands: Record<HealthBand, number>;
  /** Karşılaştırma gününe göre en az `minDrop` puan düşenler (en çok düşen önce). */
  decliners: HealthMover[];
  /** Karşılaştırma gününde riskli DEĞİLKEN bugün riskli olanlar. */
  newlyRisky: HealthMover[];
  /** Riskli banttakiler (en düşük skor önce). */
  risky: HealthMover[];
  /** Riskli + izlenmeli ofislerde en zayıf bileşen dağılımı ("neden düşük"). */
  weakest: Record<HealthComponent, number>;
};

/** En zayıf bileşen; eşitlikte ödeme > kullanım > destek (gelir kaybına en yakın neden önce). */
export function weakestComponent(r: Pick<HealthRow, "usage" | "payment" | "support">): HealthComponent {
  const order: HealthComponent[] = ["payment", "usage", "support"];
  let best: HealthComponent = order[0]!;
  for (const c of order) if (r[c] < r[best]) best = c;
  return best;
}

const avg = (xs: readonly number[]): number | null => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

/** Son gün ve karşılaştırma günü satırlarından radar özeti. */
export function buildHealthRadar(
  latest: readonly HealthRow[],
  previous: readonly HealthRow[],
  opts: { riskThreshold?: number; minDrop?: number; limit?: number } = {},
): HealthRadar {
  const threshold = opts.riskThreshold ?? HEALTH_DEFAULT_RISK_THRESHOLD;
  const minDrop = opts.minDrop ?? 10;
  const limit = opts.limit ?? 12;
  const prevBy = new Map(previous.map((r) => [r.tenantId, r.score]));
  const bands: Record<HealthBand, number> = { riskli: 0, izlenmeli: 0, saglikli: 0 };
  const weakest: Record<HealthComponent, number> = { usage: 0, payment: 0, support: 0 };
  const movers: HealthMover[] = latest.map((r) => {
    const prev = prevBy.get(r.tenantId);
    const band = healthBand(r.score, threshold);
    bands[band] += 1;
    const w = weakestComponent(r);
    if (band !== "saglikli") weakest[w] += 1;
    return {
      ...r,
      previous: prev ?? null,
      delta: prev === undefined ? null : r.score - prev,
      band,
      previousBand: prev === undefined ? null : healthBand(prev, threshold),
      weakest: w,
    };
  });
  const decliners = movers
    .filter((m) => m.delta !== null && m.delta <= -minDrop)
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0) || a.score - b.score)
    .slice(0, limit);
  const newlyRisky = movers
    .filter((m) => m.band === "riskli" && m.previousBand !== null && m.previousBand !== "riskli")
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
  const risky = movers
    .filter((m) => m.band === "riskli")
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
  return {
    latestDay: latest[0]?.day ?? null,
    compareDay: previous[0]?.day ?? null,
    scored: latest.length,
    average: avg(latest.map((r) => r.score)),
    previousAverage: avg(previous.map((r) => r.score)),
    bands,
    decliners,
    newlyRisky,
    risky,
    weakest,
  };
}

/** Gün → ortalama skor (eski → yeni); boş gün atlanır. Haftalık seri (kıvılcım) için. */
export function averageSeries(rows: readonly Pick<HealthRow, "day" | "score">[]): { day: string; average: number }[] {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const list = by.get(r.day) ?? [];
    list.push(r.score);
    by.set(r.day, list);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, xs]) => ({ day, average: avg(xs) ?? 0 }));
}

/** "2026-10-17" → n gün önceki gün anahtarı (UTC takvim aritmetiği; gün anahtarı zaten TR günüdür). */
export function dayKeyMinus(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = Date.UTC(y!, (m ?? 1) - 1, d ?? 1) - n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Haftalık örnek günler: son gün dahil, en eski önce (`weeks` nokta). */
export function weeklyDays(latestDay: string, weeks = 8): string[] {
  return Array.from({ length: weeks }, (_, i) => dayKeyMinus(latestDay, (weeks - 1 - i) * 7));
}
