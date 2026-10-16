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
  // Kurumsal referans menüsü (sahip kararı 2026-10-16, tek görünüm): düz satırlar, "Yönetim" başlığı, alt listeler.
  it("bütçe sabitleri: danışman 10, ofis 18, admin 6", () => {
    expect(NAV_BUDGET).toEqual({ advisor: 10, office: 18, admin: 6 });
  });

  it("danışman / takım lideri <= 10 satır, ofis yönetimi <= 18 satır (şubeli ofis dahil)", () => {
    for (const role of ["advisor", "team_lead"] as const) expect(rows(role).length, role).toBeLessThanOrEqual(NAV_BUDGET.advisor);
    for (const role of ["owner", "gm", "branch_manager"] as const) {
      expect(hubNav(accessibleOf(role), { role, hasBranches: true }).hubs.length, role).toBeLessThanOrEqual(NAV_BUDGET.office);
    }
  });

  it("diğer roller de ofis bütçesini aşmaz; muhasebe 4, çağrı merkezi 5 satır", () => {
    for (const role of ROLES) expect(rows(role).length, role).toBeLessThanOrEqual(NAV_BUDGET.office);
    expect(rows("accounting")).toHaveLength(4);
    expect(rows("call_center")).toHaveLength(5);
  });

  it("admin her platform rolünde <= 6 görünür satır", () => {
    for (const [role, mods] of Object.entries(PLATFORM_ROLE_MODULES)) {
      const visible = adminSidebarModel(mods).flatMap((g) => g.items);
      expect(visible.length, role).toBeLessThanOrEqual(NAV_BUDGET.admin);
    }
  });

  it("alt sabit satırlar (Abonelik = Paketim kartı, Yardım) bütçeye sayılmaz ama hiçbir yetkili sayfa kaybolmaz", () => {
    const m = hubNav(accessibleOf("owner"), { role: "owner" });
    expect(m.dock.map((h) => h.href)).toEqual(expect.arrayContaining(["/app/abonelik", "/app/yardim"]));
    expect(m.hubs.map((h) => h.href)).toContain("/app/ayarlar");
    expect(m.tools.map((t) => t.href)).toEqual(expect.arrayContaining(["/app/degerleme", "/app/asistan", "/app/ag"]));
    expect(m.hubs.some((h) => h.pages.some((p) => p.href === "/app/gelen-kutusu"))).toBe(true);
  });

  it("mobil alt çubuk rol başına en çok 5 yuva", () => {
    for (const role of ROLES) expect(hubNav(accessibleOf(role), { role }).mobile.length, role).toBeLessThanOrEqual(5);
  });
});

describe("tek sekme şeridi ve görünür sekme sınırı", () => {
  // Plan C04: taşan sekmelerin menüsü "Tümü" (eski adı "Diğer").
  it("bir şeritte en çok 5 sekme görünür, fazlası 'Tümü' menüsünde", () => {
    expect(MAX_VISIBLE_TABS).toBeLessThanOrEqual(5);
    expect(src("src/components/ui/morph-nav-more.tsx")).toContain("<span>Tümü</span>");
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

describe("yan menüde '+N daha' listelenmez; alt liste yalnız işaretli merkezlerde", () => {
  it("app ve admin yan menüsünde '+N daha' ve 'Daha az göster' yok; app alt listesi yalnız `hub.sub` merkezlerde", () => {
    for (const f of ["src/components/app/app-sidebar.tsx", "src/components/admin/admin-sidebar.tsx"]) {
      const code = src(f);
      expect(code, f).not.toContain("Daha az göster");
      expect(code, f).not.toMatch(/\+\$\{[^}]*\} daha/);
      expect(code, f).not.toContain("itemSubTabs(item)");
    }
    const app = src("src/components/app/app-sidebar.tsx");
    expect(app).toContain("Boolean(hub.sub)");
    expect(app).toContain("aria-expanded={expanded}");
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
    expect(src("src/components/app/quick-create-trigger.ts")).toContain("h-11 min-w-11");
  });
});
