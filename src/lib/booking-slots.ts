/**
 * Online randevu (danışmanın takvim linki) — müsait slot üretimi.
 *
 * SAF FONKSİYON: burada `Date.now()` YOK, kayan zaman YOK. Şimdiki an
 * (`nowMs`) ve dolu aralıklar (`busy`) çağıran tarafından verilir — böylece
 * hem React Compiler saflık kuralına uyar (bkz. `src/lib/clock.ts`) hem de
 * birim testi yazılabilir (`__tests__/booking-slots.test.ts`).
 *
 * SAAT DİLİMİ KARARI: çalışma saatleri ("09:00") ofisin duvar saatidir, ama
 * sunucu (Vercel) UTC çalışır. Türkiye 2016'dan beri DST uygulamaz — yıl boyu
 * sabit UTC+3. Bu yüzden slot üretimi sabit +180 dk ofsetle yapılır; sonuç
 * epoch ms / ISO olarak döner ve gösterim tarafında yeniden yoruma ihtiyaç
 * duymaz. Sabit ofset, `Intl` ile timezone çevirmekten hem daha ucuz hem de
 * test edilebilir (deterministik).
 */

/** Türkiye sabit UTC ofseti (dakika) — DST yok. */
export const TR_OFFSET_MIN = 180;

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Hafta günü → [başlangıç, bitiş] "HH:MM". Pazartesi=1 … Pazar=7.
 * Pazar için "0" anahtarı da kabul edilir (JS `getDay()` alışkanlığı).
 * Anahtar yoksa, dizi bozuksa veya bitiş ≤ başlangıç ise o gün KAPALI.
 */
export type WeekdayHours = Record<string, string[] | null | undefined>;

/** Danışmanın meşgul olduğu aralık (epoch ms) — iptal edilmemiş randevular. */
export type BusyInterval = { start: number; end: number };

export type BookingSlotsInput = {
  /** Şimdiki an (epoch ms) — çağıran verir, fonksiyon saati kendisi okumaz. */
  nowMs: number;
  weekdayHours: WeekdayHours;
  slotMinutes: number;
  bufferMinutes: number;
  /** Bugün dahil kaç gün ileriye slot üretilecek. */
  maxDaysAhead: number;
  /** Müşteri en erken bu kadar saat sonrası için randevu alabilir. */
  minHoursNotice: number;
  busy: BusyInterval[];
};

export type BookingSlot = {
  /** Slot başlangıcı — ISO (UTC). Form bu değeri aynen server action'a taşır. */
  startIso: string;
  startMs: number;
  endMs: number;
  /** Ofis duvar saati "HH:MM" (TR). */
  label: string;
};

export type BookingDay = {
  /** TR duvar takviminde "YYYY-MM-DD". */
  dateKey: string;
  /** Pazartesi=1 … Pazar=7. */
  weekday: number;
  slots: BookingSlot[];
};

/** "HH:MM" → gün başından itibaren dakika. Geçersizse null. */
export function parseHhMm(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Gün başından itibaren dakika → "HH:MM". */
export function toHhMm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Verilen anın TR duvar takviminde gün başlangıcı (epoch ms, UTC olarak). */
function trDayStartMs(ms: number): number {
  const shifted = ms + TR_OFFSET_MIN * MIN_MS;
  return Math.floor(shifted / DAY_MS) * DAY_MS - TR_OFFSET_MIN * MIN_MS;
}

/** TR duvar takviminde "YYYY-MM-DD". */
function trDateKey(dayStartMs: number): string {
  return new Date(dayStartMs + TR_OFFSET_MIN * MIN_MS).toISOString().slice(0, 10);
}

/** Pazartesi=1 … Pazar=7 (TR duvar takvimi). */
function trWeekday(dayStartMs: number): number {
  const d = new Date(dayStartMs + TR_OFFSET_MIN * MIN_MS).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Bir günün çalışma aralığı — kapalıysa null. */
function dayRange(weekdayHours: WeekdayHours, weekday: number): { open: number; close: number } | null {
  const raw = weekdayHours[String(weekday)] ?? (weekday === 7 ? weekdayHours["0"] : undefined);
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const open = parseHhMm(raw[0]);
  const close = parseHhMm(raw[1]);
  if (open === null || close === null || close <= open) return null;
  return { open, close };
}

/**
 * Müsait slotları üretir.
 *
 * Bir slot şu üç elemeden geçerse müsaittir:
 *  1. O hafta gününün çalışma aralığı içinde ve tamamen o aralığa sığıyor
 *     (slot bitişi kapanış saatini AŞAMAZ — 17:30'da 60 dk'lık slot açılmaz).
 *  2. `nowMs + minHoursNotice` sınırından sonra başlıyor (son dakika freni).
 *  3. Dolu randevularla, her iki yana `bufferMinutes` genişletilmiş halde
 *     ÖRTÜŞMÜYOR (yol/hazırlık payı).
 */
export function buildBookingSlots(input: BookingSlotsInput): BookingDay[] {
  const slotMinutes = Math.max(5, Math.round(input.slotMinutes || 60));
  const bufferMs = Math.max(0, Math.round(input.bufferMinutes || 0)) * MIN_MS;
  const days = Math.min(90, Math.max(1, Math.round(input.maxDaysAhead || 1)));
  const earliestMs = input.nowMs + Math.max(0, input.minHoursNotice || 0) * 60 * MIN_MS;

  // Tampon zaten slot tarafında uygulanacağı için dolu aralıkları burada
  // genişletmek yerine karşılaştırmada kullanıyoruz — tek yerde kalsın.
  const busy = (input.busy ?? []).filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);

  const out: BookingDay[] = [];
  const firstDay = trDayStartMs(input.nowMs);

  for (let i = 0; i < days; i++) {
    const dayStart = firstDay + i * DAY_MS;
    const weekday = trWeekday(dayStart);
    const range = dayRange(input.weekdayHours, weekday);
    const slots: BookingSlot[] = [];

    if (range) {
      for (let m = range.open; m + slotMinutes <= range.close; m += slotMinutes) {
        const startMs = dayStart + m * MIN_MS;
        const endMs = startMs + slotMinutes * MIN_MS;
        if (startMs < earliestMs) continue;
        const clash = busy.some((b) => startMs < b.end + bufferMs && b.start - bufferMs < endMs);
        if (clash) continue;
        slots.push({
          startIso: new Date(startMs).toISOString(),
          startMs,
          endMs,
          label: toHhMm(m),
        });
      }
    }

    out.push({ dateKey: trDateKey(dayStart), weekday, slots });
  }

  return out;
}

/**
 * Seçilen anın hâlâ geçerli bir slot olup olmadığını doğrular.
 * Rezervasyon action'ı bunu kaydetmeden HEMEN ÖNCE, taze `busy` listesiyle
 * çağırır (yarış kontrolü — iki müşteri aynı saati aynı anda seçebilir).
 */
export function isSlotAvailable(startIso: string, input: BookingSlotsInput): boolean {
  const target = new Date(startIso).getTime();
  if (Number.isNaN(target)) return false;
  return buildBookingSlots(input).some((d) => d.slots.some((s) => s.startMs === target));
}

/** Gün şeridi için parçalı etiket: { dayNum: "29", month: "Temmuz", weekday: "Sal" }. */
export function formatTrDayParts(dateKey: string): { dayNum: string; month: string; weekday: string } {
  const d = new Date(`${dateKey}T12:00:00.000Z`);
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("tr-TR", { ...opts, timeZone: "UTC" }).format(d);
  return {
    dayNum: fmt({ day: "numeric" }),
    month: fmt({ month: "long" }),
    weekday: fmt({ weekday: "short" }),
  };
}

export const WEEKDAY_LABELS: { key: string; label: string }[] = [
  { key: "1", label: "Pazartesi" },
  { key: "2", label: "Salı" },
  { key: "3", label: "Çarşamba" },
  { key: "4", label: "Perşembe" },
  { key: "5", label: "Cuma" },
  { key: "6", label: "Cumartesi" },
  { key: "7", label: "Pazar" },
];

/**
 * Form/DB'den gelen ham jsonb'yi güvenli `WeekdayHours`'a çevirir —
 * yalnız 1-7 anahtarları, yalnız geçerli "HH:MM" çiftleri kalır.
 */
export function normalizeWeekdayHours(raw: unknown): WeekdayHours {
  const out: WeekdayHours = {};
  if (!raw || typeof raw !== "object") return out;
  for (const { key } of WEEKDAY_LABELS) {
    const value = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(value) || value.length < 2) continue;
    const open = parseHhMm(value[0]);
    const close = parseHhMm(value[1]);
    if (open === null || close === null || close <= open) continue;
    out[key] = [toHhMm(open), toHhMm(close)];
  }
  return out;
}
