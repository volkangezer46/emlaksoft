import { describe, expect, it } from "vitest";
import { prefillHref, readPrefillIds } from "./prefill-params";

const C = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";

describe("readPrefillIds", () => {
  it("kanonik adları okur", () => {
    expect(readPrefillIds({ customer: C, property: P })).toEqual({ customerId: C, propertyId: P });
  });
  it("Türkçe eş adları okur", () => {
    expect(readPrefillIds({ musteri: C, portfoy: P })).toEqual({ customerId: C, propertyId: P });
  });
  it("ikisi birden varsa kanonik ad kazanır", () => {
    expect(readPrefillIds({ customer: C, musteri: P }).customerId).toBe(C);
  });
  it("boş kanonik değer eş ada düşer", () => {
    expect(readPrefillIds({ customer: "  ", musteri: C }).customerId).toBe(C);
  });
  it("UUID olmayan değeri yok sayar", () => {
    expect(readPrefillIds({ customer: "abc", portfoy: "1; drop" })).toEqual({ customerId: null, propertyId: null });
  });
  it("dizi değerde ilkini alır, boşluğu kırpar", () => {
    expect(readPrefillIds({ customer: [` ${C} `, P] }).customerId).toBe(C);
  });
  it("parametre yoksa null döner", () => {
    expect(readPrefillIds(undefined)).toEqual({ customerId: null, propertyId: null });
  });
});

describe("prefillHref", () => {
  it("kanonik adlarla bağlantı üretir", () => {
    expect(prefillHref("/app/teklifler/yeni", { customerId: C, propertyId: P })).toBe(
      `/app/teklifler/yeni?customer=${C}&property=${P}`,
    );
  });
  it("boş değerleri atlar, ek parametreleri ekler", () => {
    expect(prefillHref("/app/randevular/yeni", { customerId: C, propertyId: null }, { tur: "gosterim", x: "" })).toBe(
      `/app/randevular/yeni?customer=${C}&tur=gosterim`,
    );
    expect(prefillHref("/app/gorevler/yeni", {})).toBe("/app/gorevler/yeni");
  });
  it("ürettiği bağlantı geri okunabilir", () => {
    const href = prefillHref("/x", { customerId: C, propertyId: P });
    const sp = Object.fromEntries(new URL(href, "http://l").searchParams);
    expect(readPrefillIds(sp)).toEqual({ customerId: C, propertyId: P });
  });
});
