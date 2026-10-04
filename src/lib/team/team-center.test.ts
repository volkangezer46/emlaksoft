import { describe, expect, it } from "vitest";
import { DEFAULT_MATRIX, hasPermission } from "@/lib/permissions";
import { canSeeAllEarnings, canSeeEarningsOf } from "./earnings-scope";
import { advisorShare, summarizeAdvisorEarning, type ShareRow } from "./advisor-share";
import {
  buildScorecard,
  conversionPct,
  matchesScorecardFilter,
  parseScorecardSort,
  targetProgressPct,
  trMonthContext,
  type ScorecardInput,
} from "./scorecard";
import { computeTargetActuals, targetPeriodRange } from "./target-actuals";
import { ALL_NAV_HREFS, resolveActiveNav, visibleSections } from "@/lib/nav-config";
import { findGate } from "@/lib/billing/page-gates";
import type { AppModule } from "@/lib/permissions";

describe("kazanç gizliliği (earnings_all)", () => {
  it("varsayılan matriste yalnız sahip, genel müdür ve muhasebe başkasının kazancını görür", () => {
    const allowed = Object.keys(DEFAULT_MATRIX).filter((r) => hasPermission(r, "earnings_all", "view"));
    expect(allowed.sort()).toEqual(["accounting", "gm", "owner"]);
  });

  it("şube müdürü ve takım lideri komisyonu görse de başkasının kazancını göremez", () => {
    for (const role of ["branch_manager", "team_lead", "advisor"]) {
      expect(hasPermission(role, "commissions", "view"), role).toBe(true);
      expect(hasPermission(role, "earnings_all", "view"), role).toBe(false);
    }
  });

  it("kendi kazancı her zaman, başkasınınki yalnız izinle görünür", () => {
    expect(canSeeAllEarnings({})).toBe(false);
    expect(canSeeAllEarnings({ earnings_all: ["view"] })).toBe(true);
    expect(canSeeEarningsOf({}, "a", "a")).toBe(true);
    expect(canSeeEarningsOf({}, "a", "b")).toBe(false);
    expect(canSeeEarningsOf({ earnings_all: ["view"] }, "a", "b")).toBe(true);
  });
});

describe("danışman payı", () => {
  const row = (over: Partial<ShareRow>): ShareRow => ({
    gross_amount: 100_000,
    status: "calculated",
    splits: [
      { label: "Ayşe Yılmaz", rate: 40 },
      { label: "Ofis", rate: 60 },
    ],
    deal: { assigned_to: "u1" },
    ...over,
  });

  it("ad etiketiyle eşleşen pay brüt x oran", () => {
    expect(advisorShare(row({}), "Ayşe Yılmaz", "u1")).toEqual({ amount: 40_000, note: "%40 pay" });
  });

  it("başkasının payı bu kullanıcıya girmez", () => {
    expect(advisorShare(row({}), "Mehmet Kaya", "u2")).toBeNull();
  });

  it("paylaşım yoksa atanmış danışmana brüt yazılır", () => {
    expect(advisorShare(row({ splits: null }), "X", "u1")?.amount).toBe(100_000);
    expect(advisorShare(row({ splits: null }), "X", "u2")).toBeNull();
  });

  it("bekleyen ve tahsil edilen ayrı toplanır", () => {
    const rows = [row({}), row({ status: "paid" }), row({ status: "collected", gross_amount: 50_000 })];
    expect(summarizeAdvisorEarning(rows, "Ayşe Yılmaz", "u1")).toEqual({ count: 3, pending: 40_000, collected: 60_000 });
  });
});

const base = (over: Partial<ScorecardInput>): ScorecardInput => ({
  id: "x",
  fullName: "X",
  role: "advisor",
  customerCount: 0,
  activePropertyCount: 0,
  callCount: 0,
  appointCount: 0,
  offerCount: 0,
  dealCount: 0,
  revenue: 0,
  target: null,
  ...over,
});

describe("danışman karnesi", () => {
  it("teklif yoksa dönüşüm null (sahte yüzde yok)", () => {
    expect(conversionPct(0, 0)).toBeNull();
    expect(conversionPct(1, 4)).toBe(25);
  });

  it("anlaşmaya göre sıralar, eşitlikte aynı sıra, verisizlere sıra vermez", () => {
    const rows = buildScorecard(
      [
        base({ id: "a", fullName: "Ali", dealCount: 3 }),
        base({ id: "b", fullName: "Bora", dealCount: 3 }),
        base({ id: "c", fullName: "Can", dealCount: 1 }),
        base({ id: "d", fullName: "Deniz", dealCount: 0 }),
      ],
      "anlasma",
      { includeRevenueInTarget: () => true },
    );
    expect(rows.map((r) => [r.id, r.rank])).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 3],
      ["d", 0],
    ]);
  });

  it("kazanç sıralaması izinsiz kullanıcıda anlaşmaya düşer", () => {
    expect(parseScorecardSort("kazanc", false)).toBe("anlasma");
    expect(parseScorecardSort("kazanc", true)).toBe("kazanc");
    expect(parseScorecardSort("saçma", true)).toBe("anlasma");
  });

  it("hedef gerçekleşmesi yüksek olan oranı alır; ciro hariçse yalnız anlaşma", () => {
    const target = { deals: 4, revenue: 100_000 };
    expect(targetProgressPct(target, { deals: 1, revenue: 80_000 }, true)).toBe(80);
    expect(targetProgressPct(target, { deals: 1, revenue: 80_000 }, false)).toBe(25);
    expect(targetProgressPct(target, { deals: 9, revenue: 0 }, true)).toBe(100);
    expect(targetProgressPct(null, { deals: 1, revenue: 1 }, true)).toBeNull();
  });

  it("filtreler: randevusuz, portföysüz, hedefin gerisinde", () => {
    const [row] = buildScorecard(
      [base({ id: "a", target: { deals: 10, revenue: 0 }, dealCount: 1 })],
      "anlasma",
      { includeRevenueInTarget: () => false },
    );
    expect(matchesScorecardFilter(row!, "randevusuz", 50)).toBe(true);
    expect(matchesScorecardFilter(row!, "portfoysuz", 50)).toBe(true);
    // %10 gerçekleşme, ay %50 geçti: geride. Ay %15'te: tolerans içinde.
    expect(matchesScorecardFilter(row!, "hedefgeride", 50)).toBe(true);
    expect(matchesScorecardFilter(row!, "hedefgeride", 15)).toBe(false);
  });

  it("Türkiye ay bağlamı: UTC gece yarısı öncesi bile TR ayı doğru", () => {
    // 2026-07-31T22:30Z = 2026-08-01 01:30 TR
    const ctx = trMonthContext(Date.parse("2026-07-31T22:30:00Z"));
    expect(ctx.monthKey).toBe("2026-08-01");
    expect(ctx.monthStartIso).toBe("2026-07-31T21:00:00.000Z");
  });
});

describe("hedef gerçekleşmesi (canlı)", () => {
  it("dönem aralığı TR sınırlarıyla aylık/üç aylık/yıllık", () => {
    const m = targetPeriodRange("2026-03-01", "monthly");
    expect(new Date(m.start).toISOString()).toBe("2026-02-28T21:00:00.000Z");
    expect(new Date(m.end).toISOString()).toBe("2026-03-31T21:00:00.000Z");
    const q = targetPeriodRange("2026-01-01", "quarterly");
    expect(new Date(q.end).toISOString()).toBe("2026-03-31T21:00:00.000Z");
  });

  it("kişi hedefi yalnız kendi anlaşma ve cirosunu, ofis hedefi hepsini sayar", () => {
    const targets = [
      { id: "t1", period: "monthly", period_start: "2026-03-01", profile_id: "u1" },
      { id: "t2", period: "monthly", period_start: "2026-03-01", profile_id: null },
    ];
    const offers = [
      { created_by: "u1", created_at: "2026-03-10T10:00:00Z" },
      { created_by: "u2", created_at: "2026-03-11T10:00:00Z" },
      { created_by: "u1", created_at: "2026-04-02T10:00:00Z" },
    ];
    // Gelir = danışmanın KOMİSYON PAYI (tahsil edilmiş); ofis geneli hedef = Ofis komisyonu (brüt).
    const commissions = [
      { gross_amount: 1000, status: "paid", splits: [{ label: "Danışman", rate: 40 }], created_at: "2026-03-12T10:00:00Z", deal: { assigned_to: "u1" } },
      { gross_amount: "500", status: "collected", splits: [{ label: "Danışman", rate: 50 }], created_at: "2026-03-13T10:00:00Z", deal: { assigned_to: "u2" } },
      { gross_amount: 9000, status: "calculated", splits: [{ label: "Danışman", rate: 50 }], created_at: "2026-03-14T10:00:00Z", deal: { assigned_to: "u1" } },
    ];
    const out = computeTargetActuals(targets, offers, commissions, new Map([["u1", "Ayşe Yılmaz"], ["u2", "Can Demir"]]));
    expect(out.get("t1")).toEqual({ deals: 1, revenue: 400 });
    expect(out.get("t2")).toEqual({ deals: 2, revenue: 1500 });
  });
});

describe("Ekip Merkezi menü ve kapılar", () => {
  const ALL: AppModule[] = [
    "dashboard", "customers", "demands", "matching", "commissions", "offers", "contracts", "calls",
    "appointments", "tasks", "properties", "portals", "open_house", "rentals", "network", "projects",
    "valuation", "expenses", "billing", "reports", "targets", "leak", "team", "settings", "campaigns",
    "compliance", "support",
  ];

  it("ekip menü öğesi performans sekmelerini tek kabukta toplar; Performans başlığında tekrar yok", () => {
    const ofis = visibleSections(ALL).find((s) => s.id === "ofis")!;
    const item = ofis.items.find((i) => i.href === "/app/ekip")!;
    expect(item.tabs?.map((t) => t.label)).toEqual(["Genel", "Kıyas", "Danışman KPI", "Ekip Ligi", "Hedefler", "Devir / Atama", "Şubeler"]);
    const perf = visibleSections(ALL).find((s) => s.id === "performans")!;
    expect(perf.items.some((i) => i.href === "/app/hedefler")).toBe(false);
    expect(perf.items.some((i) => i.href === "/app/danisman-kpi" || i.href === "/app/lig")).toBe(false);
    expect(ALL_NAV_HREFS).toContain("/app/danisman-kpi");
    expect(ALL_NAV_HREFS).toContain("/app/lig");
    expect(ALL_NAV_HREFS).toContain("/app/hedefler");
  });

  it("sekme sayfaları Ekip Merkezi öğesini etkin yapar", () => {
    const sections = visibleSections(ALL);
    for (const p of ["/app/ekip/kiyas", "/app/danisman-kpi", "/app/lig", "/app/ekip/devir", "/app/hedefler"]) {
      expect(resolveActiveNav(p, sections).href, p).toBe("/app/ekip");
    }
  });

  it("ekip modülü olmayan rolde (danışman) Ekip Merkezi çıkmaz, yerine Performansım vardır", () => {
    const items = visibleSections(["dashboard", "reports", "commissions"]).flatMap((s) => s.items);
    expect(items.some((i) => i.label === "Ekip Merkezi")).toBe(false);
    expect(items.some((i) => i.href === "/app/performansim" && i.label === "Performansım")).toBe(true);
  });

  it("yetkisiz sekme gizlenir: ekip modülü olan ama hedef izni olmayan rolde Hedefler çıkmaz", () => {
    const item = visibleSections(["dashboard", "team", "reports"]).flatMap((s) => s.items).find((i) => i.label === "Ekip Merkezi")!;
    expect(item.tabs?.map((t) => t.label)).toEqual(["Genel", "Kıyas", "Danışman KPI", "Ekip Ligi", "Devir / Atama", "Şubeler"]);
  });

  it("Kazanç tek sayfa: Finans > Komisyon sekmesi, Ekip Merkezi'nde ayrı Kazanç sekmesi yok", () => {
    const fin = visibleSections(ALL).find((s) => s.id === "finans")!;
    const kom = fin.items.find((i) => i.href === "/app/komisyon")!;
    expect(kom.tabs?.map((t) => t.label)).toContain("Kazanç");
    const ekip = visibleSections(ALL).flatMap((s) => s.items).find((i) => i.href === "/app/ekip")!;
    expect(ekip.tabs?.some((t) => t.label === "Kazanç" || t.href === "/app/ekip/kazanc")).toBe(false);
  });

  it("Kıyas profesyonel pakette, diğer ekip sekmeleri ofis paketinde", () => {
    expect(findGate("/app/ekip/kiyas")?.minPlan).toBe("professional");
    expect(findGate("/app/ekip/devir")?.minPlan).toBe("office");
    // Kazanç tek sayfa (/app/cuzdan) ve eski yolu kilitsiz: Danışman paketinde de kendi kazancı açık.
    expect(findGate("/app/ekip/kazanc")).toBeNull();
    expect(findGate("/app/cuzdan")).toBeNull();
    expect(findGate("/app/performansim")).toBeNull();
  });
});
