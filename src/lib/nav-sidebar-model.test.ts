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
  it("ofis sahibi / genel müdür: 13 satır (öneri menüsü), Ayarlar · Yardım · Abonelik alt sabit; şube müdüründe Ayarlar yalnız izinli sekmeyle", () => {
    const want = ["Ana Sayfa", "Ajanda", "Onaylar", "Gelen kutusu", "Müşteriler", "Portföyler", "İlanlar", "Anlaşmalar", "Finans", "Mülk yönetimi", "Ekibim", "Raporlar", "Pazarlama"];
    for (const role of ["owner", "gm"] as const) {
      expect(labels(role), role).toEqual(want);
      expect(hubNav(accessibleOf(role), { role }).dock.map((h) => h.label), role).toEqual(["Ayarlar", "Yardım", "Abonelik"]);
    }
    // Şube müdürü: varsayılan yetkide genel ayar izni yok → Ayarlar yalnız izinli sayfasıyla (Etiketler) açılır; Entegrasyonlar yok.
    const bmDock = hubNav(accessibleOf("branch_manager"), { role: "branch_manager" }).dock;
    expect(bmDock.map((h) => h.label)).toContain("Yardım");
    expect(bmDock.find((h) => h.id === "ayarlar")?.pages.map((p) => p.href) ?? []).not.toContain("/app/ayarlar/entegrasyonlar");
  });

  // Sözlük (plan 2.6): "Komisyonum" → "Kazancım"; sekme adı "Komisyon".
  it("danışman / takım lideri: 8 satır; Kazancım ve Performansım (Karne, Lig) kişisel satırlar", () => {
    for (const role of ["advisor", "team_lead"] as const) {
      expect(labels(role), role).toEqual(["Ana Sayfa", "Ajandam", "Gelen kutusu", "Müşterilerim", "Portföylerim", "Anlaşmalarım", "Kazancım", "Performansım"]);
    }
    expect(pagesOf("advisor", "anlasmalar").map((p) => p.label)).toEqual(expect.arrayContaining(["Anlaşmalar", "Sözleşmeler", "Kiralar"]));
    // WP3: tek sayfa (iç sekmeler Kazancım · Kasam sayfadadır; "Kazancım" iki şeritte tekrar etmez).
    expect(pagesOf("advisor", "komisyon").map((p) => p.label)).toEqual(["Kazancım"]);
    // Danışmanın varsayılan yetkisinde hedef modülü yok: "Hedef" sekmesi düşer (izin verilirse görünür); Lig ve Profilim kalır.
    expect(pagesOf("advisor", "ben").map((p) => p.href)).toEqual(["/app/performansim", "/app/lig", "/app/hesabim"]);
  });

  it("Mülk yönetimi: sayfa etiketi 'Kiralar'; rentals modülü kapalıysa satır hiç görünmez", () => {
    expect(pagesOf("owner", "kiralama").map((p) => p.label)).toContain("Kiralar");
    const closedNav = hubNav(accessibleOf("owner"), { role: "owner", closed: ["rentals"] });
    expect(closedNav.hubs.some((h) => h.label === "Mülk yönetimi" && h.pages.some((p) => p.href === "/app/kiralama"))).toBe(false);
  });

  it("muhasebe 8 düz para satırı (Mülk yönetimi yok, Aidat kendi satırı), çağrı merkezi 4 satır", () => {
    // SK10: menü satırı sayfa kapısıyla aynı izinden süzülür; muhasebede kira (rentals) yok → "Mülk yönetimi" çıkmaz.
    expect(labels("accounting")).toEqual(["Ana Sayfa", "Hareketler", "Kasa ve banka", "Alacaklar", "Komisyon", "Faturalar", "Aidat", "Raporlar"]);
    const acc = hubNav(accessibleOf("accounting"), { role: "accounting" });
    const all = acc.hubs.flatMap((h) => h.pages.map((p) => p.href));
    expect(all).toEqual(expect.arrayContaining(["/app/finans", "/app/finans/komisyon", "/app/finans/tahsilat", "/app/finans/cari", "/app/aidat", "/app/raporlar?sekme=merkez"]));
    expect(pagesOf("accounting", "finans").map((p) => p.label)).toContain("Genel bakış");
    expect(acc.dock.map((h) => h.label)).toEqual(["Yardım", "Abonelik"]);
    expect(labels("call_center")).toEqual(["Ana Sayfa", "Gelen kutusu", "Ajanda", "Müşteriler"]);
  });

  it("bulunabilirlik: İlanlar & Portal (İlan kontrolü, Portföy dağıtımı, Sahibinden takibi), Finans, TV ve Karne Ekibim'de", () => {
    const o = (id: string) => [...hubNav(accessibleOf("owner"), { role: "owner" }).hubs, ...hubNav(accessibleOf("owner"), { role: "owner" }).dock].find((h) => h.id === id)?.pages ?? [];
    // İlan kontrolü TEK giriş: Portal ilanları ve Kapanış kayıpları onun alt gezinmesindedir (ayrı şerit sekmesi yok).
    expect(o("ilan-merkezi").map((p) => [p.href, p.label])).toEqual([["/app/ilan-kontrol", "İlan kontrolü"], ["/app/ilan-havuzu", "Portföy dağıtımı"], ["/app/portfoy-avi", "Sahibinden takibi"]]);
    expect(o("finans").map((p) => [p.href, p.label])).toEqual(expect.arrayContaining([["/app/finans", "Genel bakış"], ["/app/finans/komisyon", "Komisyon"], ["/app/finans/hakedis", "Danışman ödemeleri"]]));
    expect(o("finans").slice(0, 5).map((p) => p.label)).toEqual(["Genel bakış", "Hareketler", "Kasa ve banka", "Alacak ve borç", "Komisyon"]);
    expect(o("kiralama").map((p) => p.href)).toEqual(expect.arrayContaining(["/app/kiralama", "/app/aidat"]));
    expect(o("finans").map((p) => [p.href, p.label])).toEqual(expect.arrayContaining([["/app/kazancim", "Kazancım"]]));
    // Şube müdürü (muhasebe yetkisi yok): Finans satırı Komisyon'a açılır, yalnız komisyon/hakediş/kazanç sayfaları.
    const bm = hubNav(accessibleOf("branch_manager"), { role: "branch_manager" }).hubs.find((h) => h.id === "finans")!;
    expect(bm.href).toBe("/app/finans/komisyon");
    expect(bm.pages.map((p) => p.href)).toEqual(["/app/finans/komisyon", "/app/finans/hakedis", "/app/kazancim"]);
    expect(o("ekibim").map((p) => [p.href, p.label])).toEqual(
      expect.arrayContaining([["/app/pano-tv", "TV modu"], ["/app/danisman-kpi", "Karne"], ["/app/ekip", "Ekip"], ["/app/ofis-kontrol", "Ofis kontrolü"], ["/app/belgeler", "Ofis belgeleri"], ["/app/bildirimler?sekme=yonetim", "Duyurular"]]),
    );
    // Uyum (KVKK / İYS) ofis yükümlülüğüdür: Ekibim'de değil, Ayarlar'da Yetkiler ve Güvenlik'in yanında.
    expect(o("ekibim").map((p) => p.href)).not.toContain("/app/uyum");
    const ayarlar = o("ayarlar").map((p) => p.href);
    expect(ayarlar.indexOf("/app/uyum")).toBe(ayarlar.indexOf("/app/ayarlar/guvenlik") + 1);
    // Belgeler Ofis kontrolü yanında; denetim kaydı Ofis kontrolünün alt sayfasıdır (ayrı satır yok).
    const ekibim = o("ekibim").map((p) => p.href);
    expect(ekibim.indexOf("/app/belgeler")).toBe(ekibim.indexOf("/app/ofis-kontrol") + 1);
    expect(ekibim.some((h) => h.includes("denetim") || h.includes("/kayit"))).toBe(false);
  });

  it("izinsiz sayfa merkezde görünmez; hiç sayfası olmayan satır gizlenir", () => {
    expect(hubNav([], { role: "owner" }).hubs).toEqual([]);
    const onlyTasks = hubNav(["tasks"], { role: "owner" });
    expect(onlyTasks.hubs.map((h) => h.id)).toEqual(["ajanda"]);
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
    expect(resolveActiveHub("/app/ofis-kontrol/kayit", owner)).toMatchObject({ pageHref: "/app/ofis-kontrol" });
    expect(resolveActiveHub("/app/ilan-kontrol/portallar", owner)).toMatchObject({ pageHref: "/app/ilan-kontrol" });
    expect(resolveActiveHub("/app/ilan-havuzu", owner).hub?.id).toBe("ilan-merkezi");
    expect(resolveActiveHub("/app/portfoyler/42", owner).pageHref).toBe("/app/portfoyler");
    expect(resolveActiveHub("/app/pano-tv", owner)).toMatchObject({ pageHref: "/app/pano-tv" });
    expect(resolveActiveHub("/app/pano-tv", owner).hub?.id).toBe("ekibim");
    expect(resolveActiveHub("/app/ekip/devir", owner).hub?.id).toBe("ekibim");
    expect(resolveActiveHub("/app/kazancim", owner).hub?.id).toBe("finans");
    expect(resolveActiveHub("/app/kazancim/kasam", owner).pageHref).toBe("/app/kazancim");
    expect(resolveActiveHub("/app/finans/cari/abc", owner)).toMatchObject({ pageHref: "/app/finans/cari" });
    // Tam sayfa Gelir/Gider kaydı "Hareketler" sekmesinin altındadır (en uzun ön ek "Genel bakış" değil).
    expect(resolveActiveHub("/app/finans/kayit", owner)).toMatchObject({ pageHref: "/app/finans/hareketler" });
    expect(resolveActiveHub("/app/finans/kayit/abc", owner)).toMatchObject({ pageHref: "/app/finans/hareketler" });
    expect(resolveActiveHub("/app/finans", owner).pageHref).toBe("/app/finans");
  });
  it("ek yol (Kapanış kayıpları) İlan Kontrol sayfasının merkezini etkin yapar", () => {
    const r = resolveActiveHub("/app/ilan-kontrol/kapanis", owner);
    expect(r.hub?.id).toBe("ilan-merkezi");
    expect(r.pageHref).toBe("/app/ilan-kontrol");
  });
  it("Ayarlar sayfaları ve Abonelik alt sabiti etkin yapar; araç sayfaları ana satırları etkin yapmaz", () => {
    expect(resolveActiveHub("/app/ayarlar/cop-kutusu", owner)).toMatchObject({ inDock: true });
    expect(resolveActiveHub("/app/ayarlar/entegrasyonlar", owner).hub?.id).toBe("ayarlar");
    expect(resolveActiveHub("/app/uyum", owner).hub?.id).toBe("ayarlar");
    expect(resolveActiveHub("/app/ayarlar/cop-kutusu", owner).hub?.id).toBe("ayarlar");
    expect(resolveActiveHub("/app/abonelik", owner)).toMatchObject({ inDock: true });
    expect(resolveActiveHub("/app/abonelik", owner).hub?.id).toBe("abonelik");
    const tool = resolveActiveHub("/app/degerleme", owner);
    expect(tool).toMatchObject({ inTools: true, hub: null });
    // Etiketler ve Mesaj şablonları yalnız Ayarlar şeridinde (Araçlar listesinde değil).
    expect(resolveActiveHub("/app/ayarlar/etiketler", owner)).toMatchObject({ inDock: true, inTools: false });
    expect(resolveActiveHub("/app/ayarlar/mesaj-sablonlari", owner).hub?.id).toBe("ayarlar");
  });
  it("şerit: rolün menüsünde olmayan sayfa ofis yöneticisi düzeninin merkezini kullanır", () => {
    const own = resolveStripHub("/app/kampanyalar", ALL, { role: "readonly" });
    expect(own.hub?.id).toBe("pazarlama");
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
  it("app yan menüsü ofis kartı, aria-expanded, Araçlar, Menüyü düzenle ve Paketim kartı içerir; '+N daha' yok", () => {
    const code = src("src/components/app/app-sidebar.tsx");
    // Arama tek yerde: üst çubuk (Ctrl K). Yan menüde ikinci arama kutusu yok.
    expect(code).not.toContain("MenuSearchButton");
    expect(code).toContain("{officeCard}");
    expect(code).toContain("<PackageCard");
    expect(code).toContain("aria-expanded");
    expect(code).toContain("Araçlar");
    expect(code).toContain("Menüyü düzenle");
    expect(code).not.toContain("+${");
    expect(code).not.toContain("Daha az göster");
    expect(code).not.toContain("itemSubTabs");
  });

  it("grup başlıkları grup değişince çizilir; alt liste kendiliğinden açılmaz (şerit varken tekrar yok, ok + vurgu kalır)", () => {
    const code = src("src/components/app/app-sidebar.tsx");
    expect(code).toContain("hub.group !== mainHubs[i - 1]?.group");
    expect(code).toContain("const subOpen = (hub: NavHub) => stateIds.includes(`ac-${hub.id}`);");
    expect(code).not.toContain("kp-${hub.id}");
    expect(code).toContain('aria-current={isActive ? "page" : undefined}');
  });

  it("sayaç kuralı: kırmızı gecikmiş, turuncu karar, gri bilgi; rozet yalnız TEMEL sayfasının satırında (Anlaşmalar onay saymaz)", () => {
    const code = src("src/components/app/app-sidebar.tsx");
    expect(code).toContain('type Tone = "danger" | "warn" | "info"');
    expect(code).toContain("hub.pages.filter((p) => p.core)");
    // Gelen kutusu "yanıt bekliyor" tonu KAYNAĞINDA bilgi (gri): yan menüde ayrı eşleme listesi yok.
    expect(src("src/lib/inbox-badge.ts")).toContain('label: "yanıt bekliyor", tone: "info"');
    expect(code).not.toContain("INFO_BADGE_HREFS");
    // Telefonda sayaçlar geri: Bugün = acil toplam, Menü = çekmecedeki karar bekleyen iş sayısı.
    expect(code).toContain("<SlotCount");
    expect(code).toContain("{totalBadges > 99 ? \"99+\" : totalBadges}");
    const meta = src("src/lib/app-shell/nav-count-meta.ts");
    for (const href of ["/app/kiralama?durum=overdue", "/app/ilan-havuzu", "/app/randevular?gorunum=gun"]) expect(meta, href).toContain(href);
    // Menü sayaçları teklif/müşteri/canlı ilan TOPLAMI saymaz (satır adıyla çelişen sayı yok).
    const counts = src("src/lib/app-shell/nav-counts.ts");
    expect(counts).not.toContain('"/app/teklifler"');
    expect(counts).not.toContain('["/app/musteriler"');
    expect(counts).not.toContain('["/app/ilan-kontrol"');
  });

  it("üst çubukta kompakt konum yolu + 'Son güncelleme · Taze'; ofis skoru ofis kartında (yönetim rolleri)", () => {
    const layout = src("src/app/app/layout.tsx");
    expect(layout).toContain("<AppTopbarTrail");
    expect(layout).toContain("withScore={withScore}");
    const trail = src("src/components/app/app-topbar-trail.tsx");
    expect(trail).toContain('aria-label="Konum"');
    expect(trail).toContain("<TopbarFreshness />");
    const fresh = src("src/components/app/topbar-freshness.tsx");
    expect(fresh).toContain("Son güncelleme");
    expect(fresh).toContain('"Taze"');
    expect(fresh).not.toMatch(/Date\.now\(|new Date\(/);
    // /admin üst çubuğu aynı tazelik satırını kullanır (v4 ortak dil).
    expect(src("src/components/admin/admin-topbar.tsx")).toContain("<TopbarFreshness />");
    expect(src("src/components/app/office-card-slot.tsx")).toContain("getOfficeScoreCached");
    expect(src("src/components/app/office-card.tsx")).toContain("Skor {score.score}");
  });

  it("admin yan menüsü Hızlı erişim, Menüde ara ve satır içi grup akordeonu (aria-expanded) içerir; ortak 'Diğer' yok", () => {
    const code = src("src/components/admin/admin-sidebar.tsx");
    for (const needle of ["QuickAccessSection", "MenuSearchButton", "aria-expanded", "groups.map(renderGroup)"]) expect(code, needle).toContain(needle);
    expect(code).not.toContain("diger-acik");
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

describe("tek sekme şeridi: sayfa görünümleri merkez şeridinde (kabuk düzeni 2026-10-16)", () => {
  it("Eşleşme Müşteriler şeridinin, Rapor merkezi Raporlar şeridinin sekmesidir (sayfa içinde ikinci şerit yok)", () => {
    for (const role of ["owner", "advisor"] as const) {
      const hrefs = pagesOf(role, "musteriler").map((p) => p.href);
      expect(hrefs, role).toContain("/app/talepler?sekme=eslesme");
    }
    expect(pagesOf("owner", "raporlar").map((p) => [p.href, p.label])).toEqual(expect.arrayContaining([["/app/raporlar?sekme=merkez", "Rapor merkezi"]]));
    const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    expect(src("src/app/app/talepler/page.tsx")).not.toMatch(/SegmentTabs|PageTabs/);
    expect(src("src/app/app/raporlar/page.tsx")).not.toContain("ReportTabs");
    expect(src("src/app/app/gelen-kutusu/page.tsx")).toContain("PageViewSwitch");
    expect(src("src/app/app/anketler/survey-nav.tsx")).toContain("PageViewSwitch");
  });
  it("etkin sekme: adresteki ?sekme= şeritteki sorgulu sekmeyi seçer, karşılığı yoksa yol eşleşmesi kalır", async () => {
    const { activeTabHref } = await import("./nav-shell");
    const tabs = ["/app/musteriler", "/app/talepler", "/app/talepler?sekme=eslesme"];
    expect(activeTabHref("/app/talepler", "eslesme", tabs)).toBe("/app/talepler?sekme=eslesme");
    expect(activeTabHref("/app/talepler", null, tabs)).toBe("/app/talepler");
    expect(activeTabHref("/app/talepler", "yok", tabs)).toBe("/app/talepler");
    expect(activeTabHref(null, "eslesme", tabs)).toBeNull();
  });
  it("ikonlar: Sahibinden ilanlar Portföyler'den, Destek Yardım'dan ayrı ikondadır", async () => {
    const { NAV_SECTIONS } = await import("./nav-config");
    const tabs = NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => [i, ...(i.tabs ?? [])]));
    const icon = (href: string) => tabs.find((t) => t.href === href)?.icon;
    expect(icon("/app/portfoy-avi")).not.toBe(icon("/app/portfoyler"));
    expect(icon("/app/destek")).not.toBe(icon("/app/yardim"));
  });
  it("danışmanda açık ev (open_house) izni yoksa Araçlar'da Açık ev yoktur", () => {
    expect(canAccessModule("advisor", "open_house")).toBe(false);
    expect(hubNav(accessibleOf("advisor"), { role: "advisor" }).tools.map((t) => t.href)).not.toContain("/app/acik-ev");
    expect(hubNav(accessibleOf("owner"), { role: "owner" }).tools.map((t) => t.href)).toContain("/app/acik-ev");
  });
  it("ret ekranı gelinen sayfanın menü adını gösterir (modül adı değil)", async () => {
    const { navPageLabelFor } = await import("./nav-config");
    expect(navPageLabelFor("/app/belgeler")).toBe("Ofis belgeleri");
    expect(navPageLabelFor("/app/ekip/123")).toBe("Ekip");
    expect(navPageLabelFor("https://kotu.example/app/belgeler")).toBeNull();
    expect(navPageLabelFor("/app/olmayan-sayfa")).toBeNull();
    expect(navPageLabelFor(undefined)).toBeNull();
  });
});
