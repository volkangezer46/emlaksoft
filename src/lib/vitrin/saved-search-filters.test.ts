import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS } from "@/lib/vitrin/listing-filters";
import {
  hasSavedSearchFilters,
  matchesSavedSearchFilters,
  sanitizeSavedSearchFilters,
  savedSearchFilterLabels,
  savedSearchFiltersFromListing,
} from "./saved-search-filters";

const N = "11111111-2222-4333-8444-555555555555";

describe("savedSearchFiltersFromListing", () => {
  it("yalnız dolu ek süzgeçleri alır; temel kriterler (fiyat, oda, il) dışarıda", () => {
    expect(savedSearchFiltersFromListing({ ...EMPTY_FILTERS, min: 1, oda: "3+1", il: N })).toEqual({});
    expect(
      savedSearchFiltersFromListing({ ...EMPTY_FILTERS, tur: "Daire", ilce: N, mahalle: N, m2min: 80, yasmax: 0, kat: "ara", esyali: true, site: true, kredi: true }),
    ).toEqual({ type: "Daire", neighborhood: N, sqm_min: 80, age_max: 0, floor: "ara", furnished: true, in_site: true, credit: true });
  });

  it("ilçesiz mahalle yazılmaz", () => {
    expect(savedSearchFiltersFromListing({ ...EMPTY_FILTERS, mahalle: N })).toEqual({});
  });
});

describe("sanitizeSavedSearchFilters", () => {
  it("geçersiz girdi boş", () => {
    expect(sanitizeSavedSearchFilters(null)).toEqual({});
    expect(sanitizeSavedSearchFilters([1])).toEqual({});
    expect(sanitizeSavedSearchFilters("x")).toEqual({});
  });

  it("bilinmeyen anahtar ve geçersiz değer düşer; ters m² düzeltilir", () => {
    expect(
      sanitizeSavedSearchFilters({
        type: "  Villa ",
        neighborhood: "not-a-uuid",
        sqm_min: "200",
        sqm_max: 100,
        age_max: -1,
        floor: "çatı",
        furnished: "true",
        in_site: false,
        evil: "x",
      }),
    ).toEqual({ type: "Villa", sqm_min: 100, sqm_max: 200, furnished: true });
    expect(hasSavedSearchFilters({})).toBe(false);
  });
});

describe("matchesSavedSearchFilters", () => {
  const prop = {
    property_type: "Daire",
    neighborhood_id: N,
    features: { gross_sqm: "120", floor: 3, total_floors: 5, building_age: "4", furnished: "Eşyalı", in_site: "Evet", credit_eligible: true },
  };

  it("süzgeçsiz arama her ilana uyar", () => {
    expect(matchesSavedSearchFilters({}, { features: null })).toBe(true);
  });

  it("RPC kurallarıyla aynı: m², yaş, kat, eşyalı, site, kredi, tür, mahalle", () => {
    expect(
      matchesSavedSearchFilters(
        { type: "Daire", neighborhood: N, sqm_min: 100, sqm_max: 150, age_max: 5, floor: "ara", furnished: true, in_site: true, credit: true },
        prop,
      ),
    ).toBe(true);
    expect(matchesSavedSearchFilters({ sqm_min: 130 }, prop)).toBe(false);
    expect(matchesSavedSearchFilters({ age_max: 0 }, prop)).toBe(false);
    expect(matchesSavedSearchFilters({ floor: "en-ust" }, prop)).toBe(false);
    expect(matchesSavedSearchFilters({ floor: "giris" }, prop)).toBe(false);
    expect(matchesSavedSearchFilters({ type: "Villa" }, prop)).toBe(false);
  });

  it("m² bilgisi olmayan ilan m² süzgecine uymaz; brüt yoksa net (sqm) kullanılır", () => {
    expect(matchesSavedSearchFilters({ sqm_min: 50 }, { features: {} })).toBe(false);
    expect(matchesSavedSearchFilters({ sqm_min: 50 }, { features: { sqm: 60 } })).toBe(true);
  });

  it("toplam katı bilinmeyen ilan 'ara kat' sayılır, 'en üst' sayılmaz", () => {
    expect(matchesSavedSearchFilters({ floor: "ara" }, { features: { floor: 2 } })).toBe(true);
    expect(matchesSavedSearchFilters({ floor: "en-ust" }, { features: { floor: 2 } })).toBe(false);
  });
});

describe("savedSearchFilterLabels", () => {
  it("kısa Türkçe etiketler", () => {
    expect(savedSearchFilterLabels({ type: "Daire", neighborhood: N, sqm_min: 80, sqm_max: 120, age_max: 0, furnished: true }, "Moda")).toEqual([
      "Daire",
      "Moda",
      "80–120 m²",
      "Sıfır bina",
      "Eşyalı",
    ]);
  });
});
