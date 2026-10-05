import { describe, expect, it } from "vitest";
import type { AppModule } from "@/lib/permissions";
import { TOURS, getTour, resolveTourSteps, tourIdForRole } from "./product-tour-data";
import { TOUR_RESTART_HREF, tourHref } from "./product-tour-storage";

const ALL: AppModule[] = [
  "dashboard", "customers", "demands", "properties", "matching", "portals", "leak", "appointments", "calls",
  "commissions", "tasks", "team", "support", "settings", "billing", "reports", "valuation", "compliance",
  "campaigns", "contracts", "expenses", "offers", "targets", "open_house", "rentals", "projects", "network",
  "earnings_all",
];

describe("ürün turları veri sözleşmesi", () => {
  it("her tur tam yetkide 4-7 adım içerir", () => {
    for (const t of TOURS) {
      const steps = resolveTourSteps(t.id, { accessible: ALL, closed: [] });
      expect(steps.length, t.id).toBeGreaterThanOrEqual(4);
      expect(steps.length, t.id).toBeLessThanOrEqual(7);
    }
  });

  it("her adımın sayfası, en az bir seçicisi, başlığı ve açıklaması vardır", () => {
    for (const t of TOURS)
      for (const s of t.steps) {
        expect(s.path.startsWith("/app")).toBe(true);
        expect(s.selectors.length).toBeGreaterThan(0);
        expect(s.title.length).toBeGreaterThan(2);
        expect(s.desc.length).toBeGreaterThan(10);
      }
  });

  it("yetkisi olmayan sayfanın adımı elenir", () => {
    const steps = resolveTourSteps("danisman", { accessible: ["dashboard", "customers"], closed: [] });
    expect(steps.map((s) => s.path)).toContain("/app/musteriler");
    expect(steps.map((s) => s.path)).not.toContain("/app/randevular");
    expect(steps.map((s) => s.path)).not.toContain("/app/portfoyler");
  });

  it("ofisin kapattığı modülün adımı gösterilmez", () => {
    const open = resolveTourSteps("yonetici", { accessible: ALL, closed: [] }).map((s) => s.path);
    expect(open).toContain("/app/hedefler");
    const closed = resolveTourSteps("yonetici", { accessible: ALL, closed: ["team_perf"] }).map((s) => s.path);
    expect(closed).not.toContain("/app/hedefler");
    expect(closed).not.toContain("/app/lig");
    expect(closed.length).toBeGreaterThanOrEqual(3);
  });

  it("menüde olmayan sayfa (henüz eklenmemiş) elenir, ana ekran her zaman kalır", () => {
    const paths = resolveTourSteps("ofis-sahibi", { accessible: ALL, closed: [] }).map((s) => s.path);
    expect(paths).toContain("/app");
    for (const p of paths) expect(["/app", "/app/baslangic", "/app/ekip", "/app/ilan-havuzu", "/app/ofis-kontrol", "/app/ayarlar", "/app/abonelik"]).toContain(p);
    expect(resolveTourSteps("ofis-sahibi", { accessible: [], closed: [] }).map((s) => s.path)).toEqual(["/app"]);
  });

  it("muhasebe rolünün özel turu: komisyon ve abonelik adımları, yetkisi olanlara kalır", () => {
    expect(tourIdForRole("accounting")).toBe("muhasebe");
    const accessible: AppModule[] = ["dashboard", "customers", "commissions", "billing", "reports", "support"];
    const paths = resolveTourSteps("muhasebe", { accessible, closed: [], role: "accounting" }).map((s) => s.path);
    expect(paths).toEqual(["/app", "/app/komisyon", "/app/cuzdan", "/app/abonelik"]);
    expect(paths).not.toContain("/app/giderler");
    // Abonelik yetkisi yoksa o adım elenir.
    const noBilling = resolveTourSteps("muhasebe", { accessible: accessible.filter((m) => m !== "billing"), closed: [] }).map((s) => s.path);
    expect(noBilling).not.toContain("/app/abonelik");
  });

  it("rol -> tur eşlemesi; bilinmeyen rol danışman turu alır", () => {
    expect(tourIdForRole("owner")).toBe("ofis-sahibi");
    expect(tourIdForRole("gm")).toBe("yonetici");
    expect(tourIdForRole("branch_manager")).toBe("yonetici");
    expect(tourIdForRole("advisor")).toBe("danisman");
    expect(tourIdForRole("whatever")).toBe("danisman");
    expect(getTour("yok")).toBeNull();
  });

  it("yeniden başlatma adresleri", () => {
    expect(TOUR_RESTART_HREF).toBe("/app?tur=1");
    expect(tourHref("danisman")).toBe("/app?tur=danisman");
  });
});
