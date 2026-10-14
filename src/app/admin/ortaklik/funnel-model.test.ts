import { describe, expect, it } from "vitest";
import type { GrowthMetrics } from "@/lib/growth/program";
import { buildGrowthFunnel, growthIsIdle, kFactorParts, pctOf, readinessSummary } from "./funnel-model";

const m = {
  clicks: 200,
  signups: 50,
  payers: 10,
  invitesPerReferrer: 2,
  signupToPaid: 0.2,
  kFactor: 0.4,
} as GrowthMetrics;
const href = { clicks: "/a", signups: "/b", payers: "/c", rewards: "/d" };

describe("growth funnel model", () => {
  it("pctOf sıfır paydada null döner", () => {
    expect(pctOf(5, 0)).toBeNull();
    expect(pctOf(1, 4)).toBe(25);
  });
  it("dört aşama ve oranlar", () => {
    const s = buildGrowthFunnel(m, 5, href);
    expect(s.map((x) => x.value)).toEqual([200, 50, 10, 5]);
    expect(s[1]!.sub).toBe("%25 tıklama sonrası");
    expect(s[2]!.sub).toBe("%20 kayıt sonrası");
    expect(s[3]!.sub).toBe("%50 ödeyen sonrası");
    expect(s.every((x) => x.href)).toBe(true);
  });
  it("tıklama yoksa kayıt oranı uydurulmaz", () => {
    expect(buildGrowthFunnel({ ...m, clicks: 0 }, 0, href)[1]!.sub).toBeUndefined();
  });
  it("K-faktör 1 ve üstü kendi kendini büyütür", () => {
    expect(kFactorParts(m).selfSustaining).toBe(false);
    expect(kFactorParts({ ...m, kFactor: 1.2 }).selfSustaining).toBe(true);
    expect(kFactorParts({ ...m, kFactor: null }).selfSustaining).toBe(false);
  });
  it("hazırlık özeti", () => {
    const c = (ok: boolean, blocking: boolean) => ({ key: "k", label: "l", detail: "d", ok, blocking });
    expect(readinessSummary([[c(true, false), c(false, true)], [c(false, false)]])).toEqual({ ok: 1, total: 3, blocking: 1 });
  });
  it("boş durum", () => {
    expect(growthIsIdle({ referralEnabled: false, partnerEnabled: false }, 0)).toBe(true);
    expect(growthIsIdle({ referralEnabled: true, partnerEnabled: false }, 0)).toBe(false);
  });
});
