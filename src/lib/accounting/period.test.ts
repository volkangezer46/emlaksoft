import { describe, expect, it } from "vitest";
import { inPeriod, periodSearchParams, resolvePeriod, trDayStartFromKey } from "./period";

// 2026-10-31T21:30:00Z = 1 Kasım 2026 00:30 (TR): UTC'de hâlâ Ekim ama Türkiye'de Kasım.
const NOV_1_TR = Date.parse("2026-10-31T21:30:00Z");
// 2026-10-15 12:00 TR
const MID_OCT = Date.parse("2026-10-15T09:00:00Z");

describe("resolvePeriod", () => {
  it("varsayılan bu ay: sınırlar Türkiye gece yarısı (UTC+3)", () => {
    const p = resolvePeriod({}, MID_OCT);
    expect(p.preset).toBe("bu-ay");
    expect(p.fromIso).toBe("2026-09-30T21:00:00.000Z");
    expect(p.toIso).toBe("2026-10-31T21:00:00.000Z");
    expect(p.label).toBe("Ekim 2026");
  });

  it("UTC sunucuda ayın ilk 3 saati önceki aya yazılmaz", () => {
    const p = resolvePeriod({ donem: "bu-ay" }, NOV_1_TR);
    expect(p.label).toBe("Kasım 2026");
    expect(p.fromIso).toBe("2026-10-31T21:00:00.000Z");
  });

  it("geçen ay = önceki takvim ayı, üst sınır bu ayın başı (hariç)", () => {
    const p = resolvePeriod({ donem: "gecen-ay" }, MID_OCT);
    expect(p.fromIso).toBe("2026-08-31T21:00:00.000Z");
    expect(p.toIso).toBe("2026-09-30T21:00:00.000Z");
    expect(p.label).toBe("Eylül 2026");
  });

  it("yıl dönümünde geçen ay Aralık", () => {
    const p = resolvePeriod({ donem: "gecen-ay" }, Date.parse("2027-01-10T09:00:00Z"));
    expect(p.label).toBe("Aralık 2026");
  });

  it("özel aralıkta bitiş günü DAHİL (üst sınır ertesi gün başı)", () => {
    const p = resolvePeriod({ donem: "ozel", from: "2026-10-01", to: "2026-10-15" }, MID_OCT);
    expect(p.fromIso).toBe("2026-09-30T21:00:00.000Z");
    expect(p.toIso).toBe("2026-10-15T21:00:00.000Z");
    expect(inPeriod("2026-10-15T20:59:59Z", p)).toBe(true);
    expect(inPeriod("2026-10-15T21:00:00Z", p)).toBe(false);
  });

  it("ters girilen aralık düzeltilir", () => {
    const p = resolvePeriod({ donem: "ozel", from: "2026-10-15", to: "2026-10-01" }, MID_OCT);
    expect(p.fromDay).toBe("2026-10-01");
    expect(p.toDay).toBe("2026-10-15");
  });

  it("tek uçlu özel aralık açık uçludur", () => {
    const p = resolvePeriod({ donem: "ozel", from: "2026-10-01" }, MID_OCT);
    expect(p.toIso).toBeNull();
    expect(inPeriod("2030-01-01T00:00:00Z", p)).toBe(true);
  });

  it("geçersiz özel değerler ve gerçek olmayan tarih bu aya düşer", () => {
    expect(resolvePeriod({ donem: "ozel", from: "2026-02-31", to: "x" }, MID_OCT).preset).toBe("bu-ay");
    expect(resolvePeriod({ donem: "saçma" }, MID_OCT).preset).toBe("bu-ay");
    expect(trDayStartFromKey("2026-13-01")).toBeNull();
  });

  it("tüm zamanlar sınırsız", () => {
    const p = resolvePeriod({ donem: "tumu" }, MID_OCT);
    expect(p.fromIso).toBeNull();
    expect(p.toIso).toBeNull();
    expect(periodSearchParams(p)).toEqual({ donem: "tumu" });
  });

  it("periodSearchParams özel aralığı geri yazar", () => {
    const p = resolvePeriod({ donem: "ozel", from: "2026-10-01", to: "2026-10-05" }, MID_OCT);
    expect(periodSearchParams(p)).toEqual({ donem: "ozel", from: "2026-10-01", to: "2026-10-05" });
  });
});

describe("inPeriod", () => {
  it("alt sınır dahil, üst sınır hariç; boş değer false", () => {
    const p = resolvePeriod({}, MID_OCT);
    expect(inPeriod("2026-09-30T21:00:00.000Z", p)).toBe(true);
    expect(inPeriod("2026-10-31T21:00:00.000Z", p)).toBe(false);
    expect(inPeriod("2026-09-30T20:59:59.999Z", p)).toBe(false);
    expect(inPeriod(null, p)).toBe(false);
  });
});
