import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PLATFORM_ROLE_MODULES } from "@/lib/platform-access";
import { SectionTabsView } from "@/components/admin/admin-section-tabs";
import { ADMIN_NAV, activeAdminItem, activeChildHref, activeTabHref, adminNavFor, adminPaletteFor, adminSidebarModel, splitTabs, tabKey, type NavTab } from "./nav";

// Görünüm testi: akıllı bağlantı yerine düz <a> (yönlendirici bağlamı yok).
vi.mock("@/components/ui/smart-link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ href, children, prefetch: _p, ...rest }: { href: string; children?: unknown; prefetch?: unknown }) => h("a", { href, ...rest }, children as never) };
});

describe("/admin yan menü görünümü (grup akordeonu + alt sabit bölüm)", () => {
  it("her rolde gruplar + alt sabit = rolün menüsü; hiçbir sayfa kaybolmaz, tekrar yok", () => {
    for (const [role, mods] of Object.entries(PLATFORM_ROLE_MODULES)) {
      const all = adminNavFor(mods).flatMap((s) => s.items.map((i) => i.href));
      const m = adminSidebarModel(mods);
      const model = [...m.groups.flatMap((g) => g.items), ...m.dock].map((i) => i.href);
      expect(model.slice().sort(), role).toEqual(all.slice().sort());
      expect(new Set(model).size, role).toBe(model.length);
    }
  });

  it("süper yöneticide dokuz iş grubu sırasıyla; Ayarlar alt sabit bölümde (grupta tekrar edilmez)", () => {
    const m = adminSidebarModel(PLATFORM_ROLE_MODULES.super_admin);
    expect(m.groups.map((g) => g.section.title)).toEqual([
      "Genel bakış",
      "Ofisler",
      "Gelir & abonelik",
      "Destek",
      "İçerik & SEO",
      "Güvenlik & veri",
      "Sistem",
      "AI & entegrasyon",
      "Yönetim",
    ]);
    expect(m.dock.map((i) => i.href)).toEqual(["/admin/ayarlar"]);
    expect(m.groups.flatMap((g) => g.items).some((i) => i.href === "/admin/ayarlar")).toBe(false);
    // Grup başına en çok 6 satır: akordeon açılınca 1366×768'de okunur kalır.
    for (const g of m.groups) expect(g.items.length, g.section.id).toBeLessThanOrEqual(6);
  });

  it("gruplar satır içi akordeondur (aria-expanded); üst üste binen alt pencere ve sekme tekrarı yok", () => {
    const code = readFileSync(join(process.cwd(), "src/components/admin/admin-sidebar.tsx"), "utf8");
    expect(code).toContain("aria-expanded={expanded}");
    expect(code).toContain("groups.map(renderGroup)");
    // İkon modunda yalnız ipucu: NavFlyout'a alt sayfa listesi verilmez.
    expect(code).not.toContain("railFlyoutItems");
    expect(code).not.toMatch(/items=\{[^}]*tabs/);
    // v4 kabuk teması (/app menüsüyle aynı sınıf ve CSS).
    expect(code).toContain("sb-surface app-sb");
    expect(readFileSync(join(process.cwd(), "src/app/admin/layout.tsx"), "utf8")).toContain('import "@/app/console-shell.css";');
  });

  it("boş grup yoktur; her grubun en az bir satırı vardır", () => {
    for (const mods of Object.values(PLATFORM_ROLE_MODULES)) {
      for (const g of adminSidebarModel(mods).groups) expect(g.items.length).toBeGreaterThan(0);
    }
  });

  it("menü yönetimi farkı: grup gizlenir/sıralanır; zorunlu gruplar (Genel bakış, Yönetim) gizlenemez", () => {
    const m = adminSidebarModel(PLATFORM_ROLE_MODULES.super_admin, {}, { hiddenGroups: ["destek", "genel", "yonetim"], groupOrder: ["gelir", "genel"] });
    const ids = m.groups.map((g) => g.section.id);
    expect(ids).not.toContain("destek");
    expect(ids).toContain("genel");
    expect(ids).toContain("yonetim");
    expect(ids.slice(0, 2)).toEqual(["gelir", "genel"]);
    // Bilinmeyen kimlik yok sayılır.
    expect(adminSidebarModel(PLATFORM_ROLE_MODULES.super_admin, {}, { hiddenGroups: ["yok"] }).groups.length).toBe(9);
  });

  it("alt çubuk kısa adları: Kontrol paneli -> Panel, Site ve içerik -> Site (dar menüde kesilmeyen ad)", () => {
    const byHref = new Map(ADMIN_NAV.flatMap((s) => s.items).map((i) => [i.href, i]));
    expect(byHref.get("/admin")?.short).toBe("Panel");
    expect(byHref.get("/admin/site")?.label).toBe("Site ve içerik");
    expect(byHref.get("/admin/site")?.short).toBe("Site");
    for (const i of ADMIN_NAV.flatMap((s) => s.items)) expect(i.label.length, i.label).toBeLessThanOrEqual(22);
    const code = readFileSync(join(process.cwd(), "src/components/admin/admin-sidebar.tsx"), "utf8");
    expect(code).toContain("{tab.short ?? tab.label}");
  });
});

describe("İçerik & SEO: üç bölüm (Site ve içerik · SEO ve hız · Reklam ve Google)", () => {
  const items = ADMIN_NAV.flatMap((s) => s.items);
  const site = items.find((i) => i.href === "/admin/site")!;
  const seo = items.find((i) => i.href === "/admin/site/seo")!;
  const ads = items.find((i) => i.href === "/admin/site/reklam")!;
  it("sekmeler bölüme göre; aktif öğe doğru bölümdür", () => {
    expect(site.tabs!.map((t) => t.label)).toEqual(["Genel bakış", "İçerik", "Site menüsü", "Marka", "Medya", "Rehber"]);
    expect(seo.tabs!.map((t) => t.label)).toEqual(["SEO", "Hız"]);
    expect(ads.tabs!.map((t) => t.label)).toEqual(["Reklam", "Bağlantılar"]);
    expect(activeAdminItem("/admin/site/hiz/saha")?.href).toBe("/admin/site/seo");
    expect(activeAdminItem("/admin/site/baglantilar")?.href).toBe("/admin/site/reklam");
    expect(activeAdminItem("/admin/site/sayfalar/abc")?.href).toBe("/admin/site");
    expect(activeTabHref("/admin/site/sayfalar/fiyatlar", site.tabs!)).toBe("/admin/site/sayfalar");
    const hiz = seo.tabs!.find((t) => t.label === "Hız")!;
    expect(activeChildHref("/admin/site/hiz/saha", hiz)).toBe("/admin/site/hiz/saha");
  });

  it("her sekme ve alt sekmenin modülü açtığı sayfanın kapısını içerir (görünen sekme 'yetkisiz' açılmaz)", () => {
    const links = [site, seo, ads].flatMap((i) => i.tabs!.flatMap((t) => [t, ...(t.children ?? [])]));
    for (const l of links) {
      const code = readFileSync(join(process.cwd(), `src/app${l.href}/page.tsx`), "utf8");
      const gate = /requirePlatformModule\("([a-z]+)"\)/.exec(code)?.[1];
      if (gate && gate !== "dashboard") expect(l.modules, `${l.href} -> ${gate}`).toContain(gate);
    }
  });

  it("destek ve muhasebe rolleri site bölümlerini görmez; ops Marka sekmesini görmez", () => {
    for (const role of ["support", "billing"] as const) {
      const hrefs = adminNavFor(PLATFORM_ROLE_MODULES[role]).flatMap((s) => s.items.map((i) => i.href));
      for (const h of ["/admin/site", "/admin/site/seo", "/admin/site/reklam"]) expect(hrefs, `${role} ${h}`).not.toContain(h);
    }
    const ops = adminNavFor(PLATFORM_ROLE_MODULES.ops).flatMap((s) => s.items).find((i) => i.href === "/admin/site")!;
    expect(ops.tabs!.map((t) => t.label)).not.toContain("Marka");
    expect(adminPaletteFor(PLATFORM_ROLE_MODULES.super_admin).some((c) => c.href === "/admin/site/sayfalar")).toBe(true);
  });
});

describe("AdminSectionTabs: 5 görünür sekme + 'Diğer ▾', alt sayfalar ikinci satırda", () => {
  const T = (n: number, extra: Partial<NavTab> = {}): NavTab => ({ href: `/admin/x/${n}`, label: `Sekme ${n}`, description: `d${n}`, modules: ["seo"], ...extra });
  const seven = [T(1), T(2, { children: [T(21, { label: "Alt A" }), T(22, { label: "Alt B" })] }), T(3), T(4), T(5), T(6), T(7)];
  const html = (current: string | null, child: string | null = null) =>
    renderToStaticMarkup(createElement(SectionTabsView, { label: "Bölüm", tabs: seven, current, currentChild: child }));

  it("splitTabs: 7 sekmede 5 görünür, 2 'Diğer'de; overflow işaretli sekme hep 'Diğer'de", () => {
    const s = splitTabs(seven);
    expect(s.visible.map((t) => t.label)).toEqual(["Sekme 1", "Sekme 2", "Sekme 3", "Sekme 4", "Sekme 5"]);
    expect(s.more.map((t) => t.label)).toEqual(["Sekme 6", "Sekme 7"]);
    expect(splitTabs([T(1), T(2, { overflow: true })]).more.map((t) => t.label)).toEqual(["Sekme 2"]);
  });

  it("render: 5 bağlantı + details/summary 'Diğer'; etkin sekme taşmadaysa 'Diğer' etkin", () => {
    const out = html("/admin/x/7");
    const main = out.split("<details")[0]!;
    expect(main.match(/<a /g)?.length).toBe(5);
    expect(out).toContain("<summary");
    expect(out).toMatch(/<summary[^>]*aria-current="page"[^>]*>Diğer/);
    expect(html("/admin/x/1")).not.toMatch(/<summary[^>]*aria-current/);
  });

  it("render: etkin sekmenin children listesi ikinci satırda çizilir; diğer sekmede çizilmez", () => {
    const out = html("/admin/x/2", "/admin/x/22");
    expect(out).toContain("data-section-children");
    expect(out).toMatch(/aria-current="page"[^>]*>Alt B/);
    expect(html("/admin/x/1")).not.toContain("data-section-children");
  });
});

describe("/admin/sistem?sekme=hatalar bölüm şeridinde 'Hata kayıtları' sekmesini etkin yapar (sorgu sekmesi)", () => {
  const sistem = ADMIN_NAV.flatMap((s) => s.items).find((i) => i.href === "/admin/sistem")!;
  it("Hata kayıtları sekmesi kanonik adrese (Sistem sayfasının hatalar sekmesi) gider", () => {
    expect(sistem.tabs!.map((t) => t.href)).toContain("/admin/sistem?sekme=hatalar");
  });
  it("Entegrasyonlar kendi menü öğesidir (Yapay zeka & entegrasyon): yalnız o sekmede etkin, Sistem durumu değil", () => {
    expect(sistem.tabs!.map((t) => t.href)).not.toContain("/admin/sistem?sekme=entegrasyonlar");
    expect(activeAdminItem("/admin/sistem", ADMIN_NAV, "entegrasyonlar")?.label).toBe("Entegrasyonlar");
    expect(activeAdminItem("/admin/sistem", ADMIN_NAV, "hatalar")?.label).toBe("Sistem durumu");
    expect(activeAdminItem("/admin/sistem", ADMIN_NAV, null)?.label).toBe("Sistem durumu");
  });
  it("hata görünümü Hata kayıtları, diğer görünümler Sağlık sekmesidir", () => {
    expect(activeTabHref("/admin/sistem", sistem.tabs!, "hatalar")).toBe("/admin/sistem?sekme=hatalar");
    expect(activeTabHref("/admin/sistem", sistem.tabs!, null)).toBe("/admin/sistem");
    expect(activeTabHref("/admin/sistem", sistem.tabs!, "bilinmeyen")).toBe("/admin/sistem");
    expect(activeTabHref("/admin/sistem", sistem.tabs!, "durum")).toBe("/admin/sistem?sekme=durum");
    // Aktivite kendi öğesidir: Sistem sekmesi değildir; başka sayfadaki `sekme=hatalar` sorgu sekmesini etkin yapmaz.
    expect(activeTabHref("/admin/aktivite", sistem.tabs!, "hatalar")).toBeNull();
  });
  it("tabKey: sorgu sekmesinde tam adres, yol sekmesinde yol", () => {
    expect(tabKey("/admin/sistem?sekme=hatalar")).toBe("/admin/sistem?sekme=hatalar");
    expect(tabKey("/admin/sistem")).toBe("/admin/sistem");
  });
  it("render: sorgu sekmesi etkinken yalnız o sekme aria-current taşır", () => {
    const out = renderToStaticMarkup(
      createElement(SectionTabsView, { label: "Sistem", tabs: sistem.tabs!, current: activeTabHref("/admin/sistem", sistem.tabs!, "hatalar"), currentChild: null }),
    );
    expect(out.match(/aria-current="page"/g)?.length).toBe(1);
    // Sekme ikonlu (premium v5, lib/admin/tab-icons.ts): etiketten önce dekoratif SVG gelir.
    expect(out).toMatch(/aria-current="page"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Hata kayıtları/);
  });
});
