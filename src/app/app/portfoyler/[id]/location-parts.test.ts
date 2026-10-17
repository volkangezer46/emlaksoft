import { describe, expect, it } from "vitest";
import { propertyLocationParts } from "./location-parts";

describe("propertyLocationParts (F10: konum satırı tekrar etmez)", () => {
  it("adres satırı ilçe ve ili içeriyorsa tekrar eklenmez", () => {
    expect(propertyLocationParts("Kadıköy, İstanbul", "Kadıköy", "İstanbul")).toEqual(["Kadıköy, İstanbul"]);
  });
  it("Türkçe büyük/küçük harf farkı tekrar sayılır", () => {
    expect(propertyLocationParts("Caferağa Mah. KADIKÖY / İSTANBUL", "Kadıköy", "İstanbul")).toEqual(["Caferağa Mah. KADIKÖY / İSTANBUL"]);
  });
  it("adreste olmayan ilçe / il eklenir", () => {
    expect(propertyLocationParts("Moda Cd. No:5", "Kadıköy", "İstanbul")).toEqual(["Moda Cd. No:5", "Kadıköy", "İstanbul"]);
  });
  it("kelime parçası eşleşme sayılmaz", () => {
    expect(propertyLocationParts("Ataşehirli Sk.", "Ataşehir", null)).toEqual(["Ataşehirli Sk.", "Ataşehir"]);
  });
  it("adres yoksa ilçe · il; ilçe = il ise tek", () => {
    expect(propertyLocationParts(null, "Kadıköy", "İstanbul")).toEqual(["Kadıköy", "İstanbul"]);
    expect(propertyLocationParts("", "Bolu", "Bolu")).toEqual(["Bolu"]);
    expect(propertyLocationParts(null, null, null)).toEqual([]);
  });
  it("adres satırındaki tekrar eden parça tekilleşir", () => {
    expect(propertyLocationParts("Kadıköy, Kadıköy, İstanbul", "Kadıköy", "İstanbul")).toEqual(["Kadıköy, İstanbul"]);
  });
});
