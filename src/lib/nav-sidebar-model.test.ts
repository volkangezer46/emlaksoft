import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hubNav, resolveActiveHub, resolveStripHub } from "./nav-config";
import { NAV_BY_ROLE } from "./nav-roles";
import { DEFAULT_MATRIX, canAccessModule, type AppModule, type AppRole } from "./permissions";

const ROLES = Object.keys(NAV_BY_ROLE) as AppRole[];
const accessibleOf = (role: AppRole) => (Object.keys(DEFAULT_MATRIX[role]) as AppModule[]).filter((m) => canAccessModule(role, m));
const ALL = Object.keys(DEFAULT_MATRIX.owner) as AppModule[];
const ids = (role: AppRole) => hubNav(accessibleOf(role), { role }).hubs.map((h) => h.id);
const labels = (role: AppRole) => hubNav(accessibleOf(role), { role }).hubs.map((h) => h.label);
const pagesOf = (role: AppRole, hubId: string) => hubNav(accessibleOf(role), { role }).hubs.find((h) => h.id === hubId)?.pages ?? [];

describe("yan menü görünür yüzeyi (hubNav)", () => {
  it("ofis sahibi / genel müdür / şube müdürü: 10 açık satır", () => {
    for (const role of ["owner", "gm", "branch_manager"] as const) {
      // Şube müdürünün muhasebe (expenses) yetkisi yok: Muhasebe satırı onun düzeninde yer almaz.
      const want = ["Bugün", "Müşteriler", "Portföy", "Havuz ve Atama", "Satış", "Komisyon", "Muhasebe", "Mülk Yönetimi", "Ekibim", "Raporlar"].filter((l) => role !== "branch_manager" || l !== "Muhasebe");
      expect(labels(role), role).toEqual(want);
      // Alt sabit satırlar rolün varsayılan yetkisine göre süzülür (şube müdüründe ayar/abonelik izni yoktur).
      const dock = hubNav(accessibleOf(role), { role }).dock.map((h) => h.label);
      expect(dock, role).toContain("Yardım");
      if (role !== "branch_manager") expect(dock, role).toEqual(["Ayarlar", "Abonelik", "Yardım"]);
    }
  });

  it("danışman / takım lideri: 6 satır (Bugün, Müşteriler, Portföy, Satış, Komisyonum, Ben)", () => {
    for (const role of ["advisor", "team_lead"] as const) expect(labels(role), role).toEqual(["Bugün", "Müşteriler", "Portföy", "Satış", "Komisyonum", "Ben"]);
    // Danışman kendi komisyonunu ayrı "Komisyonum" satırında görür.
    expect(pagesOf("advisor", "satis").map((p) => p.label)).toEqual(expect.arrayContaining(["Anlaşmalar"]));
    expect(pagesOf("advisor", "komisyon").map((p) => p.label)).toEqual(expect.arrayContaining(["Komisyonum", "Kazanç"]));
    expect(pagesOf("advisor", "ben").map((p) => p.href)).toEqual(["/app/performansim", "/app/hesabim"]);
    // Hedef izni olunca "Hedefim" da gelir.
    expect(hubNav([...accessibleOf("advisor"), "targets"], { role: "advisor" }).hubs.find((h) => h.id === "ben")!.pages.map((p) => p.label)).toEqual(["Performansım", "Hedefim", "Profilim"]);
  });

  it("Mülk Yönetimi: sayfa etiketi 'Kira takibi'; rentals modülü kapalıysa satır hiç görünmez", () => {
    expect(pagesOf("owner", "kiralama").map((p) => p.label)).toContain("Kira takibi");
    const closedNav = hubNav(accessibleOf("owner"), { role: "owner", closed: ["rentals"] });
    expect(closedNav.hubs.some((h) => h.label === "Mülk Yönetimi" && h.pages.some((p) => p.href === "/app/kiralama"))).toBe(false);
  });

  it("muhasebe 4 satır, çağrı merkezi 4 satır", () => {
    expect(labels("accounting")).toEqual(["Bugün", "Muhasebe", "Komisyon", "Mülk Yönetimi", "Raporlar", "Abonelik"]);
    expect(labels("call_center")).toEqual(["Bugün", "Gelen kutusu", "Müşteriler", "Randevu ve Görev"]);
    expect(pagesOf("accounting", "muhasebe").map((p) => p.label)).toContain("Gelir ve gider");
  });

  it("bulunabilirlik: Havuz ve Atama kendi satırında, Muhasebe kendi satırında, TV modu ve Ekip karnesi Ekibim'de", () => {
    const o = (id: string) => pagesOf("owner", id);
    expect(o("ilanlar").map((p) => [p.href, p.label])).toEqual(
      expect.arrayContaining([["/app/ilan-kontrol", "İlan Kontrol"], ["/app/portallar", "Portal ilanları"]]),
    );
    expect(o("muhasebe").map((p) => [p.href, p.label])).toEqual(expect.arrayContaining([["/app/giderler", "Gelir ve gider"]]));
    expect(o("kiralama").map((p) => p.href)).toEqual(expect.arrayContaining(["/app/kiralama", "/app/aidat"]));
    expect(o("komisyon").map((p) => [p.href, p.label])).toEqual(expect.arrayContaining([["/app/cuzdan", "Kazanç"]]));
    expect(o("ekibim").map((p) => [p.href, p.label])).toEqual(
      expect.arrayContaining([["/app/pano-tv", "TV modu"], ["/app/danisman-kpi", "Ekip karnesi"], ["/app/ekip", "Danışmanlar"], ["/app/ofis-kontrol", "Ofis Kontrol"]]),
    );
  });

  it("izinsiz sayfa merkezde görünmez; hiç sayfası olmayan satır gizlenir", () => {
    expect(hubNav([], { role: "owner" }).hubs).toEqual([]);
    const onlyTasks = hubNav(["tasks"], { role: "owner" });
    expect(onlyTasks.hubs.map((h) => h.id)).toEqual(["bugun"]);
    expect(onlyTasks.hubs[0]!.pages.map((p) => p.href)).toEqual(["/app/gorevler"]);
    expect(onlyTasks.hubs[0]!.href).toBe("/app/gorevler");
  });

  it("kapalı modül sayfayı merkezden ve araçlardan çıkarır", () => {
    const open = hubNav(ALL, { role: "owner" });
    const shut = hubNav(ALL, { role: "owner", closed: ["presentations", "keys", "projects"] });
    const pages = (m: typeof open) => m.hubs.flatMap((h) => h.pages.map((p) => p.href));
    expect(pages(open)).toEqual(expect.arrayContaining(["/app/portfoyler/sunumlar", "/app/portfoyler/anahtarlar"]));
    expect(pages(shut)).not.toContain("/app/portfoyler/sunumlar");
    expect(pages(shut)).not.toContain("/app/portfoyler/anahtarlar");
    expect(open.tools.map((t) => t.href)).toContain("/app/projeler");
    expect(shut.tools.map((t) => t.href)).not.toContain("/app/projeler");
  });

  it("tüm roller: görünen satırlar tekrarsız, mobil yuvalar görünen merkezlere bağlı", () => {
    for (const role of ROLES) {
      const m = hubNav(accessibleOf(role), { role });
      expect(new Set(ids(role)).size, role).toBe(m.hubs.length);
      const hubIds = new Set(m.hubs.map((h) => h.id));
      for (const slot of m.mobile) expect(slot === "new" || slot === "menu" || hubIds.has(slot), `${role} ${slot}`).toBe(true);
    }
  });
});

describe("etkin merkez çözümü ve tek sekme şeridi", () => {
  const owner = hubNav(ALL, { role: "owner" });
  it("detay ve alt sayfalar kendi merkezini etkin yapar", () => {
    expect(resolveActiveHub("/app", owner).hub?.id).toBe("bugun");
    expect(resolveActiveHub("/app/musteriler/abc", owner).hub?.id).toBe("musteriler");
    expect(resolveActiveHub("/app/akilli-listeler", owner).hub?.id).toBe("musteriler");
    expect(resolveActiveHub("/app/ilan-havuzu", owner).hub?.id).toBe("havuz");
    expect(resolveActiveHub("/app/portfoyler/42", owner).pageHref).toBe("/app/portfoyler");
    expect(resolveActiveHub("/app/pano-tv", owner)).toMatchObject({ pageHref: "/app/pano-tv" });
    expect(resolveActiveHub("/app/pano-tv", owner).hub?.id).toBe("ekibim");
    expect(resolveActiveHub("/app/ekip/devir", owner).hub?.id).toBe("ekibim");
    expect(resolveActiveHub("/app/cuzdan", owner).hub?.id).toBe("komisyon");
    expect(resolveActiveHub("/app/giderler", owner).pageHref).toBe("/app/giderler");
  });
  it("ek yol (Kapanış kayıpları) İlan Kontrol sayfasının merkezini etkin yapar", () => {
    const r = resolveActiveHub("/app/kayip-kacak", owner);
    expect(r.hub?.id).toBe("ilanlar");
    expect(r.pageHref).toBe("/app/ilan-kontrol");
  });
  it("alt sabit ve araç sayfaları ana satırları etkin yapmaz", () => {
    expect(resolveActiveHub("/app/ayarlar/cop-kutusu", owner)).toMatchObject({ inDock: true });
    expect(resolveActiveHub("/app/ayarlar/cop-kutusu", owner).hub?.id).toBe("ayarlar");
    expect(resolveActiveHub("/app/abonelik", owner).hub?.id).toBe("abonelik");
    const tool = resolveActiveHub("/app/degerleme", owner);
    expect(tool).toMatchObject({ inTools: true, hub: null });
    // En uzun yol kazanır: Etiketler Ayarlar'a değil Müşteriler'e bağlıdır.
    expect(resolveActiveHub("/app/ayarlar/etiketler", owner).hub?.id).toBe("musteriler");
  });
  it("şerit: rolün menüsünde olmayan sayfa ofis yöneticisi düzeninin merkezini kullanır", () => {
    const own = resolveStripHub("/app/kampanyalar", ALL, { role: "readonly" });
    expect(own.hub?.id).toBe("musteriler");
    expect(own.hub!.pages.length).toBeGreaterThan(1);
  });
  it("şerit sayfaları tek düz listedir; hiçbir sayfada ikinci şerit için alt liste yoktur", () => {
    for (const hub of owner.hubs) {
      const hrefs = hub.pages.map((p) => p.href);
      expect(new Set(hrefs).size, hub.id).toBe(hrefs.length);
    }
  });
});

describe("yan menü bileşen sözleşmesi (erişilebilirlik ve tek kaynak)", () => {
  const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  it("app yan menüsü Menüde ara, aria-expanded, Araçlar ve Menüyü düzenle içerir; alt liste ve '+N daha' yok", () => {
    const code = src("src/components/app/app-sidebar.tsx");
    expect(code).toContain("MenuSearchButton");
    expect(code).toContain("aria-expanded");
    expect(code).toContain("Araçlar");
    expect(code).toContain("Menüyü düzenle");
    expect(code).not.toContain("alt sayfaları");
    expect(code).not.toContain("+${");
    expect(code).not.toContain("Daha az göster");
    expect(code).not.toContain("itemSubTabs");
  });

  it("admin yan menüsü Hızlı erişim, Menüde ara, aria-expanded ve 'Diğer' içerir", () => {
    const code = src("src/components/admin/admin-sidebar.tsx");
    for (const needle of ["QuickAccessSection", "MenuSearchButton", "aria-expanded", "Diğer"]) expect(code, needle).toContain(needle);
    const kit = src("src/components/ui/console/nav-kit.tsx");
    expect(kit).toContain('"Escape"');
    expect(kit).toContain("aria-haspopup");
  });

  it("mobil alt çubuk rol bazlıdır, '+ Yeni' eylem sayfası ve 56 px hedefler vardır", () => {
    const code = src("src/components/app/app-sidebar.tsx");
    expect(code).toContain("nav.mobile");
    expect(code).toContain("MobileNewSheet");
    expect(code).toContain("min-h-14");
    expect(code).not.toContain("MOBILE_TAB_SECTIONS");
    const sheet = src("src/components/app/mobile-new-sheet.tsx");
    for (const needle of ["/app/musteriler/yeni", "/app/portfoyler/yeni", "/app/talepler/yeni", "/app/randevular/yeni", "/app/gorevler/yeni", "min-h-14"]) {
      expect(sheet, needle).toContain(needle);
    }
  });

  it("yan menü sunucu saatine bağlı değildir (Date.now/new Date yok)", () => {
    for (const f of ["src/components/app/app-sidebar.tsx", "src/components/app/mobile-new-sheet.tsx", "src/components/app/section-tabs.tsx", "src/components/admin/admin-sidebar.tsx", "src/components/ui/console/quick-access.tsx"]) {
      expect(src(f), f).not.toMatch(/Date\.now\(|new Date\(/);
    }
  });
});
