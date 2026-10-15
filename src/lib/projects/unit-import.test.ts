import { describe, expect, it } from "vitest";
import { mapUnitImportHeaders, parseUnitPriceList, sanitizeImportRows } from "./unit-import";
import { groupBuyers, matchableUnits, unitToMatchProperty } from "./unit-match";
import { scoreDemandMatches } from "@/lib/match-candidates";
import type { MatchDemand } from "@/lib/matching";

describe("parseUnitPriceList", () => {
  it("Excel'den yapıştırılan (sekmeli) Türkçe fiyat listesi", () => {
    const text = "Blok\tKat\tDaire No\tOda Sayısı\tBrüt m²\tSatış Fiyatı\nA Blok\tZemin\t1\t2+1\t95,5\t4.250.000 TL\nA\t3\t12\t3+1\t140\t6.900.000,00";
    const r = parseUnitPriceList(text);
    expect(r.missingUnitNo).toBe(false);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, block: "A", floor: 0, unit_no: "1", rooms: "2+1", gross_m2: 95.5, list_price: 4_250_000 },
      { line: 3, block: "A", floor: 3, unit_no: "12", rooms: "3+1", gross_m2: 140, list_price: 6_900_000 },
    ]);
  });

  it("noktalı virgüllü CSV; bozuk fiyat ve tekrar eden daire satır hatası olur", () => {
    const r = parseUnitPriceList("daire;fiyat\n1;abc\n2;1.000.000\n2;1.100.000");
    expect(r.rows.map((x) => x.unit_no)).toEqual(["2"]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 4]);
  });

  it("daire no kolonu yoksa hiç satır üretmez", () => {
    expect(parseUnitPriceList("oda;fiyat\n2+1;100").missingUnitNo).toBe(true);
  });

  it("başlık eşlemesi özgül ipucunu önce alır", () => {
    expect(mapUnitImportHeaders(["Blok", "Kat", "Daire No", "Brüt Alan", "Liste Fiyatı"])).toEqual({
      block: 0,
      floor: 1,
      unit_no: 2,
      gross_m2: 3,
      list_price: 4,
    });
  });

  it("sunucu süzgeci tip ve aralık dışını atar", () => {
    expect(
      sanitizeImportRows([{ unit_no: " 5 ", floor: 2.7, list_price: -1, gross_m2: "90", block: 3 }, { unit_no: "" }, "x"]),
    ).toEqual([{ block: null, floor: 2, unit_no: "5", rooms: null, gross_m2: null, list_price: null }]);
  });
});

describe("proje daireleri ↔ alıcı talepleri", () => {
  const project = { id: "p1", name: "Deniz Evleri", province_id: "il", district_id: "ilce" };
  const unit = (id: string, rooms: string, price: number, status = "available") => ({
    id, block: "A", floor: 2, unit_no: id, rooms, gross_m2: 120, list_price: price, status,
  });
  const demand = (id: string, over: Partial<MatchDemand> = {}): MatchDemand => ({
    id, transaction_type: "Satılık", property_type: "Daire", province_id: "il", district_id: "ilce",
    budget_min: null, budget_max: 8_000_000, rooms: "3+1", min_sqm: 100, urgency: null, status: "active", ...over,
  });

  it("yalnız müsait daire aday olur; satılık daire biçimine çevrilir", () => {
    const props = matchableUnits(project, [unit("1", "3+1", 7_000_000), unit("2", "3+1", 7_000_000, "sold")]);
    expect(props).toHaveLength(1);
    expect(unitToMatchProperty(project, unit("1", "3+1", 7_000_000))).toMatchObject({
      transaction_type: "Satılık", property_type: "Daire", district_id: "ilce", features: { rooms: "3+1", sqm: 120 },
    });
  });

  it("talep başına gruplanır; bütçe ve oda uyan daire önde", () => {
    const props = matchableUnits(project, [unit("1", "3+1", 7_000_000), unit("2", "2+1", 5_000_000), unit("3", "3+1", 20_000_000)]);
    const scored = scoreDemandMatches({ demands: [demand("d1"), demand("d2", { district_id: "baska", province_id: "baska-il" })], properties: props, customerOf: () => null });
    const buyers = groupBuyers(scored.pairs);
    expect(buyers[0]!.demand.id).toBe("d1");
    expect(buyers[0]!.units[0]!.id).toBe("1");
    expect(buyers[0]!.best).toBeGreaterThanOrEqual(75);
  });
});
