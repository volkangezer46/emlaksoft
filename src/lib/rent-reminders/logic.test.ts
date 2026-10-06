import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMINDER_SETTINGS,
  buildReminderMessage,
  daysToDue,
  isQuietHour,
  isSmsEligibleStoredPhone,
  normalizeReminderSettings,
  pickReminder,
  reminderKindFor,
} from "./logic";

const S = { daysBefore: 3, lateAfterDays: 3 };

describe("varsayılanlar", () => {
  it("KAPALI doğar", () => {
    expect(DEFAULT_REMINDER_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_REMINDER_SETTINGS.smsEnabled).toBe(false);
    expect(normalizeReminderSettings(null).enabled).toBe(false);
    expect(normalizeReminderSettings({ enabled: "true" }).enabled).toBe(false);
    expect(normalizeReminderSettings({ enabled: true, sms_enabled: true, days_before: 99 })).toMatchObject({ enabled: true, smsEnabled: true, daysBefore: 3 });
  });
});

describe("reminderKindFor", () => {
  it("vade öncesi pencere", () => {
    expect(reminderKindFor(4, S)).toBeNull();
    expect(reminderKindFor(3, S)).toBe("before");
    expect(reminderKindFor(1, S)).toBe("before");
    expect(reminderKindFor(1, { daysBefore: 0, lateAfterDays: 3 })).toBeNull();
  });
  it("vade günü ve 2 gün tolerans", () => {
    expect(reminderKindFor(0, S)).toBe("due");
    expect(reminderKindFor(-2, S)).toBe("due");
  });
  it("gecikme: lateAfterDays sonra, 7 gün tolerans, sonra kesilir", () => {
    expect(reminderKindFor(-3, S)).toBe("late");
    expect(reminderKindFor(-10, S)).toBe("late");
    expect(reminderKindFor(-11, S)).toBeNull();
  });
  it("lateAfterDays=1 iken due ve late çakışmaz", () => {
    const s = { daysBefore: 3, lateAfterDays: 1 };
    expect(reminderKindFor(0, s)).toBe("due");
    expect(reminderKindFor(-1, s)).toBe("late");
  });
});

describe("pickReminder", () => {
  const base = { dueDay: 10, startDate: "2025-01-01", endDate: null, paidPeriods: new Set<string>(), settings: S };
  it("vadeden 2 gün önce before", () => {
    expect(pickReminder({ ...base, today: "2026-10-08" })).toMatchObject({ period: "2026-10-01", kind: "before", due: "2026-10-10", daysToDue: 2 });
  });
  it("ay sonunda sonraki ayın vadesi için before", () => {
    expect(pickReminder({ ...base, today: "2026-10-29", dueDay: 1 })).toMatchObject({ period: "2026-11-01", kind: "before" });
  });
  it("ay başında önceki ayın gecikmesi late", () => {
    expect(pickReminder({ ...base, today: "2026-10-02", dueDay: 28 })).toMatchObject({ period: "2026-09-01", kind: "late" });
  });
  it("ödenmiş dönem atlanır", () => {
    expect(pickReminder({ ...base, today: "2026-10-10", paidPeriods: new Set(["2026-10-01"]) })).toBeNull();
  });
  it("sözleşme kapsamı dışı atlanır", () => {
    expect(pickReminder({ ...base, today: "2026-10-10", endDate: "2026-10-05" })).toBeNull();
    expect(pickReminder({ ...base, today: "2026-10-08", startDate: "2026-10-20" })).toBeNull();
  });
  it("pencere dışında null", () => {
    expect(pickReminder({ ...base, today: "2026-10-25" })).toBeNull();
  });
});

describe("daysToDue", () => {
  it("gün farkı", () => {
    expect(daysToDue("2026-10-06", "2026-10-10")).toBe(4);
    expect(daysToDue("2026-10-10", "2026-10-06")).toBe(-4);
  });
});

describe("isQuietHour (Türkiye saati)", () => {
  const at = (hh: string) => Date.parse(`2026-10-06T${hh}:00+03:00`);
  it("21-08 gece penceresi", () => {
    expect(isQuietHour(at("22:30"), 21, 8)).toBe(true);
    expect(isQuietHour(at("03:00"), 21, 8)).toBe(true);
    expect(isQuietHour(at("08:00"), 21, 8)).toBe(false);
    expect(isQuietHour(at("12:00"), 21, 8)).toBe(false);
  });
  it("aynı gün penceresi ve eşit uçlar", () => {
    expect(isQuietHour(at("13:00"), 12, 14)).toBe(true);
    expect(isQuietHour(at("15:00"), 12, 14)).toBe(false);
    expect(isQuietHour(at("03:00"), 5, 5)).toBe(false);
  });
});

describe("buildReminderMessage", () => {
  it("yalnız ad, tutar, tarih ve ofis; adres/IBAN yok", () => {
    const m = buildReminderMessage({ kind: "before", renterName: "Ayşe Yılmaz", officeName: "Vadi Emlak", amount: 15000, due: "2026-10-10" });
    expect(m).toContain("Ayşe Yılmaz");
    expect(m).toContain("10 Ekim");
    expect(m).toMatch(/15\.000/);
    expect(m).toContain("Vadi Emlak");
    expect(m).not.toMatch(/IBAN|TR\d{2}/i);
    expect(m).toMatch(/istemiyorsanız/);
  });
  it("ad yoksa genel hitap; gecikme metni sert değil", () => {
    const m = buildReminderMessage({ kind: "late", renterName: null, officeName: null, amount: 1000, due: "2026-10-10" });
    expect(m.startsWith("Merhaba,")).toBe(true);
    expect(m).toMatch(/rica ederiz/);
  });
});

describe("isSmsEligibleStoredPhone", () => {
  it("yalnız TR cep saklama biçimi", () => {
    expect(isSmsEligibleStoredPhone("05321234567")).toBe(true);
    expect(isSmsEligibleStoredPhone("02121234567")).toBe(false);
    expect(isSmsEligibleStoredPhone("+4915112345678")).toBe(false);
    expect(isSmsEligibleStoredPhone(null)).toBe(false);
  });
});
