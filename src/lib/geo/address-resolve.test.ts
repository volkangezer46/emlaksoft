import { describe, expect, it } from "vitest";
import { addressWords, describeResolvedGeo, markedNeighborhoodCandidates, resolveAddressCore, type AddressIndex } from "./address-resolve";

const index: AddressIndex = {
  provinces: [
    { id: "p34", name: "İstanbul", plateCode: 34 },
    { id: "p06", name: "Ankara", plateCode: 6 },
    { id: "p35", name: "İzmir", plateCode: 35 },
    { id: "p16", name: "Bursa", plateCode: 16 },
  ],
  districts: [
    { id: "d-kadikoy", name: "Kadıköy", provinceId: "p34" },
    { id: "d-besiktas", name: "Beşiktaş", provinceId: "p34" },
    { id: "d-cankaya", name: "Çankaya", provinceId: "p06" },
    { id: "d-merkez-b", name: "Merkez", provinceId: "p16" },
    { id: "d-karsiyaka", name: "Karşıyaka", provinceId: "p35" },
    // Aynı adlı ilçe iki ilde (belirsizlik testi)
    { id: "d-osm-b", name: "Osmangazi", provinceId: "p16" },
    { id: "d-osm-x", name: "Osmangazi", provinceId: "p06" },
  ],
  neighborhoodsOf: async (districtId) =>
    districtId === "d-kadikoy"
      ? [
          { id: "n-caferaga", name: "Caferağa Mahallesi" },
          { id: "n-moda", name: "Moda" },
          { id: "n-fenerbahce", name: "Fenerbahçe" },
        ]
      : districtId === "d-cankaya"
        ? [{ id: "n-kizilay", name: "Kızılay" }]
        : [],
};

describe("addressWords / işaretli mahalle", () => {
  it("Türkçe katlar, noktalama ve büyük-küçük harfi siler", () => {
    expect(addressWords("CAFERAĞA Mah. Moda Cad. No:12 KADIKÖY/İSTANBUL")).toEqual(["caferaga", "mah", "moda", "cad", "no", "12", "kadikoy", "istanbul"]);
  });
  it("Mah./Mh. öncesindeki kelimeleri aday verir", () => {
    expect(markedNeighborhoodCandidates(["yeni", "caferaga", "mh", "x"]).map((c) => c.key)).toEqual(["yeni caferaga", "caferaga"]);
  });
});

describe("resolveAddressCore", () => {
  it("serbest metinden il + ilçe + işaretli mahalle (sokak adı mahalle sanılmaz)", async () => {
    const r = await resolveAddressCore({ text: "Caferağa Mah. Moda Cad. No:12 Kadıköy/İstanbul" }, index);
    expect(r.status).toBe("ok");
    expect(r.geo).toMatchObject({ provinceId: "p34", districtId: "d-kadikoy", neighborhoodId: "n-caferaga" });
    expect(describeResolvedGeo(r.geo)).toBe("Kadıköy / İstanbul · Caferağa Mahallesi");
  });

  it("işaretli mahallede yazım toleransı (Caferaga Mh.)", async () => {
    const r = await resolveAddressCore({ text: "caferga mh. kadıköy" }, index);
    expect(r.geo.neighborhoodId).toBe("n-caferaga");
    expect(r.geo.provinceId).toBe("p34"); // ilçeden il çıkarılır
  });

  it("işaretsiz tek mahalle adı tam eşleşmeyle bulunur", async () => {
    const r = await resolveAddressCore({ text: "Fenerbahçe Kadıköy" }, index);
    expect(r.geo.neighborhoodId).toBe("n-fenerbahce");
  });

  it("yapılandırılmış sütunlar: plaka, ilçe yazım hatası, mahalle", async () => {
    const r = await resolveAddressCore({ province: "34", district: "Kadikoyy", neighborhood: "moda" }, index);
    expect(r).toMatchObject({ status: "ok", geo: { provinceId: "p34", districtId: "d-kadikoy", neighborhoodId: "n-moda" } });
  });

  it("aynı adlı ilçe il bilinmeden çözülmez (tahmin yok)", async () => {
    const r = await resolveAddressCore({ text: "Osmangazi" }, index);
    expect(r.status).toBe("ambiguous");
    expect(r.geo.districtId).toBeNull();
    const withProvince = await resolveAddressCore({ text: "Osmangazi Bursa" }, index);
    expect(withProvince.geo.districtId).toBe("d-osm-b");
  });

  it("'Merkez' yalnız il biliniyorsa ilçe sayılır", async () => {
    expect((await resolveAddressCore({ text: "Merkez" }, index)).geo.districtId).toBeNull();
    expect((await resolveAddressCore({ text: "Merkez / Bursa" }, index)).geo.districtId).toBe("d-merkez-b");
  });

  it("yalnız il → partial; hiçbir şey → none", async () => {
    expect((await resolveAddressCore({ text: "Ankara" }, index)).status).toBe("partial");
    expect((await resolveAddressCore({ text: "Moda Caddesi No 5" }, index)).status).toBe("none");
    expect((await resolveAddressCore({}, index)).status).toBe("none");
  });

  it("verilen il ile çelişen ilçe o ilin dışında aranmaz", async () => {
    const r = await resolveAddressCore({ province: "İzmir", text: "Kadıköy" }, index);
    expect(r.geo.provinceId).toBe("p35");
    expect(r.geo.districtId).toBeNull();
    expect(r.status).toBe("partial");
  });
});
