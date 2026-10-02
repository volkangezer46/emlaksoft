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
    const used = new Set(NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.module)));
    const missing = ALL_MODULES.filter((m) => !used.has(m) && m !== "dashboard");
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
