import { describe, expect, it } from "vitest";
import { cleanPresenceNote, effectivePresence, presenceRank, presenceTimeLabel, shouldAutoField } from "./presence";

// 2026-10-17 14:00 Türkiye saati (11:00Z).
const NOW = Date.parse("2026-10-17T11:00:00Z");
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("effectivePresence: gün sonu (Europe/Istanbul) bitişi", () => {
  it("bugün seçilen durum geçerli", () => {
    expect(effectivePresence({ status: "meeting", note: "Moda", updated_at: iso(NOW - 30 * MIN) }, NOW)).toEqual({ status: "meeting", note: "Moda", atMs: NOW - 30 * MIN, expired: false });
  });
  it("dün seçilen durum bugün Çevrimdışı olur, son görülme korunur", () => {
    const at = Date.parse("2026-10-16T18:30:00Z"); // 16 Eki 21:30 TR
    expect(effectivePresence({ status: "office", updated_at: iso(at) }, NOW)).toEqual({ status: "offline", note: null, atMs: at, expired: true });
  });
  it("sınır Türkiye gece yarısıdır (UTC değil)", () => {
    const at = Date.parse("2026-10-16T21:30:00Z"); // 17 Eki 00:30 TR → bugün
    expect(effectivePresence({ status: "field", updated_at: iso(at) }, NOW)?.expired).toBe(false);
    const before = Date.parse("2026-10-16T20:59:00Z"); // 16 Eki 23:59 TR → dün
    expect(effectivePresence({ status: "field", updated_at: iso(before) }, NOW)?.expired).toBe(true);
  });
  it("örnek satır bitmez; yaşı 6 saatlik pencerede döner", () => {
    const e = effectivePresence({ status: "break", updated_at: iso(NOW - 3 * 86_400_000 - 12 * MIN), is_sample: true }, NOW)!;
    expect(e.expired).toBe(false);
    expect(e.status).toBe("break");
    expect(NOW - e.atMs).toBe(12 * MIN);
  });
  it("satır yok / bozuk durum / bozuk zaman → null", () => {
    expect(effectivePresence(null, NOW)).toBeNull();
    expect(effectivePresence({ status: "uykuda", updated_at: iso(NOW) }, NOW)).toBeNull();
    expect(effectivePresence({ status: "office", updated_at: "x" }, NOW)).toBeNull();
  });
});

describe("presenceTimeLabel", () => {
  it.each([
    [NOW - 2 * MIN, "Şu an aktif"],
    [NOW + 1 * MIN, "Şu an aktif"],
    [NOW - 15 * MIN, "15 dk önce"],
    [NOW - 59 * MIN, "59 dk önce"],
    [NOW - 60 * MIN, "1 saat önce"],
    [NOW - 170 * MIN, "2 saat önce"],
    [Date.parse("2026-10-17T05:32:00Z"), "08:32"],
    [Date.parse("2026-10-16T15:05:00Z"), "Dün 18:05"],
    [Date.parse("2026-10-14T09:00:00Z"), "3 gün önce"],
  ])("%s → %s", (at, label) => {
    expect(presenceTimeLabel(at, NOW)).toBe(label);
  });
  it("geçersiz zaman boş", () => expect(presenceTimeLabel(NaN, NOW)).toBe(""));
});

describe("sıra, not, saha modu", () => {
  it("Ofiste → Görüşmede → Sahada → Mola → Uzakta → durumsuz → Çevrimdışı", () => {
    const order = (["offline", null, "away", "break", "field", "meeting", "office"] as const).slice().sort((a, b) => presenceRank(a) - presenceRank(b));
    expect(order).toEqual(["office", "meeting", "field", "break", "away", null, "offline"]);
  });
  it("not kırpılır, boşluk sadeleşir, 60 karakter", () => {
    expect(cleanPresenceNote("  15:00'e   kadar  ")).toBe("15:00'e kadar");
    expect(cleanPresenceNote("")).toBeNull();
    expect(cleanPresenceNote(42)).toBeNull();
    expect(Array.from(cleanPresenceNote("ğ".repeat(80))!)).toHaveLength(60);
  });
  it("saha modu yalnız durum yoksa / bitmişse / Ofiste-Çevrimdışı ise Sahada'ya geçirir", () => {
    expect(shouldAutoField(null)).toBe(true);
    expect(shouldAutoField({ status: "offline", note: null, atMs: 0, expired: true })).toBe(true);
    expect(shouldAutoField({ status: "office", note: null, atMs: 0, expired: false })).toBe(true);
    expect(shouldAutoField({ status: "meeting", note: null, atMs: 0, expired: false })).toBe(false);
    expect(shouldAutoField({ status: "break", note: null, atMs: 0, expired: false })).toBe(false);
  });
});
