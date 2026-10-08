import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminSidebarModel } from "./admin/nav";
import { sidebarModel } from "./nav-config";
import { NAV_BUDGET, NAV_CORE_BY_ROLE } from "./nav-roles";
import { DEFAULT_MATRIX, canAccessModule, type AppModule, type AppRole } from "./permissions";
import { PLATFORM_ROLE_MODULES } from "./platform-access";

/**
 * ANA İLKE: menü sayısı çoğalmaz, kullanım zorluğu yaşanmaz. YENİ ÖZELLİK = yeni menü öğesi DEĞİL; önce mevcut sayfaya
 * sekme/kart. Yan menü görünür satır bütçesi: danışman <= 8, ofis <= 10, admin <= 8. Bu test bütçeyi aşan her
 * değişikliği kırar; gevşetme değil, çekirdekten bir öğeyi "Diğer"e indir.
 */
const ROLES = Object.keys(NAV_CORE_BY_ROLE) as AppRole[];
const accessibleOf = (role: AppRole) => (Object.keys(DEFAULT_MATRIX[role]) as AppModule[]).filter((m) => canAccessModule(role, m));
const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("menü görünür satır bütçesi (sidebarModel çıktısı)", () => {
  it("danışman / takım lideri <= 8 satır", () => {
    for (const role of ["advisor", "team_lead"] as const) {
      const rows = sidebarModel(accessibleOf(role), { simple: true, role }).groups.flatMap((g) => g.items);
      expect(rows.length, role).toBeLessThanOrEqual(NAV_BUDGET.advisor);
    }
  });

  it("ofis yönetimi (owner/gm/branch_manager) <= 10 satır", () => {
    for (const role of ["owner", "gm", "branch_manager"] as const) {
      const rows = sidebarModel(accessibleOf(role), { simple: true, role }).groups.flatMap((g) => g.items);
      expect(rows.length, role).toBeLessThanOrEqual(NAV_BUDGET.office);
    }
  });

  it("diğer roller de ofis bütçesini aşmaz", () => {
    for (const role of ROLES) {
      const rows = sidebarModel(accessibleOf(role), { simple: true, role }).groups.flatMap((g) => g.items);
      expect(rows.length, role).toBeLessThanOrEqual(NAV_BUDGET.office);
    }
  });

  it("admin her platform rolünde <= 8 görünür satır", () => {
    for (const [role, mods] of Object.entries(PLATFORM_ROLE_MODULES)) {
      const rows = adminSidebarModel(mods).flatMap((g) => g.items);
      expect(rows.length, role).toBeLessThanOrEqual(NAV_BUDGET.admin);
    }
  });

  it("çekirdek dışı hiçbir yetkili sayfa kaybolmaz: 'Diğer' (rest) altında durur", () => {
    const m = sidebarModel(accessibleOf("owner"), { simple: true, role: "owner" });
    const rest = m.rest.flatMap((s) => s.items.map((i) => i.href));
    expect(rest).toEqual(expect.arrayContaining(["/app/ekip", "/app/ayarlar", "/app/abonelik", "/app/gelen-kutusu"]));
  });
});

describe("yan menüde alt sekme / '+N daha' listelenmez", () => {
  it("app ve admin yan menüsünde alt liste, '+N daha' ve 'Daha az göster' yok", () => {
    for (const f of ["src/components/app/app-sidebar.tsx", "src/components/admin/admin-sidebar.tsx"]) {
      const code = src(f);
      expect(code, f).not.toContain("alt sayfaları");
      expect(code, f).not.toContain("Daha az göster");
      expect(code, f).not.toMatch(/\+\$\{[^}]*\} daha/);
      expect(code, f).not.toContain("itemSubTabs(item)");
    }
  });

  it("Hızlı erişim en çok 4 satır; 'Son açılanlar' ayrı grup değildir", () => {
    const code = src("src/components/ui/console/quick-access.tsx");
    expect(code).toContain("MAX_QUICK_ROWS = 4");
    expect(code).not.toContain("Son açılanlar");
  });
});
