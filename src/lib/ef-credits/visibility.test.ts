import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import {
  canManageEfCredits,
  canViewReport,
  cleanDay,
  filterReports,
  filterVisibleReports,
  monthlyAllowanceView,
  pdfStatusOf,
  reportValidity,
  shouldShowEfBadge,
  shouldShowLowBalanceBanner,
  validityLabel,
} from "./visibility";

const NOW = Date.parse("2026-10-15T09:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("rol kapısı", () => {
  it("yalnız owner ve gm kontör yönetir/tüm raporları görür", () => {
    expect(canManageEfCredits("owner")).toBe(true);
    expect(canManageEfCredits("gm")).toBe(true);
    for (const r of ["branch_manager", "advisor", "readonly", "", null, undefined]) expect(canManageEfCredits(r)).toBe(false);
  });

  it("rozet: yetkisiz/kapalı modül/EF live değil/impersonation = gizli", () => {
    const base = { role: "advisor", canAccessValuation: true, valuationClosed: false, efLive: true };
    expect(shouldShowEfBadge(base)).toBe(true);
    expect(shouldShowEfBadge({ ...base, role: "owner", canAccessValuation: false })).toBe(true);
    expect(shouldShowEfBadge({ ...base, role: "advisor", canAccessValuation: false })).toBe(false);
    expect(shouldShowEfBadge({ ...base, valuationClosed: true })).toBe(false);
    expect(shouldShowEfBadge({ ...base, efLive: false })).toBe(false);
    expect(shouldShowEfBadge({ ...base, impersonating: true })).toBe(false);
  });

  it("düşük bakiye bandı: yalnız owner/gm + gerçek düşük/boş + live + modül açık", () => {
    const base = { role: "owner", valuationClosed: false, efLive: true, state: "low" as const };
    expect(shouldShowLowBalanceBanner(base)).toBe(true);
    expect(shouldShowLowBalanceBanner({ ...base, state: "empty" })).toBe(true);
    expect(shouldShowLowBalanceBanner({ ...base, state: "ok" })).toBe(false);
    expect(shouldShowLowBalanceBanner({ ...base, state: null })).toBe(false);
    expect(shouldShowLowBalanceBanner({ ...base, role: "advisor" })).toBe(false);
    expect(shouldShowLowBalanceBanner({ ...base, role: "branch_manager" })).toBe(false);
    expect(shouldShowLowBalanceBanner({ ...base, efLive: false })).toBe(false);
    expect(shouldShowLowBalanceBanner({ ...base, valuationClosed: true })).toBe(false);
  });
});

describe("rapor görünürlüğü", () => {
  const rows = [
    { user_id: "u1", id: "a" },
    { user_id: "u2", id: "b" },
    { user_id: null, id: "c" },
  ];
  it("danışman yalnız kendi raporunu görür; sahibi bilinmeyen satır görünmez", () => {
    expect(filterVisibleReports(rows, { userId: "u1", role: "advisor" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterVisibleReports(rows, { userId: "", role: "advisor" })).toEqual([]);
  });
  it("owner/gm ofisin tüm raporlarını görür", () => {
    expect(filterVisibleReports(rows, { userId: "u9", role: "owner" })).toHaveLength(3);
    expect(canViewReport({ user_id: "u2" }, { userId: "u9", role: "gm" })).toBe(true);
  });
  it("şube müdürü/salt okunur başkasının raporunu görmez", () => {
    expect(canViewReport({ user_id: "u2" }, { userId: "u1", role: "branch_manager" })).toBe(false);
    expect(canViewReport({ user_id: "u2" }, { userId: "u1", role: "readonly" })).toBe(false);
  });
});

describe("geçerlilik ve PDF durumu", () => {
  it("expires_at'e göre kalan gün (yukarı yuvarlanır) ve doldu", () => {
    const v = reportValidity({ created_at: iso(NOW - DAY_MS), expires_at: iso(NOW + 12 * DAY_MS + 3600_000) }, NOW);
    expect(v).toMatchObject({ expired: false, daysLeft: 13 });
    expect(validityLabel(v)).toBe("13 gün kaldı");
    const gone = reportValidity({ created_at: iso(NOW - 40 * DAY_MS), expires_at: iso(NOW - 1) }, NOW);
    expect(gone).toMatchObject({ expired: true, daysLeft: 0 });
    expect(validityLabel(gone)).toBe("Süresi doldu");
  });
  it("expires_at yoksa created_at + 30 gün; geçersiz tarih belirsiz", () => {
    expect(reportValidity({ created_at: iso(NOW - 29 * DAY_MS), expires_at: null }, NOW)).toMatchObject({ expired: false, daysLeft: 1 });
    expect(validityLabel(reportValidity({ created_at: iso(NOW - 29 * DAY_MS), expires_at: null }, NOW))).toBe("Son gün");
    expect(reportValidity({ created_at: iso(NOW - 31 * DAY_MS), expires_at: null }, NOW).expired).toBe(true);
    expect(reportValidity({ created_at: "x", expires_at: null }, NOW)).toEqual({ expired: false, daysLeft: null, expiresAtMs: null });
  });
  it("PDF durumu", () => {
    expect(pdfStatusOf({ pdf_charged: true }, false)).toEqual({ taken: true, label: "PDF alındı" });
    expect(pdfStatusOf({ pdf_charged: false }, false).label).toBe("PDF henüz alınmadı");
    expect(pdfStatusOf({ pdf_charged: false }, true).label).toContain("süresi doldu");
  });
});

describe("rapor süzgeci", () => {
  const r = (created_at: string, tip: string, user_id: string) => ({ created_at, tip, user_id });
  const rows = [
    r("2026-10-01T10:00:00.000Z", "arsa", "u1"),
    r("2026-10-10T10:00:00.000Z", "konut", "u2"),
    r("2026-10-14T22:00:00.000Z", "arsa", "u1"), // TR: 15 Ekim 01:00
  ];
  it("tarih (TR günü, bitiş dahil), tip ve kullanıcı", () => {
    expect(filterReports(rows, { from: "2026-10-05" })).toHaveLength(2);
    expect(filterReports(rows, { to: "2026-10-10" })).toHaveLength(2);
    expect(filterReports(rows, { to: "2026-10-14" })).toHaveLength(2);
    expect(filterReports(rows, { to: "2026-10-15" })).toHaveLength(3);
    expect(filterReports(rows, { tip: "konut" })).toHaveLength(1);
    expect(filterReports(rows, { tip: "arsa", userId: "u1" })).toHaveLength(2);
  });
  it("geçersiz değerler yok sayılır", () => {
    expect(cleanDay("2026-13-45")).toBeNull();
    expect(cleanDay("abc")).toBeNull();
    expect(filterReports(rows, { from: "abc", tip: "bilinmez" })).toHaveLength(3);
  });
  it("süzgeç görünürlüğü genişletmez (yalnız verilen satırlar üzerinde çalışır)", () => {
    const visible = filterVisibleReports(rows, { userId: "u2", role: "advisor" });
    expect(filterReports(visible, { userId: "u1" })).toEqual([]);
  });
});

describe("aylık hak sayacı", () => {
  const mv = (at: string, label: string, units: number) => ({ at, label, units });
  it("yalnız bu TR ayındaki plan yüklemesi ve harcama sayılır; kalan bakiyeyi aşmaz; yenileme ay başı", () => {
    const v = monthlyAllowanceView({
      entitlement: 40,
      available: 25,
      nowMs: NOW,
      rows: [
        mv("2026-10-01T00:05:00.000Z", "Plan kontörü", 40),
        mv("2026-10-03T10:00:00.000Z", "Değerleme", -5),
        mv("2026-10-04T10:00:00.000Z", "PDF rapor", -2),
        mv("2026-09-30T20:30:00.000Z", "Plan kontörü", 40), // TR 30 Eylül 23:30 -> geçen ay
        mv("2026-09-15T10:00:00.000Z", "Değerleme", -9),
        mv("2026-10-05T10:00:00.000Z", "Paket satın alma", 100),
      ],
    });
    expect(v.grantedThisMonth).toBe(40);
    expect(v.spentThisMonth).toBe(7);
    expect(v.remainingOfMonthly).toBe(25); // 33 hak kalanı, bakiye 25 ile sınırlı
    expect(v.rolloverCap).toBe(120);
    expect(v.nextRenewalMs).toBe(Date.parse("2026-10-31T21:00:00.000Z")); // 1 Kasım 00:00 TR
  });
  it("bakiye bilinmiyorsa hak farkı gösterilir; satır yoksa sıfır", () => {
    expect(monthlyAllowanceView({ entitlement: 10, rows: [], available: null, nowMs: NOW }).remainingOfMonthly).toBe(0);
    expect(
      monthlyAllowanceView({ entitlement: 10, rows: [mv("2026-10-02T10:00:00.000Z", "Plan kontörü", 10)], available: null, nowMs: NOW }).remainingOfMonthly,
    ).toBe(10);
  });
});
