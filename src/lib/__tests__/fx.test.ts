import { describe, expect, it } from "vitest";
import {
  convertTry,
  fetchLatestRates,
  formatFx,
  fxAgeLabel,
  fxApproxLine,
  type FxClient,
} from "@/lib/fx";

/** `tcmb_rates` sorgusunu taklit eden minimal sahte client. */
function fakeClient(result: { data: unknown; error?: unknown }): FxClient {
  return {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve(result as { data: never; error: unknown }),
        }),
      }),
    }),
  } as unknown as FxClient;
}

describe("fetchLatestRates", () => {
  it("en güncel satırdan USD/EUR satış kurunu okur (numeric string dahil)", async () => {
    const rates = await fetchLatestRates(
      fakeClient({ data: [{ rate_date: "2026-07-28", usd_selling: "47.375100", eur_selling: 53.8414 }] }),
    );
    expect(rates).toEqual({ rateDate: "2026-07-28", usd: 47.3751, eur: 53.8414 });
  });

  it("kur yoksa null döner — çağıran döviz satırını hiç basmasın", async () => {
    expect(await fetchLatestRates(fakeClient({ data: [] }))).toBeNull();
    expect(await fetchLatestRates(fakeClient({ data: null }))).toBeNull();
    // Satır var ama iki kur da boş → gösterilecek bir şey yok
    expect(
      await fetchLatestRates(fakeClient({ data: [{ rate_date: "2026-07-28", usd_selling: null, eur_selling: null }] })),
    ).toBeNull();
    // Sorgu hatası uydurma kurla maskelenmez
    expect(
      await fetchLatestRates(fakeClient({ data: null, error: { message: "boom" } })),
    ).toBeNull();
  });

  it("tek para birimi yayınlanmışsa diğerini null bırakır", async () => {
    const rates = await fetchLatestRates(
      fakeClient({ data: [{ rate_date: "2026-07-28", usd_selling: 47.3751, eur_selling: null }] }),
    );
    expect(rates).toEqual({ rateDate: "2026-07-28", usd: 47.3751, eur: null });
  });
});

describe("convertTry", () => {
  it("₺ tutarı kura böler ve 2 basamağa yuvarlar", () => {
    expect(convertTry(4_737_510, 47.3751)).toBe(100_000);
    expect(convertTry(1000, 3)).toBe(333.33);
  });

  it("kur yok/sıfır/negatifse null — asla uydurma çevrim", () => {
    expect(convertTry(1000, null)).toBeNull();
    expect(convertTry(1000, 0)).toBeNull();
    expect(convertTry(1000, -5)).toBeNull();
    expect(convertTry(null, 47)).toBeNull();
    expect(convertTry(undefined, 47)).toBeNull();
    expect(convertTry(Number.NaN, 47)).toBeNull();
  });

  it("sıfır ve negatif tutarı olduğu gibi çevirir (fark/indirim hesapları)", () => {
    expect(convertTry(0, 47.3751)).toBe(0);
    expect(convertTry(-4_737_510, 47.3751)).toBe(-100_000);
  });
});

describe("formatFx", () => {
  it("tr-TR ayraçlarıyla biçimler; ₺ sona, $/€ başa gelir", () => {
    expect(formatFx(1_234_567, "TRY")).toBe("1.234.567 ₺");
    expect(formatFx(1_234_567, "USD")).toBe("$1.234.567");
    expect(formatFx(980_000, "EUR")).toBe("€980.000");
  });

  it("kuruşu yuvarlar, sıfır/negatifi basar, geçersizde null döner", () => {
    expect(formatFx(1234.56, "USD")).toBe("$1.235");
    expect(formatFx(0, "TRY")).toBe("0 ₺");
    expect(formatFx(-1500, "USD")).toBe("$-1.500");
    expect(formatFx(null, "USD")).toBeNull();
    expect(formatFx(undefined, "EUR")).toBeNull();
    expect(formatFx(Number.NaN, "TRY")).toBeNull();
  });
});

describe("fxAgeLabel", () => {
  const now = Date.UTC(2026, 6, 28, 12, 0, 0); // 2026-07-28

  it("aynı gün 'bugünün kuru' der", () => {
    expect(fxAgeLabel("2026-07-28", now)).toBe("bugünün kuru");
  });

  it("yaşlı kuru gün sayısıyla söyler — kullanıcı eskiliği görsün", () => {
    expect(fxAgeLabel("2026-07-27", now)).toBe("dünkü kur");
    expect(fxAgeLabel("2026-07-26", now)).toBe("2 gün önceki kur");
    expect(fxAgeLabel("2026-07-18", now)).toBe("10 gün önceki kur");
  });

  it("gelecek tarihi bugüne çeker, geçersiz/boş girdide null döner", () => {
    expect(fxAgeLabel("2026-07-29", now)).toBe("bugünün kuru");
    expect(fxAgeLabel("", now)).toBeNull();
    expect(fxAgeLabel(null, now)).toBeNull();
    expect(fxAgeLabel("bozuk-tarih", now)).toBeNull();
  });
});

describe("fxApproxLine", () => {
  it("iki kur varsa tek satırda ikisini de basar", () => {
    expect(fxApproxLine(4_737_510, { rateDate: "2026-07-28", usd: 47.3751, eur: 53.8414 })).toBe(
      "≈ $100.000 · €87.990",
    );
  });

  it("tek kur varsa tek karşılık basar", () => {
    expect(fxApproxLine(4_737_510, { rateDate: "2026-07-28", usd: 47.3751, eur: null })).toBe("≈ $100.000");
  });

  it("kur yoksa veya fiyat girilmemişse null — satır hiç çizilmez", () => {
    expect(fxApproxLine(4_737_510, null)).toBeNull();
    expect(fxApproxLine(null, { rateDate: "2026-07-28", usd: 47.3751, eur: 53.8414 })).toBeNull();
    expect(fxApproxLine(0, { rateDate: "2026-07-28", usd: 47.3751, eur: 53.8414 })).toBeNull();
  });
});
