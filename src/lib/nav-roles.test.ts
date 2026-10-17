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

  it("satır sayıları (menü önerisi, tek görünüm): ofis yönetimi 13, danışman 8, muhasebe 8, çağrı 4; bütçeyi aşmaz", () => {
    for (const role of ["owner", "gm", "branch_manager"] as const) expect(NAV_BY_ROLE[role].hubs, role).toHaveLength(13);
    for (const role of ["advisor", "team_lead"] as const) expect(NAV_BY_ROLE[role].hubs, role).toHaveLength(8);
    // SK10: muhasebede "Mülk yönetimi" (rentals) satırı yok; Aidat kendi satırı.
    expect(NAV_BY_ROLE.accounting.hubs).toHaveLength(8);
    expect(NAV_BY_ROLE.call_center.hubs).toHaveLength(4);
    for (const role of ["advisor", "team_lead"] as const) expect(NAV_BY_ROLE[role].hubs.length).toBeLessThanOrEqual(NAV_BUDGET.advisor);
    for (const role of ROLES) expect(NAV_BY_ROLE[role].hubs.length, role).toBeLessThanOrEqual(NAV_BUDGET.office);
  });

  it("ofis yönetimi menüsü öneri sırasıyla; beş grup başlığı (CLAUDE.md adları: Finans, 'Para' değil)", () => {
    const owner = NAV_BY_ROLE.owner.hubs;
    expect(owner.map((h) => h.label)).toEqual([
      "Ana Sayfa",
      "Ajanda",
      "Onaylar",
      "Gelen kutusu",
      "Müşteriler",
      "Portföyler",
      "İlanlar",
      "Anlaşmalar",
      "Finans",
      "Mülk yönetimi",
      "Ekibim",
      "Raporlar",
      "Pazarlama",
    ]);
    const groups = owner.filter((h, i) => h.group && h.group !== owner[i - 1]?.group).map((h) => `${h.group}:${h.label}`);
    expect(groups).toEqual(["Günlük işler:Ajanda", "Müşteri ve portföy:Müşteriler", "Satış:Anlaşmalar", "Finans:Finans", "Yönetim:Ekibim"]);
    expect(owner.filter((h) => h.sub).map((h) => h.label)).toEqual(["Ajanda", "Müşteriler", "Portföyler", "İlanlar", "Anlaşmalar", "Finans", "Mülk yönetimi", "Ekibim", "Raporlar", "Pazarlama"]);
    expect(NAV_BY_ROLE.advisor.hubs.map((h) => h.label)).toEqual(["Ana Sayfa", "Ajandam", "Gelen kutusu", "Müşterilerim", "Portföylerim", "Anlaşmalarım", "Kazancım", "Performansım"]);
    const adv = NAV_BY_ROLE.advisor.hubs;
    expect(adv.filter((h, i) => h.group && h.group !== adv[i - 1]?.group).map((h) => h.group)).toEqual(["Günlük", "İşlerim", "Satış", "Ben"]);
  });

  it("Anlaşmalar kendi satırında (Tahta, Teklifler, Sözleşmeler, Şablonlar); Onaylar ayrı satır; Ajanda randevu + görev", () => {
    const hub = (id: string) => NAV_BY_ROLE.owner.hubs.find((h) => h.id === id)!;
    expect(hub("anlasmalar").pages.map((p) => [p.href, p.label])).toEqual([
      ["/app/anlasmalar", "Tahta"],
      ["/app/teklifler", "Teklifler"],
      ["/app/sozlesmeler", "Sözleşmeler"],
      ["/app/ayarlar/sozlesme-sablonlari", "Şablonlar"],
    ]);
    expect(hub("onaylar").pages.map((p) => p.href)).toEqual(["/app/onaylar"]);
    expect(hub("ajanda").pages.map((p) => p.href)).toEqual(["/app/randevular", "/app/gorevler"]);
    expect(hub("ilan-merkezi").pages.map((p) => p.href)).toEqual(["/app/ilan-kontrol", "/app/ilan-havuzu", "/app/portfoy-avi"]);
    // Onay sayfası satış satırında yoktur: "Anlaşmalar" sayacı onay saymaz.
    expect(hub("anlasmalar").pages.map((p) => p.href)).not.toContain("/app/onaylar");
  });

  it("Şubeler ayrı satır değil, Ekibim şeridinde büyük ofis (şubeli) sekmesidir", () => {
    const withBranches = hubNav(accessibleOf("owner"), { role: "owner", hasBranches: true, smallOffice: false });
    expect(withBranches.hubs.map((h) => h.id)).not.toContain("subeler");
    expect(withBranches.hubs.find((h) => h.id === "ekibim")!.pages.find((p) => p.href === "/app/ekip/subeler")?.core).toBe(true);
  });

  it("her satır varsayılan yetkiyle en az bir görünür sayfa içerir (ölü satır yok)", () => {
    for (const role of ROLES) {
      const live = new Set(hubNav(accessibleOf(role), { role, hasBranches: true }).hubs.map((h) => h.id));
      // Şube müdürünün varsayılan yetkisinde ayar izni yok: yalnız ayar sayfası taşıyan satırlar onda çıkmaz (kapı aynı).
      const settingsOnly = new Set<string>();
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
    // Danışman telefonu: Bugün · Müşteriler · + Yeni · Portföy · Menü (sayaçlar yuvalarda).
    expect(NAV_BY_ROLE.advisor.mobile).toEqual(["bugun", "musteriler", "new", "ilanlar", "menu"]);
    expect(NAV_BY_ROLE.advisor.hubs.find((h) => h.id === "bugun")?.short).toBe("Bugün");
    expect(NAV_BY_ROLE.advisor.hubs.find((h) => h.id === "ilanlar")?.short).toBe("Portföy");
    expect(NAV_BY_ROLE.accounting.mobile).toEqual(["bugun", "finans", "cari", "raporlar", "menu"]);
    expect(NAV_BY_ROLE.call_center.mobile).toEqual(["bugun", "gelen-kutusu", "new", "ajanda", "menu"]);
  });

  it("Ayarlar alt sabit bölümde (Entegrasyonlar ve Uyum içinde) yalnız yönetim rollerinde; Abonelik her rolde Paketim kartı", () => {
    for (const role of ["owner", "gm", "branch_manager"] as const) {
      expect(NAV_BY_ROLE[role].dock.map((h) => h.id)).toEqual(["ayarlar", "yardim", "abonelik"]);
      expect(NAV_BY_ROLE[role].hubs.map((h) => h.id)).not.toContain("ayarlar");
      const ayarlar = NAV_BY_ROLE[role].dock[0]!.pages.map((p) => p.href);
      expect(ayarlar).toEqual(expect.arrayContaining(["/app/ayarlar/entegrasyonlar", "/app/ayarlar/api-webhook", "/app/uyum"]));
    }
    for (const role of ["advisor", "team_lead", "call_center", "accounting"] as const) {
      expect(NAV_BY_ROLE[role].dock.map((h) => h.id)).not.toContain("ayarlar");
      expect(NAV_BY_ROLE[role].hubs.map((h) => h.id)).not.toContain("ayarlar");
      expect(NAV_BY_ROLE[role].dock.map((h) => h.id)).toContain("abonelik");
      expect(NAV_BY_ROLE[role].hubs.map((h) => h.id)).not.toContain("abonelik");
    }
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

  it("danışman şeritleri: Müşterilerim, Portföylerim (Sahibinden dahil) ve Anlaşmalarım temel sekmeleri", () => {
    const m = hubNav(accessibleOf("advisor"), { role: "advisor" });
    const core = (id: string) => m.hubs.find((h) => h.id === id)?.pages.filter((p) => p.core).map((p) => p.label);
    expect(core("musteriler")).toEqual(["Müşteriler", "Arama listesi", "Talepler", "Eşleşme"]);
    expect(core("ilanlar")).toEqual(["Portföyler", "Anahtarlar", "Sunumlar", "Sahibinden"]);
    // KAYBOLAN geri: danışman İlan kontrolü ve Kampanyalar'a menüden ulaşır ("Tümü" altında).
    const all = (id: string) => m.hubs.find((h) => h.id === id)?.pages.map((p) => p.href) ?? [];
    expect(all("ilanlar")).toContain("/app/ilan-kontrol");
    expect(all("musteriler")).toContain("/app/kampanyalar");
    expect(m.hubs.find((h) => h.id === "gelen-kutusu")?.pages.map((p) => p.href)).toEqual(["/app/gelen-kutusu"]);
  });

  it("sahip: Onaylar kendi satırında; Ekibim temel sekmeleri; Takımlar/Şubeler/Lig/TV yalnız büyük ofiste temel", () => {
    const small = hubNav(accessibleOf("owner"), { role: "owner", smallOffice: true });
    const big = hubNav(accessibleOf("owner"), { role: "owner", smallOffice: false });
    expect(small.hubs.find((h) => h.id === "onaylar")?.pages.map((p) => p.href)).toEqual(["/app/onaylar"]);
    const coreOf = (m: typeof small) => m.hubs.find((h) => h.id === "ekibim")!.pages.filter((p) => p.core).map((p) => p.label);
    expect(coreOf(small)).toEqual(["Ekip", "Karne", "Hedefler", "Devir", "Ofis kontrolü", "Duyurular"]);
    expect(coreOf(big)).toEqual(expect.arrayContaining(["Takımlar", "Şubeler", "Lig", "TV modu"]));
  });

  it("Pazarlama ayar sayfalarını taşır (Ayarlar şeridinde tekrar etmez); Entegrasyonlar Ayarlar'ın sekmesidir", () => {
    const m = hubNav(accessibleOf("owner"), { role: "owner" });
    const hrefs = (id: string) => [...m.hubs, ...m.dock].find((h) => h.id === id)?.pages.map((p) => p.href) ?? [];
    expect(hrefs("pazarlama")).toEqual(expect.arrayContaining(["/app/kampanyalar", "/app/otomasyonlar", "/app/ayarlar/vitrin", "/app/ayarlar/lead"]));
    for (const h of hrefs("pazarlama")) expect(hrefs("ayarlar")).not.toContain(h);
    expect(hrefs("ayarlar")).toEqual(expect.arrayContaining(["/app/ayarlar/entegrasyonlar", "/app/ayarlar/api-webhook"]));
    expect(m.hubs.map((h) => h.id)).not.toContain("entegrasyonlar");
  });
});
