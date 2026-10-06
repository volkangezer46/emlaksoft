import { describe, expect, it } from "vitest";
import { decideCadence, isCheckStale, type CadenceInput } from "./cadence";

const NOW = Date.parse("2026-03-01T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3_600_000;
const D = 86_400_000;

const base: CadenceInput = {
  state: "verified",
  publishedAt: iso(NOW - 20 * D),
  lastCheckAt: iso(NOW - 2 * H),
  nextCheckAt: null,
  checkFailures: 0,
  riskScore: 0,
  priceMismatch: false,
  authorityIssue: false,
};

describe("akıllı kontrol sıklığı", () => {
  it("normal ilan 24 saat; son kontrol 2 saat önceyse henüz vadesi gelmedi", () => {
    const d = decideCadence(base, NOW)!;
    expect(d.reason).toBe("normal");
    expect(d.intervalMinutes).toBe(24 * 60);
    expect(d.due).toBe(false);
    expect(decideCadence({ ...base, lastCheckAt: iso(NOW - 25 * H) }, NOW)!.due).toBe(true);
  });

  it("yeni ilan (ilk 7 gün) 6 saat", () => {
    const d = decideCadence({ ...base, publishedAt: iso(NOW - 2 * D) }, NOW)!;
    expect(d.reason).toBe("new_listing");
    expect(d.intervalMinutes).toBe(360);
  });

  it("60+ gün yaşlı ilan 12 saat", () => {
    const d = decideCadence({ ...base, publishedAt: iso(NOW - 90 * D) }, NOW)!;
    expect(d.reason).toBe("old_listing");
    expect(d.intervalMinutes).toBe(720);
  });

  it("kritik (risk ≥ 60, fiyat farkı, yetki, onaylı kayıp) 6 saat", () => {
    expect(decideCadence({ ...base, riskScore: 60 }, NOW)!.reason).toBe("critical");
    expect(decideCadence({ ...base, priceMismatch: true }, NOW)!.intervalMinutes).toBe(360);
    expect(decideCadence({ ...base, authorityIssue: true }, NOW)!.reason).toBe("critical");
    expect(decideCadence({ ...base, state: "confirmed_missing" }, NOW)!.reason).toBe("critical");
  });

  it("şüpheli/olası kayıp 15 dakikada yeniden kontrol, en yüksek öncelik", () => {
    const d = decideCadence({ ...base, state: "suspect", lastCheckAt: iso(NOW - 16 * 60_000) }, NOW)!;
    expect(d.reason).toBe("suspect_recheck");
    expect(d.due).toBe(true);
    expect(d.priority).toBeGreaterThan(decideCadence(base, NOW)!.priority);
  });

  it("başarısız kontrol 30/60/120/240 dk geri çekilir (azami 240)", () => {
    const mk = (n: number) => decideCadence({ ...base, state: "unverifiable", checkFailures: n }, NOW)!.intervalMinutes;
    expect([mk(1), mk(2), mk(3), mk(4), mk(9)]).toEqual([30, 60, 120, 240, 240]);
  });

  it("duraklatılmış ilan kuyruğa alınmaz", () => {
    expect(decideCadence({ ...base, state: "paused" }, NOW)).toBeNull();
  });

  it("RPC'nin yazdığı daha erken next_check_at'e saygı gösterir", () => {
    const d = decideCadence({ ...base, nextCheckAt: iso(NOW - 60_000) }, NOW)!;
    expect(d.due).toBe(true);
  });

  it("tazelik: başarılı kontrol yoksa ya da 72 saatten eskiyse bayat", () => {
    expect(isCheckStale(null, NOW)).toBe(true);
    expect(isCheckStale(iso(NOW - 80 * H), NOW)).toBe(true);
    expect(isCheckStale(iso(NOW - 10 * H), NOW)).toBe(false);
  });
});
