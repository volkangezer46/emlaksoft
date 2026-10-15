import { describe, expect, it } from "vitest";
import {
  demandsSimilar,
  groupPropertyDuplicates,
  propertyCompleteness,
  emailLookupKey,
  phoneLookupVariants,
  propertyMatchReasons,
  scopeHit,
  tokenSimilarity,
  type DuplicateHit,
  type PropertyProbe,
} from "./duplicate-match";

describe("phoneLookupVariants", () => {
  it("TR numarasının tüm yazımlarını üretir", () => {
    const v = phoneLookupVariants("0532 111 22 33");
    expect(v).toEqual(expect.arrayContaining(["05321112233", "+905321112233", "5321112233", "905321112233"]));
  });
  it("farklı girişler aynı kümeyi verir", () => {
    expect(phoneLookupVariants("+90 532 111 22 33").sort()).toEqual(phoneLookupVariants("05321112233").sort());
  });
  it("yabancı numara + ve plus'sız", () => {
    const v = phoneLookupVariants("+49 151 23456789");
    expect(v).toContain("+4915123456789");
    expect(v).toContain("4915123456789");
  });
  it("geçersiz girişte boş", () => {
    expect(phoneLookupVariants("abc")).toEqual([]);
    expect(phoneLookupVariants("")).toEqual([]);
  });
});

describe("emailLookupKey", () => {
  it("küçük harf ve kırpma", () => expect(emailLookupKey("  Ali@Ornek.COM ")).toBe("ali@ornek.com"));
  it("geçersiz -> boş", () => expect(emailLookupKey("ali@")).toBe(""));
});

describe("tokenSimilarity", () => {
  it("aksan/büyük harf farkını yok sayar", () => {
    expect(tokenSimilarity("Çankaya Kızılay 3+1", "cankaya kizilay 3 1")).toBe(1);
  });
  it("farklı metin düşük", () => expect(tokenSimilarity("a b c", "x y z")).toBe(0));
});

const probe: PropertyProbe = {
  title: "Kadıköy Moda 3+1 Satılık Daire",
  address: "Moda Caddesi No 12 Daire 4",
  block: "123",
  lot: "45",
  propertyType: "Daire",
  transactionType: "Satılık",
  districtId: "d1",
  neighborhoodId: "n1",
};
const cand = {
  title: "Başka",
  address_line: null,
  parcel_block: null,
  parcel_lot: null,
  property_type: "Daire",
  transaction_type: "Satılık",
  district_id: "d1",
  neighborhood_id: "n1",
};

describe("propertyMatchReasons", () => {
  it("ada+parsel aynı mahallede eşleşir", () => {
    expect(propertyMatchReasons(probe, { ...cand, parcel_block: "123", parcel_lot: "45" })).toContain("ada-parsel");
  });
  it("aynı ada/parsel farklı mahallede eşleşmez", () => {
    expect(propertyMatchReasons(probe, { ...cand, parcel_block: "123", parcel_lot: "45", neighborhood_id: "n2" })).toEqual([]);
  });
  it("yalnız ada eşleşirse eşleşmez", () => {
    expect(propertyMatchReasons(probe, { ...cand, parcel_block: "123", parcel_lot: "99" })).toEqual([]);
  });
  it("adres benzerliği", () => {
    expect(propertyMatchReasons(probe, { ...cand, address_line: "moda caddesi no 12 daire 4" })).toContain("adres");
  });
  it("başlık+mahalle+tür", () => {
    expect(propertyMatchReasons(probe, { ...cand, title: "Kadıköy Moda 3+1 satılık daire" })).toContain("baslik");
  });
  it("tür farklıysa başlık eşleşmez", () => {
    expect(propertyMatchReasons(probe, { ...cand, title: "Kadıköy Moda 3+1 satılık daire", property_type: "Villa" })).toEqual([]);
  });
  it("kısa başlık tek başına eşleşme sayılmaz", () => {
    expect(propertyMatchReasons({ ...probe, title: "Daire" }, { ...cand, title: "Daire" })).toEqual([]);
  });
});

describe("demandsSimilar", () => {
  const p = { transactionType: "Satılık", propertyType: "Daire", districtId: "d1" };
  it("aynı işlem+tür+ilçe", () =>
    expect(demandsSimilar(p, { transaction_type: "Satılık", property_type: "Daire", district_id: "d1" })).toBe(true));
  it("farklı işlem türü", () =>
    expect(demandsSimilar(p, { transaction_type: "Kiralık", property_type: "Daire", district_id: "d1" })).toBe(false));
  it("farklı ilçe", () =>
    expect(demandsSimilar(p, { transaction_type: "Satılık", property_type: "Daire", district_id: "d2" })).toBe(false));
  it("aday boş ilçe benzer sayılır", () =>
    expect(demandsSimilar(p, { transaction_type: "Satılık", property_type: null, district_id: null })).toBe(true));
});

describe("scopeHit", () => {
  const hit: DuplicateHit = {
    id: "c1", visible: true, label: "Ali Kaya", advisor: "Veli", lastContact: "2026-01-01",
    code: "ES-1", price: 5, status: "active", reasons: ["telefon"],
  };
  it("ofis geneli: açık", () => expect(scopeHit(hit, "u2", { userId: "u1", officeWide: true }).label).toBe("Ali Kaya"));
  it("kendi kaydı: açık", () => expect(scopeHit(hit, "u1", { userId: "u1", officeWide: false }).id).toBe("c1"));
  it("başkasının kaydı: kimlik sızmaz", () => {
    const h = scopeHit(hit, "u2", { userId: "u1", officeWide: false });
    expect(h).toMatchObject({ id: null, visible: false, label: null, advisor: null, code: null, price: null });
    expect(h.reasons).toEqual(["telefon"]);
  });
});

describe("groupPropertyDuplicates (portföy çift kayıt taraması)", () => {
  const base = {
    title: null, address_line: null, parcel_block: null, parcel_lot: null, property_type: "daire",
    transaction_type: "satilik", district_id: "d1", neighborhood_id: "n1", created_at: "2026-10-01T00:00:00Z",
  };
  it("aynı mahallede ada/parsel ve benzer adres eşleşmelerini geçişli gruplar; işlem türü farklıysa eşleşmez", () => {
    const groups = groupPropertyDuplicates([
      { ...base, id: "a", parcel_block: "101", parcel_lot: "5" },
      { ...base, id: "b", parcel_block: "101", parcel_lot: "5", address_line: "Atatürk Cad. No 12 Daire 3" },
      { ...base, id: "c", address_line: "Atatürk Cad. No 12 Daire 3", created_at: "2026-10-02T00:00:00Z" },
      { ...base, id: "d", parcel_block: "101", parcel_lot: "5", transaction_type: "kiralik" },
      { ...base, id: "e", parcel_block: "101", parcel_lot: "5", neighborhood_id: "n2" },
      { ...base, id: "f", parcel_block: "101", parcel_lot: "5", property_type: "dukkan" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ids).toEqual(["a", "b", "c"]);
    expect(groups[0]!.reasons).toEqual(["ada-parsel", "adres"]);
  });

  it("konumsuz kayıt taranmaz; doluluk puanı medyayı sayar", () => {
    expect(
      groupPropertyDuplicates([
        { ...base, id: "a", district_id: null, neighborhood_id: null, parcel_block: "1", parcel_lot: "1" },
        { ...base, id: "b", district_id: null, neighborhood_id: null, parcel_block: "1", parcel_lot: "1" },
      ]),
    ).toEqual([]);
    expect(
      propertyCompleteness({ title: "x", address_line: "", parcel_block: null, lat: 1, list_price: 5, neighborhood_id: "n", media_count: 3 }),
    ).toBe(7);
  });
});
