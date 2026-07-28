import { describe, expect, it } from "vitest";
import {
  PUBLIC_VALUATION_SOURCE_NAME,
  extractPublicValuationRequest,
  publicValuationSourceEntry,
  type PublicValuationRequest,
} from "../public-valuation-source";
import { isInternalSource } from "../valuation-sources";

/** comparables.ts `server-only` olduğu için sabit burada tekrar yazılı (kasıtlı). */
const COMPARABLES_SOURCE_NAME = "__emsal_dokumu";

const req: PublicValuationRequest = {
  origin: "vitrin",
  slug: "demo-ofis",
  customer_id: "cus-1",
  province_id: "34",
  district_id: "34-kadikoy",
  district_name: "Kadıköy",
  province_name: "İstanbul",
  property_type: "Daire",
  sqm: 120,
  rooms: "3+1",
  building_age: "5-10",
  transaction_type: "Satılık",
};

describe("publicValuationSourceEntry", () => {
  it("kriterleri yapısal saklar ve geri okunabilir", () => {
    const entry = publicValuationSourceEntry(req);
    const geri = extractPublicValuationRequest([entry]);
    expect(geri).toEqual(req);
    expect(geri!.sqm).toBe(120);
    expect(geri!.district_name).toBe("Kadıköy");
  });

  it("fiyat hesabına girmez (weight 0) ve DAHİLİ döküm sayılır", () => {
    const entry = publicValuationSourceEntry(req);
    expect(entry.weight).toBe(0);
    expect(isInternalSource(entry.name)).toBe(true);
  });

  it("emsal dökümü de dahili sayılır — rapor sayfaları tek kuralla süzüyor", () => {
    expect(isInternalSource(COMPARABLES_SOURCE_NAME)).toBe(true);
    expect(isInternalSource("Endeksa")).toBe(false);
    expect(isInternalSource(null)).toBe(false);
  });

  it("vitrin kaynaklı olmayan kayıtta null döner", () => {
    expect(extractPublicValuationRequest([{ name: "Endeksa", weight: 1, value: 5, note: "" }])).toBeNull();
    expect(extractPublicValuationRequest(null)).toBeNull();
    expect(extractPublicValuationRequest([])).toBeNull();
    expect(extractPublicValuationRequest([{ name: PUBLIC_VALUATION_SOURCE_NAME }])).toBeNull();
  });
});
