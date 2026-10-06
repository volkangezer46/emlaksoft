import { describe, expect, it } from "vitest";
import { navBadgesFromCounts, parseShellBootstrap, usageRowsFromCounts } from "./bootstrap-core";
import { getPlan } from "@/lib/billing/plans";

const sample = {
  version: 1,
  profile: { id: "u1", full_name: "Ayşe Yılmaz", role: "advisor", tenant_id: "t1" },
  tenant: { name: "Demo Ofis", plan: "office", status: "trial", brand_color: "#112233", created_at: "2026-01-01T00:00:00Z", slug: "demo", trial_ends_at: null },
  role_overrides: [{ module: "reports", action: "view", allowed: true }, { module: "x" }],
  user_overrides: [{ module: "tasks", actions: ["view"], expires_at: null }, { module: "bad", actions: "no" }],
  modules: [{ module_key: "projects", enabled: false, locked_by_platform: false }, { module_key: "nope" }],
  usage: { seats: 3, active_properties: "12", customers: 40 },
  badges: { overdue_tasks: 2, pending_approvals: 0 },
};

describe("parseShellBootstrap", () => {
  it("geçerli yanıtı tipler; bozuk satırları atar; sayıları güvenli çevirir", () => {
    const b = parseShellBootstrap(sample);
    expect(b).not.toBeNull();
    expect(b!.profile).toEqual({ id: "u1", fullName: "Ayşe Yılmaz", role: "advisor", tenantId: "t1" });
    expect(b!.office?.name).toBe("Demo Ofis");
    expect(b!.office?.trial_ends_at).toBeNull();
    expect(b!.roleOverrides).toEqual([{ module: "reports", action: "view", allowed: true }]);
    expect(b!.userOverrides).toEqual([{ module: "tasks", actions: ["view"], expires_at: null }]);
    expect(b!.modules).toEqual([{ module_key: "projects", enabled: false, locked_by_platform: false }]);
    expect(b!.usage).toEqual({ seats: 3, activeProperties: 12, customers: 40 });
    expect(b!.badges).toEqual({ overdueTasks: 2, pendingApprovals: 0 });
  });

  it("profil/tenant kimliği eksikse null (yarım veri kullanılmaz)", () => {
    expect(parseShellBootstrap(null)).toBeNull();
    expect(parseShellBootstrap({ profile: { id: "u1", role: "advisor" }, usage: {}, badges: {} })).toBeNull();
    expect(parseShellBootstrap({ ...sample, usage: undefined })).toBeNull();
  });

  it("tenant yoksa office null, geri kalan korunur", () => {
    const b = parseShellBootstrap({ ...sample, tenant: null });
    expect(b?.office).toBeNull();
    expect(b?.profile.tenantId).toBe("t1");
  });
});

describe("usageRowsFromCounts", () => {
  it("getPlanUsage ile aynı anahtar/etiket/hedef; limitsiz kalem döndürülmez", () => {
    const rows = usageRowsFromCounts("office", { seats: 2, activeProperties: 30, customers: 100 });
    const limits = getPlan("office").limits;
    const keys = rows.map((r) => r.key);
    expect(keys.includes("seats")).toBe(limits.seats != null);
    expect(keys.includes("properties")).toBe(limits.activeProperties != null);
    expect(keys.includes("customers")).toBe(limits.customers != null);
    for (const r of rows) {
      expect(r.limit).toBeGreaterThan(0);
      expect(r.href.startsWith("/app/")).toBe(true);
    }
    const seats = rows.find((r) => r.key === "seats");
    if (seats) expect(seats).toMatchObject({ label: "Kullanıcı", used: 2, href: "/app/ekip" });
  });

  it("bilinmeyen plan ofis paketine düşer (getPlanUsage ile aynı)", () => {
    expect(usageRowsFromCounts(undefined, { seats: 1, activeProperties: 1, customers: 1 })).toEqual(
      usageRowsFromCounts("office", { seats: 1, activeProperties: 1, customers: 1 }),
    );
  });
});

describe("navBadgesFromCounts", () => {
  it("görev rozeti yalnız tasks erişimiyle, onay rozeti yalnız commissions + karar rolüyle; sıfır rozet çıkmaz", () => {
    const counts = { overdueTasks: 3, pendingApprovals: 2 };
    expect(navBadgesFromCounts({ counts, role: "advisor", accessible: ["tasks", "commissions"] }).map((b) => b.itemHref)).toEqual(["/app/gorevler"]);
    expect(navBadgesFromCounts({ counts, role: "owner", accessible: ["tasks", "commissions"] }).map((b) => b.itemHref)).toEqual(["/app/gorevler", "/app/onaylar"]);
    expect(navBadgesFromCounts({ counts, role: "owner", accessible: ["commissions"] }).map((b) => b.itemHref)).toEqual(["/app/onaylar"]);
    expect(navBadgesFromCounts({ counts: { overdueTasks: 0, pendingApprovals: 0 }, role: "owner", accessible: ["tasks", "commissions"] })).toEqual([]);
  });

  it("rozet hedefi filtreli listedir (sıfır çıkmaz metrik)", () => {
    const [b] = navBadgesFromCounts({ counts: { overdueTasks: 1, pendingApprovals: 0 }, role: "advisor", accessible: ["tasks"] });
    expect(b.href).toBe("/app/gorevler?filter=overdue&mine=1");
    expect(b.tone).toBe("danger");
  });
});
