import { describe, expect, it } from "vitest";
import { ALL_NAV_HREFS, hubNav, PALETTE_ONLY_PAGES } from "./nav-config";
import { NAV_BUDGET, NAV_BY_ROLE, SIMPLE_NAV_BY_ROLE, layoutHrefs, navLayoutFor } from "./nav-roles";
import { DEFAULT_MATRIX, canAccessModule, type AppModule, type AppRole } from "./permissions";

const ROLES = Object.keys(NAV_BY_ROLE) as AppRole[];
const accessibleOf = (role: AppRole) =>
  (Object.keys(DEFAULT_MATRIX[role]) as AppModule[]).filter((m) => canAccessModule(role, m));
const KNOWN = new Set([...ALL_NAV_HREFS, ...PALETTE_ONLY_PAGES.map((p) => p.href)]);

describe("rol bazlı merkez yapısı (nav-roles)", () => {
  it("merkez sayfalarının hepsi katalogda tanımlı bir sayfadır", () => {
    for (const role of ROLES) for (const h of layoutHrefs(NAV_BY_ROLE[role])) expect(KNOWN.has(h), `${role} ${h}`).toBe(true);
  });

  it("bir rolün menüsünde aynı sayfa iki kez yoktur (merkez, alt sabit, araç)", () => {
    for (const role of ROLES) {
      const all = layoutHrefs(NAV_BY_ROLE[role]);
      expect(new Set(all).size, role).toBe(all.length);
    }
  });

  it("satır sayıları: ofis yönetimi 10, danışman 6, muhasebe 4, çağrı 4; bütçeyi aşmaz", () => {
    // WP6: Komisyon + Muhasebe tek "Finans" satırı.
    expect(NAV_BY_ROLE.owner.hubs).toHaveLength(10);
    expect(NAV_BY_ROLE.gm.hubs).toHaveLength(10);
    expect(NAV_BY_ROLE.branch_manager.hubs).toHaveLength(10);
    expect(NAV_BY_ROLE.advisor.hubs).toHaveLength(6);
    expect(NAV_BY_ROLE.team_lead.hubs).toHaveLength(6);
    // SK10: muhasebede "Mülk yönetimi" (rentals) satırı yok; Aidatlar Finans merkezinde.
    expect(NAV_BY_ROLE.accounting.hubs).toHaveLength(4);
    expect(NAV_BY_ROLE.call_center.hubs).toHaveLength(4);
    for (const role of ["advisor", "team_lead"] as const) expect(NAV_BY_ROLE[role].hubs.length).toBeLessThanOrEqual(NAV_BUDGET.advisor);
    for (const role of ROLES) expect(NAV_BY_ROLE[role].hubs.length, role).toBeLessThanOrEqual(NAV_BUDGET.office);
  });

  it("her satır varsayılan yetkiyle en az bir görünür sayfa içerir (ölü satır yok)", () => {
    for (const role of ROLES) {
      const live = new Set(hubNav(accessibleOf(role), { role }).hubs.map((h) => h.id));
      for (const hub of NAV_BY_ROLE[role].hubs) expect(live.has(hub.id), `${role} ${hub.id}`).toBe(true);
    }
  });

  it("mobil alt çubuk: en çok 5 yuva, yalnız o rolün merkezleri + Yeni + Menü; Yeni ve Menü birer kez", () => {
    for (const role of ROLES) {
      const layout = NAV_BY_ROLE[role];
      expect(layout.mobile.length, role).toBeLessThanOrEqual(5);
      const hubIds = new Set(layout.hubs.map((h) => h.id));
      for (const slot of layout.mobile) expect(slot === "new" || slot === "menu" || hubIds.has(slot), `${role} ${slot}`).toBe(true);
      expect(layout.mobile.filter((s) => s === "new").length).toBeLessThanOrEqual(1);
      expect(layout.mobile.filter((s) => s === "menu").length).toBeLessThanOrEqual(1);
    }
    expect(NAV_BY_ROLE.owner.mobile).toEqual(["bugun", "musteriler", "new", "ilanlar", "menu"]);
    // Plan 2.3: üst çubuktaki hamburger kalktı; danışmanın alt çubuğu da çekmeceyi "Menü" yuvasıyla açar.
    expect(NAV_BY_ROLE.advisor.mobile).toEqual(["bugun", "musteriler", "new", "ilanlar", "menu"]);
    expect(NAV_BY_ROLE.accounting.mobile).toEqual(["bugun", "finans", "raporlar", "menu"]);
    expect(NAV_BY_ROLE.call_center.mobile).toEqual(["bugun", "gelen-kutusu", "musteriler", "new", "menu"]);
  });

  it("Ayarlar yalnız yönetim rollerinde alt sabittir; Abonelik muhasebede satırdır, diğerlerinde alt sabit", () => {
    for (const role of ["owner", "gm", "branch_manager"] as const) expect(NAV_BY_ROLE[role].dock.map((h) => h.id)).toEqual(["ayarlar", "abonelik", "yardim"]);
    for (const role of ["advisor", "team_lead", "call_center"] as const) expect(NAV_BY_ROLE[role].dock.map((h) => h.id)).not.toContain("ayarlar");
    expect(NAV_BY_ROLE.accounting.hubs.map((h) => h.id)).toContain("abonelik");
    expect(NAV_BY_ROLE.accounting.dock.map((h) => h.id)).not.toContain("abonelik");
  });

  it("araçlar menü satırı değildir; Davet et yalnız yönetimde", () => {
    const tools = NAV_BY_ROLE.owner.tools;
    expect(tools).toEqual(expect.arrayContaining(["/app/degerleme", "/app/hesaplayici", "/app/asistan", "/app/mahalle-notlari", "/app/yabanci-satis", "/app/ag", "/app/acik-ev", "/app/projeler", "/app/buyume"]));
    for (const role of ROLES) {
      const rows = NAV_BY_ROLE[role].hubs.flatMap((h) => h.pages.map((p) => p.href));
      for (const t of tools) expect(rows, `${role} ${t}`).not.toContain(t);
    }
    expect(NAV_BY_ROLE.advisor.tools).not.toContain("/app/buyume");
  });

  it("bilinmeyen rolde en kısıtlı düzen (salt okunur) kullanılır", () => {
    expect(navLayoutFor("yok-boyle-rol")).toBe(NAV_BY_ROLE.readonly);
    expect(navLayoutFor(null)).toBe(NAV_BY_ROLE.readonly);
  });

  it("katalogdaki hiçbir sayfa hiçbir rolün menüsünde kaybolmaz: roller birleşimi tüm sayfaları kapsar (takma ad yok)", () => {
    const union = new Set(ROLES.flatMap((r) => layoutHrefs(NAV_BY_ROLE[r])));
    const missing = ALL_NAV_HREFS.filter((h) => !union.has(h));
    expect(missing).toEqual([]);
  });
});

describe("sade düzenler (plan 2.2, C03/C04)", () => {
  const SIMPLE_ROLES = Object.keys(SIMPLE_NAV_BY_ROLE) as AppRole[];

  it("hiçbir özellik silinmez: sade düzen tam düzenin her yolunu (merkez, Daha fazla, alt sabit, araç) taşır", () => {
    for (const role of SIMPLE_ROLES) {
      const simple = new Set(layoutHrefs(navLayoutFor(role, { simple: true })));
      const full = layoutHrefs(NAV_BY_ROLE[role]);
      const advisorDropped = new Set(["/app/tavsiyeler", "/app/kampanyalar", "/app/ilan-havuzu", "/app/ilan-kontrol", "/app/ayarlar/filigran", "/app/kiralama"]);
      // Danışman şeridinden yalnız yönetim sekmeleri çıkar (plan 2.2); onlar da Ctrl+K ve şerit yedeğiyle açılır.
      const missing = full.filter((h) => !simple.has(h) && !((role === "advisor" || role === "team_lead") && advisorDropped.has(h)));
      expect(missing, role).toEqual([]);
    }
  });

  it("hamburger yok: her rolün (tam ve sade) alt çubuğunda Menü yuvası var", () => {
    for (const role of ROLES) {
      expect(NAV_BY_ROLE[role].mobile, role).toContain("menu");
      expect(navLayoutFor(role, { simple: true }).mobile, role).toContain("menu");
    }
  });

  it("sade düzende aynı sayfa iki kez yoktur ve her yol katalogdadır", () => {
    for (const role of SIMPLE_ROLES) {
      const all = layoutHrefs(navLayoutFor(role, { simple: true }));
      expect(new Set(all).size, role).toBe(all.length);
      for (const h of all) expect(KNOWN.has(h), `${role} ${h}`).toBe(true);
    }
  });

  it("mobil alt çubuk: danışman Randevular ve Menü içerir; sahip Menü ile biter", () => {
    expect(navLayoutFor("advisor", { simple: true }).mobile).toEqual(["bugun", "musteriler", "new", "randevu-gorev", "menu"]);
    expect(navLayoutFor("owner", { simple: true }).mobile).toEqual(["bugun", "musteriler", "new", "ilanlar", "menu"]);
    const slots = hubNav(accessibleOf("advisor"), { role: "advisor", simple: true });
    expect(slots.mobile).toHaveLength(5);
    expect(slots.hubs.find((h) => h.id === "randevu-gorev")?.label).toBe("Randevular");
  });

  it("danışman şeritleri: Müşteriler (Müşteriler, Arama listesi, Gelen kutusu), Portföyler (Portföyler, Sahibinden ilanlar) temel", () => {
    const m = hubNav(accessibleOf("advisor"), { role: "advisor", simple: true });
    const core = (id: string) => m.hubs.find((h) => h.id === id)?.pages.filter((p) => p.core).map((p) => p.label);
    expect(core("musteriler")).toEqual(["Müşteriler", "Arama listesi", "Gelen kutusu"]);
    expect(core("ilanlar")).toEqual(["Portföyler", "Sahibinden ilanlar"]);
    expect(m.more.map((h) => h.label)).toEqual(["Anlaşmalarım", "Performansım"]);
  });

  it("sahip: Onaylar Bugün'de; Takımlar/Şubeler/Lig/TV yalnız büyük ofiste temel", () => {
    const small = hubNav(accessibleOf("owner"), { role: "owner", simple: true, smallOffice: true });
    const big = hubNav(accessibleOf("owner"), { role: "owner", simple: true, smallOffice: false });
    expect(small.hubs[0]?.pages.map((p) => p.href)).toContain("/app/onaylar");
    const coreOf = (m: typeof small) => m.hubs.find((h) => h.id === "ekibim")!.pages.filter((p) => p.core).map((p) => p.label);
    expect(coreOf(small)).toEqual(["Ekip", "Karne", "Danışman devri"]);
    expect(coreOf(big)).toEqual(expect.arrayContaining(["Takımlar", "Şubeler", "Lig", "TV ekranı"]));
  });

  it("sade düzeni olmayan roller (muhasebe, çağrı, salt okunur) tam düzeni kullanır", () => {
    for (const role of ["accounting", "call_center", "readonly"] as const) expect(navLayoutFor(role, { simple: true })).toBe(NAV_BY_ROLE[role]);
  });
});
