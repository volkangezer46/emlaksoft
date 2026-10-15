import { describe, expect, it } from "vitest";
import { matchListingsForDemand, networkMatchScore, normKey, type MatchDemand, type MatchListing } from "./match";

const demand: MatchDemand = {
  transactionType: "Satılık",
  propertyType: "Daire",
  rooms: "3+1",
  provinceName: "İstanbul",
  districtName: "Kadıköy",
  budgetMin: 4_000_000,
  budgetMax: 5_000_000,
};
const listing: MatchListing = {
  transactionType: "satilik",
  propertyType: "daire",
  rooms: "3+1",
  provinceName: "İstanbul",
  districtName: "KADIKÖY",
  price: 5_400_000,
};

describe("ağ eşleştirmesi (OA10)", () => {
  it("Türkçe duyarsız karşılaştırır; bütçe %10 tolerans", () => {
    expect(normKey(" Satılık ")).toBe("satilik");
    expect(networkMatchScore(demand, listing)).toBe(6);
    expect(networkMatchScore(demand, { ...listing, price: 5_600_000 })).toBeNull();
    expect(networkMatchScore(demand, { ...listing, price: 3_500_000 })).toBeNull();
    expect(networkMatchScore(demand, { ...listing, price: null })).toBe(5);
  });

  it("işlem türü, tür, ilçe ve oda uyuşmazlığı eler; ilanda oda yoksa geçer", () => {
    expect(networkMatchScore(demand, { ...listing, transactionType: "Kiralık" })).toBeNull();
    expect(networkMatchScore(demand, { ...listing, propertyType: "Villa" })).toBeNull();
    expect(networkMatchScore(demand, { ...listing, districtName: "Üsküdar" })).toBeNull();
    expect(networkMatchScore(demand, { ...listing, rooms: "2+1" })).toBeNull();
    expect(networkMatchScore(demand, { ...listing, rooms: null })).toBe(5);
  });

  it("ilçesiz talep ile eşleşir; konumsuz talep eşleştirilmez", () => {
    expect(networkMatchScore({ ...demand, districtName: null }, { ...listing, districtName: "Üsküdar" })).toBe(5);
    expect(networkMatchScore({ ...demand, districtName: null, provinceName: null }, listing)).toBeNull();
  });

  it("sıralama puana göre", () => {
    const a = { ...listing, rooms: null, id: "a" };
    const b = { ...listing, id: "b" };
    const c = { ...listing, transactionType: "Kiralık", id: "c" };
    expect(matchListingsForDemand(demand, [a, b, c]).map((x) => x.id)).toEqual(["b", "a"]);
  });
});
