import { describe, expect, it } from "vitest";
import { NAV_SECTIONS, moreSections, visibleSections } from "./nav-config";
import { NAV_CORE_BY_ROLE, coreHrefsFor, isHiddenInSimple } from "./nav-roles";
import { DEFAULT_MATRIX, canAccessModule, type AppModule, type AppRole } from "./permissions";

const ROLES = Object.keys(NAV_CORE_BY_ROLE) as AppRole[];
const ITEMS = NAV_SECTIONS.flatMap((s) => s.items);
const accessibleOf = (role: AppRole) =>
  (Object.keys(DEFAULT_MATRIX[role]) as AppModule[]).filter((m) => canAccessModule(role, m));
const hrefs = (sections: { items: { href: string }[] }[]) => sections.flatMap((s) => s.items.map((i) => i.href));

describe("sade görünüm: rol çekirdek eşlemesi", () => {
  it("çekirdek yolların hepsi menüde tanımlı bir öğedir", () => {
    const defined = new Set(ITEMS.map((i) => i.href));
    for (const role of ROLES) for (const h of NAV_CORE_BY_ROLE[role]) expect(defined.has(h), `${role} ${h}`).toBe(true);
  });

  it("tier: 'core' tam olarak en az bir rolün çekirdeğindeki öğelerdir", () => {
    const union = new Set(ROLES.flatMap((r) => [...NAV_CORE_BY_ROLE[r]]));
    for (const item of ITEMS) expect(item.tier === "core", item.href).toBe(union.has(item.href));
  });

  it("çekirdek öğe yalnız rolün gerçekten yetkili olduğu modüllerden gelir (yetki matrisi değişmedi)", () => {
    for (const role of ROLES) {
      const accessible = accessibleOf(role);
      const shown = visibleSections(accessible, { mode: "simple", role });
      const full = new Set(hrefs(visibleSections(accessible)));
      for (const h of hrefs(shown)) expect(full.has(h), `${role} ${h}`).toBe(true);
    }
  });

  it("sade + daha fazla = tam görünümden yönetim-gizlileri çıkarılmış hali; hiçbir sayfa kaybolmaz", () => {
    for (const role of ROLES) {
      const accessible = accessibleOf(role);
      const full = hrefs(visibleSections(accessible));
      const simple = hrefs(visibleSections(accessible, { mode: "simple", role }));
      const more = hrefs(moreSections(accessible, { role }));
      // Sekmeli öğenin tam görünümdeki yolu ilk yetkili sekmedir: sekme yolları da öğeyle birlikte sayılır.
      const hidden = ITEMS.filter((i) => isHiddenInSimple(role, i.href)).flatMap((i) => [i.href, ...(i.tabs?.map((t) => t.href) ?? [])]);
      expect(new Set(simple).size + new Set(more).size).toBe(simple.length + more.length);
      for (const h of full) expect(simple.includes(h) || more.includes(h) || hidden.includes(h), `${role} ${h}`).toBe(true);
    }
  });

  it("danışman: settings=VIEW yüzünden görünen yönetim sayfaları sade görünümde yok, tam görünümde var", () => {
    const accessible = accessibleOf("advisor");
    const adminPages = ["/app/otomasyonlar", "/app/ayarlar/is-akislari", "/app/belgeler", "/app/denetim", "/app/ayarlar"];
    const full = hrefs(visibleSections(accessible));
    const simple = [...hrefs(visibleSections(accessible, { mode: "simple", role: "advisor" })), ...hrefs(moreSections(accessible, { role: "advisor" }))];
    for (const h of adminPages) {
      if (!full.includes(h)) continue;
      expect(simple, h).not.toContain(h);
    }
  });

  it("ofis sahibi çekirdeği 10 sayfa (İlan Kontrol dahil), muhasebe/sekreter kendi çekirdeğini görür", () => {
    expect(coreHrefsFor("owner").size).toBe(10);
    const acc = hrefs(visibleSections(accessibleOf("accounting"), { mode: "simple", role: "accounting" }));
    expect(acc).toEqual(expect.arrayContaining(["/app/komisyon", "/app/abonelik", "/app/raporlar"]));
    const cc = hrefs(visibleSections(accessibleOf("call_center"), { mode: "simple", role: "call_center" }));
    expect(cc).toEqual(expect.arrayContaining(["/app/gelen-kutusu", "/app/musteriler", "/app/randevular", "/app/gorevler"]));
  });

  // Çekirdek listede olup rolün VARSAYILAN matrisinde modülü bulunmayan öğeler (ofis tenant override'ı
  // ile yetki verilirse görünür; matris bilinçli değiştirilmedi). Yeni boşluk bu testi kırar.
  it("çekirdek öğe ile varsayılan yetki arasında boşluk yok", () => {
    const gaps: string[] = [];
    for (const role of ROLES) {
      const accessible = new Set(accessibleOf(role));
      for (const item of ITEMS) {
        if (!NAV_CORE_BY_ROLE[role].includes(item.href)) continue;
        const mods = [item.module, ...(item.tabs?.map((t) => t.module) ?? [])];
        if (!mods.some((m) => accessible.has(m))) gaps.push(`${role}:${item.href}`);
      }
    }
    // Muhasebe artık "expenses" VIEW alır (20260826001700): önceki iki boşluk kapandı.
    expect(gaps.sort()).toEqual([]);
  });

  it("tam görünüm (varsayılan) değişmedi", () => {
    const all = Object.keys(DEFAULT_MATRIX.owner) as AppModule[];
    expect(hrefs(visibleSections(all))).toEqual(hrefs(visibleSections(all, { mode: "full", role: "owner" })));
  });
});
