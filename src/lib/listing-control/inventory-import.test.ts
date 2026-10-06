import { describe, expect, it } from "vitest";
import {
  buildInventoryBreakdown,
  parsePastedList,
  probeFromListingTitle,
  rankUnregistered,
  rowsFromObserved,
  toObservations,
  toSummary,
  type CrmListing,
  type InventoryRow,
  type PropertyForMatch,
} from "./inventory-import";
import { parseInventoryCsv } from "./adapters";

const crm = (over: Partial<CrmListing>): CrmListing => ({
  listingId: "l1",
  propertyId: "p1",
  propertyCode: "P-1",
  externalId: "1000000001",
  url: null,
  listPrice: 1_000_000,
  advisorId: "a1",
  advisorName: "Ayşe Yılmaz",
  ...over,
});
const row = (over: Partial<InventoryRow>): InventoryRow => ({ externalId: "1000000001", url: null, title: null, price: null, advisorName: null, status: "active", ...over });

describe("yapıştırılan liste", () => {
  it("URL ve ilan no karışık; tekilleşir; tanınmayan parça ayrı listelenir", () => {
    const r = parsePastedList(
      "sahibinden",
      "https://www.sahibinden.com/ilan/emlak-konut-satilik-1234567890/detay\n#1234567890, 2222222222 ; abc https://evil.example/ilan/x-3333333333/detay",
    );
    expect(r.rows.map((x) => x.externalId)).toEqual(["1234567890", "2222222222"]);
    expect(r.invalid).toEqual(["abc", "https://evil.example/ilan/x-3333333333/detay"]);
  });
  it("Excel'den başlıklı tablo yapıştırma (sekme ayraçlı) tablo olarak okunur", () => {
    const r = parsePastedList("sahibinden", "İlan No\tFiyat\tDurum\n1234567890\t1.250.000\tYayında\n2222222222\t900.000\tPasif\n");
    expect(r.rows).toEqual([
      { externalId: "1234567890", url: null, title: null, price: 1_250_000, advisorName: null, status: "active" },
      { externalId: "2222222222", url: null, title: null, price: 900_000, advisorName: null, status: "passive" },
    ]);
  });
  it("CSV satırları tekilleşir", () => {
    const obs = parseInventoryCsv("sahibinden", "İlan No;Fiyat\n111111;10\n111111;20\n222222;30\n", "2026-10-07T00:00:00.000Z");
    expect(rowsFromObserved(obs).map((r) => r.externalId)).toEqual(["111111", "222222"]);
  });
});

describe("envanter kırılımı (compareInventory üzerinden)", () => {
  const list: CrmListing[] = [
    crm({ listingId: "l1", externalId: "1000000001" }),
    crm({ listingId: "l2", propertyId: "p2", propertyCode: "P-2", externalId: "1000000002" }),
    crm({ listingId: "l3", propertyId: "p3", propertyCode: "P-3", externalId: "12ab" }),
    crm({ listingId: "l4", propertyId: "p4", propertyCode: "P-4", externalId: null }),
    crm({ listingId: "l5", propertyId: "p5", propertyCode: "P-5", externalId: "1000000005" }),
    crm({ listingId: "l6", propertyId: "p6", propertyCode: "P-6", externalId: "1000000006", listPrice: 2_000_000 }),
  ];
  const rows: InventoryRow[] = [
    row({ externalId: "1000000001", price: 1_000_000, advisorName: "Ayşe Yılmaz", title: "3+1" }),
    row({ externalId: "1000000005", status: "passive" }),
    row({ externalId: "1000000006", price: 2_200_000, advisorName: "Mehmet Demir" }),
    row({ externalId: "1999999999", title: "Kayıtsız 2+1 95 m²", price: 900_000 }),
  ];
  const b = buildInventoryBreakdown({ portal: "sahibinden", rows, crm: list, neverPublished: 4 });

  it("her CRM ilanı TEK kovaya düşer; kayıtsız portal ilanı ayrılır", () => {
    expect(b.matched.map((m) => m.crm.listingId)).toEqual(["l1", "l6"]);
    expect(b.removed.map((r) => [r.crm.listingId, r.reason])).toEqual([
      ["l2", "absent"],
      ["l5", "passive"],
    ]);
    expect(b.idInvalid.map((c) => c.listingId)).toEqual(["l3"]);
    expect(b.unverifiable.map((c) => c.listingId)).toEqual(["l4"]);
    expect(b.unregistered.map((r) => r.externalId)).toEqual(["1999999999"]);
    expect(b.otherAdvisor.map((o) => o.crm.listingId)).toEqual(["l6"]);
    expect(b.priceDiff).toEqual([{ crm: list[5], portalPrice: 2_200_000, deviationPercent: 10 }]);
    expect(b.neverPublished).toBe(4);
  });

  it("liste tam DEĞİLSE 'listede yok' gözlemi üretilmez; tamsa absent yazılır", () => {
    const partial = toObservations(b, false);
    expect(partial.every((o) => o.result === "present")).toBe(true);
    expect(partial.find((o) => o.listing_id === "l6")?.observed).toEqual({ price: 2_200_000, advisor_name: "Mehmet Demir", status: "active" });
    const full = toObservations(b, true);
    expect(full.filter((o) => o.result === "absent").map((o) => o.listing_id)).toEqual(["l2", "l5"]);
  });

  it("özet sayıları kırılımla birebir", () => {
    const s = toSummary(b);
    expect(s).toMatchObject({ total_rows: 4, matched: 2, removed: 2, unregistered: 1, never_published: 4, id_invalid: 1, unverifiable: 1, other_advisor: 1, price_diff: 1 });
    expect(s.detail.removed).toEqual(["P-2", "P-5"]);
  });
});

describe("kayıtsız ilan → portföy adayları", () => {
  const props: PropertyForMatch[] = [
    { id: "p9", code: "P-9", title: "Kadıköy Moda 2+1 95 m² daire", address: null, price: 905_000, sqm: 95, rooms: "2+1", block: null, lot: null, lat: null, lng: null, districtKey: null, advisorName: null },
    { id: "p8", code: "P-8", title: "Beykoz villa", address: null, price: 9_000_000, sqm: 400, rooms: "6+2", block: null, lot: null, lat: null, lng: null, districtKey: null, advisorName: null },
  ];
  it("başlıktan oda/m² çıkar", () => {
    expect(probeFromListingTitle("Satılık 3 + 1 120 m² daire")).toEqual({ rooms: "3+1", sqm: 120 });
    expect(probeFromListingTitle(null)).toEqual({ rooms: null, sqm: null });
  });
  it("güven yüzdesi ve sinyallerle sıralar; yalnız no'lu satırda aday yok (sahte skor yok)", () => {
    const [withTitle, bare] = rankUnregistered(
      [row({ externalId: "1999999999", title: "Moda 2+1 95 m² daire", price: 900_000 }), row({ externalId: "1888888888" })],
      props,
    );
    expect(withTitle.candidates[0]?.property_id).toBe("p9");
    expect(withTitle.top_score).toBeGreaterThanOrEqual(60);
    expect(withTitle.candidates[0]?.signals.map((s) => s.key)).toEqual(expect.arrayContaining(["price", "sqm", "rooms"]));
    expect(bare.candidates).toEqual([]);
    expect(bare.top_score).toBeNull();
  });
});
