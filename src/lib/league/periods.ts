/**
 * Lig dönemleri — SAF. İki tür: aylık ("YYYY-MM") ve haftalık ("YYYY-Www", ISO hafta, Pazartesi başlar).
 *
 * Sınırların hepsi Türkiye saatine göre (UTC+3, `clock.ts`): sunucu UTC çalışsa da Pazartesi 00:00-03:00 TRT
 * önceki haftaya, ayın ilk 3 saati önceki aya yazılmaz. `endIso` HARİÇtir (bir sonraki dönemin başı).
 */
import { DAY_MS, TR_OFFSET_MS, shiftMonthKey, trDayKey, trMonthKey, trMonthStartMsFromKey } from "@/lib/clock";

export type LeaguePeriodKind = "month" | "week";

export type LeaguePeriod = {
  kind: LeaguePeriodKind;
  /** Normalize anahtar: "2026-10" veya "2026-W41" */
  period: string;
  startIso: string;
  endIso: string;
  startMs: number;
  endMs: number;
  /** "Ekim 2026" / "41. hafta · 5-11 Eki" */
  label: string;
};

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;

const SHORT_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

export function isWeekKey(key: string): boolean {
  return WEEK_RE.test(key);
}

/** Verilen UTC günü (TR takvim günü etiketi) için ISO hafta anahtarı. */
function weekKeyOfDayUtc(dayUtc: number): string {
  const d = new Date(dayUtc);
  const dow = d.getUTCDay() || 7; // Pzt=1..Paz=7
  const thursday = new Date(dayUtc + (4 - dow) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((thursday.getTime() - jan1) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Bir anın TR haftası anahtarı. */
export function weekKeyOf(valueMs: number): string {
  const day = trDayKey(valueMs); // "YYYY-MM-DD" (TR)
  const [y, m, d] = day.split("-").map(Number);
  return weekKeyOfDayUtc(Date.UTC(y, m - 1, d));
}

/** "YYYY-Www" → haftanın Pazartesi TR 00:00 anı (epoch ms); geçersizse NaN. */
export function weekStartMsFromKey(key: string): number {
  const m = WEEK_RE.exec(key);
  if (!m) return Number.NaN;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return Number.NaN;
  const jan4 = Date.UTC(year, 0, 4);
  const jan4dow = new Date(jan4).getUTCDay() || 7;
  const monday1 = jan4 - (jan4dow - 1) * DAY_MS;
  return monday1 + (week - 1) * 7 * DAY_MS - TR_OFFSET_MS;
}

/** Haftayı `delta` hafta kaydırır; geçersiz anahtar null. */
export function shiftWeekKey(key: string, delta: number): string | null {
  const start = weekStartMsFromKey(key);
  if (Number.isNaN(start)) return null;
  return weekKeyOf(start + delta * 7 * DAY_MS + 12 * 3_600_000);
}

function dayLabel(ms: number): string {
  const [, m, d] = trDayKey(ms).split("-").map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]}`;
}

/**
 * Dönem anahtarını aralığa çevirir. Geçersiz anahtar: `fallbackMs` anının AYI (varsayılan davranış eski
 * `periodRange` ile aynı — çağıran "şimdi"yi verir, burada saat okunmaz).
 */
export function leaguePeriod(period: string, fallbackMs: number): LeaguePeriod {
  if (WEEK_RE.test(period) && !Number.isNaN(weekStartMsFromKey(period))) {
    const startMs = weekStartMsFromKey(period);
    const endMs = startMs + 7 * DAY_MS;
    const wk = Number(WEEK_RE.exec(period)![2]);
    return {
      kind: "week",
      period,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      startMs,
      endMs,
      label: `${wk}. hafta · ${dayLabel(startMs)} – ${dayLabel(endMs - 1)}`,
    };
  }
  const mm = MONTH_RE.exec(period);
  const valid = mm !== null && Number(mm[2]) >= 1 && Number(mm[2]) <= 12;
  const key = valid ? period : trMonthKey(fallbackMs);
  const next = shiftMonthKey(key, 1) as string;
  const startMs = trMonthStartMsFromKey(key);
  const endMs = trMonthStartMsFromKey(next);
  return {
    kind: "month",
    period: key,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    startMs,
    endMs,
    label: new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(
      new Date(startMs),
    ),
  };
}

/** Bir önceki dönem (aynı türde). */
export function previousLeaguePeriod(period: string, fallbackMs: number): string {
  const p = leaguePeriod(period, fallbackMs);
  return (p.kind === "week" ? shiftWeekKey(p.period, -1) : shiftMonthKey(p.period, -1)) as string;
}

/** Bir sonraki dönem (aynı türde). */
export function nextLeaguePeriod(period: string, fallbackMs: number): string {
  const p = leaguePeriod(period, fallbackMs);
  return (p.kind === "week" ? shiftWeekKey(p.period, 1) : shiftMonthKey(p.period, 1)) as string;
}

/** Anın, istenen türdeki dönem anahtarı. */
export function currentLeaguePeriod(kind: LeaguePeriodKind, valueMs: number): string {
  return kind === "week" ? weekKeyOf(valueMs) : trMonthKey(valueMs);
}
