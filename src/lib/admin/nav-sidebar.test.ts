import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PLATFORM_ROLE_MODULES } from "@/lib/platform-access";
import { SectionTabsView } from "@/components/admin/admin-section-tabs";
import { ADMIN_NAV, activeChildHref, activeTabHref, adminNavFor, adminPaletteFor, adminSidebarModel, splitTabs, tabKey, type NavTab } from "./nav";

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

  it("her grup başlığıyla çizilir (tek öğeli grup başlıksız satır olmaz: Site, SEO ve Reklam Gelir'in altında görünmez)", () => {
    const code = readFileSync(join(process.cwd(), "src/components/admin/admin-sidebar.tsx"), "utf8");
    expect(code).not.toContain("folded.length === 0 && items.length === 1");
    expect(ADMIN_NAV.find((s) => s.id === "icerik")?.title).toBe("İçerik");
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
    expect(groupOf("/admin/ortaklik")).toBe("gelir");
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
  it("sekmeler: Genel bakış · İçerik · SEO · Site menüsü · Marka; İçerik'te ayrı 'Ana sayfa' alt satırı yok; menü satırı eklenmez", () => {
    expect(site.tabs!.map((t) => t.label)).toEqual(["Genel bakış", "İçerik", "SEO", "Site menüsü", "Marka", "Hız", "Reklam", "Medya", "Rehber", "Bağlantılar"]);
    const icerik = site.tabs!.find((t) => t.label === "İçerik")!;
    expect(icerik.href).toBe("/admin/site/sayfalar");
    expect(icerik.children).toBeUndefined();
    expect(ADMIN_NAV.flatMap((s) => s.items).some((i) => i.href === "/admin/site/sayfalar")).toBe(false);
    // Site URL'leri tek kök altında: eski kök yollar yok.
    expect(site.match).toEqual(undefined);
  });
  it("sayfa editörü ve fiyatlar alt sayfalarında İçerik sekmesi ve Sayfalar alt sekmesi etkindir (Genel bakış değil)", () => {
    const icerik = site.tabs!.find((t) => t.label === "İçerik")!;
    expect(activeTabHref("/admin/site/sayfalar/abcdef123456", site.tabs!)).toBe(icerik.href);
    expect(activeTabHref("/admin/site/sayfalar/fiyatlar", site.tabs!)).toBe(icerik.href);
    expect(activeTabHref("/admin/site/sayfalar/ana-sayfa", site.tabs!)).toBe(icerik.href);
    expect(activeChildHref("/admin/site/sayfalar/fiyatlar", icerik)).toBeNull();
    expect(activeTabHref("/admin/site", site.tabs!)).toBe("/admin/site");
  });
  it("S1 dikişi: Hız, Reklam, Medya, Rehber ve Bağlantılar 'Diğer ▾' altında; ilk 5 sekme değişmez, menü satırı eklenmez", () => {
    const { visible, more } = splitTabs(site.tabs!);
    expect(visible.map((t) => t.label)).toEqual(["Genel bakış", "İçerik", "SEO", "Site menüsü", "Marka"]);
    expect(more.map((t) => [t.label, t.href])).toEqual([
      ["Hız", "/admin/site/hiz"],
      ["Reklam", "/admin/site/reklam"],
      ["Medya", "/admin/site/medya"],
      ["Rehber", "/admin/site/rehber"],
      ["Bağlantılar", "/admin/site/baglantilar"],
    ]);
    const hiz = site.tabs!.find((t) => t.label === "Hız")!;
    expect(hiz.children!.map((c) => c.href)).toEqual(["/admin/site/hiz", "/admin/site/hiz/saha", "/admin/site/hiz/lab"]);
    expect(activeTabHref("/admin/site/hiz/saha", site.tabs!)).toBe("/admin/site/hiz");
    expect(activeChildHref("/admin/site/hiz/saha", hiz)).toBe("/admin/site/hiz/saha");
    expect(activeTabHref("/admin/site/reklam/google", site.tabs!)).toBe("/admin/site/reklam");
    expect(activeTabHref("/admin/site/rehber/abcdef123456", site.tabs!)).toBe("/admin/site/rehber");
    for (const href of ["/admin/site/hiz", "/admin/site/reklam", "/admin/site/medya", "/admin/site/rehber", "/admin/site/baglantilar"]) {
      expect(ADMIN_NAV.flatMap((s) => s.items).some((i) => i.href === href), href).toBe(false);
      expect(adminPaletteFor(PLATFORM_ROLE_MODULES.super_admin).some((c) => c.href === href), href).toBe(true);
    }
  });

  it("her sekme ve alt sekmenin modülü açtığı sayfanın kapısını içerir (görünen sekme 'yetkisiz' açılmaz)", () => {
    const links = site.tabs!.flatMap((t) => [t, ...(t.children ?? [])]);
    for (const l of links) {
      const file = join(process.cwd(), `src/app${l.href}/page.tsx`);
      const code = readFileSync(file, "utf8");
      const gate = /requirePlatformModule\("([a-z]+)"\)/.exec(code)?.[1];
      // Genel bakış /admin/site "dashboard" ile kapılıdır (herkes); diğerleri kendi modülüyle.
      if (gate && gate !== "dashboard") expect(l.modules, `${l.href} -> ${gate}`).toContain(gate);
    }
  });

  it("rolü olmayan yeni sekme görünmez: destek ve muhasebe rolleri Site bölümünü hiç görmez", () => {
    for (const role of ["support", "billing"] as const) {
      expect(adminNavFor(PLATFORM_ROLE_MODULES[role]).flatMap((s) => s.items).some((i) => i.href === "/admin/site"), role).toBe(false);
    }
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

describe("/admin/sistem?sekme=hatalar bölüm şeridinde 'Hata kayıtları' sekmesini etkin yapar (sorgu sekmesi)", () => {
  const sistem = ADMIN_NAV.flatMap((s) => s.items).find((i) => i.href === "/admin/sistem")!;
  it("Hata kayıtları sekmesi kanonik adrese (Sistem sayfasının hatalar sekmesi) gider", () => {
    expect(sistem.tabs!.map((t) => t.href)).toContain("/admin/sistem?sekme=hatalar");
  });
  it("hata görünümü Hata kayıtları, diğer görünümler Sağlık sekmesidir", () => {
    expect(activeTabHref("/admin/sistem", sistem.tabs!, "hatalar")).toBe("/admin/sistem?sekme=hatalar");
    expect(activeTabHref("/admin/sistem", sistem.tabs!, null)).toBe("/admin/sistem");
    expect(activeTabHref("/admin/sistem", sistem.tabs!, "bilinmeyen")).toBe("/admin/sistem");
    expect(activeTabHref("/admin/sistem", sistem.tabs!, "durum")).toBe("/admin/sistem?sekme=durum");
    expect(activeTabHref("/admin/aktivite", sistem.tabs!, null)).toBe("/admin/aktivite");
    // Başka sayfadaki `sekme=hatalar` sorgu sekmesini etkin yapmaz.
    expect(activeTabHref("/admin/aktivite", sistem.tabs!, "hatalar")).toBe("/admin/aktivite");
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
    expect(out).toMatch(/aria-current="page"[^>]*>Hata kayıtları/);
  });
});
