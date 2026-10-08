import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { itemSubTabs, moreSections, NAV_SECTIONS, sidebarModel, visibleSections } from "./nav-config";
import { NAV_CORE_BY_ROLE, isHiddenInSimple } from "./nav-roles";
import { DEFAULT_MATRIX, canAccessModule, type AppModule, type AppRole } from "./permissions";

const ROLES = Object.keys(NAV_CORE_BY_ROLE) as AppRole[];
const accessibleOf = (role: AppRole) => (Object.keys(DEFAULT_MATRIX[role]) as AppModule[]).filter((m) => canAccessModule(role, m));
const hrefsOf = (sections: { items: { href: string }[] }[]) => sections.flatMap((s) => s.items.map((i) => i.href));

describe("yan menü görünür yüzeyi (sidebarModel)", () => {
  it("sade görünümde çekirdek + 'Diğer' = eski sade + daha fazla (hiçbir yetkili sayfa kaybolmaz, tekrar yok)", () => {
    for (const role of ROLES) {
      const accessible = accessibleOf(role);
      const m = sidebarModel(accessible, { simple: true, role });
      const shown = [...m.groups.flatMap((g) => g.items), ...m.rest.flatMap((s) => s.items)].map((i) => i.href);
      const expected = [...hrefsOf(visibleSections(accessible, { mode: "simple", role })), ...hrefsOf(moreSections(accessible, { role }))];
      expect(shown.slice().sort(), role).toEqual(expected.slice().sort());
      expect(new Set(shown).size, `${role} tekrar`).toBe(shown.length);
    }
  });

  it("tam görünümde her başlık tüm öğeleriyle gelir, rest (Diğer) yoktur", () => {
    const m = sidebarModel(accessibleOf("owner"), { simple: false, role: "owner" });
    expect(m.rest).toEqual([]);
    expect(m.groups.flatMap((g) => g.items.map((i) => i.href))).toEqual(hrefsOf(visibleSections(accessibleOf("owner"))));
  });

  it("danışman konsolu: 8 üst satır; Teklifler Anlaşmalar'ın sekmesi, yan menüde alt liste yok", () => {
    const m = sidebarModel(accessibleOf("advisor"), { simple: true, role: "advisor" });
    const top = m.groups.flatMap((g) => g.items.map((i) => i.href));
    expect(top).toEqual([
      "/app",
      "/app/randevular",
      "/app/gorevler",
      "/app/musteriler",
      "/app/talepler",
      "/app/portfoyler",
      "/app/anlasmalar",
      "/app/performansim",
    ]);
    expect(m.groups.map((g) => g.section.id)).toEqual(["bugun", "musteriler", "portfoy", "anlasmalar", "performans"]);
    const withOffers = sidebarModel([...accessibleOf("advisor"), "offers"], { simple: true, role: "advisor" });
    const anlasmalar = withOffers.groups.flatMap((g) => g.items).find((i) => i.href === "/app/anlasmalar")!;
    expect(itemSubTabs(anlasmalar)?.map((t) => t.href)).toContain("/app/teklifler");
    // Gelen Kutusu, Komisyon, İlan Kontrol, Değerleme ve Yardım "Diğer" altında; kaybolmadı.
    const rest = m.rest.flatMap((s) => s.items).map((i) => i.href);
    expect(rest).toEqual(expect.arrayContaining(["/app/gelen-kutusu", "/app/komisyon", "/app/ilan-kontrol", "/app/degerleme", "/app/yardim"]));
  });

  it("ofis konsolu (yönetici): toplam 10 çekirdek satır", () => {
    for (const role of ["owner", "gm", "branch_manager"] as const) {
      const m = sidebarModel(accessibleOf(role), { simple: true, role });
      expect(m.groups.flatMap((g) => g.items).length).toBeLessThanOrEqual(10);
      // Ayarlar vb. yönetim sayfaları yöneticide "Diğer" altında ulaşılabilir.
      const rest = m.rest.flatMap((s) => s.items).map((i) => i.href);
      if (role === "owner") expect(rest.some((h) => h.startsWith("/app/ayarlar")), role).toBe(true);
    }
  });

  it("yönetici olmayan rolde yönetim-gizli sayfalar menüde hiç yok (doğrudan adres ve ⌘K çalışır)", () => {
    const m = sidebarModel(accessibleOf("advisor"), { simple: true, role: "advisor" });
    const all = [...m.groups.flatMap((g) => g.items), ...m.rest.flatMap((s) => s.items)];
    for (const i of all) expect(isHiddenInSimple("advisor", i.href), i.href).toBe(false);
  });

  it("itemSubTabs: yalnız ≥2 sekmeli öğede alt liste; sekme yolları öğe tanımından gelir", () => {
    expect(itemSubTabs({ tabs: undefined })).toBeNull();
    const items = NAV_SECTIONS.flatMap((s) => s.items);
    const musteriler = items.find((i) => i.href === "/app/musteriler")!;
    expect(itemSubTabs(musteriler)?.map((t) => t.href)).toEqual(expect.arrayContaining(["/app/akilli-listeler", "/app/kayip-satis", "/app/tavsiyeler"]));
    expect(itemSubTabs(items.find((i) => i.href === "/app/talepler")!)).toBeNull();
  });
});

describe("yan menü bileşen sözleşmesi (erişilebilirlik ve tek kaynak)", () => {
  const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  it("app ve admin yan menüsü Hızlı erişim, Menüde ara, aria-expanded ve 'Diğer' içerir; alt liste ve '+N daha' yok", () => {
    for (const f of ["src/components/app/app-sidebar.tsx", "src/components/admin/admin-sidebar.tsx"]) {
      const code = src(f);
      expect(code, f).toContain("QuickAccessSection");
      expect(code, f).toContain("MenuSearchButton");
      expect(code, f).toContain("aria-expanded");
      expect(code, f).toContain("Diğer");
      expect(code, f).not.toContain("alt sayfaları");
      expect(code, f).not.toContain("+${");
      expect(code, f).not.toContain("Daha az göster");
    }
    const kit = src("src/components/ui/console/nav-kit.tsx");
    expect(kit).toContain('"Escape"');
    expect(kit).toContain("aria-haspopup");
  });

  it("yan menü sunucu saatine bağlı değildir (Date.now/new Date yok)", () => {
    for (const f of ["src/components/app/app-sidebar.tsx", "src/components/admin/admin-sidebar.tsx", "src/components/ui/console/quick-access.tsx"]) {
      expect(src(f), f).not.toMatch(/Date\.now\(|new Date\(/);
    }
  });
});
