/**
 * Kontör merkezi görsel hesapları (saf, zaman dışarıdan verilir). Yalnız GERÇEK defter verisinden
 * türetilir: yetersiz geçmişte tahmin ÜRETİLMEZ (sahte "bitiş tarihi" yok).
 */
import { DAY_MS } from "@/lib/clock";

export type StackedSegment = { key: "available" | "reserved" | "spent"; value: number; pct: number };

/** Kullanılabilir / rezerve / harcanan tek yığılmış gösterge. Toplam 0 ise null (boş gösterge çizilmez). */
export function stackedBalance(p: { available: number; reserved: number; spent: number }): { total: number; segments: StackedSegment[] } | null {
  const clean = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const a = clean(p.available);
  const r = clean(p.reserved);
  const s = clean(p.spent);
  const total = a + r + s;
  if (total <= 0) return null;
  const seg = (key: StackedSegment["key"], value: number): StackedSegment => ({ key, value, pct: (value / total) * 100 });
  return { total, segments: [seg("available", a), seg("reserved", r), seg("spent", s)] };
}

type LedgerPoint = { at: string | null; units: number; balanceAfter: number | null };

/** Eskiden yeniye sıralı bakiye noktaları (balanceAfter dolu satırlar; en çok `limit` son nokta). */
export function balanceSeries(rows: readonly LedgerPoint[], limit = 30): { values: number[]; atMs: number[] } {
  const pts = rows
    .map((r) => ({ t: r.at ? Date.parse(r.at) : Number.NaN, v: r.balanceAfter }))
    .filter((p): p is { t: number; v: number } => Number.isFinite(p.t) && p.v !== null && Number.isFinite(p.v))
    .sort((x, y) => x.t - y.t)
    .slice(-limit);
  return { values: pts.map((p) => p.v), atMs: pts.map((p) => p.t) };
}

/** Çizgi üzerinde eşik yüksekliği (üstten %). AreaChart geometrisi: 160 yükseklik, 14 üst / 8 alt boşluk, taban 0. */
export function thresholdTopPct(threshold: number, seriesMax: number): number | null {
  if (!(threshold > 0) || !(seriesMax > 0) || threshold > seriesMax) return null;
  const H = 160;
  const padT = 14;
  const padB = 8;
  return ((padT + (1 - threshold / seriesMax) * (H - padT - padB)) / H) * 100;
}

export const FORECAST_MIN_SPEND_ROWS = 5;
export const FORECAST_MIN_SPAN_DAYS = 14;
export const FORECAST_WINDOW_DAYS = 60;

export type DepletionForecast = { burnPerDay: number; daysLeft: number; dateMs: number };

/**
 * Bitiş TAHMİNİ: son 60 günün harcama hızından. Şartlar: en az 5 harcama hareketi ve ilk-son harcama
 * arası en az 14 gün; yoksa null (gösterilmez). Bakiye <= 0 ise de null (zaten bitti).
 */
export function forecastDepletion(rows: readonly LedgerPoint[], available: number, nowMs: number): DepletionForecast | null {
  if (!(available > 0)) return null;
  const from = nowMs - FORECAST_WINDOW_DAYS * DAY_MS;
  const spends = rows
    .map((r) => ({ t: r.at ? Date.parse(r.at) : Number.NaN, u: r.units }))
    .filter((r) => Number.isFinite(r.t) && r.t >= from && r.t <= nowMs && r.u !== 0 && r.u < 0);
  if (spends.length < FORECAST_MIN_SPEND_ROWS) return null;
  const first = Math.min(...spends.map((s) => s.t));
  const last = Math.max(...spends.map((s) => s.t));
  if (last - first < FORECAST_MIN_SPAN_DAYS * DAY_MS) return null;
  const total = spends.reduce((a, s) => a + -s.u, 0);
  const spanDays = Math.max(FORECAST_MIN_SPAN_DAYS, (nowMs - first) / DAY_MS);
  const burnPerDay = total / spanDays;
  if (!(burnPerDay > 0)) return null;
  const daysLeft = Math.floor(available / burnPerDay);
  return { burnPerDay, daysLeft, dateMs: nowMs + daysLeft * DAY_MS };
}
