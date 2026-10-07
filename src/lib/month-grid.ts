/**
 * Ay takvimi ızgarası (saf): "YYYY-MM" anahtarından Pazartesi başlangıçlı haftalar.
 * Gün anahtarları "YYYY-MM-DD" (TR takvim günü; saat dilimi dönüşümü çağıranın işi:
 * olay anları `trDayKey` ile anahtarlanır). Görev takvimi ve benzeri vade görünümleri kullanır.
 */
export type MonthGridDay = { dayKey: string; day: number; inMonth: boolean };

const MONTH_NAMES = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"] as const;
export const WEEKDAY_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"] as const;

function parse(key: string): { y: number; m: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12 || y < 2000 || y > 2100) return null;
  return { y, m };
}

export function isMonthKey(key: string | null | undefined): key is string {
  return typeof key === "string" && parse(key) !== null;
}

export function monthLabel(key: string): string {
  const p = parse(key);
  return p ? `${MONTH_NAMES[p.m - 1]} ${p.y}` : key;
}

function keyOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildMonthGrid(key: string): MonthGridDay[][] {
  const p = parse(key);
  if (!p) return [];
  const first = new Date(Date.UTC(p.y, p.m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // 0=Pzt
  const start = new Date(first.getTime() - offset * 86_400_000);
  const weeks: MonthGridDay[][] = [];
  let cursor = start;
  for (let w = 0; w < 6; w += 1) {
    const week: MonthGridDay[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push({ dayKey: keyOf(cursor), day: cursor.getUTCDate(), inMonth: cursor.getUTCMonth() === p.m - 1 });
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
    // Ayın son haftasından sonra tamamen ay dışı kalan hafta çizilmez.
    if (w >= 4 && week.every((d) => !d.inMonth)) break;
    weeks.push(week);
  }
  return weeks;
}
