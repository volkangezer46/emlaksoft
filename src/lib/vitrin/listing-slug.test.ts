import { describe, expect, it } from "vitest";
import {
  LISTING_SLUG_MAX,
  listingKod,
  listingKodIdRange,
  listingSlug,
  listingSlugInput,
  parseListingKod,
  pickUniqueByKod,
  slugifyTr,
  vitrinListingPath,
  vitrinListingUrl,
} from "./listing-slug";

const ID = "1a2b3c4d-5e6f-4a1b-8c2d-0123456789ab";
const KOD = "1a2b3c4d5e6f";

describe("slugifyTr", () => {
  it("Türkçe harfleri ASCII'ye çevirir, küçük harf + tire", () => {
    expect(slugifyTr("Çağlayan Şişli Ümraniye Göztepe")).toBe("caglayan-sisli-umraniye-goztepe");
    expect(slugifyTr("İSTANBUL ISPARTA ıhlamur")).toBe("istanbul-isparta-ihlamur");
    expect(slugifyTr("Kadıköy")).toBe("kadikoy");
    expect(slugifyTr("3+1")).toBe("3-1");
    expect(slugifyTr("  Stüdyo (1+0) ")).toBe("studyo-1-0");
    expect(slugifyTr(null)).toBe("");
    expect(slugifyTr("---")).toBe("");
  });
});

describe("listingSlug", () => {
  it("ilçe + oda + işlem + tip + kod", () => {
    expect(
      listingSlug({ id: ID, district: "Kadıköy", province: "İstanbul", rooms: "3+1", transactionType: "Satılık", propertyType: "Daire" }),
    ).toBe(`kadikoy-3-1-satilik-daire-${KOD}`);
    expect(listingSlug({ id: ID, district: "Beşiktaş", transactionType: "Devren Satılık", propertyType: "İşyeri" })).toBe(
      `besiktas-devren-satilik-isyeri-${KOD}`,
    );
  });
  it("ilçe yoksa il; İngilizce işlem kodu Türkçeye çevrilir", () => {
    expect(listingSlug({ id: ID, district: null, province: "Muğla", transactionType: "rent" })).toBe(`mugla-kiralik-${KOD}`);
  });
  it("eksik alanlar atlanır; hiçbiri yoksa 'ilan-{kod}'", () => {
    expect(listingSlug({ id: ID, rooms: "2+1" })).toBe(`2-1-${KOD}`);
    expect(listingSlug({ id: ID })).toBe(`ilan-${KOD}`);
  });
  it(`en çok ${LISTING_SLUG_MAX} karakter; kod korunur, kesim tire sınırında`, () => {
    const s = listingSlug({
      id: ID,
      district: "Çok Uzun Bir İlçe Adı Ki Sınırı Kesinlikle Aşar Ve Daha Da Uzar Gider Burada",
      rooms: "10+2",
      transactionType: "Satılık",
      propertyType: "Müstakil Ev",
    });
    expect(s.length).toBeLessThanOrEqual(LISTING_SLUG_MAX);
    expect(s.endsWith(`-${KOD}`)).toBe(true);
    expect(s).not.toMatch(/--/);
    expect(parseListingKod(s)).toBe(KOD);
  });
  it("satırdan girdi: ilişki dizisi/nesnesi, features.rooms ya da rooms sütunu", () => {
    const row = {
      id: ID,
      transaction_type: "Kiralık",
      property_type: "Daire",
      features: { rooms: "1+1", description: "x" },
      district: [{ name: "Çankaya" }],
      province: { name: "Ankara" },
    };
    expect(vitrinListingPath("vadi-emlak", listingSlugInput(row))).toBe(`/vitrin/vadi-emlak/cankaya-1-1-kiralik-daire-${KOD}`);
    expect(listingSlugInput({ id: ID, rooms: "4+1", features: { rooms: "x" } }).rooms).toBe("4+1");
    expect(vitrinListingUrl("https://x.test/", "o", { id: ID })).toBe(`https://x.test/vitrin/o/ilan-${KOD}`);
  });
});

describe("kod çözümleme", () => {
  it("listingKod: uuid'nin ilk 12 onaltılık hanesi; geçersiz id boş", () => {
    expect(listingKod(ID)).toBe(KOD);
    expect(listingKod(ID.toUpperCase())).toBe(KOD);
    expect(listingKod("abc")).toBe("");
  });
  it("parseListingKod: yalnız son parça; açıklayıcı kısım önemsiz", () => {
    expect(parseListingKod(`kadikoy-3-1-satilik-daire-${KOD}`)).toBe(KOD);
    expect(parseListingKod(`yanlis-aciklama-${KOD}`)).toBe(KOD);
    expect(parseListingKod(KOD)).toBe(KOD);
    expect(parseListingKod(`ilan-${KOD.toUpperCase()}`)).toBe(KOD);
    expect(parseListingKod(`k%C4%B1-${KOD}`)).toBe(KOD);
    // Eski uuid adresi desteklenmez (son parça 12 hane değil).
    expect(parseListingKod(ID)).toBeNull();
    expect(parseListingKod(`ilan-${KOD.slice(0, 11)}`)).toBeNull();
    expect(parseListingKod(`ilan-${KOD}0`)).toBeNull();
    expect(parseListingKod("ilan-zzzzzzzzzzzz")).toBeNull();
    expect(parseListingKod("")).toBeNull();
  });
  it("listingKodIdRange: kodun kapsadığı uuid aralığı", () => {
    const r = listingKodIdRange(KOD);
    expect(r).toEqual({ lo: "1a2b3c4d-5e6f-0000-0000-000000000000", hi: "1a2b3c4d-5e6f-ffff-ffff-ffffffffffff" });
    expect(ID >= r.lo && ID <= r.hi).toBe(true);
  });
  it("pickUniqueByKod: tek eşleşme döner; belirsiz (2) ya da yok → null", () => {
    const a = { id: ID };
    const b = { id: "1a2b3c4d-5e6f-4fff-8000-000000000000" };
    const other = { id: "ffffffff-5e6f-4a1b-8c2d-0123456789ab" };
    expect(pickUniqueByKod([a], KOD)).toBe(a);
    expect(pickUniqueByKod([a, other], KOD)).toBe(a);
    expect(pickUniqueByKod([a, b], KOD)).toBeNull();
    expect(pickUniqueByKod([], KOD)).toBeNull();
    expect(pickUniqueByKod(null, KOD)).toBeNull();
  });
});
