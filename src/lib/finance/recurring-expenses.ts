/**
 * Tekrarlayan giderler / abonelikler (SAF). Aynı başlık+kategori+dönem = bir seri; sonraki yenileme = son kayıt + dönem.
 * Yeni kayıt girilince seri ilerler. Çok eski (bitmiş sayılan) seriler hatırlatma üretmez.
 */

export const RECURRENCES = ["monthly", "quarterly", "yearly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  monthly: "Aylık",
  quarterly: "3 aylık",
  yearly: "Yıllık",
};

export const RECURRENCE_MONTHS: Record<Recurrence, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** Yenilemeye bu kadar gün kala hatırlat. */
export const RENEWAL_REMIND_DAYS = 7;
/** Vadesi bu kadar günden fazla geçmiş seri "bitmiş" sayılır (hatırlatma yok). */
export const RENEWAL_STALE_AFTER_DAYS = 14;

export function isRecurrence(v: unknown): v is Recurrence {
  return typeof v === "string" && (RECURRENCES as readonly string[]).includes(v);
}

export type RecurringExpense = {
  id: string;
  title: string;
  category: string;
  amount: number;
  /** YYYY-MM-DD */
  date: string;
  recurrence: Recurrence;
  portalKey?: string | null;
};

export type RecurringSeries = {
  key: string;
  title: string;
  category: string;
  recurrence: Recurrence;
  portalKey: string | null;
  lastId: string;
  lastDate: string;
  lastAmount: number;
  nextDue: string;
  recordCount: number;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(key: string): number {
  return Math.floor(Date.parse(`${key}T00:00:00Z`) / 86_400_000);
}

/** İki gün anahtarı arası gün farkı (to − from). */
export function daysBetweenKeys(fromKey: string, toKey: string): number {
  return dayNumber(toKey) - dayNumber(fromKey);
}

/** Gün anahtarına gün ekler (negatif geriye). */
export function addDaysKey(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Ay ekler; hedef ayda gün yoksa ayın son gününe sıkıştırır (31 Ocak + 1 ay = 28/29 Şubat). */
export function addMonthsKey(dateKey: string, months: number): string {
  if (!ISO.test(dateKey)) return dateKey;
  const [y, m, d] = dateKey.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function nextDueKey(lastDate: string, recurrence: Recurrence): string {
  return addMonthsKey(lastDate, RECURRENCE_MONTHS[recurrence]);
}

const norm = (s: string) => s.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");

export function seriesKey(e: Pick<RecurringExpense, "title" | "category" | "recurrence">): string {
  return `${norm(e.title)}|${e.category}|${e.recurrence}`;
}

export function buildRecurringSeries(rows: readonly RecurringExpense[]): RecurringSeries[] {
  const map = new Map<string, RecurringSeries>();
  for (const r of rows) {
    if (!ISO.test(r.date) || !isRecurrence(r.recurrence)) continue;
    const key = seriesKey(r);
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        key,
        title: r.title.trim(),
        category: r.category,
        recurrence: r.recurrence,
        portalKey: r.portalKey ?? null,
        lastId: r.id,
        lastDate: r.date,
        lastAmount: r.amount,
        nextDue: nextDueKey(r.date, r.recurrence),
        recordCount: 1,
      });
      continue;
    }
    cur.recordCount += 1;
    if (r.date > cur.lastDate) {
      cur.lastId = r.id;
      cur.lastDate = r.date;
      cur.lastAmount = r.amount;
      cur.nextDue = nextDueKey(r.date, r.recurrence);
      cur.portalKey = r.portalKey ?? cur.portalKey;
    }
  }
  return [...map.values()].sort((a, b) => a.nextDue.localeCompare(b.nextDue) || a.title.localeCompare(b.title, "tr"));
}

export type RenewalState = "overdue" | "due_soon" | "upcoming" | "inactive";

export type RenewalInfo = { state: RenewalState; daysLeft: number };

/** daysLeft negatifse vade geçmiştir. */
export function renewalInfo(series: Pick<RecurringSeries, "nextDue">, todayKey: string): RenewalInfo {
  const daysLeft = daysBetweenKeys(todayKey, series.nextDue);
  if (daysLeft < -RENEWAL_STALE_AFTER_DAYS) return { state: "inactive", daysLeft };
  if (daysLeft < 0) return { state: "overdue", daysLeft };
  if (daysLeft <= RENEWAL_REMIND_DAYS) return { state: "due_soon", daysLeft };
  return { state: "upcoming", daysLeft };
}

/** Aylık eşdeğer maliyet (yıllık/12, 3 aylık/3) — özet toplam için. */
export function monthlyEquivalent(amount: number, recurrence: Recurrence): number {
  return amount / RECURRENCE_MONTHS[recurrence];
}
