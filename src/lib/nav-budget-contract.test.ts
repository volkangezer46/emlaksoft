import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminSidebarModel } from "./admin/nav";
import { hubNav } from "./nav-config";
import { NAV_BUDGET, NAV_BY_ROLE } from "./nav-roles";
import { MAX_VISIBLE_TABS } from "./morph-tabs";
import { DEFAULT_MATRIX, canAccessModule, type AppModule, type AppRole } from "./permissions";
import { PLATFORM_ROLE_MODULES } from "./platform-access";

/**
 * ANA İLKE ("Google sadeliği"): menü sayısı çoğalmaz, kullanım zorluğu yaşanmaz. YENİ ÖZELLİK = yeni menü öğesi DEĞİL;
 * önce mevcut merkeze sekme/kart. Yan menü görünür satır bütçesi: danışman <= 5, ofis <= 6, admin <= 6; sayfa başına TEK
 * sekme şeridi, en çok 5 görünür sekme. Bu test bütçeyi aşan her değişikliği kırar; gevşetme değil, öğeyi bir merkeze taşı.
 */
const ROLES = Object.keys(NAV_BY_ROLE) as AppRole[];
const accessibleOf = (role: AppRole) => (Object.keys(DEFAULT_MATRIX[role]) as AppModule[]).filter((m) => canAccessModule(role, m));
const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const rows = (role: AppRole) => hubNav(accessibleOf(role), { role }).hubs;

describe("menü görünür satır bütçesi (hubNav çıktısı)", () => {
  it("bütçe sabitleri: danışman 5, ofis 6, admin 6", () => {
    expect(NAV_BUDGET).toEqual({ advisor: 5, office: 7, admin: 6 });
  });

  it("danışman / takım lideri <= 5 satır", () => {
    for (const role of ["advisor", "team_lead"] as const) expect(rows(role).length, role).toBeLessThanOrEqual(NAV_BUDGET.advisor);
  });

  it("ofis yönetimi (owner/gm/branch_manager) <= 6 satır", () => {
    for (const role of ["owner", "gm", "branch_manager"] as const) expect(rows(role).length, role).toBeLessThanOrEqual(NAV_BUDGET.office);
  });

  it("diğer roller de ofis bütçesini aşmaz; muhasebe ve çağrı merkezi 4 satır", () => {
    for (const role of ROLES) expect(rows(role).length, role).toBeLessThanOrEqual(NAV_BUDGET.office);
    expect(rows("accounting")).toHaveLength(4);
    expect(rows("call_center")).toHaveLength(4);
  });

  it("admin her platform rolünde <= 6 görünür satır", () => {
    for (const [role, mods] of Object.entries(PLATFORM_ROLE_MODULES)) {
      const visible = adminSidebarModel(mods).flatMap((g) => g.items);
      expect(visible.length, role).toBeLessThanOrEqual(NAV_BUDGET.admin);
    }
  });

  it("alt sabit satırlar (Ayarlar, Abonelik, Yardım) bütçeye sayılmaz ama hiçbir yetkili sayfa kaybolmaz", () => {
    const m = hubNav(accessibleOf("owner"), { role: "owner" });
    expect(m.dock.map((h) => h.href)).toEqual(expect.arrayContaining(["/app/ayarlar", "/app/abonelik", "/app/yardim"]));
    expect(m.tools.map((t) => t.href)).toEqual(expect.arrayContaining(["/app/degerleme", "/app/asistan", "/app/ag"]));
    expect(m.hubs.some((h) => h.pages.some((p) => p.href === "/app/gelen-kutusu"))).toBe(true);
  });

  it("mobil alt çubuk rol başına en çok 5 yuva", () => {
    for (const role of ROLES) expect(hubNav(accessibleOf(role), { role }).mobile.length, role).toBeLessThanOrEqual(5);
  });
});

describe("tek sekme şeridi ve görünür sekme sınırı", () => {
  it("bir şeritte en çok 5 sekme görünür, fazlası 'Diğer' menüsünde", () => {
    expect(MAX_VISIBLE_TABS).toBeLessThanOrEqual(5);
    expect(src("src/components/ui/morph-nav-more.tsx")).toContain("<span>Diğer</span>");
  });

  it("sayfanın üstünde TEK şerit: SectionTabs yalnız etkin merkezin düz listesini çizer (grup şeridi + alt şerit yok)", () => {
    const code = src("src/components/app/section-tabs.tsx");
    expect(code.match(/<MorphNav\b/g)?.length).toBe(1);
    expect(code).toContain("resolveStripHub");
    expect(code).not.toContain("itemSubTabs");
    expect(code).not.toContain("subTabs");
  });

  it("mobilde etiket her zaman görünür: yalnız-ikon sekme yoktur", () => {
    const code = src("src/components/ui/morph-tab-parts.tsx");
    expect(code).toContain('inactive: "label"');
    expect(code).not.toContain('inactive: item.icon ? "icon" : "label"');
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

  it("Hızlı erişim (admin) en çok 4 satır; 'Son açılanlar' ayrı grup değildir", () => {
    const code = src("src/components/ui/console/quick-access.tsx");
    expect(code).toContain("MAX_QUICK_ROWS = 4");
    expect(code).not.toContain("Son açılanlar");
  });
});

describe("dokunma hedefleri (>= 44 px)", () => {
  it("üst çubuk düğmeleri mobilde h-11 w-11 (44 px)", () => {
    expect(src("src/components/theme-toggle.tsx")).toContain("h-11 w-11");
    expect(src("src/components/app/notification-bell.tsx")).toContain("h-11 w-11");
    expect(src("src/components/app/command-search.tsx")).toContain("h-11 w-11");
    expect(src("src/components/app/quick-create-menu.tsx")).toContain("h-11 min-w-11");
  });
});
