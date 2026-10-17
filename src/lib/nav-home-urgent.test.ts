import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAttentionItems, type AttentionInput } from "@/app/app/_home/home-metrics";
import { navBadgesFromCounts } from "@/lib/app-shell/bootstrap-core";
import { NAV_COUNT_META } from "@/lib/app-shell/nav-count-meta";
import {
  OFFICE_OVERDUE_TASKS_HREF,
  OVERDUE_TASKS_HREF,
  homeUrgentScope,
  navBadgesForHomeScope,
  officeOverdueTasksCountQuery,
  overdueTasksCountQuery,
  type NavBadge,
} from "@/lib/nav-badges";

/**
 * Ana Sayfa yan menü acil sayacı = ana ekran "Dikkat gerektirenler" listesinin ACİL kalemleri (sahip kuralı: aynı küme).
 * Yan menü toplamı (app-sidebar `urgentSignal`): kırmızı rozetler + akışlı kırmızı sayaçlar (`alerts`). Ofis geneli
 * görünümde geciken görev ofis geneli sayılır (kişisel rozet düşer), "Benim işlerim"de kişiseldir.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** app-sidebar `urgentSignal` formülü (sözleşme testi aşağıda kaynakta da doğrular). */
const sidebarUrgent = (badges: readonly NavBadge[], alerts: Record<string, number>) =>
  badges.filter((b) => b.tone === "danger").reduce((t, b) => t + b.count, 0) + Object.values(alerts).reduce((t, n) => t + n, 0);

const homeUrgent = (input: Partial<AttentionInput>) =>
  buildAttentionItems({
    overdueTasks: null, approvals: null, overdueRent: null, staleDeals: null, staleDays: 14, pendingCommission: null, pendingCommissionText: "",
    passiveAdvisors: null, passiveDays: 30, mine: false, userId: "u-1", ...input,
  })
    .filter((i) => i.level === "acil")
    .reduce((t, i) => t + (i.count ?? 0), 0);

const ALL = ["tasks", "commissions", "rentals"] as const;

describe("Ana Sayfa acil sayacı kapsamı", () => {
  it("yönetim rolü çerezsiz ofis geneli; 'ben' seçerse kişisel; diğer roller her zaman kişisel", () => {
    for (const r of ["owner", "gm", "branch_manager"]) {
      expect(homeUrgentScope(r, null)).toBe("ofis");
      expect(homeUrgentScope(r, "ofis")).toBe("ofis");
      expect(homeUrgentScope(r, "ben")).toBe("ben");
    }
    for (const r of ["advisor", "team_lead", "call_center", "accounting", null]) expect(homeUrgentScope(r, "ofis")).toBe("ben");
  });

  it("ofis geneli (yönetici): sayaç = ofis geciken görev + geciken kira = Dikkat'in acil kalemleri (kişisel görev iki kez sayılmaz)", () => {
    const badges = navBadgesForHomeScope(navBadgesFromCounts({ counts: { overdueTasks: 2, pendingApprovals: 3 }, role: "owner", accessible: ALL }), "ofis");
    expect(badges.map((b) => b.itemHref)).toEqual(["/app/onaylar"]);
    const alerts = { "/app/gorevler": 7, "/app/kiralama": 4 };
    expect(sidebarUrgent(badges, alerts)).toBe(11);
    expect(sidebarUrgent(badges, alerts)).toBe(homeUrgent({ overdueTasks: 7, overdueRent: 4, approvals: 3, mine: false }));
  });

  it("danışman: sayaç = kişisel geciken görev = Dikkat (kişisel); kira ofis sayacı yok", () => {
    const badges = navBadgesForHomeScope(navBadgesFromCounts({ counts: { overdueTasks: 2, pendingApprovals: 0 }, role: "advisor", accessible: ALL }), homeUrgentScope("advisor", null));
    expect(badges.map((b) => b.href)).toEqual([OVERDUE_TASKS_HREF]);
    expect(sidebarUrgent(badges, {})).toBe(homeUrgent({ overdueTasks: 2, mine: true }));
  });

  it("'Benim işlerim' seçen yönetici: kişisel görev + ofis geciken kira (Dikkat yönetimde kirayı her kapsamda sayar)", () => {
    const badges = navBadgesForHomeScope(navBadgesFromCounts({ counts: { overdueTasks: 2, pendingApprovals: 0 }, role: "gm", accessible: ALL }), homeUrgentScope("gm", "ben"));
    expect(sidebarUrgent(badges, { "/app/kiralama": 4 })).toBe(homeUrgent({ overdueTasks: 2, overdueRent: 4, mine: true }));
  });

  it("ofis sayacının hedefi Dikkat'in ofis görev kalemiyle aynı süzgeç", () => {
    expect(NAV_COUNT_META["/app/gorevler"]?.href).toBe(OFFICE_OVERDUE_TASKS_HREF);
    const item = buildAttentionItems({
      overdueTasks: 1, approvals: null, overdueRent: null, staleDeals: null, staleDays: 14, pendingCommission: null, pendingCommissionText: "",
      passiveAdvisors: null, passiveDays: 30, mine: false, userId: "u",
    })[0]!;
    expect(item.href).toBe(OFFICE_OVERDUE_TASKS_HREF);
  });
});

describe("geciken görev sorguları", () => {
  function recorder() {
    const calls: [string, ...unknown[]][] = [];
    const chain: Record<string, unknown> = {};
    const self = new Proxy(chain, { get: (_t, prop: string) => (...args: unknown[]) => (calls.push([prop, ...args]), self) });
    return { db: { from: (t: string) => (calls.push(["from", t]), self) } as unknown as SupabaseClient, calls };
  }

  it("ofis geneli: açık, vadesi bugünün başından önce, atanan süzgeci YOK; kişisel: bana atanmış", () => {
    const office = recorder();
    officeOverdueTasksCountQuery(office.db, "t-1", "2026-10-16T21:00:00.000Z");
    expect(office.calls).toContainEqual(["eq", "status", "open"]);
    expect(office.calls).toContainEqual(["lt", "due_at", "2026-10-16T21:00:00.000Z"]);
    expect(office.calls.some((c) => c[1] === "assigned_to")).toBe(false);
    const mine = recorder();
    overdueTasksCountQuery(mine.db, "t-1", "u-1", "2026-10-17T10:00:00.000Z");
    expect(mine.calls).toContainEqual(["eq", "assigned_to", "u-1"]);
  });

  it("kaynak sözleşmesi: ana ekran ofis gecikmiş tanımı ve yan menü toplama formülü değişmedi", () => {
    // Ana ekran ofis kapsamı: anlık görüntü RPC'si ve yedek sorgu "vadesi bugünün başından önce" sayar.
    expect(read("supabase/migrations/20261006000410_dashboard_snapshot_rpcs.sql")).toMatch(/'overdue', count\(\*\) filter \(where t\.due_at < v_day_start\)/);
    expect(read("src/app/app/_home/data.ts")).toMatch(/overdueQ = ctx\.sample\.apply\([\s\S]{0,140}\.lt\("due_at", ctx\.dayStartIso\)/);
    // Yan menü acil toplamı: kırmızı rozetler + akışlı alerts (bu test formülü buna göre kurar).
    const sidebar = read("src/components/app/app-sidebar.tsx");
    expect(sidebar).toMatch(/function urgentSignal[\s\S]{0,200}badgeTone\(b\) === "danger"[\s\S]{0,200}data\.alerts/);
    // Kabuk: rozet kapsama göre süzülür, akışlı sayaçlar ofis görev sayımını alır.
    const layout = read("src/app/app/layout.tsx");
    expect(layout).toMatch(/navBadgesForHomeScope\(m\.navBadges, homeScope\)/);
    expect(layout).toMatch(/officeTasks: homeScope === "ofis"/);
  });
});
