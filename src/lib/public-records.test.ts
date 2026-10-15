import { describe, expect, it } from "vitest";
import { AFAD_TDTH_URL, DASK_URL, TKGM_PARSEL_SORGU_URL, parcelQueryText } from "./public-records";

describe("parcelQueryText", () => {
  it("il/ilçe/mahalle ada/parsel biçiminde üretir", () => {
    expect(
      parcelQueryText({ province: "İstanbul", district: "Kadıköy", neighborhood: "Moda", block: "123", lot: "45" }),
    ).toBe("İstanbul/Kadıköy/Moda 123/45");
  });

  it("eksik konum parçalarını atlar, boşlukları sadeleştirir", () => {
    expect(parcelQueryText({ province: " Ankara ", district: null, neighborhood: "", block: " 10 ", lot: "2" })).toBe(
      "Ankara 10/2",
    );
    expect(parcelQueryText({ block: "7", lot: "8" })).toBe("7/8");
  });

  it("ada veya parsel yoksa null", () => {
    expect(parcelQueryText({ province: "İzmir", block: "5", lot: null })).toBeNull();
    expect(parcelQueryText({ province: "İzmir", block: "  ", lot: "3" })).toBeNull();
  });

  it("resmi adresler https", () => {
    for (const url of [TKGM_PARSEL_SORGU_URL, AFAD_TDTH_URL, DASK_URL]) expect(url.startsWith("https://")).toBe(true);
  });
});
