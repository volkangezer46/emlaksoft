import { describe, expect, it } from "vitest";
import {
  isOnLeave,
  leaveDaysCount,
  leaveRangesToBusy,
  overlappingLeaves,
  type LeaveLike,
} from "@/lib/leave-utils";
import { buildBookingSlots, TR_OFFSET_MIN, type BookingSlotsInput } from "@/lib/booking-slots";

/** Kısa izin kaydı kurucu — varsayılan onaylı yıllık izin. */
const leave = (over: Partial<LeaveLike> & Pick<LeaveLike, "staff_id" | "starts_on" | "ends_on">): LeaveLike => ({
  status: "onayli",
  kind: "izin",
  ...over,
});

const AYSE = "a0000000-0000-0000-0000-000000000001";
const MEHMET = "b0000000-0000-0000-0000-000000000002";

describe("isOnLeave", () => {
  it("1) tek günlük izin yalnız o günü kapsar", () => {
    const rows = [leave({ staff_id: AYSE, starts_on: "2026-08-14", ends_on: "2026-08-14" })];
    expect(isOnLeave(rows, AYSE, "2026-08-14")).toBe(true);
    expect(isOnLeave(rows, AYSE, "2026-08-13")).toBe(false);
    expect(isOnLeave(rows, AYSE, "2026-08-15")).toBe(false);
  });

  it("2) çok günlü izinde SINIR GÜNLER de dahildir", () => {
    const rows = [leave({ staff_id: AYSE, starts_on: "2026-08-10", ends_on: "2026-08-14" })];
    expect(isOnLeave(rows, AYSE, "2026-08-10")).toBe(true); // ilk gün
    expect(isOnLeave(rows, AYSE, "2026-08-12")).toBe(true); // orta
    expect(isOnLeave(rows, AYSE, "2026-08-14")).toBe(true); // son gün (dahil)
    expect(isOnLeave(rows, AYSE, "2026-08-09")).toBe(false);
    expect(isOnLeave(rows, AYSE, "2026-08-15")).toBe(false);
    // Tam ISO zaman damgası da kabul edilir (ilk 10 karakter)
    expect(isOnLeave(rows, AYSE, "2026-08-12T09:30:00.000Z")).toBe(true);
  });

  it("3) başka personelin izni bu kişiyi etkilemez", () => {
    const rows = [leave({ staff_id: MEHMET, starts_on: "2026-08-10", ends_on: "2026-08-14" })];
    expect(isOnLeave(rows, MEHMET, "2026-08-12")).toBe(true);
    expect(isOnLeave(rows, AYSE, "2026-08-12")).toBe(false);
  });

  it("4) reddedilmiş ve talep halindeki izin BLOKLAMAZ", () => {
    const red = [leave({ staff_id: AYSE, starts_on: "2026-08-10", ends_on: "2026-08-14", status: "reddedildi" })];
    const talep = [leave({ staff_id: AYSE, starts_on: "2026-08-10", ends_on: "2026-08-14", status: "talep" })];
    expect(isOnLeave(red, AYSE, "2026-08-12")).toBe(false);
    expect(isOnLeave(talep, AYSE, "2026-08-12")).toBe(false);
    // status alanı hiç yoksa onaylı sayılır (DB varsayılanı 'onayli')
    expect(isOnLeave([{ staff_id: AYSE, starts_on: "2026-08-10", ends_on: "2026-08-14" }], AYSE, "2026-08-12")).toBe(true);
  });

  it("5) boş/eksik liste ve bozuk tarih false döner", () => {
    expect(isOnLeave([], AYSE, "2026-08-12")).toBe(false);
    expect(isOnLeave(null, AYSE, "2026-08-12")).toBe(false);
    expect(isOnLeave(undefined, AYSE, "2026-08-12")).toBe(false);
    expect(isOnLeave([leave({ staff_id: AYSE, starts_on: "2026-08-10", ends_on: "2026-08-14" })], AYSE, "bozuk")).toBe(false);
    expect(isOnLeave([leave({ staff_id: AYSE, starts_on: "2026-08-10", ends_on: "2026-08-14" })], "", "2026-08-12")).toBe(false);
  });
});

describe("leaveRangesToBusy", () => {
  it("6) izin aralığı TR duvar gününün 00:00-24:00'ına karşılık gelen tek blok üretir", () => {
    const busy = leaveRangesToBusy(
      [leave({ staff_id: AYSE, starts_on: "2026-08-10", ends_on: "2026-08-11" })],
      TR_OFFSET_MIN,
    );
    expect(busy).toHaveLength(1);
    // TR 10 Ağustos 00:00 = UTC 9 Ağustos 21:00
    expect(new Date(busy[0]!.start).toISOString()).toBe("2026-08-09T21:00:00.000Z");
    // ends_on DAHİL → TR 12 Ağustos 00:00 = UTC 11 Ağustos 21:00
    expect(new Date(busy[0]!.end).toISOString()).toBe("2026-08-11T21:00:00.000Z");
    expect(busy[0]!.end - busy[0]!.start).toBe(2 * 86_400_000);
  });

  it("7) yalnız onaylı izinler ve istenirse yalnız o personel çevrilir", () => {
    const rows = [
      leave({ staff_id: AYSE, starts_on: "2026-08-10", ends_on: "2026-08-10" }),
      leave({ staff_id: AYSE, starts_on: "2026-08-20", ends_on: "2026-08-20", status: "reddedildi" }),
      leave({ staff_id: MEHMET, starts_on: "2026-08-10", ends_on: "2026-08-10" }),
    ];
    expect(leaveRangesToBusy(rows, TR_OFFSET_MIN)).toHaveLength(2); // reddedilen düştü
    expect(leaveRangesToBusy(rows, TR_OFFSET_MIN, AYSE)).toHaveLength(1);
    expect(leaveRangesToBusy([], TR_OFFSET_MIN)).toEqual([]);
    // Bozuk tarih sessizce elenir
    expect(leaveRangesToBusy([leave({ staff_id: AYSE, starts_on: "bozuk", ends_on: "2026-08-10" })], TR_OFFSET_MIN)).toEqual([]);
  });

  it("8) üretilen busy bloğu buildBookingSlots'ta o günü TAMAMEN kapatır", () => {
    // 10 Ağustos 2026 Pazartesi; TR 08:00 = UTC 05:00
    const nowMs = Date.parse("2026-08-10T05:00:00.000Z");
    const input = (busy: { start: number; end: number }[]): BookingSlotsInput => ({
      nowMs,
      weekdayHours: { "1": ["09:00", "13:00"], "2": ["09:00", "13:00"] },
      slotMinutes: 60,
      bufferMinutes: 0,
      maxDaysAhead: 2,
      minHoursNotice: 0,
      busy,
    });
    // İzinsiz: iki gün de dolu ızgara
    const acik = buildBookingSlots(input([]));
    expect(acik[0]!.slots).toHaveLength(4);
    expect(acik[1]!.slots).toHaveLength(4);

    const busy = leaveRangesToBusy(
      [leave({ staff_id: AYSE, starts_on: "2026-08-10", ends_on: "2026-08-10" })],
      TR_OFFSET_MIN,
    );
    const izinli = buildBookingSlots(input(busy));
    expect(izinli[0]!.slots).toEqual([]); // izin günü: hiç slot yok
    expect(izinli[1]!.slots).toHaveLength(4); // ertesi gün etkilenmedi
  });
});

describe("overlappingLeaves", () => {
  it("9) pencereyle kesişen izinleri döndürür, durumdan bağımsız", () => {
    const rows = [
      leave({ staff_id: AYSE, starts_on: "2026-08-01", ends_on: "2026-08-05" }), // önce, kesişmez
      leave({ staff_id: AYSE, starts_on: "2026-08-09", ends_on: "2026-08-10" }), // baştan taşar
      leave({ staff_id: AYSE, starts_on: "2026-08-12", ends_on: "2026-08-13", status: "talep" }), // içeride
      leave({ staff_id: MEHMET, starts_on: "2026-08-12", ends_on: "2026-08-13" }), // başka kişi
      leave({ staff_id: AYSE, starts_on: "2026-08-20", ends_on: "2026-08-25" }), // sonra, kesişmez
    ];
    const hit = overlappingLeaves(rows, "2026-08-10", "2026-08-15", AYSE);
    expect(hit.map((l) => l.starts_on)).toEqual(["2026-08-09", "2026-08-12"]);
    // Kişi filtresi verilmezse Mehmet de gelir
    expect(overlappingLeaves(rows, "2026-08-10", "2026-08-15")).toHaveLength(3);
    // Ters verilen pencere düzeltilir
    expect(overlappingLeaves(rows, "2026-08-15", "2026-08-10", AYSE)).toHaveLength(2);
    expect(overlappingLeaves([], "2026-08-10", "2026-08-15")).toEqual([]);
    expect(overlappingLeaves(rows, "bozuk", "2026-08-15")).toEqual([]);
  });
});

describe("leaveDaysCount", () => {
  it("10) iki uç dahil sayar, tek gün 1 döner", () => {
    expect(leaveDaysCount("2026-08-14", "2026-08-14")).toBe(1);
    expect(leaveDaysCount("2026-08-10", "2026-08-14")).toBe(5);
    // Ay sınırı ve artık yıl
    expect(leaveDaysCount("2026-07-30", "2026-08-02")).toBe(4);
    expect(leaveDaysCount("2028-02-27", "2028-03-01")).toBe(4);
    // Ters / bozuk aralık 0
    expect(leaveDaysCount("2026-08-14", "2026-08-10")).toBe(0);
    expect(leaveDaysCount("bozuk", "2026-08-10")).toBe(0);
  });
});
