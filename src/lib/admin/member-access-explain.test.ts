import { describe, expect, it } from "vitest";
import { mergeEffectivePermissions } from "@/lib/permissions-effective";
import { ALL_MODULES, describeModuleAccess, explainModuleAccess, explainScope } from "./member-access-explain";

const NOW = Date.parse("2026-10-13T09:00:00Z");

describe("etkin izin açıklayıcı", () => {
  it("sonuç uygulama kapısıyla (mergeEffectivePermissions) birebir aynı", () => {
    const roleOverrides = [
      { module: "customers", action: "delete", allowed: true },
      { module: "properties", action: "edit", allowed: false },
    ];
    const userOverrides = [{ module: "reports", actions: ["view"], expires_at: null }];
    const rows = explainModuleAccess({ role: "advisor", roleOverrides, userOverrides, nowMs: NOW });
    const merged = mergeEffectivePermissions("advisor", roleOverrides, userOverrides, NOW);
    for (const r of rows) expect([...r.final].sort()).toEqual([...(merged[r.module] ?? [])].sort());
    expect(rows.map((r) => r.module)).toEqual(ALL_MODULES);
  });

  it("kişi istisnası müşterileri kapatınca kaynaklı açıklama verir", () => {
    const rows = explainModuleAccess({
      role: "advisor",
      roleOverrides: [],
      userOverrides: [{ module: "customers", actions: [], expires_at: null }],
      nowMs: NOW,
    });
    const customers = rows.find((r) => r.module === "customers")!;
    expect(customers.final).toEqual([]);
    expect(customers.decidedBy).toBe("user");
    const text = describeModuleAccess(customers, { moduleLabel: "Müşteriler", roleLabel: "Danışman" });
    expect(text.summary).toBe("Müşteriler: görüntüleme yok (modül görünmez)");
    expect(text.source).toMatch(/^Kaynak: rol Danışman \(varsayılan: görüntüleme/);
    expect(text.source).toContain("+ kişi istisnası (yalnız hiçbiri)");
  });

  it("ofis rol ayarı çıkarması ve süresi geçmiş istisna ayrı gösterilir", () => {
    const rows = explainModuleAccess({
      role: "advisor",
      roleOverrides: [{ module: "customers", action: "view", allowed: false }],
      userOverrides: [{ module: "customers", actions: ["view", "edit"], expires_at: "2026-10-01T00:00:00Z" }],
      nowMs: NOW,
    });
    const c = rows.find((r) => r.module === "customers")!;
    expect(c.roleRemoved).toEqual(["view"]);
    expect(c.userOverride?.active).toBe(false);
    expect(c.decidedBy).toBe("tenant_role");
    expect(c.final).not.toContain("view");
    const text = describeModuleAccess(c, { moduleLabel: "Müşteriler", roleLabel: "Danışman", fmtDate: () => "1 Eki" });
    expect(text.source).toContain("ofis rol ayarı (−görüntüleme)");
    expect(text.source).toContain("süresi geçmiş kişi istisnası (yok sayılıyor, bitiş 1 Eki)");
  });

  it("owner istisnadan, readonly her katmandan muaf; bilinmeyen rol kapalı", () => {
    const uo = [{ module: "customers", actions: [], expires_at: null }];
    const owner = explainModuleAccess({ role: "owner", roleOverrides: [], userOverrides: uo, nowMs: NOW }).find((r) => r.module === "customers")!;
    expect(owner.userOverride).toBeNull();
    expect(owner.final).toContain("view");
    const ro = explainModuleAccess({ role: "readonly", roleOverrides: [{ module: "customers", action: "edit", allowed: true }], userOverrides: uo, nowMs: NOW });
    expect(ro.every((r) => r.decidedBy === "readonly_ceiling" && !r.final.includes("edit"))).toBe(true);
    const unknown = explainModuleAccess({ role: "hacker", roleOverrides: [], userOverrides: [], nowMs: NOW });
    expect(unknown.every((r) => r.final.length === 0 && r.decidedBy === "unknown_role")).toBe(true);
  });

  it("kapsam: satır yoksa rol varsayılanı, varsa özel", () => {
    expect(explainScope("advisor", null).text).toBe("Rol varsayılanı: Kendi kayıtları.");
    const custom = explainScope(
      "advisor",
      { scope_type: "branch", team_id: null, branch_id: "b", can_view_all_data: false, can_edit_team_members: false, can_override_permissions: false, can_see_earnings: true },
      { branchName: "Kadıköy" },
    );
    expect(custom.custom).toBe(true);
    expect(custom.text).toBe("Özel kapsam: Şube (Kadıköy) · kazançları görür.");
  });
});
