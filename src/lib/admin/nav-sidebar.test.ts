import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PLATFORM_ROLE_MODULES } from "@/lib/platform-access";
import { SectionTabsView } from "@/components/admin/admin-section-tabs";
import { ADMIN_NAV, activeChildHref, activeTabHref, adminNavFor, adminPaletteFor, adminSidebarModel, adminTabPathname, splitTabs, type NavTab } from "./nav";

// Görünüm testi: akıllı bağlantı yerine düz <a> (yönlendirici bağlamı yok).
vi.mock("@/components/ui/smart-link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ href, children, prefetch: _p, ...rest }: { href: string; children?: unknown; prefetch?: unknown }) => h("a", { href, ...rest }, children as never) };
});

describe("/admin yan menü görünümü (çekirdek + katlanan)", () => {
  it("her rolde görünen + katlanan = rolün menüsü; hiçbir sayfa kaybolmaz, tekrar yok", () => {
    for (const [role, mods] of Object.entries(PLATFORM_ROLE_MODULES)) {
      const all = adminNavFor(mods).flatMap((s) => s.items.map((i) => i.href));
      const model = adminSidebarModel(mods).flatMap((g) => [...g.items, ...g.folded].map((i) => i.href));
      expect(model.slice().sort(), role).toEqual(all.slice().sort());
    }
  });

  it("süper yöneticide 6 çekirdek öğe görünür (Raporlar/AI danışmanı Kontrol paneli, Üyeler Ofisler sekmesi), nadir araçlar grup içinde katlanır", () => {
    const groups = adminSidebarModel(PLATFORM_ROLE_MODULES.super_admin);
    const visible = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(visible).toEqual(["/admin", "/admin/tenants", "/admin/billing", "/admin/site", "/admin/tickets", "/admin/sistem"]);
    const folded = groups.flatMap((g) => g.folded.map((i) => i.href));
    expect(folded).toEqual(expect.arrayContaining(["/admin/ayarlar", "/admin/personel", "/admin/geo"]));
  });

  it("çekirdeği olmayan grup (rol süzgeci sonrası) tam gösterilir; boş grup yoktur", () => {
    for (const mods of Object.values(PLATFORM_ROLE_MODULES)) {
      for (const g of adminSidebarModel(mods)) {
        expect(g.items.length).toBeGreaterThan(0);
        if (g.folded.length > 0) expect(g.items.every((i) => i.core)).toBe(true);
      }
    }
  });

  it("çekirdek bayrağı yalnız 6 tanımlı menü öğesinde", () => {
    expect(ADMIN_NAV.flatMap((s) => s.items).filter((i) => i.core).length).toBe(6);
  });

  it("görünür satır >= grup sayısı: her grubun en az bir satırı hep görünür (başlık tek başına kalmaz)", () => {
    for (const [role, mods] of Object.entries(PLATFORM_ROLE_MODULES)) {
      const groups = adminSidebarModel(mods);
      const visible = groups.flatMap((g) => g.items);
      expect(visible.length, role).toBeGreaterThanOrEqual(groups.length);
    }
  });

  it("eski ortak 'Diğer' grubu yok: ek öğeler ilgili gruptadır (Gelir, Destek, Sistem)", () => {
    const groupOf = (href: string) => ADMIN_NAV.find((s) => s.items.some((i) => i.href === href))?.id;
    expect(groupOf("/admin/growth")).toBe("gelir");
    expect(groupOf("/admin/analiz-tarifesi")).toBe("gelir");
    expect(groupOf("/admin/duyuru")).toBe("destek");
    expect(groupOf("/admin/geo")).toBe("sistem");
    expect(groupOf("/admin/personel")).toBe("sistem");
    expect(groupOf("/admin/ayarlar")).toBe("sistem");
    const code = readFileSync(join(process.cwd(), "src/components/admin/admin-sidebar.tsx"), "utf8");
    expect(code).not.toContain("diger-acik");
    expect(code).not.toContain('"adm-diger"');
  });

  it("alt çubuk kısa adları: Kontrol paneli -> Panel, Site, SEO ve Reklam -> Site", () => {
    const byHref = new Map(ADMIN_NAV.flatMap((s) => s.items).map((i) => [i.href, i]));
    expect(byHref.get("/admin")?.short).toBe("Panel");
    expect(byHref.get("/admin/site")?.label).toBe("Site, SEO ve Reklam");
    expect(byHref.get("/admin/site")?.short).toBe("Site");
    const code = readFileSync(join(process.cwd(), "src/components/admin/admin-sidebar.tsx"), "utf8");
    expect(code).toContain("{tab.short ?? tab.label}");
  });
});

describe("Site, SEO ve Reklam: sekmeler (SP1; AP6 Sayfalar İçerik'in alt sayfası, yeni menü satırı değil)", () => {
  const site = ADMIN_NAV.flatMap((s) => s.items).find((i) => i.href === "/admin/site")!;
  it("sekmeler: Genel bakış · İçerik (Ana sayfa, Sayfalar) · SEO · Site menüsü · Marka; menü satırı eklenmez", () => {
    expect(site.tabs!.map((t) => t.label)).toEqual(["Genel bakış", "İçerik", "SEO", "Site menüsü", "Marka"]);
    const icerik = site.tabs!.find((t) => t.label === "İçerik")!;
    expect(icerik.children!.map((c) => [c.label, c.href])).toEqual([
      ["Ana sayfa", "/admin/site-icerik"],
      ["Sayfalar", "/admin/site/sayfalar"],
    ]);
    expect(icerik.children!.every((c) => c.modules.join() === "sitecontent")).toBe(true);
    expect(ADMIN_NAV.flatMap((s) => s.items).some((i) => i.href === "/admin/site/sayfalar")).toBe(false);
  });
  it("sayfa editörü ve fiyatlar alt sayfalarında İçerik sekmesi ve Sayfalar alt sekmesi etkindir (Genel bakış değil)", () => {
    const icerik = site.tabs!.find((t) => t.label === "İçerik")!;
    expect(activeTabHref("/admin/site/sayfalar/abcdef123456", site.tabs!)).toBe(icerik.href);
    expect(activeTabHref("/admin/site/sayfalar/fiyatlar", site.tabs!)).toBe(icerik.href);
    expect(activeChildHref("/admin/site/sayfalar/fiyatlar", icerik)).toBe("/admin/site/sayfalar");
    expect(activeChildHref("/admin/site-icerik", icerik)).toBe("/admin/site-icerik");
    expect(activeTabHref("/admin/site", site.tabs!)).toBe("/admin/site");
  });
  it("İçerik alt sayfaları rol süzgecinden geçer ve komut paletinde aranır", () => {
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

describe("/admin/sistem?sekme=hatalar bölüm şeridinde 'Hata kayıtları' sekmesini etkin yapar", () => {
  const sistem = ADMIN_NAV.flatMap((s) => s.items).find((i) => i.href === "/admin/sistem")!;
  it("hata görünümü Hata kayıtları, diğer görünümler Sağlık sekmesidir", () => {
    expect(activeTabHref(adminTabPathname("/admin/sistem", "hatalar"), sistem.tabs!)).toBe("/admin/hatalar");
    expect(activeTabHref(adminTabPathname("/admin/sistem", null), sistem.tabs!)).toBe("/admin/sistem");
    expect(activeTabHref(adminTabPathname("/admin/sistem", "emlakfiyati"), sistem.tabs!)).toBe("/admin/sistem");
    // Başka sayfadaki `sekme=hatalar` eşlemeye girmez.
    expect(adminTabPathname("/admin/aktivite", "hatalar")).toBe("/admin/aktivite");
  });
});
