import { describe, expect, it } from "vitest";
import {
  buildBookingSlots,
  isSlotAvailable,
  normalizeWeekdayHours,
  parseHhMm,
  toHhMm,
  type BookingSlotsInput,
} from "@/lib/booking-slots";

/**
 * Testler duvar saatinden bağımsız: `nowMs` her senaryoda sabit verilir.
 * Referans an: 27 Temmuz 2026 Pazartesi, TR saatiyle 08:00 (UTC 05:00).
 */
const MON_08_TR = Date.parse("2026-07-27T05:00:00.000Z");
const DAY = 86_400_000;

/** TR duvar saatiyle epoch ms — gün ofseti + "HH:MM". */
const tr = (dayOffset: number, hh: number, mm = 0) =>
  MON_08_TR - 8 * 3_600_000 + dayOffset * DAY + (hh * 60 + mm) * 60_000;

const base = (over: Partial<BookingSlotsInput> = {}): BookingSlotsInput => ({
  nowMs: MON_08_TR,
  weekdayHours: { "1": ["09:00", "13:00"] },
  slotMinutes: 60,
  bufferMinutes: 0,
  maxDaysAhead: 1,
  minHoursNotice: 0,
  busy: [],
  ...over,
});

/** Bir günün slot etiketleri. */
const labels = (input: BookingSlotsInput, dayIndex = 0) =>
  buildBookingSlots(input)[dayIndex]!.slots.map((s) => s.label);

describe("parseHhMm / toHhMm", () => {
  it("geçerli saati dakikaya çevirir, geçersizi reddeder", () => {
    expect(parseHhMm("09:30")).toBe(570);
    expect(parseHhMm("24:00")).toBeNull();
    expect(parseHhMm("9:5")).toBeNull();
    expect(parseHhMm(null)).toBeNull();
    expect(toHhMm(570)).toBe("09:30");
  });
});

describe("buildBookingSlots", () => {
  it("1) hafta günü kapalıysa o gün hiç slot üretmez", () => {
    // Salı (2) tanımlı değil → 27 Tem Pazartesi + Salı: Salı boş
    const days = buildBookingSlots(base({ maxDaysAhead: 2 }));
    expect(days).toHaveLength(2);
    expect(days[0]!.weekday).toBe(1);
    expect(days[0]!.slots.length).toBeGreaterThan(0);
    expect(days[1]!.weekday).toBe(2);
    expect(days[1]!.slots).toEqual([]);
  });

  it("2) dolu randevu örtüşen slotu eler", () => {
    // 09:00-13:00 / 60 dk → 09,10,11,12. 10:00'da 60 dk'lık randevu var.
    expect(labels(base())).toEqual(["09:00", "10:00", "11:00", "12:00"]);
    const withBusy = labels(
      base({ busy: [{ start: tr(0, 10), end: tr(0, 11) }] }),
    );
    expect(withBusy).toEqual(["09:00", "11:00", "12:00"]);
  });

  it("3) tampon (buffer) dolu randevunun iki yanındaki slotları da eler", () => {
    // 10:00-11:00 dolu + 30 dk tampon → yasak pencere 09:30-11:30 olur;
    // 09:00-10:00 ve 11:00-12:00 slotları bu pencereye girdiği için elenir.
    const withBuffer = labels(
      base({ bufferMinutes: 30, busy: [{ start: tr(0, 10), end: tr(0, 11) }] }),
    );
    expect(withBuffer).toEqual(["12:00"]);
    // Tam bitişik randevu tamponsuz elenmez (09:00-10:00 dolu → 10:00 açık kalır)
    const noBuffer = labels(base({ busy: [{ start: tr(0, 9), end: tr(0, 10) }] }));
    expect(noBuffer).toEqual(["10:00", "11:00", "12:00"]);
  });

  it("4) en az kaç saat önce (min notice) yakın saatleri eler", () => {
    // Şimdi TR 08:00; 4 saat ihbar → 12:00'dan önce başlayan slot yok.
    expect(labels(base({ minHoursNotice: 4 }))).toEqual(["12:00"]);
    // 6 saat → bugün hiç slot kalmaz
    expect(labels(base({ minHoursNotice: 6 }))).toEqual([]);
  });

  it("5) gün sınırı (max_days_ahead) kadar gün üretilir, fazlası yok", () => {
    const days = buildBookingSlots(
      base({ maxDaysAhead: 3, weekdayHours: { "1": ["09:00", "11:00"], "2": ["09:00", "11:00"], "3": ["09:00", "11:00"] } }),
    );
    expect(days.map((d) => d.dateKey)).toEqual(["2026-07-27", "2026-07-28", "2026-07-29"]);
    expect(days.every((d) => d.slots.length === 2)).toBe(true);
    // Sınır 1 gün → yalnız bugün
    expect(buildBookingSlots(base({ maxDaysAhead: 1 }))).toHaveLength(1);
  });

  it("6) slot adımı saatleri böler ve kapanışı AŞMAZ", () => {
    // 09:00-13:00 / 30 dk → 8 slot, sonuncusu 12:30
    const half = labels(base({ slotMinutes: 30 }));
    expect(half).toHaveLength(8);
    expect(half[0]).toBe("09:00");
    expect(half.at(-1)).toBe("12:30");
    // 90 dk → 09:00, 10:30 (12:00 başlayan 13:30'da biterdi → yok)
    expect(labels(base({ slotMinutes: 90 }))).toEqual(["09:00", "10:30"]);
  });

  it("7) pazar günü '7' anahtarıyla tanımlanır ve '0' takma adı da çalışır", () => {
    // 2 Ağustos 2026 Pazar = referanstan 6 gün sonra
    const sunday7 = buildBookingSlots(
      base({ maxDaysAhead: 7, weekdayHours: { "7": ["10:00", "12:00"] } }),
    ).at(-1)!;
    expect(sunday7.weekday).toBe(7);
    expect(sunday7.slots.map((s) => s.label)).toEqual(["10:00", "11:00"]);

    const sunday0 = buildBookingSlots(
      base({ maxDaysAhead: 7, weekdayHours: { "0": ["10:00", "12:00"] } }),
    ).at(-1)!;
    expect(sunday0.slots.map((s) => s.label)).toEqual(["10:00", "11:00"]);
  });

  it("8) bozuk çalışma saati (bitiş ≤ başlangıç, eksik değer) günü kapatır", () => {
    expect(labels(base({ weekdayHours: { "1": ["13:00", "09:00"] } }))).toEqual([]);
    expect(labels(base({ weekdayHours: { "1": ["09:00"] } }))).toEqual([]);
    expect(labels(base({ weekdayHours: {} }))).toEqual([]);
  });

  it("9) slot başlangıcı ISO olarak TR duvar saatine karşılık gelir", () => {
    const first = buildBookingSlots(base())[0]!.slots[0]!;
    // TR 09:00 = UTC 06:00
    expect(first.startIso).toBe("2026-07-27T06:00:00.000Z");
    expect(first.endMs - first.startMs).toBe(3_600_000);
  });
});

describe("isSlotAvailable (yarış kontrolü)", () => {
  it("boş saat için true, araya randevu girince false döner", () => {
    const input = base();
    expect(isSlotAvailable("2026-07-27T07:00:00.000Z", input)).toBe(true);
    expect(
      isSlotAvailable("2026-07-27T07:00:00.000Z", { ...input, busy: [{ start: tr(0, 10), end: tr(0, 11) }] }),
    ).toBe(false);
    // Izgarada olmayan bir saat (09:15) hiçbir zaman kabul edilmez
    expect(isSlotAvailable("2026-07-27T06:15:00.000Z", input)).toBe(false);
    expect(isSlotAvailable("bozuk-tarih", input)).toBe(false);
  });
});

describe("normalizeWeekdayHours", () => {
  it("yalnız geçerli 1-7 anahtarlarını ve HH:MM çiftlerini bırakır", () => {
    expect(
      normalizeWeekdayHours({
        "1": ["9:00", "18:00"],
        "2": ["18:00", "09:00"],
        "8": ["09:00", "18:00"],
        "6": ["10:00", "14:00", "fazlalık"],
        x: 5,
      }),
    ).toEqual({ "1": ["09:00", "18:00"], "6": ["10:00", "14:00"] });
    expect(normalizeWeekdayHours(null)).toEqual({});
  });
});
