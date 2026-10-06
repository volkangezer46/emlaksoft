import { describe, expect, it } from "vitest";
import {
  applyBlockCooldown,
  EXTENSION_LIMITS,
  INITIAL_PACING,
  leaseDecision,
  localDayKey,
  pacingDecision,
  recordRequest,
  releaseLease,
  todayCount,
} from "./extension-pacing";
import { WORKER_LIMITS } from "./core";

const DAY = "2026-10-07";
const T0 = Date.parse("2026-10-07T09:00:00.000Z");

describe("eklenti hız kuralı", () => {
  it("sayılar tek kaynaktan: ≥20 sn + sapma, saatte ≤60", () => {
    expect(EXTENSION_LIMITS.minIntervalMs).toBe(WORKER_LIMITS.minIntervalMs);
    expect(EXTENSION_LIMITS.minIntervalMs).toBeGreaterThanOrEqual(20_000);
    expect(EXTENSION_LIMITS.maxPerHour).toBeLessThanOrEqual(60);
  });
  it("iki istek arası en az 20 sn (rastgele sapma eklenir)", () => {
    const s1 = recordRequest(INITIAL_PACING, T0, DAY, 0.5);
    expect(pacingDecision(s1, T0 + 19_999, DAY)).toMatchObject({ ok: false, reason: "interval" });
    expect(pacingDecision(s1, T0 + 25_000, DAY)).toEqual({ ok: true });
    expect(recordRequest(INITIAL_PACING, T0, DAY, 1).nextAllowedAtMs - T0).toBe(30_000);
  });
  it("saatlik tavan: 60 istekten sonra en eski istek saati dolana kadar bekler", () => {
    let s = INITIAL_PACING;
    for (let i = 0; i < 60; i += 1) s = recordRequest(s, T0 + i * 30_000, DAY, 0);
    const d = pacingDecision(s, T0 + 60 * 30_000, DAY);
    expect(d).toMatchObject({ ok: false, reason: "hour_cap" });
    expect(pacingDecision(s, T0 + 3_600_000 + 1, DAY).ok).toBe(true);
  });
  it("günlük tavan ve gün değişimi", () => {
    const s = { ...INITIAL_PACING, dayKey: DAY, dayCount: EXTENSION_LIMITS.maxPerDay };
    expect(pacingDecision(s, T0, DAY)).toMatchObject({ ok: false, reason: "day_cap" });
    expect(pacingDecision(s, T0, "2026-10-08").ok).toBe(true);
    expect(todayCount(recordRequest(s, T0, "2026-10-08", 0), "2026-10-08")).toBe(1);
  });
  it("429/CAPTCHA/giriş duvarı tüm kontrolleri 30 dk durdurur (aşma yok); sıradan hata durdurmaz", () => {
    const blocked = applyBlockCooldown(INITIAL_PACING, T0, "http_429");
    expect(pacingDecision(blocked, T0 + 29 * 60_000, DAY)).toMatchObject({ ok: false, reason: "cooldown" });
    expect(pacingDecision(blocked, T0 + 31 * 60_000, DAY).ok).toBe(true);
    expect(applyBlockCooldown(INITIAL_PACING, T0, "captcha").cooldownUntilMs).toBeGreaterThan(T0);
    expect(applyBlockCooldown(INITIAL_PACING, T0, "unexpected_structure")).toBe(INITIAL_PACING);
  });
});

describe("lider sekme kirası", () => {
  it("tek sekme yürütür; kira dolunca ya da bırakılınca başka sekme devralır", () => {
    const a = leaseDecision(null, "A", T0);
    expect(a.granted).toBe(true);
    expect(leaseDecision(a.lease, "B", T0 + 10_000).granted).toBe(false);
    expect(leaseDecision(a.lease, "A", T0 + 10_000).granted).toBe(true);
    expect(leaseDecision(a.lease, "B", T0 + EXTENSION_LIMITS.leaseMs + 1).granted).toBe(true);
    expect(leaseDecision(releaseLease(a.lease, "A"), "B", T0 + 1).granted).toBe(true);
    expect(releaseLease(a.lease, "B")).toEqual(a.lease);
    expect(leaseDecision(null, "", T0).granted).toBe(false);
  });
  it("yerel gün anahtarı", () => {
    expect(localDayKey(Date.parse("2026-10-07T22:30:00.000Z"), -180)).toBe("2026-10-08");
    expect(localDayKey(Date.parse("2026-10-07T20:30:00.000Z"), -180)).toBe("2026-10-07");
  });
});
