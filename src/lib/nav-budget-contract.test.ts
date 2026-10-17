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
 * önce mevcut merkeze sekme/kart. Yan menü görünür satır bütçesi: danışman <= 8, ofis <= 13, admin <= 6; sayfa başına TEK
 * sekme şeridi, en çok 5 görünür sekme. Bu test bütçeyi aşan her değişikliği kırar; gevşetme değil, öğeyi bir merkeze taşı.
 */
const ROLES = Object.keys(NAV_BY_ROLE) as AppRole[];
const accessibleOf = (role: AppRole) => (Object.keys(DEFAULT_MATRIX[role]) as AppModule[]).filter((m) => canAccessModule(role, m));
const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const rows = (role: AppRole) => hubNav(accessibleOf(role), { role }).hubs;

describe("menü görünür satır bütçesi (hubNav çıktısı)", () => {
  // Menü önerisi (sahip kararı 2026-10-16, "iyi tespitler"): 13 satır + 5 grup başlığı; 1366×768'de kaydırmadan sığar.
  // Admin 9 grup (genişleme 2026-10, sahip: "adminde çok fazla menü ve işlevsellik olacak"): KVKK, giriş güvenliği, ileti
  // izni ve veri saklama "Güvenlik & veri" grubunda toplandı; grup başına 6 satır sınırı aynen kalır (akordeon).
  it("bütçe sabitleri: danışman 8, ofis 13; admin grup başına 6 satır, en çok 9 grup", () => {
    expect(NAV_BUDGET).toEqual({ advisor: 8, office: 13, admin: 6, adminGroups: 9 });
  });

  it("danışman / takım lideri <= 8 satır, ofis yönetimi <= 13 satır (şubeli ofis dahil)", () => {
    for (const role of ["advisor", "team_lead"] as const) expect(rows(role).length, role).toBeLessThanOrEqual(NAV_BUDGET.advisor);
    for (const role of ["owner", "gm", "branch_manager"] as const) {
      expect(hubNav(accessibleOf(role), { role, hasBranches: true }).hubs.length, role).toBeLessThanOrEqual(NAV_BUDGET.office);
    }
  });

  it("diğer roller de ofis bütçesini aşmaz; muhasebe 8, çağrı merkezi 4 satır", () => {
    for (const role of ROLES) expect(rows(role).length, role).toBeLessThanOrEqual(NAV_BUDGET.office);
    expect(rows("accounting")).toHaveLength(8);
    expect(rows("call_center")).toHaveLength(4);
  });

  /**
   * Sahip kararı 2026-10-17 (referans konsol düzeni): SABİT ALT BÖLÜM YOK. Satırlar okunaklı ~40 px (`--sb-row-h: 2.625rem`,
   * 15 px etiket); Ayarlar · Yardım · Paketim satırı · Araçlar · Menüyü daralt listenin sonunda, menüyle birlikte kayar
   * (NavScroller flex-1, `.sb-pad { min-height: 0 }`). 1366×768'de marka + ofis kartı + en az 10 satır ilk ekranda görünür.
   */
  it("1366×768: tüm menü tek kaydırılan liste; Ayarlar/Yardım/Paketim normal satır (sabit alt bölüm yok)", () => {
    const sidebar = src("src/components/app/app-sidebar.tsx");
    const shell = src("src/app/console-shell.css");
    expect(shell).toMatch(/--sb-row-h: 2\.625rem;/);
    expect(shell).toMatch(/\.app-sb \.sb-pad \{ min-height: 0; \}/);
    expect(sidebar).not.toContain('"--sb-row-h"');
    expect(sidebar).toContain("lg:min-h-8");
    expect(sidebar).toMatch(/<NavScroller[^>]*className=\{`sb-pad flex-1/);
    expect(sidebar).not.toContain("sb-foot");
    expect(sidebar).toContain('title: "Ayarlar ve yardım"');
    expect(sidebar).toContain("{renderTail(variant)}");
    expect(sidebar).toMatch(/const GROUP_CLASS = "sb-group px-3 pb-1 pt-3 text-xs [^"]*leading-4/);
    expect(sidebar).toContain("lg:min-h-12 lg:py-2!");
    expect(src("src/components/app/office-card.tsx")).toContain("min-h-12");
    const ROW = 40, GAP = 2, HEAD = 56, OFFICE = 48 + 8, LIST_PAD = 8, GROUP = 32;
    expect(HEAD + OFFICE + LIST_PAD + 2 * GROUP + 10 * (ROW + GAP)).toBeLessThanOrEqual(768);
  });

  it("admin her platform rolünde <= 8 grup ve grup başına <= 6 satır (akordeon: kapalı grup tek başlık)", () => {
    for (const [role, mods] of Object.entries(PLATFORM_ROLE_MODULES)) {
      const { groups } = adminSidebarModel(mods);
      expect(groups.length, role).toBeLessThanOrEqual(NAV_BUDGET.adminGroups);
      for (const g of groups) expect(g.items.length, `${role} ${g.section.id}`).toBeLessThanOrEqual(NAV_BUDGET.admin);
    }
  });

  it("alt sabit satırlar (Abonelik = Paketim kartı, Yardım) bütçeye sayılmaz ama hiçbir yetkili sayfa kaybolmaz", () => {
    const m = hubNav(accessibleOf("owner"), { role: "owner" });
    expect(m.dock.map((h) => h.href)).toEqual(expect.arrayContaining(["/app/ayarlar", "/app/abonelik", "/app/yardim"]));
    expect(m.hubs.map((h) => h.href)).not.toContain("/app/ayarlar");
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

describe("yan menüde '+N daha' listelenmez; üçüncü düzey alt liste yok", () => {
  it("app ve admin yan menüsünde '+N daha' ve 'Daha az göster' yok; app grupları açık akordeon, merkez alt listesi yok", () => {
    for (const f of ["src/components/app/app-sidebar.tsx", "src/components/admin/admin-sidebar.tsx"]) {
      const code = src(f);
      expect(code, f).not.toContain("Daha az göster");
      expect(code, f).not.toMatch(/\+\$\{[^}]*\} daha/);
      expect(code, f).not.toContain("itemSubTabs(item)");
    }
    // Sahip kararı 2026-10-17: yan menüde üçüncü düzey (merkez alt listesi) yok; kardeş sayfalar sekme şeridinde.
    // Grup başlıkları satır içi açılır/kapanır (aria-expanded), varsayılan açık.
    const app = src("src/components/app/app-sidebar.tsx");
    expect(app).not.toContain("sb-sub");
    expect(app).not.toContain("toggleSub");
    expect(app).toContain("aria-expanded={expanded}");
    expect(app).toContain("hasActive || !stateIds.includes(`g-${g.id}`)");
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
