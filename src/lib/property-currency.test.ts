import { describe, expect, it } from "vitest";
import { fxApproxLine, toTryAmount, type FxRates } from "./fx";
import {
  currencyFeatureValue,
  formatPropertyMoney,
  formatPropertyPrice,
  normalizePropertyCurrency,
  priceForHealth,
  propertyCurrency,
} from "./property-currency";
import { computePriceHealth } from "./price-health";
import { propertyThumbUrl, thumbDigest, thumbSizeOf } from "./property-media-thumb";

const RATES: FxRates = { rateDate: "2026-10-15", usd: 41.5, eur: 48.2 };
const nbsp = (s: string) => s.replace(/ /g, " ");

describe("B094: portföy para birimi", () => {
  it("sütun önce, yoksa features.currency, ikisi de yoksa TRY", () => {
    expect(propertyCurrency({ currency: "USD", features: { currency: "TL" } })).toBe("USD");
    expect(propertyCurrency({ currency: null, features: { currency: "EUR" } })).toBe("EUR");
    expect(propertyCurrency({ features: { currency: "TL" } })).toBe("TRY");
    expect(propertyCurrency({})).toBe("TRY");
    expect(normalizePropertyCurrency("₺")).toBe("TRY");
    expect(normalizePropertyCurrency("gbp")).toBeNull();
    expect(currencyFeatureValue("TRY")).toBe("TL");
    expect(currencyFeatureValue("USD")).toBe("USD");
  });

  it("0c058490 villası: '$850.000' görünür; komisyon USD; ₺ fiyat eski biçimde kalır", () => {
    expect(nbsp(formatPropertyPrice(850000, "Satılık", "USD"))).toBe("$850.000");
    expect(nbsp(formatPropertyPrice(25000, "Kiralık", "EUR"))).toBe("€25.000/ay");
    expect(formatPropertyPrice(1234, "Satılık", "TRY")).toBe("₺1.234");
    expect(formatPropertyPrice(null, "Satılık", "USD")).toBe("Fiyat girilmedi");
    // Komisyon (liste × %2) aynı para biriminde
    expect(nbsp(formatPropertyMoney(17000, "USD"))).toBe("$17.000");
  });

  it("döviz satırı kaynak para biriminden çevirir ($850.000 → ₺ ve € karşılığı; eskiden $17.209 diyordu)", () => {
    const line = fxApproxLine(850000, RATES, "USD")!;
    expect(line).toContain("35.275.000 ₺");
    expect(line).not.toContain("$");
    expect(fxApproxLine(4_150_000, RATES)).toBe("≈ $100.000 · €86.100");
  });

  it("fiyat sağlığı ₺ karşılığıyla; kur yoksa değerlendirilemedi (sahte 'Riskli' yok)", () => {
    expect(toTryAmount(850000, "USD", RATES)).toBe(35_275_000);
    expect(priceForHealth(850000, "USD", RATES)).toEqual({ priceTry: 35_275_000, unrated: false });
    expect(priceForHealth(850000, "USD", null)).toEqual({ priceTry: null, unrated: true });
    expect(priceForHealth(850000, "TRY", null)).toEqual({ priceTry: 850000, unrated: false });
    // Ham dolar tutarı ₺ sanılınca Üsküdar villası "red" çıkıyordu; ₺ karşılığıyla aynı bant değil.
    const raw = computePriceHealth({ listPrice: 850000, sqm: 350, districtHint: "Üsküdar", transactionType: "Satılık" });
    const tl = computePriceHealth({ listPrice: 35_275_000, sqm: 350, districtHint: "Üsküdar", transactionType: "Satılık" });
    expect(raw.health).toBe("red");
    expect(tl.deltaPct === null || tl.deltaPct < (raw.deltaPct ?? 0)).toBe(true);
  });
});

describe("B031: küçük resim URL'i içerik özetli", () => {
  it("özet içerik değişince değişir; boyut türevi URL'de", () => {
    const a = { storage_path: "t/p/a.png", file_size: 100, has_watermark: false };
    expect(thumbDigest(a)).toBe(thumbDigest({ ...a }));
    expect(thumbDigest(a)).not.toBe(thumbDigest({ ...a, has_watermark: true }));
    expect(thumbDigest(a)).not.toBe(thumbDigest({ ...a, file_size: 101 }));
    expect(propertyThumbUrl("m1", a)).toMatch(/^\/api\/property-media\/m1\/thumb\?v=[0-9a-f]{8}$/);
    expect(propertyThumbUrl("m1", a, "kart")).toMatch(/&s=kart$/);
    expect(thumbSizeOf("kart")).toBe("kart");
    expect(thumbSizeOf("x")).toBe("liste");
  });
});
