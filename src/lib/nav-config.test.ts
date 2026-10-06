import { describe, expect, it } from "vitest";
import {
  ALL_NAV_HREFS,
  HIDDEN_APP_PAGES,
  MOBILE_TAB_SECTIONS,
  NAV_SECTIONS,
  NAV_SHORTCUTS,
  resolveActiveNav,
  visibleSections,
} from "./nav-config";
import type { AppModule } from "./permissions";

// Eski menüdeki 55 öğenin yolları: yeniden düzenleme hiçbir sayfayı menüden kaybettirmemeli.
// (Filigran, Mesaj Şablonları, Duyurular, Kartvizitim, İzinler bilinçli olarak üst sayfalarına
// taşındı: /app/ayarlar ve /app/ekip içinde bağlantılıdır.)
const MOVED_UNDER_PARENTS = [
  "/app/ayarlar/filigran",
  "/app/ayarlar/mesaj-sablonlari",
  "/app/ayarlar/duyurular",
  "/app/ekip/kartvizitim",
  "/app/ekip/izinler",
];
const LEGACY_HREFS = [
  "/app", "/app/asistan",
  "/app/musteriler", "/app/akilli-listeler", "/app/tavsiyeler", "/app/talepler", "/app/eslestirme",
  "/app/anlasmalar", "/app/teklifler", "/app/sozlesmeler", "/app/gelen-kutusu", "/app/arama",
  "/app/randevular", "/app/gorevler",
  "/app/portfoyler", "/app/portfoyler/anahtarlar", "/app/portfoyler/sunumlar", "/app/portallar",
  "/app/acik-ev", "/app/kiralama", "/app/ag", "/app/projeler", "/app/degerleme", "/app/hesaplayici",
  "/app/yatirim", "/app/yabanci-satis",
  "/app/komisyon", "/app/cuzdan", "/app/performansim", "/app/giderler", "/app/aidat", "/app/kira-artis", "/app/abonelik",
  "/app/raporlar", "/app/danisman-kpi", "/app/lig", "/app/pano-tv", "/app/hedefler",
  "/app/bolge-analizi", "/app/kayip-kacak", "/app/kayip-satis",
  "/app/ekip", "/app/otomasyonlar", "/app/kampanyalar", "/app/uyum", "/app/onaylar",
  "/app/belgeler", "/app/denetim", "/app/destek", "/app/ayarlar", "/app/ayarlar/is-akislari",
];

const ALL_MODULES: AppModule[] = [
  "dashboard", "customers", "demands", "matching", "commissions", "offers", "contracts", "calls",
  "appointments", "tasks", "properties", "portals", "open_house", "rentals", "network", "projects",
  "valuation", "expenses", "billing", "reports", "targets", "leak", "team", "settings", "campaigns",
  "compliance", "support",
];

describe("menü yapısı", () => {
  it("9 iş başlığı vardır", () => {
    expect(NAV_SECTIONS).toHaveLength(9);
    expect(new Set(NAV_SECTIONS.map((s) => s.id)).size).toBe(9);
  });

  it("eski menüdeki hiçbir sayfa kaybolmadı (taşınanlar hariç)", () => {
    const missing = LEGACY_HREFS.filter((h) => !ALL_NAV_HREFS.includes(h));
    expect(missing).toEqual([]);
  });

  it("Günlük Brifing menüden kalktı (içerik ana ekranın Bugün bloğunda; adres yönlendirir)", () => {
    expect(ALL_NAV_HREFS).not.toContain("/app/brifing");
  });

  it("her yol bir kez ve /app altındadır", () => {
    expect(new Set(ALL_NAV_HREFS).size).toBe(ALL_NAV_HREFS.length);
    expect(ALL_NAV_HREFS.every((h) => h === "/app" || h.startsWith("/app/"))).toBe(true);
  });

  it("tüm modüller en az bir başlıkta erişilebilir", () => {
    const used = new Set(NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => [i.module, ...(i.tabs?.map((t) => t.module) ?? [])])));
    // `matching`: Talepler sayfasının "Eşleşme" sekmesi (sayfa içi sekme, ?sekme=eslesme); kendi izniyle gizlenir.
    // `leak`: Kayıp-Kaçak Kalkanı İlan Kontrol alt gezinmesinin "Kapanış kayıpları" sekmesi (matchPaths; tek menü girişi).
    const missing = ALL_MODULES.filter((m) => !used.has(m) && m !== "dashboard" && m !== "matching" && m !== "leak");
    expect(missing).toEqual([]);
  });

  it("izin yoksa başlık gizlenir, varsa girişi ilk görünen sayfadır", () => {
    expect(visibleSections([])).toEqual([]);
    const only = visibleSections(["offers", "contracts"]);
    expect(only.map((s) => s.id)).toEqual(["anlasmalar"]);
    expect(only[0]!.href).toBe("/app/teklifler");
  });

  it("alt sayfalar ilgili öğeyi ve başlığı etkin yapar", () => {
    const sections = visibleSections(ALL_MODULES);
    expect(resolveActiveNav("/app", sections).href).toBe("/app");
    expect(resolveActiveNav("/app/musteriler/abc", sections).section?.id).toBe("musteriler");
    expect(resolveActiveNav("/app/ekip/izinler", sections).href).toBe("/app/ekip");
    expect(resolveActiveNav("/app/ayarlar/cop-kutusu", sections).href).toBe("/app/ayarlar");
    // Anahtar Takibi ve Sunumlar Portföyler öğesinin sekmesidir (yol aynı, menü öğesi Portföyler).
    expect(resolveActiveNav("/app/portfoyler/anahtarlar", sections).href).toBe("/app/portfoyler");
    expect(resolveActiveNav("/app/akilli-listeler", sections).href).toBe("/app/musteriler");
    expect(resolveActiveNav("/app/kayip-satis", sections).href).toBe("/app/anlasmalar");
    expect(resolveActiveNav("/app/portfoyler/42", sections).href).toBe("/app/portfoyler");
  });

  it("taşınan alt sayfalar üst sayfalarına bağlıdır", () => {
    for (const path of MOVED_UNDER_PARENTS) {
      const res = resolveActiveNav(path, visibleSections(ALL_MODULES));
      expect(res.href, path).not.toBeNull();
    }
  });
});

describe("mükerrer menü girişi yok (2026-10)", () => {
  const menu = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
  it("Kayıp-kaçak yalnız İlan Kontrol alt sekmesidir; sayfa yolu korunur ve İlan Kontrol öğesini etkin yapar", () => {
    expect(menu).not.toContain("/app/kayip-kacak");
    expect(ALL_NAV_HREFS).toContain("/app/kayip-kacak");
    expect(resolveActiveNav("/app/kayip-kacak", visibleSections(ALL_MODULES)).href).toBe("/app/ilan-kontrol");
  });
  it("TV panosu menü öğesi değil (ana ekran 'TV modu' düğmesi); Brifing menüde yok", () => {
    expect(menu).not.toContain("/app/pano-tv");
    expect(menu).not.toContain("/app/brifing");
    expect(resolveActiveNav("/app/pano-tv", visibleSections(ALL_MODULES)).href).toBe("/app/danisman-kpi");
  });
  it("Ekip performansı TEK öğe: Özet / Lig / Kıyas; Ekip Merkezi bu sekmeleri tekrar etmez", () => {
    const perf = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.label === "Ekip performansı");
    expect(perf?.tabs?.map((t) => t.label)).toEqual(["Özet", "Lig", "Kıyas"]);
    const ekip = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.href === "/app/ekip");
    for (const h of ["/app/lig", "/app/danisman-kpi", "/app/ekip/kiyas"]) expect(ekip?.tabs?.map((t) => t.href)).not.toContain(h);
  });
});

describe("sekmeli menü öğeleri", () => {
  const tabsOf = (mods: AppModule[], href: string) =>
    visibleSections(mods).flatMap((s) => s.items).find((i) => i.href === href)?.tabs?.map((t) => t.href);

  it("birleşen sayfalar menüde tek öğedir ama yolları sekme olarak durur", () => {
    const menu = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
    for (const gone of ["/app/cuzdan", "/app/onaylar", "/app/lig", "/app/kira-artis", "/app/yatirim"]) {
      expect(menu, gone).not.toContain(gone);
      expect(ALL_NAV_HREFS, gone).toContain(gone);
    }
  });

  it("sekmeler kendi modül yetkisiyle süzülür", () => {
    expect(tabsOf(ALL_MODULES, "/app/komisyon")).toEqual(["/app/komisyon", "/app/cuzdan", "/app/onaylar"]);
    expect(tabsOf(["rentals"], "/app/kiralama")).toEqual(["/app/kiralama"]);
    expect(tabsOf(["rentals", "valuation"], "/app/kiralama")).toEqual(["/app/kiralama", "/app/kira-artis"]);
    expect(tabsOf(["valuation"], "/app/kira-artis")).toEqual(["/app/kira-artis"]);
  });

  it("Raporlar ve Otomasyon tek öğe, yolları sabit sekmedir; arama/eşleştirme eski yol olarak durur", () => {
    expect(tabsOf(ALL_MODULES, "/app/raporlar")).toEqual([
      "/app/raporlar", "/app/bolge-analizi", "/app/raporlar/talep-arz", "/app/raporlar/memnuniyet", "/app/raporlar/lead-hizi", "/app/franchise", "/app/raporlar/kar-zarar",
    ]);
    expect(tabsOf(ALL_MODULES, "/app/otomasyonlar")).toEqual(["/app/otomasyonlar", "/app/ayarlar/is-akislari"]);
    const menu = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
    for (const gone of ["/app/arama", "/app/eslestirme", "/app/bolge-analizi", "/app/ayarlar/is-akislari"]) {
      expect(menu, gone).not.toContain(gone);
      expect(ALL_NAV_HREFS, gone).toContain(gone);
    }
  });

  it("sekme yolu sahibi menü öğesini etkin yapar", () => {
    const sections = visibleSections(ALL_MODULES);
    expect(resolveActiveNav("/app/cuzdan", sections).href).toBe("/app/komisyon");
    expect(resolveActiveNav("/app/onaylar", sections).href).toBe("/app/komisyon");
    expect(resolveActiveNav("/app/lig", sections).href).toBe("/app/danisman-kpi");
    expect(resolveActiveNav("/app/danisman-kpi", sections).href).toBe("/app/danisman-kpi");
    expect(resolveActiveNav("/app/ekip/kiyas", sections).href).toBe("/app/danisman-kpi");
    expect(resolveActiveNav("/app/ekip/devir", sections).href).toBe("/app/ekip");
    expect(resolveActiveNav("/app/kira-artis", sections).href).toBe("/app/kiralama");
    expect(resolveActiveNav("/app/hesaplayici", sections).href).toBe("/app/hesaplayici");
  });
});

describe("bilgi mimarisi 2026-10 (docs/design/MENU_IA_2026_10.md)", () => {
  const sectionOf = (href: string) => NAV_SECTIONS.find((s) => s.items.some((i) => i.href === href))?.id;
  const sections = visibleSections(ALL_MODULES);

  it("Bugün = günün işi: randevu ve görev; AI Asistan Araçlar'a; kurulum sihirbazı eylem akışı (menüde değil)", () => {
    expect(sectionOf("/app/randevular")).toBe("bugun");
    expect(sectionOf("/app/gorevler")).toBe("bugun");
    expect(sectionOf("/app/asistan")).toBe("araclar");
    expect(sectionOf("/app/baslangic")).toBeUndefined();
    expect(HIDDEN_APP_PAGES["/app/baslangic"]).toBeTruthy();
    expect(sectionOf("/app/gelen-kutusu")).toBe("iletisim");
    expect(sectionOf("/app/kampanyalar")).toBe("iletisim");
  });

  it("yetim sayfalar menüye bağlandı: Bildirimler, Mahalle notları, Ayarlar sekmeleri; İçe aktarma eylem (başlık düğmesi)", () => {
    expect(sectionOf("/app/bildirimler")).toBe("bugun");
    expect(sectionOf("/app/ice-aktarma")).toBeUndefined();
    expect(HIDDEN_APP_PAGES["/app/ice-aktarma"]).toBeTruthy();
    expect(sectionOf("/app/mahalle-notlari")).toBe("araclar");
    for (const h of ["/app/ayarlar/roller", "/app/ayarlar/yetkilendirme", "/app/ayarlar/moduller"]) {
      expect(ALL_NAV_HREFS, h).toContain(h);
      expect(resolveActiveNav(h, sections).href, h).toBe("/app/ayarlar");
    }
    // Ayarlar altındaki diğer sayfalar (sekme olmayan) yine Ayarlar öğesini etkin yapar.
    expect(resolveActiveNav("/app/ayarlar/cop-kutusu", sections).href).toBe("/app/ayarlar");
  });

  it("modüle ait ayar sayfası modülün 'Ayarlar' sekmesidir (yol sabit, tek sayfa); eylem sayfası menü öğesi olmaz", () => {
    const owners: Record<string, string> = {
      "/app/ayarlar/etiketler": "/app/musteriler",
      "/app/ayarlar/filigran": "/app/portfoyler",
      "/app/ayarlar/sozlesme-sablonlari": "/app/sozlesmeler",
      "/app/ayarlar/mesaj-sablonlari": "/app/kampanyalar",
      "/app/ayarlar/ai-kullanim": "/app/asistan",
      "/app/ayarlar/is-akislari": "/app/otomasyonlar",
    };
    for (const [page, owner] of Object.entries(owners)) {
      expect(resolveActiveNav(page, sections).href, page).toBe(owner);
      const tab = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.href === owner)?.tabs?.find((t) => t.href === page);
      expect(tab, page).toBeTruthy();
    }
    // Aynı ayar sayfası menüde iki öğenin sekmesi olamaz (tek giriş; ikinci yol Ayarlar dizini kartıdır).
    const tabHrefs = NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => (i.tabs ?? []).filter((t) => t.href !== i.href).map((t) => t.href)));
    expect(new Set(tabHrefs).size).toBe(tabHrefs.length);
    // Eylem sayfaları (/yeni, içe aktarma, kurulum sihirbazı) menü öğesi değildir.
    const itemHrefs = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
    for (const h of itemHrefs) expect(h, h).not.toMatch(/\/yeni$/);
    expect(itemHrefs).not.toContain("/app/ice-aktarma");
    expect(itemHrefs).not.toContain("/app/baslangic");
  });

  it("her öğenin ve ikincil sekmenin Türkçe açıklaması var; ekranda 'lead' geçmez", () => {
    for (const s of NAV_SECTIONS) {
      expect(s.description.length, s.id).toBeGreaterThan(8);
      for (const i of s.items) {
        expect(i.description.length, i.href).toBeGreaterThanOrEqual(12);
        expect(i.description.length, i.href).toBeLessThanOrEqual(90);
        expect(`${i.label} ${i.description} ${s.title}`, i.href).not.toMatch(/\blead\b/i);
        for (const t of i.tabs ?? []) {
          if (t.href === i.href) continue;
          expect(t.description, t.href).toBeTruthy();
          expect(`${t.label} ${t.description}`, t.href).not.toMatch(/\blead\b/i);
        }
      }
    }
  });

  it("'lead' eş anlamlısı yalnız aramada çalışır ve Talepler'e götürür", () => {
    const withLead = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => i.keywords?.includes("lead"));
    expect(withLead.map((i) => i.href)).toEqual(["/app/talepler"]);
  });

  it("g-kısayolları tek kaynaktan: benzersiz, 'g <harf>' biçiminde, hedefi menüde", () => {
    const keys = NAV_SHORTCUTS.map((k) => k.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(NAV_SHORTCUTS.map((k) => k.href)).size).toBe(keys.length);
    for (const k of NAV_SHORTCUTS) {
      expect(k.keys, k.href).toMatch(/^g [a-z]$/);
      const path = k.href.split("?")[0]!;
      expect(ALL_NAV_HREFS, k.href).toContain(path);
    }
    const byHref = Object.fromEntries(NAV_SHORTCUTS.map((k) => [k.href, k.keys]));
    expect(byHref["/app/musteriler"]).toBe("g m");
    expect(byHref["/app/portfoyler"]).toBe("g p");
    expect(byHref["/app"]).toBe("g h");
  });

  it("ileri düzey öğeler ayracın altında: her başlıkta en az bir temel öğe kalır", () => {
    for (const s of NAV_SECTIONS) {
      expect(s.items.some((i) => !i.advanced), s.id).toBe(true);
      // Çekirdek (sade görünüm) öğe ileri düzey olamaz: ikisi birbirini dışlar.
      for (const i of s.items) if (i.advanced) expect(i.tier, i.href).toBe("more");
    }
  });

  it("mobil alt sekmeler var olan başlıklara bağlıdır ve ofis sahibinde dördü de görünür", () => {
    const ids = new Set(NAV_SECTIONS.map((s) => s.id));
    for (const t of MOBILE_TAB_SECTIONS) expect(ids.has(t.id), t.id).toBe(true);
    const visible = new Set(sections.map((s) => s.id));
    for (const t of MOBILE_TAB_SECTIONS) expect(visible.has(t.id), t.id).toBe(true);
    expect(MOBILE_TAB_SECTIONS).toHaveLength(4);
  });

  it("gizli sayfa listesi menüyle çakışmaz", () => {
    for (const h of Object.keys(HIDDEN_APP_PAGES)) {
      expect(ALL_NAV_HREFS, h).not.toContain(h);
      expect(HIDDEN_APP_PAGES[h]!.length, h).toBeGreaterThan(10);
    }
  });
});

describe("menü ikonları", () => {
  it("başlık ve sayfa ikonlarının hiçbiri çakışmaz (sekmeler sahibi öğeyle aynı ikonu paylaşabilir)", () => {
    const labelsByIcon = new Map<unknown, string[]>();
    const add = (icon: unknown, label: string) => labelsByIcon.set(icon, [...(labelsByIcon.get(icon) ?? []), label]);
    for (const s of NAV_SECTIONS) {
      add(s.icon, `başlık:${s.title}`);
      for (const i of s.items) {
        add(i.icon, i.label);
        for (const t of i.tabs ?? []) if (t.icon !== i.icon) add(t.icon, `sekme:${t.label}`);
      }
    }
    const clashes = [...labelsByIcon.values()].filter((l) => l.length > 1);
    expect(clashes).toEqual([]);
  });
});
