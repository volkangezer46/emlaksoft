import { describe, expect, it } from "vitest";
import { trMonthKey } from "@/lib/clock";
import { EF_DEFAULT_TARIFF } from "./config";
import {
  approxValuations,
  decideGrants,
  efCreditsLine,
  monthlyUnitsOf,
  planMonthlyIdempotencyKey,
  welcomeIdempotencyKey,
  type EfGrantCandidate,
} from "./plan-credits";

const cand = (over: Partial<EfGrantCandidate> = {}): EfGrantCandidate => ({
  tenantId: "t1",
  plan: "office",
  subscriptionStatus: "active",
  tenantStatus: "active",
  valuationClosed: false,
  ...over,
});
const base = { monthKey: "2026-10", planMonthly: { office: 40, advisor: 10, enterprise: null }, welcomeUnits: 0, welcomeGranted: new Set<string>() };

describe("plan kontör hakkı: anahtarlar ve ay sınırı", () => {
  it("idempotency anahtarları sözleşmeye uyar", () => {
    expect(planMonthlyIdempotencyKey("abc", "2026-10")).toBe("plan:abc:2026-10");
    expect(welcomeIdempotencyKey("abc")).toBe("welcome:abc");
  });
  it("ay anahtarı TR takvimine göre (UTC 21:00 sonrası ertesi ay)", () => {
    expect(trMonthKey(Date.UTC(2026, 9, 31, 20, 59))).toBe("2026-10");
    expect(trMonthKey(Date.UTC(2026, 9, 31, 21, 0))).toBe("2026-11");
    expect(trMonthKey(Date.UTC(2026, 11, 31, 22, 0))).toBe("2027-01");
  });
});

describe("plan kontör hakkı: hesap ve metin", () => {
  it("null/0/geçersiz = hak yok", () => {
    for (const v of [null, undefined, 0, -3, 1.5]) expect(monthlyUnitsOf(v)).toBe(0);
    expect(monthlyUnitsOf(120)).toBe(120);
  });
  it("yaklaşık değerleme = floor(N / değerleme bedeli); bedel 0 ise hesaplanamaz", () => {
    expect(approxValuations(120, EF_DEFAULT_TARIFF)).toBe(24);
    expect(approxValuations(10, EF_DEFAULT_TARIFF)).toBe(2);
    expect(approxValuations(7, EF_DEFAULT_TARIFF)).toBe(1);
    expect(approxValuations(40, { valuationArsa: 0 })).toBeNull();
  });
  it("satır: hak yoksa gizli, bedel yoksa parantezsiz", () => {
    expect(efCreditsLine(null, 5)).toBeNull();
    expect(efCreditsLine(0, 5)).toBeNull();
    expect(efCreditsLine(40, 5)).toBe("Aylık 40 kontör (yaklaşık 8 değerleme)");
    expect(efCreditsLine(3, 5)).toBe("Aylık 3 kontör");
    expect(efCreditsLine(40, 0)).toBe("Aylık 40 kontör");
  });
});

describe("hak verme kararı", () => {
  it("plan hakkı kadar plan_monthly, ay anahtarıyla", () => {
    const d = decideGrants({ ...base, candidates: [cand()] });
    expect(d.grants).toEqual([{ tenantId: "t1", kind: "plan_monthly", units: 40, idempotencyKey: "plan:t1:2026-10" }]);
  });
  it("deneme (trialing/trial) ofisi hak alır", () => {
    const d = decideGrants({ ...base, candidates: [cand({ subscriptionStatus: "trialing", tenantStatus: "trial" })] });
    expect(d.grants).toHaveLength(1);
  });
  it("past_due / askıda / iptal / duraklatılmış hak almaz", () => {
    const d = decideGrants({
      ...base,
      candidates: [
        cand({ tenantId: "a", subscriptionStatus: "past_due" }),
        cand({ tenantId: "b", subscriptionStatus: "cancelled" }),
        cand({ tenantId: "c", subscriptionStatus: "paused" }),
        cand({ tenantId: "d", tenantStatus: "suspended" }),
        cand({ tenantId: "e", tenantStatus: "past_due" }),
      ],
      welcomeUnits: 10,
    });
    expect(d.grants).toEqual([]);
    expect(d.skipped).toHaveLength(5);
  });
  it("valuation modülü kapalı ofis hak almaz", () => {
    const d = decideGrants({ ...base, candidates: [cand({ valuationClosed: true })], welcomeUnits: 10 });
    expect(d.grants).toEqual([]);
    expect(d.skipped).toEqual([{ tenantId: "t1", reason: "modul_kapali" }]);
  });
  it("plan hakkı olmayan paket (Kurumsal null) aylık hibe almaz, atlanır", () => {
    const d = decideGrants({ ...base, candidates: [cand({ plan: "enterprise" })] });
    expect(d.grants).toEqual([]);
    expect(d.skipped).toEqual([{ tenantId: "t1", reason: "plan_hakki_yok" }]);
  });
  it("bu ay zaten verilmişse tekrar planlanmaz (ön eleme)", () => {
    const d = decideGrants({ ...base, candidates: [cand()], monthlyGranted: new Set(["plan:t1:2026-10"]) });
    expect(d.grants).toEqual([]);
  });
  it("hoş geldin: açıkken tek sefer bonus, almışsa verilmez, 0 = kapalı", () => {
    const on = decideGrants({ ...base, welcomeUnits: 10, candidates: [cand()] });
    expect(on.grants.map((g) => g.kind)).toEqual(["plan_monthly", "bonus"]);
    expect(on.grants[1]).toMatchObject({ units: 10, idempotencyKey: "welcome:t1" });
    const taken = decideGrants({ ...base, welcomeUnits: 10, candidates: [cand()], welcomeGranted: new Set(["welcome:t1"]) });
    expect(taken.grants.map((g) => g.kind)).toEqual(["plan_monthly"]);
    const off = decideGrants({ ...base, welcomeUnits: 0, candidates: [cand()] });
    expect(off.grants.map((g) => g.kind)).toEqual(["plan_monthly"]);
  });
  it("plan hakkı olmayan paket hoş geldin alabilir", () => {
    const d = decideGrants({ ...base, welcomeUnits: 10, candidates: [cand({ plan: "enterprise" })] });
    expect(d.grants.map((g) => g.kind)).toEqual(["bonus"]);
  });
});
