import { describe, expect, it } from "vitest";
import { ALL_NAV_HREFS, NAV_SECTIONS, resolveActiveNav, visibleSections } from "./nav-config";
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
  "/app", "/app/brifing", "/app/asistan",
  "/app/musteriler", "/app/akilli-listeler", "/app/tavsiyeler", "/app/talepler", "/app/eslestirme",
  "/app/anlasmalar", "/app/teklifler", "/app/sozlesmeler", "/app/gelen-kutusu", "/app/arama",
  "/app/randevular", "/app/gorevler",
  "/app/portfoyler", "/app/portfoyler/anahtarlar", "/app/portfoyler/sunumlar", "/app/portallar",
  "/app/acik-ev", "/app/kiralama", "/app/ag", "/app/projeler", "/app/degerleme", "/app/hesaplayici",
  "/app/yatirim", "/app/yabanci-satis",
  "/app/komisyon", "/app/cuzdan", "/app/giderler", "/app/aidat", "/app/kira-artis", "/app/abonelik",
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

  it("her yol bir kez ve /app altındadır", () => {
    expect(new Set(ALL_NAV_HREFS).size).toBe(ALL_NAV_HREFS.length);
    expect(ALL_NAV_HREFS.every((h) => h === "/app" || h.startsWith("/app/"))).toBe(true);
  });

  it("tüm modüller en az bir başlıkta erişilebilir", () => {
    const used = new Set(NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => [i.module, ...(i.tabs?.map((t) => t.module) ?? [])])));
    // `matching`: Talepler sayfasının "Eşleşme" sekmesi (sayfa içi sekme, ?sekme=eslesme); kendi izniyle gizlenir.
    const missing = ALL_MODULES.filter((m) => !used.has(m) && m !== "dashboard" && m !== "matching");
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
    expect(resolveActiveNav("/app/ayarlar/filigran", sections).href).toBe("/app/ayarlar");
    expect(resolveActiveNav("/app/portfoyler/anahtarlar", sections).href).toBe("/app/portfoyler/anahtarlar");
    expect(resolveActiveNav("/app/portfoyler/42", sections).href).toBe("/app/portfoyler");
  });

  it("taşınan alt sayfalar üst sayfalarına bağlıdır", () => {
    for (const path of MOVED_UNDER_PARENTS) {
      const res = resolveActiveNav(path, visibleSections(ALL_MODULES));
      expect(res.href, path).not.toBeNull();
    }
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
      "/app/raporlar", "/app/bolge-analizi", "/app/raporlar/talep-arz", "/app/raporlar/memnuniyet", "/app/franchise",
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
    expect(resolveActiveNav("/app/kira-artis", sections).href).toBe("/app/kiralama");
    expect(resolveActiveNav("/app/hesaplayici", sections).href).toBe("/app/hesaplayici");
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
