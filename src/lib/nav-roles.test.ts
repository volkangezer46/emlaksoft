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

  it("satır sayıları: ofis yönetimi 6, danışman 5, muhasebe 4, çağrı 4; bütçeyi aşmaz", () => {
    expect(NAV_BY_ROLE.owner.hubs).toHaveLength(6);
    expect(NAV_BY_ROLE.gm.hubs).toHaveLength(6);
    expect(NAV_BY_ROLE.branch_manager.hubs).toHaveLength(6);
    expect(NAV_BY_ROLE.advisor.hubs).toHaveLength(5);
    expect(NAV_BY_ROLE.team_lead.hubs).toHaveLength(5);
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
    expect(NAV_BY_ROLE.advisor.mobile).toEqual(["bugun", "musteriler", "new", "ilanlar", "ben"]);
    expect(NAV_BY_ROLE.accounting.mobile).toEqual(["bugun", "para", "raporlar", "menu"]);
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

  it("katalogdaki hiçbir sayfa hiçbir rolün menüsünde kaybolmaz: roller birleşimi tüm sayfaları kapsar (eski yollar ve ek yollar hariç)", () => {
    const union = new Set(ROLES.flatMap((r) => layoutHrefs(NAV_BY_ROLE[r])));
    // Eski (yönlendirmeli) yollar ve sekme çizilmeyen ek yollar sayfa değil, takma addır.
    const aliasLike = new Set(["/app/yatirim", "/app/arama", "/app/eslestirme", "/app/kayip-kacak"]);
    const missing = ALL_NAV_HREFS.filter((h) => !union.has(h) && !aliasLike.has(h));
    expect(missing).toEqual([]);
  });
});
