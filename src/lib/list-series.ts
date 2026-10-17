/**
 * Liste KPI kartlarının haftalık GERÇEK serileri (WP3). Kural: seri yalnız gerçek kayıt tarihlerinden kurulur; sorgu hata
 * verirse, tarama tavana dayanırsa (kesilmiş olabilir) ya da pencerede hiç kayıt yoksa `undefined` döner — kart sade kalır,
 * sahte çubuk/trend çizilmez. Sorgu ucuzdur: yalnız tarih sütunu, son `weeks` hafta, `scanLimit` satır.
 */
import { WEEK_MS, weeklySeriesOf } from "@/components/ui/list-kit/list-logic";

export const SERIES_WEEKS = 8;
export const SERIES_SCAN_LIMIT = 2000;

/** Seri penceresinin başlangıcı (ISO): `weeks` hafta önce. */
export function seriesSinceIso(nowMs: number, weeks = SERIES_WEEKS): string {
  return new Date(nowMs - weeks * WEEK_MS).toISOString();
}

type Rows = { data: readonly Record<string, unknown>[] | null; error: unknown };

/** Sorgu sonucundan (tarih sütunu `column`) haftalık sayım; güvenilmezse ya da boşsa undefined. */
export function weeklySeriesFromRows(res: Rows, column: string, nowMs: number, scanLimit = SERIES_SCAN_LIMIT, weeks = SERIES_WEEKS): number[] | undefined {
  if (res.error || !res.data) return undefined;
  const isos = res.data.map((r) => {
    const v = r[column];
    return typeof v === "string" ? v : null;
  });
  const series = weeklySeriesOf(isos, nowMs, scanLimit, weeks);
  return series && series.some((v) => v > 0) ? series : undefined;
}

/** Sorguyu bekleyip `weeklySeriesFromRows` uygular; sorgu fırlatırsa da seri yok (sayfa düşmez). */
export async function loadWeeklySeries(query: PromiseLike<Rows>, column: string, nowMs: number, scanLimit = SERIES_SCAN_LIMIT): Promise<number[] | undefined> {
  try {
    return weeklySeriesFromRows(await query, column, nowMs, scanLimit);
  } catch {
    return undefined;
  }
}
