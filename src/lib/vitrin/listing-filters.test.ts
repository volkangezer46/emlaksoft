import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  activeFilterChips,
  filterKey,
  filtersToQuery,
  hasAdvancedOnlyFilters,
  hasAnyFilter,
  listingHref,
  pageInfo,
  panelFilterCount,
  parseListingFilters,
  toSearchRpcFilters,
} from "./listing-filters";
import { parseFacets } from "./listing-search";

const D1 = "11111111-1111-4111-8111-111111111111";
const N1 = "22222222-2222-4222-8222-222222222222";

describe("vitrin süzgeçleri (PUB-1 / PUB-2)", () => {
  it("geçersiz değerler boş sayılır; ters aralık düzeltilir", () => {
    const f = parseListingFilters({
      tx: "hepsi",
      sirala: "rastgele",
      kat: "bodrum",
      il: "x",
      ilce: D1.toUpperCase(),
      min: "3.000.000",
      max: "1.000.000 ₺",
      m2min: "200",
      m2max: "80",
      yas: "abc",
      sayfa: "-2",
      esyali: "1",
      site: "on",
      kredi: "0",
    });
    expect(f.tx).toBe("");
    expect(f.sirala).toBe("");
    expect(f.kat).toBe("");
    expect(f.il).toBe("");
    expect(f.ilce).toBe(D1);
    expect([f.min, f.max]).toEqual([1_000_000, 3_000_000]);
    expect([f.m2min, f.m2max]).toEqual([80, 200]);
    expect(f.yasmax).toBeNull();
    expect(f.sayfa).toBe(1);
    expect([f.esyali, f.site, f.kredi]).toEqual([true, true, false]);
  });

  it("sıfır bina (yas=0) geçerli üst sınırdır; sayfa tavanı uygulanır", () => {
    expect(parseListingFilters({ yas: "0" }).yasmax).toBe(0);
    expect(parseListingFilters({ sayfa: "99999" }).sayfa).toBe(1);
    expect(parseListingFilters({ sayfa: "3" }).sayfa).toBe(3);
  });

  it("URL gidiş-dönüş kayıpsız", () => {
    const f = parseListingFilters({ tx: "kiralik", ilce: D1, mahalle: N1, m2min: "90", yas: "10", kat: "ara", kredi: "1", sirala: "m2-fiyat", sayfa: "2" });
    const back = parseListingFilters(Object.fromEntries(new URLSearchParams(filtersToQuery(f))));
    expect(back).toEqual(f);
    expect(filterKey(back)).toBe(filterKey(f));
  });

  it("süzgeç değişince sayfa 1'e, ilçe değişince mahalle temizlenir", () => {
    const f = parseListingFilters({ ilce: D1, mahalle: N1, sayfa: "4" });
    expect(listingHref("ofis", f, { tx: "satilik" })).toBe(`/vitrin/ofis?tx=satilik&ilce=${D1}&mahalle=${N1}`);
    expect(listingHref("ofis", f, { ilce: "" })).toBe("/vitrin/ofis");
    expect(listingHref("ofis", f, { sayfa: 5 })).toContain("sayfa=5");
    expect(listingHref("ofis", EMPTY_FILTERS)).toBe("/vitrin/ofis");
  });

  it("RPC girdisi migration anahtarlarıyla birebir", () => {
    const f = parseListingFilters({ tx: "satilik", q: "deniz", min: "1", oda: "3+1", tur: "Daire", ilce: D1, m2max: "150", yas: "5", kat: "en-ust", esyali: "1", site: "1", kredi: "1", sirala: "fiyat-artan" });
    expect(toSearchRpcFilters(f)).toEqual({
      tx: "satilik",
      q: "deniz",
      min: 1,
      rooms: "3+1",
      type: "Daire",
      district: D1,
      sqm_max: 150,
      age_max: 5,
      floor: "en-ust",
      furnished: true,
      in_site: true,
      credit: true,
      sort: "fiyat-artan",
    });
    expect(toSearchRpcFilters(EMPTY_FILTERS)).toEqual({});
    expect(hasAdvancedOnlyFilters(f)).toBe(true);
    expect(hasAdvancedOnlyFilters(parseListingFilters({ tx: "kiralik", oda: "2+1" }))).toBe(false);
  });

  it("çipler kendi süzgecini kaldıran bağlantıdır; sayılar doğru", () => {
    const f = parseListingFilters({ ilce: D1, min: "1000000", esyali: "1", sayfa: "2" });
    const chips = activeFilterChips("ofis", f, { provinces: [], districts: [{ id: D1, name: "Kadıköy" }], neighborhoods: [] });
    expect(chips.map((c) => c.label)).toEqual(["Kadıköy", "En az 1.000.000", "Eşyalı"]);
    expect(chips[0].href).toBe("/vitrin/ofis?min=1000000&esyali=1");
    expect(panelFilterCount(f)).toBe(3);
    expect(hasAnyFilter(EMPTY_FILTERS)).toBe(false);
    expect(hasAnyFilter({ ...EMPTY_FILTERS, sayfa: 3 })).toBe(false);
  });

  it("sayfa bilgisi", () => {
    expect(pageInfo(137, 1)).toEqual({ from: 1, to: 24, pages: 6 });
    expect(pageInfo(137, 6)).toEqual({ from: 121, to: 137, pages: 6 });
    expect(pageInfo(0, 1)).toEqual({ from: 0, to: 0, pages: 1 });
  });

  it("seçenek çıktısı güvenle tiplenir ve Türkçe sıralanır", () => {
    const facets = parseFacets({
      rooms: ["3+1", "", 4, "1+1"],
      types: ["Villa", "Daire"],
      provinces: [{ id: "p", name: "İzmir", count: 2 }, { name: "bozuk" }],
      districts: [{ id: "d2", name: "Üsküdar", provinceId: "p", count: 1 }, { id: "d1", name: "Çankaya", provinceId: "p", count: "3" }],
      neighborhoods: null,
    });
    expect(facets.rooms).toEqual(["1+1", "3+1"]);
    expect(facets.types).toEqual(["Daire", "Villa"]);
    expect(facets.provinces).toEqual([{ id: "p", name: "İzmir", count: 2 }]);
    expect(facets.districts.map((d) => [d.name, d.count])).toEqual([["Çankaya", 3], ["Üsküdar", 1]]);
    expect(facets.neighborhoods).toEqual([]);
    expect(parseFacets(null).rooms).toEqual([]);
  });
});
