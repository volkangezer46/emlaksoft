import { describe, expect, it } from "vitest";
import type { AdvisorMetricRow } from "@/lib/team/advisor-metrics";
import { assignHref, buildLeague, computeTeamHealth, filterAdvisors, parseAdvisorFilters, parseAssignView, parseTab, sortAdvisors, tabHref, unassignedSlaState } from "./logic";
import type { OfficeAdvisorRow, OfficeStatistics } from "./types";

const NOW = Date.UTC(2026, 9, 5, 9, 0, 0);
const H = 3_600_000;

function row(over: Partial<OfficeAdvisorRow>): OfficeAdvisorRow {
  return {
    id: "a",
    fullName: "Ali",
    role: "advisor",
    title: null,
    isActive: true,
    branchId: null,
    branchName: null,
    teamId: null,
    teamName: null,
    createdAt: "2026-01-01T00:00:00Z",
    openProperties: 0,
    openDemands: 0,
    wonThisMonth: 0,
    slaWithinPct: null,
    lastActivityAt: null,
    onLeaveToday: false,
    specialties: [],
    regions: [],
    ...over,
  };
}

describe("URL filtre kontratı", () => {
  it("bozuk sekme/filtre varsayılana düşer, geçerli olanlar korunur", () => {
    expect(parseTab("yok")).toBe("danismanlar");
    // "Atamalar" sekmesi kalktı (atama İlan Havuzu'nda); eski yer imi varsayılana düşer.
    expect(parseTab(["atamalar"])).toBe("danismanlar");
    // Birleşen sekmeler: eski yer imleri tek "Tanımlar" sekmesine düşer.
    expect(parseTab("ayarlar")).toBe("tanimlar");
    expect(parseTab("tanimlamalar")).toBe("tanimlar");
    const f = parseAdvisorFilters({ q: "  ece ", durum: "x", rol: "advisor", sube: "nope", sirala: "portfoy" });
    expect(f).toEqual({ q: "ece", durum: "", rol: "advisor", sube: "", sirala: "portfoy", yon: "desc" });
    expect(parseAdvisorFilters({}).yon).toBe("asc");
  });

  it("tabHref yalnız dolu parametreleri yazar", () => {
    expect(tabHref("danismanlar")).toBe("/app/ekip");
    expect(tabHref("istatistikler", { durum: "gecikmis", bos: undefined })).toBe("/app/ekip?sekme=istatistikler&durum=gecikmis");
  });

  it("atama TEK ekranda: İlan Havuzu ?atama= (bozuk görünüm varsayılana düşer)", () => {
    expect(assignHref()).toBe("/app/ilan-havuzu?atama=bekleyen");
    expect(assignHref("iptal")).toBe("/app/ilan-havuzu?atama=iptal");
    expect(parseAssignView("yok")).toBe("bekleyen");
    expect(parseAssignView(["gecmis"])).toBe("gecmis");
  });
});

describe("liste süzme/sıralama", () => {
  const rows = [
    row({ id: "1", fullName: "Zeynep", openProperties: 3, slaWithinPct: 80, lastActivityAt: new Date(NOW - 2 * H).toISOString() }),
    row({ id: "2", fullName: "Ahmet", openProperties: 9, slaWithinPct: null, isActive: false, branchId: "b1" }),
    row({ id: "3", fullName: "Mehmet", openProperties: 9, slaWithinPct: 40, role: "team_lead", teamName: "Kadıköy" }),
  ];
  it("durum/rol/şube/arama süzer", () => {
    expect(filterAdvisors(rows, parseAdvisorFilters({ durum: "pasif" })).map((r) => r.id)).toEqual(["2"]);
    expect(filterAdvisors(rows, parseAdvisorFilters({ rol: "team_lead" })).map((r) => r.id)).toEqual(["3"]);
    expect(filterAdvisors(rows, parseAdvisorFilters({ q: "kadık" })).map((r) => r.id)).toEqual(["3"]);
  });
  it("sayısal sıralama eşitlikte ada göre; null SLA sona", () => {
    expect(sortAdvisors(rows, "portfoy", "desc").map((r) => r.id)).toEqual(["2", "3", "1"]);
    expect(sortAdvisors(rows, "sla", "desc").map((r) => r.id)).toEqual(["1", "3", "2"]);
    expect(sortAdvisors(rows, "aktivite", "desc").map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(sortAdvisors(rows, "ad", "asc").map((r) => r.fullName)).toEqual(["Ahmet", "Mehmet", "Zeynep"]);
  });
});

describe("SLA ve ekip sağlığı", () => {
  it("atanmamış ilan SLA: son %20'de yaklaşıyor, aşımda breached", () => {
    expect(unassignedSlaState(NOW - 1 * H, NOW, 24)).toBe("ok");
    expect(unassignedSlaState(NOW - 20 * H, NOW, 24)).toBe("due_soon");
    expect(unassignedSlaState(NOW - 25 * H, NOW, 24)).toBe("breached");
  });

  const stats: OfficeStatistics = {
    totalProperties: 40,
    liveProperties: 30,
    unassignedProperties: 2,
    wonDealsThisMonth: 3,
    activeRentals: 1,
    assignmentsThisMonth: 10,
    cancelledAssignmentsThisMonth: 1,
    activeAdvisors: 5,
    inactiveAdvisors: 1,
    failed: false,
  };
  it("eşik altı = sağlıklı; SLA aşımı = kritik; iptal oranı %30+ uyarı verir", () => {
    expect(computeTeamHealth({ stats, breachedUnassigned: 0, unassignedThreshold: 5, advisorsWithoutActivity30d: 0 }).level).toBe("healthy");
    const crit = computeTeamHealth({ stats, breachedUnassigned: 2, unassignedThreshold: 5, advisorsWithoutActivity30d: 0 });
    expect(crit.level).toBe("critical");
    expect(crit.alerts[0].href).toBe("/app/ilan-havuzu?atama=gecikmis");
    const warn = computeTeamHealth({ stats: { ...stats, cancelledAssignmentsThisMonth: 4 }, breachedUnassigned: 0, unassignedThreshold: 5, advisorsWithoutActivity30d: 0 });
    expect(warn.level).toBe("warning");
    expect(warn.alerts.every((a) => a.href.startsWith("/app/ofis-merkezi") || a.href.startsWith("/app/ilan-havuzu"))).toBe(true);
  });
});

describe("danışman ligi kazanç gizliliği", () => {
  const m = (over: Partial<AdvisorMetricRow>): AdvisorMetricRow => ({
    id: "x",
    fullName: "X",
    role: "advisor",
    branchId: null,
    customerCount: 0,
    newCustomerCount: 0,
    activePropertyCount: 0,
    callCount: 0,
    appointCount: 0,
    offerCount: 0,
    dealCount: 0,
    conversionPct: null,
    revenue: 1000,
    pendingRevenue: 0,
    commissionCount: 1,
    target: null,
    targetPct: null,
    activeDemandCount: null,
    overdueTaskCount: null,
    untrackedDemandCount: null,
    ...over,
  });
  it("earnings_all yoksa yalnız kendi geliri görünür; sıra anlaşma sayısına göre", () => {
    const rows = [m({ id: "me", fullName: "Ben", dealCount: 1 }), m({ id: "other", fullName: "Diğer", dealCount: 4 })];
    const league = buildLeague(rows, { viewerId: "me", seeAllEarnings: false });
    expect(league.map((l) => l.advisorId)).toEqual(["other", "me"]);
    expect(league[0].revenue).toBeNull();
    expect(league[1].revenue).toBe(1000);
    expect(buildLeague(rows, { viewerId: "me", seeAllEarnings: true })[0].revenue).toBe(1000);
  });
});
