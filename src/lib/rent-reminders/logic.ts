/**
 * Kiracıya kira hatırlatma — SAF mantık (DB/React yok; sunucu, cron ve UI aynı kuralları kullanır).
 *
 * KAPALI DOĞAR: `enabled=false` iken hiçbir hatırlatma üretilmez. Hatırlatma TÜRLERİ:
 *  - before: vadeden en çok `daysBefore` gün önce (1 ≤ kalan gün ≤ daysBefore)
 *  - due:    vade günü (ve kaçırılırsa sonraki en çok 2 gün; cron aksaması/sessiz saat telafisi)
 *  - late:   vadeden `lateAfterDays` gün sonra (ve en çok 7 gün tolerans)
 * Aynı (kira, dönem, tür, kanal) ikinci kez üretilmez: DB `unique(rental_id, period, kind, channel)`.
 * Mesaj gövdesi yalnız ad, tutar, vade tarihi ve ofis adını içerir (adres/IBAN/ek kişisel veri YOK).
 */
import { DAY_MS, trParts } from "@/lib/clock";

export type ReminderKind = "before" | "due" | "late";
export type ReminderChannel = "office" | "sms";

export const KIND_LABELS: Record<ReminderKind, string> = {
  before: "Vade yaklaşıyor",
  due: "Vade günü",
  late: "Gecikme",
};

export type ReminderSettings = {
  enabled: boolean;
  smsEnabled: boolean;
  daysBefore: number;
  lateAfterDays: number;
  quietStartHour: number;
  quietEndHour: number;
};

/** KAPALI DOĞAR varsayılanı (DB varsayılanlarıyla birebir). */
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: false,
  smsEnabled: false,
  daysBefore: 3,
  lateAfterDays: 3,
  quietStartHour: 21,
  quietEndHour: 8,
};

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** DB satırı / form girdisi → güvenli ayar. Bozuk alan varsayılana düşer; `enabled` yalnız `true` ise açık. */
export function normalizeReminderSettings(raw: Record<string, unknown> | null | undefined): ReminderSettings {
  const d = DEFAULT_REMINDER_SETTINGS;
  if (!raw) return { ...d };
  return {
    enabled: raw.enabled === true,
    smsEnabled: raw.sms_enabled === true || raw.smsEnabled === true,
    daysBefore: clampInt(raw.days_before ?? raw.daysBefore, 0, 10, d.daysBefore),
    lateAfterDays: clampInt(raw.late_after_days ?? raw.lateAfterDays, 1, 30, d.lateAfterDays),
    quietStartHour: clampInt(raw.quiet_start_hour ?? raw.quietStartHour, 0, 23, d.quietStartHour),
    quietEndHour: clampInt(raw.quiet_end_hour ?? raw.quietEndHour, 0, 23, d.quietEndHour),
  };
}

/** Türkiye saatine göre sessiz saat mi? start > end ise gece yarısını aşar; start == end sessiz saat yok demektir. */
export function isQuietHour(nowMs: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  const h = trParts(nowMs).hour;
  return startHour < endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-01` dönem anahtarı + vade günü (1-28) → `YYYY-MM-DD`. */
export function dueDateOfPeriod(period: string, dueDay: number): string {
  return `${period.slice(0, 7)}-${pad(Math.min(Math.max(dueDay, 1), 28))}`;
}

function monthShift(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

/** Bugüne göre vadeye kalan gün (vade geçtiyse negatif). */
export function daysToDue(today: string, due: string): number {
  return dayNumber(due) - dayNumber(today);
}

/** Kalan güne göre hangi tür hatırlatma uygun (yoksa null). */
export function reminderKindFor(d: number, s: Pick<ReminderSettings, "daysBefore" | "lateAfterDays">): ReminderKind | null {
  if (d >= 1) return s.daysBefore >= 1 && d <= s.daysBefore ? "before" : null;
  const dueGrace = Math.min(2, s.lateAfterDays - 1);
  if (d <= 0 && d >= -dueGrace) return "due";
  if (d <= -s.lateAfterDays && d >= -(s.lateAfterDays + 7)) return "late";
  return null;
}

export type ReminderCandidate = { period: string; kind: ReminderKind; due: string; daysToDue: number };

/**
 * Bir kira için bugün üretilecek hatırlatma: önceki/bu/sonraki ay vadelerinden TAHSİL EDİLMEMİŞ ve sözleşme
 * kapsamındaki ilk uygun olanı (vadesi en yakın olan önce). `paidPeriods`: `YYYY-MM-01` dönem anahtarları.
 */
export function pickReminder(input: {
  today: string;
  dueDay: number;
  startDate: string;
  endDate: string | null;
  paidPeriods: ReadonlySet<string>;
  settings: Pick<ReminderSettings, "daysBefore" | "lateAfterDays">;
}): ReminderCandidate | null {
  const cur = input.today.slice(0, 7);
  const candidates: ReminderCandidate[] = [];
  for (const ym of [monthShift(cur, -1), cur, monthShift(cur, 1)]) {
    const period = `${ym}-01`;
    const due = dueDateOfPeriod(period, input.dueDay);
    if (input.paidPeriods.has(period)) continue;
    if (input.startDate.slice(0, 10) > due) continue; // sözleşme bu vadeden sonra başlıyor
    if (input.endDate && input.endDate.slice(0, 10) < due) continue; // sözleşme vadeden önce bitmiş
    const d = daysToDue(input.today, due);
    const kind = reminderKindFor(d, input.settings);
    if (kind) candidates.push({ period, kind, due, daysToDue: d });
  }
  candidates.sort((a, b) => Math.abs(a.daysToDue) - Math.abs(b.daysToDue));
  return candidates[0] ?? null;
}

export const money = (n: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);

const dateTr = (iso: string) =>
  new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

/** Kiracıya gidecek kısa metin (SMS ve wa.me aynı gövdeyi kullanır). Ek kişisel veri/adres/IBAN içermez. */
export function buildReminderMessage(input: {
  kind: ReminderKind;
  renterName: string | null;
  officeName: string | null;
  amount: number;
  due: string;
}): string {
  const who = (input.renterName ?? "").trim();
  const hello = who ? `Sayın ${who},` : "Merhaba,";
  const amount = money(input.amount);
  const due = dateTr(input.due);
  const sign = (input.officeName ?? "").trim();
  const body =
    input.kind === "before"
      ? `${due} tarihli ${amount} kira ödemenizin vadesi yaklaşıyor.`
      : input.kind === "due"
        ? `${due} tarihli ${amount} kira ödemenizin vadesi geldi.`
        : `${due} tarihli ${amount} kira ödemeniz henüz görünmüyor; müsait olduğunuzda iletmenizi rica ederiz.`;
  return [hello, body, sign ? `${sign}` : null, "Bu hatırlatmayı istemiyorsanız ofisimize bildirmeniz yeterli."].filter(Boolean).join(" ");
}

/** SMS gönderimi yalnız TR cep numarasına (saklama biçimi 05XXXXXXXXX) yapılır. */
export function isSmsEligibleStoredPhone(stored: string | null | undefined): boolean {
  return typeof stored === "string" && /^05\d{9}$/.test(stored);
}
