import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  advanceCollection,
  advanceRoundingGap,
  budgetPeriodLabel,
  budgetPeriods,
  budgetVsActual,
  monthlyAdvance,
  monthsElapsed,
  parseBudgetLines,
} from "./budget";
import { audienceCustomerIds, buildAnnouncementSms, planAnnouncementSend, sortAnnouncements, ANNOUNCEMENT_SMS_MAX } from "./announcements";

describe("işletme projesi kalemleri", () => {
  it("TR tutar biçimini okur, boş satırları atlar, toplamı kuruşla hesaplar", () => {
    const r = parseBudgetLines([
      { category: "Temizlik", label: "Temizlik", amount: "24.000" },
      { category: "", label: "Asansör", amount: "1.250,55" },
      { label: "", amount: "" },
    ]);
    expect(r).toEqual({ ok: true, total: 25250.55, lines: [{ category: "Temizlik", label: "Temizlik", amount: 24000 }, { category: null, label: "Asansör", amount: 1250.55 }] });
  });
  it("adsız, sıfır ya da üç ondalıklı tutarı reddeder; hiç kalem yoksa hata", () => {
    expect(parseBudgetLines([{ label: "", amount: "10" }]).ok).toBe(false);
    expect(parseBudgetLines([{ label: "x", amount: "0" }]).ok).toBe(false);
    expect(parseBudgetLines([{ label: "x", amount: "1,005" }]).ok).toBe(false);
    expect(parseBudgetLines([]).ok).toBe(false);
    expect(parseBudgetLines("x").ok).toBe(false);
  });
});

describe("aylık avans ve dönem", () => {
  it("avans kuruşa yuvarlanır; yuvarlama farkı raporlanır (SQL round ile aynı)", () => {
    expect(monthlyAdvance(36000, 12)).toBe(3000);
    expect(monthlyAdvance(1000, 12)).toBe(83.33);
    expect(advanceRoundingGap(1000, 12)).toBe(-0.04);
    expect(monthlyAdvance(1000.1, 3)).toBe(333.37);
  });
  it("dönem ayları ve etiket yıl geçişini doğru sayar", () => {
    expect(budgetPeriods("2026-11-01", 3)).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
    expect(budgetPeriodLabel("2027-01-01", 12)).toBe("Ocak 2027 – Aralık 2027");
    expect(monthsElapsed("2027-01-01", 12, "2026-12-31")).toBe(0);
    expect(monthsElapsed("2027-01-01", 12, "2027-03-15")).toBe(3);
    expect(monthsElapsed("2027-01-01", 12, "2028-05-01")).toBe(12);
  });
});

describe("bütçe / gerçekleşen", () => {
  const lines = [
    { category: "Temizlik", label: "Temizlik", amount: 12000 },
    { category: "Asansör", label: "Asansör", amount: 6000 },
    { category: null, label: "Muhtelif", amount: 1200 },
  ];
  it("kategori bazında plan, bugüne kadarki plan, gerçekleşen ve durum", () => {
    const r = budgetVsActual({
      lines,
      periodStart: "2027-01-01",
      months: 12,
      today: "2027-06-20",
      actuals: [
        { category: "Temizlik", amount: 5000, period: "2027-02-01" },
        { category: "Asansör", amount: 7000, period: "2027-05-01" },
        { category: "Güvenlik", amount: 900, period: "2027-03-01" },
        { category: "Temizlik", amount: 9999, period: "2026-12-01" }, // pencere dışı
      ],
    });
    expect(r.elapsed).toBe(6);
    const by = Object.fromEntries(r.rows.map((x) => [x.category, x]));
    expect(by["Temizlik"]).toMatchObject({ planned: 12000, plannedToDate: 6000, actual: 5000, variance: -1000, status: "ok" });
    expect(by["Asansör"]).toMatchObject({ planned: 6000, actual: 7000, status: "over" });
    expect(by["Diğer"]).toMatchObject({ planned: 1200, actual: 0, status: "ok" });
    expect(by["Güvenlik"]).toMatchObject({ planned: 0, actual: 900, status: "unplanned", usedPct: null });
    expect(r.totals).toMatchObject({ planned: 19200, plannedToDate: 9600, actual: 12900, variance: 3300 });
  });
  it("izle: bugüne kadarki planın %10 üzerinde ama yıllık planın altında", () => {
    const r = budgetVsActual({ lines, periodStart: "2027-01-01", months: 12, today: "2027-03-01", actuals: [{ category: "Temizlik", amount: 3500, period: "2027-02-01" }] });
    expect(r.rows.find((x) => x.category === "Temizlik")!.status).toBe("watch");
  });
  it("avans tahsilat özeti fazla ödemeyi saymaz", () => {
    expect(advanceCollection([{ amount: 100, paid: 100 }, { amount: 100, paid: 40 }, { amount: 50, paid: 70 }])).toEqual({ charged: 250, collected: 190, outstanding: 60, rate: 76 });
  });
});

describe("duyuru alıcı planı", () => {
  const customers = [
    { id: "a", fullName: "A", phone: "05321112233", blacklist: false, isSample: false, deleted: false },
    { id: "b", fullName: "B", phone: "05321112233", blacklist: false, isSample: false, deleted: false }, // aynı numara
    { id: "c", fullName: "C", phone: null, blacklist: false, isSample: false, deleted: false },
    { id: "d", fullName: "D", phone: "05329998877", blacklist: true, isSample: false, deleted: false },
    { id: "e", fullName: "E", phone: "05324445566", blacklist: false, isSample: false, deleted: false },
    { id: "f", fullName: "F", phone: "05327778899", blacklist: false, isSample: false, deleted: false },
  ];
  it("kitle: malik / kiracı / tümü benzersiz", () => {
    const units = [{ ownerCustomerId: "a", tenantCustomerId: "e" }, { ownerCustomerId: "a", tenantCustomerId: null }, { ownerCustomerId: null, tenantCustomerId: "f" }];
    expect(audienceCustomerIds(units, "all")).toEqual(["a", "e", "f"]);
    expect(audienceCustomerIds(units, "owners")).toEqual(["a"]);
    expect(audienceCustomerIds(units, "tenants")).toEqual(["e", "f"]);
  });
  it("izinsiz, telefonsuz, engelli atlanır; aynı numara bir kez; tavan uygulanır", () => {
    const plan = planAnnouncementSend({ customerIds: ["a", "b", "c", "d", "e", "f"], customers, allowed: new Set(["a", "b", "c", "d", "f"]), cap: 1 });
    expect(plan.send.map((s) => s.customerId)).toEqual(["a"]);
    expect(plan.counts).toEqual({ total: 6, noPhone: 1, blocked: 1, noConsent: 1, overCap: 1 });
  });
  it("SMS metni ofis + bina + başlık taşır ve üst sınırda kısaltılır", () => {
    expect(buildAnnouncementSms({ officeName: "Ofis", buildingName: "Güneş Apt.", title: "Su kesintisi", body: "Salı\\n10-14" })).toBe("Ofis · Güneş Apt. duyurusu: Su kesintisi — Salı\\n10-14");
    expect(buildAnnouncementSms({ officeName: null, buildingName: "B", title: "T", body: "x".repeat(900) }).length).toBe(ANNOUNCEMENT_SMS_MAX);
  });
  it("sabitlenenler önce, sonra en yeni", () => {
    const rows = sortAnnouncements([
      { id: 1, pinned: false, createdAt: "2027-01-03" },
      { id: 2, pinned: true, createdAt: "2027-01-01" },
      { id: 3, pinned: false, createdAt: "2027-01-05" },
    ]);
    expect(rows.map((r) => r.id)).toEqual([2, 3, 1]);
  });
});

describe("işletme projesi ve duyuru action sözleşmesi", () => {
  const budgetSrc = readFileSync("src/app/actions/building-budget.ts", "utf8");
  const annSrc = readFileSync("src/app/actions/building-announcements.ts", "utf8");
  const blocks = (src: string) => src.split(/\nexport async function /).slice(1);
  it("her action ilk iş expenses kapısını çağırır", () => {
    for (const b of [...blocks(budgetSrc), ...blocks(annSrc)]) {
      expect(b.slice(0, 400), b.slice(0, 40)).toMatch(/requirePermission\("expenses", (?:"(?:create|edit|delete)"|input\.id \? "edit" : "create")\)/);
    }
  });
  it("taslak silme delete, onay/taslağa alma edit, avans tahakkuku create ister", () => {
    const find = (name: string) => blocks(budgetSrc).find((b) => b.startsWith(name))!.slice(0, 300);
    expect(find("deleteBuildingBudget")).toContain('"expenses", "delete"');
    expect(find("approveBuildingBudget")).toContain('"expenses", "edit"');
    expect(find("reopenBuildingBudget")).toContain('"expenses", "edit"');
    expect(find("accrueBuildingBudget")).toContain('"expenses", "create"');
  });
  it("service_role yok; bütçe ve tahakkuk yalnız RPC ile yazılır; duyuru gönderimi İYS kapısından geçer", () => {
    for (const src of [budgetSrc, annSrc]) expect(src).not.toMatch(/createAdminClient/);
    expect(budgetSrc).not.toMatch(/from\("building_(budgets|charges|charge_batches)"\)\s*\.\s*(insert|update|delete|upsert)/);
    for (const rpc of ["save_building_budget", "set_building_budget_status", "accrue_building_budget"]) expect(budgetSrc).toContain(`rpc("${rpc}"`);
    expect(annSrc).toContain('kind: "bulk_message"');
    expect(annSrc).toContain("strictIysAllowedIds(");
    expect(annSrc.indexOf("gateIysRecipients(")).toBeLessThan(annSrc.indexOf("export async function sendBuildingAnnouncement"));
    expect(annSrc).toMatch(/\.is\(`delivery->\$\{channel\}`, null\)/);
  });
});
