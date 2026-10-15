/**
 * Vergi takvimi (SAF; DB/saat yok). Aylık KDV beyannamesi dönemi izleyen ayın 28'inde, muhtasar ve prim hizmet
 * beyannamesi (kesilen stopaj) 26'sında verilir ve ödenir. Son gün hafta sonuna denk gelirse ilk iş gününe kayar
 * (resmî tatiller hesaba katılmaz; arayüz "mali müşavirinizle doğrulayın" notu taşır). Test: tax-calendar.test.ts.
 */

export type FilingKind = "kdv" | "muhtasar";

export type Filing = {
  kind: FilingKind;
  /** Beyan edilen dönem ("YYYY-MM"). */
  periodMonth: string;
  /** Son gün ("YYYY-MM-DD"), hafta sonu kaydırması uygulanmış. */
  dueDate: string;
  /** Bugünden son güne kalan gün (0 = bugün). */
  daysLeft: number;
};

const DUE_DAY: Record<FilingKind, number> = { kdv: 28, muhtasar: 26 };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00Z`);

/** Cumartesi/Pazar → Pazartesi. */
export function nextBusinessDay(day: string): string {
  const d = parse(day);
  const wd = d.getUTCDay();
  if (wd === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (wd === 0) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

function monthShift(key: string, delta: number): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1 + delta;
  return `${y + Math.floor(m / 12)}-${String((((m % 12) + 12) % 12) + 1).padStart(2, "0")}`;
}

/** `periodMonth` döneminin son günü (izleyen ayın 26'sı/28'i, hafta sonu kaydırmalı). */
export function filingDueDate(kind: FilingKind, periodMonth: string): string {
  return nextBusinessDay(`${monthShift(periodMonth, 1)}-${String(DUE_DAY[kind]).padStart(2, "0")}`);
}

/** Bugün itibarıyla sıradaki (süresi geçmemiş) beyan: geçen ayın beyanı süresindeyse o, değilse bu ayınki. */
export function nextFiling(kind: FilingKind, today: string): Filing {
  const thisMonth = today.slice(0, 7);
  let period = monthShift(thisMonth, -1);
  let due = filingDueDate(kind, period);
  if (due < today.slice(0, 10)) {
    period = thisMonth;
    due = filingDueDate(kind, period);
  }
  const daysLeft = Math.round((parse(due).getTime() - parse(today).getTime()) / 86_400_000);
  return { kind, periodMonth: period, dueDate: due, daysLeft };
}
