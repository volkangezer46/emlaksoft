import { describe, expect, it } from "vitest";
import { DEFAULT_MATRIX, type AppModule, type AppRole } from "@/lib/permissions";
import { getPaletteRows } from "@/lib/palette-core";
import { homeVariantOf } from "./home-layout";
import { neYapmakChips, type ChipPermissions } from "./ne-yapmak-chips";

/**
 * SÖZLEŞME (B058 / B184-c): ana ekrandaki "Ne yapmak istiyorsun?" çipleri, rolün varsayılan izinleriyle paletin
 * KENDİ arama işlevinde (getPaletteRows) en az bir sonuç verir; yetkisi olmayan eylem çipi gösterilmez.
 */
const ROLES: AppRole[] = ["owner", "gm", "branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"];

function permsOf(role: AppRole): ChipPermissions {
  const row = DEFAULT_MATRIX[role] ?? {};
  const modules = Object.keys(row) as AppModule[];
  return {
    accessible: modules.filter((m) => (row[m] ?? []).includes("view")),
    creatable: modules.filter((m) => (row[m] ?? []).includes("create")),
  };
}

describe("ne yapmak çipleri — her rolde palette sonuç verir", () => {
  for (const role of ROLES) {
    it(`${role}: her çip en az 1 sonuç`, () => {
      const perms = permsOf(role);
      const chips = neYapmakChips(homeVariantOf(role), role === "owner", perms);
      expect(chips.length, role).toBeGreaterThan(0);
      for (const chip of chips) {
        expect(getPaletteRows(chip, perms).length, `${role} → "${chip}"`).toBeGreaterThan(0);
      }
    });
  }

  it('"müşteri ekle" müşteri oluşturabilen 6 rolde Yeni müşteri sayfasını önerir', () => {
    const creators: AppRole[] = ["owner", "gm", "branch_manager", "team_lead", "advisor", "call_center"];
    for (const role of creators) {
      const hrefs = getPaletteRows("müşteri ekle", permsOf(role)).map((r) => r.href);
      expect(hrefs, role).toContain("/app/musteriler/yeni");
    }
  });

  it("salt okunur rol oluşturma çipi görmez (müşteri ekle yok), göz atma çipi görür", () => {
    const chips = neYapmakChips(homeVariantOf("readonly"), false, permsOf("readonly"));
    expect(chips).not.toContain("müşteri ekle");
    expect(chips.length).toBeGreaterThanOrEqual(2);
  });

  it("izin verilmezse rol varyantının sabit listesi döner (geriye uyumlu imza)", () => {
    // Sade sözlük (C30): "ilan paylaş" -> "ilan gönder", "komisyonum" -> "kazancım"; çipler paletin kendi aramasında sonuç verir.
    expect(neYapmakChips("advisor", false)).toEqual(["müşteri ekle", "randevu", "ilan gönder", "kazancım"]);
  });

  it("eylem fiilleri ve yardım indeksi palette karşılık bulur", () => {
    const all = permsOf("owner");
    expect(getPaletteRows("ilan paylaş", all).map((r) => r.href)).toContain("/app/portfoyler/sunumlar/yeni");
    expect(getPaletteRows("bugün ne oldu", all).map((r) => r.href)).toContain("/app");
    expect(getPaletteRows("portala aktar", all).map((r) => r.href)).toContain("/app/ilan-kontrol");
    expect(getPaletteRows("bu ay ciro", all).map((r) => r.href)).toContain("/app/raporlar");
    expect(getPaletteRows("komisyon nasıl hesaplanır", all).some((r) => r.href.startsWith("/app/yardim?q="))).toBe(true);
  });
});
