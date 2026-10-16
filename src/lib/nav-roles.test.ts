import { describe, expect, it } from "vitest";
import { ALL_NAV_HREFS, hubNav, PALETTE_ONLY_PAGES } from "./nav-config";
import { NAV_BUDGET, NAV_BY_ROLE, layoutHrefs, navLayoutFor } from "./nav-roles";
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

  it("satır sayıları (kurumsal referans, tek görünüm): ofis yönetimi 17, danışman 10, muhasebe 4, çağrı 5; bütçeyi aşmaz", () => {
    for (const role of ["owner", "gm", "branch_manager"] as const) expect(NAV_BY_ROLE[role].hubs, role).toHaveLength(17);
    for (const role of ["advisor", "team_lead"] as const) expect(NAV_BY_ROLE[role].hubs, role).toHaveLength(10);
    // SK10: muhasebede "Mülk yönetimi" (rentals) satırı yok; Aidatlar Finans merkezinde.
    expect(NAV_BY_ROLE.accounting.hubs).toHaveLength(4);
    expect(NAV_BY_ROLE.call_center.hubs).toHaveLength(5);
    for (const role of ["advisor", "team_lead"] as const) expect(NAV_BY_ROLE[role].hubs.length).toBeLessThanOrEqual(NAV_BUDGET.advisor);
    for (const role of ROLES) expect(NAV_BY_ROLE[role].hubs.length, role).toBeLessThanOrEqual(NAV_BUDGET.office);
  });

  it("ofis yönetimi menüsü referans sırasıyla; 'Yönetim' başlığı Ekibim'de, alt listeli satırlar İlanlar/Müşteriler/Finans/Raporlar/Pazarlama", () => {
    const owner = NAV_BY_ROLE.owner.hubs;
    expect(owner.map((h) => h.label)).toEqual([
      "Ana Sayfa",
      "İlanlar",
      "Müşteriler",
      "Portföy Yönetimi",
      "Sahibinden Takibi",
      "Randevular",
      "Görevler",
      "Teklifler",
      "Sözleşmeler",
      "Finans",
      "Mülk yönetimi",
      "Raporlar",
      "Ekibim",
      "Şubeler",
      "Pazarlama",
      "Entegrasyonlar",
      "Ayarlar",
    ]);
    expect(owner.filter((h) => h.heading).map((h) => `${h.heading}:${h.label}`)).toEqual(["Yönetim:Ekibim"]);
    expect(owner.filter((h) => h.sub).map((h) => h.label)).toEqual(["İlanlar", "Müşteriler", "Finans", "Raporlar", "Pazarlama"]);
    expect(NAV_BY_ROLE.advisor.hubs.map((h) => h.label)).toEqual([
      "Ana Sayfa",
      "Müşteriler",
      "Portföy",
      "Sahibinden Takibi",
      "Randevular",
      "Görevler",
      "Anlaşmalar",
      "Sözleşmeler",
      "Kazancım",
      "Performansım",
    ]);
  });

  it("Şubeler satırı yalnız şubeli ofiste görünür", () => {
    const without = hubNav(accessibleOf("owner"), { role: "owner" }).hubs.map((h) => h.id);
    const withBranches = hubNav(accessibleOf("owner"), { role: "owner", hasBranches: true }).hubs.map((h) => h.id);
    expect(without).not.toContain("subeler");
    expect(withBranches).toContain("subeler");
  });

  it("her satır varsayılan yetkiyle en az bir görünür sayfa içerir (ölü satır yok)", () => {
    for (const role of ROLES) {
      const live = new Set(hubNav(accessibleOf(role), { role, hasBranches: true }).hubs.map((h) => h.id));
      // Şube müdürünün varsayılan yetkisinde ayar izni yok: yalnız ayar sayfası taşıyan satırlar onda çıkmaz (kapı aynı).
      const settingsOnly = new Set(role === "branch_manager" ? ["entegrasyonlar", "ayarlar"] : []);
      for (const hub of NAV_BY_ROLE[role].hubs) if (!settingsOnly.has(hub.id)) expect(live.has(hub.id), `${role} ${hub.id}`).toBe(true);
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
    expect(NAV_BY_ROLE.advisor.mobile).toEqual(["bugun", "musteriler", "new", "randevular", "menu"]);
    expect(NAV_BY_ROLE.accounting.mobile).toEqual(["bugun", "finans", "raporlar", "menu"]);
    expect(NAV_BY_ROLE.call_center.mobile).toEqual(["bugun", "gelen-kutusu", "musteriler", "new", "menu"]);
  });

  it("Ayarlar yalnız yönetim rollerinde (Yönetim bölümünün son satırı); Abonelik muhasebede satırdır, diğerlerinde Paketim kartı", () => {
    for (const role of ["owner", "gm", "branch_manager"] as const) {
      expect(NAV_BY_ROLE[role].hubs.at(-1)?.id).toBe("ayarlar");
      expect(NAV_BY_ROLE[role].dock.map((h) => h.id)).toEqual(["abonelik", "yardim"]);
    }
    for (const role of ["advisor", "team_lead", "call_center"] as const) {
      expect(NAV_BY_ROLE[role].dock.map((h) => h.id)).not.toContain("ayarlar");
      expect(NAV_BY_ROLE[role].hubs.map((h) => h.id)).not.toContain("ayarlar");
    }
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

describe("tek görünüm (sahip kararı 2026-10-16)", () => {
  it("sade/dengeli düzen yoktur: rol başına TEK düzen; her rolün alt çubuğunda Menü yuvası var", () => {
    for (const role of ROLES) {
      expect(navLayoutFor(role)).toBe(NAV_BY_ROLE[role]);
      expect(NAV_BY_ROLE[role].mobile, role).toContain("menu");
    }
  });

  it("danışman şeritleri: Müşteriler (Müşteriler, Arama listesi, Gelen kutusu) ve Portföy temel sekmeleri", () => {
    const m = hubNav(accessibleOf("advisor"), { role: "advisor" });
    const core = (id: string) => m.hubs.find((h) => h.id === id)?.pages.filter((p) => p.core).map((p) => p.label);
    expect(core("musteriler")).toEqual(["Müşteriler", "Arama listesi", "Gelen kutusu"]);
    expect(core("ilanlar")).toEqual(["Portföyler", "Anahtarlar", "Sunumlar"]);
  });

  it("sahip: Onaylar Teklifler merkezinde; Takımlar/Lig/TV yalnız büyük ofiste temel", () => {
    const small = hubNav(accessibleOf("owner"), { role: "owner", smallOffice: true });
    const big = hubNav(accessibleOf("owner"), { role: "owner", smallOffice: false });
    expect(small.hubs.find((h) => h.id === "teklifler")?.pages.map((p) => p.href)).toContain("/app/onaylar");
    const coreOf = (m: typeof small) => m.hubs.find((h) => h.id === "ekibim")!.pages.filter((p) => p.core).map((p) => p.label);
    expect(coreOf(small)).toEqual(["Ekip", "Karne", "Hedefler", "Danışman devri"]);
    expect(coreOf(big)).toEqual(expect.arrayContaining(["Takımlar", "Lig", "TV ekranı"]));
  });

  it("Pazarlama ve Entegrasyonlar ayar sayfalarını taşır; Ayarlar şeridinde tekrar etmez", () => {
    const m = hubNav(accessibleOf("owner"), { role: "owner" });
    const hrefs = (id: string) => m.hubs.find((h) => h.id === id)?.pages.map((p) => p.href) ?? [];
    expect(hrefs("pazarlama")).toEqual(expect.arrayContaining(["/app/kampanyalar", "/app/otomasyonlar", "/app/ayarlar/vitrin"]));
    expect(hrefs("entegrasyonlar")).toEqual(["/app/ayarlar/entegrasyonlar", "/app/ayarlar/api-webhook"]);
    for (const h of [...hrefs("pazarlama"), ...hrefs("entegrasyonlar")]) expect(hrefs("ayarlar")).not.toContain(h);
  });
});
