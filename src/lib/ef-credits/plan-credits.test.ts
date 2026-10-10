import { describe, expect, it } from "vitest";
import { trMonthKey } from "@/lib/clock";
import { EF_DEFAULT_TARIFF } from "./config";
import {
  approxValuations,
  decideGrants,
  efCreditsLine,
  monthlyUnitsOf,
  monthlyUnitsWithSeats,
  planDeltaIdempotencyKey,
  planMonthlyIdempotencyKey,
  welcomeEligible,
  welcomeIdempotencyKey,
  type EfGrantCandidate,
} from "./plan-credits";

const cand = (over: Partial<EfGrantCandidate> = {}): EfGrantCandidate => ({
  tenantId: "t1",
  plan: "office",
  subscriptionStatus: "active",
  tenantStatus: "active",
  valuationClosed: false,
  tenantCreatedAt: "2026-10-10T09:00:00Z",
  ...over,
});
const SINCE = Date.parse("2026-10-06T00:00:00Z");
const base = {
  monthKey: "2026-10",
  planMonthly: { office: 40, advisor: 10, enterprise: null },
  welcomeUnits: 0,
  welcomeSinceMs: SINCE,
  welcomeGranted: new Set<string>(),
};

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
    // En ucuz rapor (konut 700): paket hakları Danışman 100 / Ofis 700 / Profesyonel 2.100 / Kurumsal 7.000 = 0 / 1 / 3 / 10 rapor.
    expect([100, 700, 2100, 7000].map((u) => approxValuations(u, EF_DEFAULT_TARIFF))).toEqual([0, 1, 3, 10]);
    expect(approxValuations(699, EF_DEFAULT_TARIFF)).toBe(0);
    expect(approxValuations(40, { valuationArsa: 0 })).toBeNull();
  });
  it("satır: hak yoksa gizli, bedel yoksa parantezsiz", () => {
    expect(efCreditsLine(null, 5)).toBeNull();
    expect(efCreditsLine(0, 5)).toBeNull();
    expect(efCreditsLine(40, 5)).toBe("Aylık 40 kontör (yaklaşık 8 değerleme)");
    expect(efCreditsLine(2100, 700)).toBe("Aylık 2.100 kontör (yaklaşık 3 değerleme)");
    expect(efCreditsLine(3, 5)).toBe("Aylık 3 kontör");
    expect(efCreditsLine(40, 0)).toBe("Aylık 40 kontör");
  });
});

describe("hak verme kararı", () => {
  it("plan hakkı kadar plan_monthly, ay anahtarıyla", () => {
    const d = decideGrants({ ...base, candidates: [cand()] });
    expect(d.grants).toEqual([{ tenantId: "t1", kind: "plan_monthly", units: 40, idempotencyKey: "plan:t1:2026-10" }]);
  });
  it("deneme (trialing/trial) ofisi AYLIK plan hakkı almaz (yalnız active)", () => {
    const d = decideGrants({
      ...base,
      candidates: [cand({ subscriptionStatus: "trialing", tenantStatus: "trial", extraSeats: 5 })],
      planPerExtraSeat: { office: 6 },
    });
    expect(d.grants).toEqual([]);
    expect(d.skipped).toEqual([{ tenantId: "t1", reason: "plan_hakki_yok" }]);
  });
  it("deneme ofisi hoş geldin kontörünü alır (yeni ofis); aylık hak ilk ödemeden (active) sonra", () => {
    const trial = decideGrants({
      ...base,
      welcomeUnits: 10,
      candidates: [cand({ subscriptionStatus: "trialing", tenantStatus: "trial" })],
    });
    expect(trial.grants).toEqual([{ tenantId: "t1", kind: "bonus", units: 10, idempotencyKey: "welcome:t1" }]);
    const paid = decideGrants({
      ...base,
      welcomeUnits: 10,
      welcomeGranted: new Set(["welcome:t1"]),
      monthGranted: new Map(),
      candidates: [cand()],
    });
    expect(paid.grants).toEqual([{ tenantId: "t1", kind: "plan_monthly", units: 40, idempotencyKey: "plan:t1:2026-10" }]);
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
    expect(on.grants).toHaveLength(2);
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

describe("kullanıcı sayısıyla ölçeklenen aylık hak (Kurumsal)", () => {
  it("plan hakkı + ek kullanıcı x ek kullanıcı başı hak; plan hakkı yoksa 0", () => {
    expect(monthlyUnitsWithSeats(400, 6, 0)).toBe(400);
    expect(monthlyUnitsWithSeats(400, 6, 450)).toBe(3100);
    expect(monthlyUnitsWithSeats(400, null, 450)).toBe(400);
    expect(monthlyUnitsWithSeats(400, 6, -3)).toBe(400);
    expect(monthlyUnitsWithSeats(null, 6, 10)).toBe(0);
  });
  it("hibe kararı ek kullanıcıyı sayar; ay anahtarı aynı kalır", () => {
    const d = decideGrants({
      candidates: [cand({ tenantId: "e1", plan: "enterprise", extraSeats: 100 }), cand({ tenantId: "o1", plan: "office", extraSeats: 3 })],
      monthKey: "2026-10",
      planMonthly: { enterprise: 400, office: 40 },
      planPerExtraSeat: { enterprise: 6 },
      welcomeUnits: 0,
      welcomeGranted: new Set<string>(),
    });
    expect(d.grants.map((g) => [g.tenantId, g.units, g.idempotencyKey])).toEqual([
      ["e1", 1000, "plan:e1:2026-10"],
      ["o1", 40, "plan:o1:2026-10"],
    ]);
  });
  it("satır metni ek kullanıcı hakkını yazar", () => {
    expect(efCreditsLine(400, 5, 6)).toBe("Aylık 400 kontör (yaklaşık 80 değerleme) + her ek kullanıcı için 6 kontör");
  });
});

describe("hoş geldin geriye dönük dağıtılmaz", () => {
  it("welcomeEligible: since sonrası/eşit evet; önce, tarih yok, ayar yok hayır", () => {
    expect(welcomeEligible("2026-10-06T00:00:00Z", SINCE)).toBe(true);
    expect(welcomeEligible("2026-10-05T23:59:59Z", SINCE)).toBe(false);
    expect(welcomeEligible(null, SINCE)).toBe(false);
    expect(welcomeEligible("2026-10-10T00:00:00Z", null)).toBe(false);
    expect(welcomeEligible("bozuk", SINCE)).toBe(false);
  });
  it("mevcut (since öncesi) ofise toplu hibe yok; yeni ofis alır; ayar yoksa kimse almaz", () => {
    const candidates = [
      cand({ tenantId: "eski", plan: "enterprise", tenantCreatedAt: "2026-01-01T00:00:00Z" }),
      cand({ tenantId: "yeni", plan: "enterprise", tenantCreatedAt: "2026-10-07T00:00:00Z" }),
    ];
    const d = decideGrants({ ...base, welcomeUnits: 10, candidates });
    expect(d.grants.map((g) => g.tenantId)).toEqual(["yeni"]);
    expect(d.skipped).toEqual([{ tenantId: "eski", reason: "plan_hakki_yok" }]);
    const none = decideGrants({ ...base, welcomeUnits: 10, welcomeSinceMs: null, candidates });
    expect(none.grants).toEqual([]);
  });
});

describe("plan yükseltme farkı (aynı ay)", () => {
  const withGranted = (granted: number, plan = "office", seats = 0) =>
    decideGrants({ ...base, planMonthly: { office: 40, pro: 120 }, candidates: [cand({ plan, extraSeats: seats })], monthGranted: new Map([["t1", granted]]) });

  it("yükseltmede güncel hak ile o ay verilen arasındaki pozitif fark, delta anahtarıyla", () => {
    const d = withGranted(40, "pro");
    expect(d.grants).toEqual([
      { tenantId: "t1", kind: "plan_monthly", units: 80, idempotencyKey: "plan:t1:2026-10:delta:120", delta: true },
    ]);
    expect(planDeltaIdempotencyKey("t1", "2026-10", 120)).toBe("plan:t1:2026-10:delta:120");
  });
  it("ikinci yükseltme yalnız kalan farkı verir (toplam = taban + önceki deltalar)", () => {
    const d = decideGrants({
      ...base,
      planMonthly: { business: 300 },
      candidates: [cand({ plan: "business" })],
      monthGranted: new Map([["t1", 120]]), // 40 + 80 verilmişti
    });
    expect(d.grants.map((g) => [g.units, g.idempotencyKey])).toEqual([[180, "plan:t1:2026-10:delta:300"]]);
  });
  it("çift koşu = sıfır ek hibe: hak == verilen toplam", () => {
    expect(withGranted(40).grants).toEqual([]);
  });
  it("düşürmede (verilenden küçük hak) geri alma/hibe yok", () => {
    expect(withGranted(120, "office").grants).toEqual([]);
  });
  it("ay içi yükselt-düşür-yükselt: yeni fark yok (toplam zaten karşılanmış)", () => {
    expect(withGranted(120, "pro").grants).toEqual([]);
  });
  it("hiç verilmemişse tam aylık hibe (taban anahtar)", () => {
    const d = decideGrants({ ...base, candidates: [cand()], monthGranted: new Map() });
    expect(d.grants).toEqual([{ tenantId: "t1", kind: "plan_monthly", units: 40, idempotencyKey: "plan:t1:2026-10" }]);
  });
  it("extra_seats yok/0/negatif iken ek hak 0; ek kullanıcı gelince fark verilir", () => {
    const per = { office: 6 };
    const mk = (extraSeats: number | undefined, granted: number) =>
      decideGrants({ ...base, planPerExtraSeat: per, candidates: [cand({ extraSeats })], monthGranted: new Map([["t1", granted]]) }).grants;
    expect(mk(undefined, 40)).toEqual([]);
    expect(mk(0, 40)).toEqual([]);
    expect(mk(-4, 40)).toEqual([]);
    expect(mk(5, 40)).toEqual([{ tenantId: "t1", kind: "plan_monthly", units: 30, idempotencyKey: "plan:t1:2026-10:delta:70", delta: true }]);
  });
  it("monthGranted yoksa (okunamadı) eski ön eleme: fark verilmez", () => {
    const d = decideGrants({ ...base, planMonthly: { office: 120 }, candidates: [cand()], monthlyGranted: new Set(["plan:t1:2026-10"]) });
    expect(d.grants).toEqual([]);
  });
});
