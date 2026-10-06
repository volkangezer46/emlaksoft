import { DAY_MS, trDayKey } from "@/lib/clock";

const MONTH_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** "2026-10-06" → "6 Eki". */
export function dayLabel(key: string): string {
  const m = Number(key.slice(5, 7));
  return `${Number(key.slice(8, 10))} ${MONTH_SHORT[m - 1] ?? ""}`.trim();
}

/**
 * Son `days` günün (bugün dahil, TR takvimi) günlük sayımı — SAF. Kaynaktan gelen her tarih (ISO) TR gününe düşürülür;
 * pencere dışı tarih sayılmaz. Hiç kayıt yoksa null (düz sıfır çizgisi uydurma bir eğridir).
 */
export function dailyCounts(dates: readonly string[], nowMs: number, days = 30): { key: string; label: string; value: number }[] | null {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(trDayKey(nowMs - i * DAY_MS));
  const index = new Map(keys.map((k, i) => [k, i]));
  const counts = keys.map(() => 0);
  let any = false;
  for (const d of dates) {
    if (!d) continue;
    const i = index.get(trDayKey(d));
    if (i === undefined) continue;
    counts[i]! += 1;
    any = true;
  }
  if (!any) return null;
  return keys.map((k, i) => ({ key: k, label: dayLabel(k), value: counts[i]! }));
}
