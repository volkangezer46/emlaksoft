import { describe, expect, it } from "vitest";
import { computeLeadScore, type LeadSignals } from "./lead-score";

/**
 * Lead skoru danışmanın gün içinde KİMİ ARAYACAĞINI belirliyor. Yanlış bir
 * eşik ya da taşan bir tavan, sıcak bir müşteriyi listenin dibine düşürür ve
 * bu hata sessizce yaşar — arayüzde "yanlış" görünen bir şey olmaz.
 *
 * Testler tarih bağımlı: `daysSince` `Date.now()` kullanıyor, bu yüzden
 * mutlak tarih yerine "şu andan N gün önce" üretiliyor.
 */

const gunOnce = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const bos: LeadSignals = {
  hasPhone: false,
  hasEmail: false,
  source: null,
  activeDemands: 0,
  communications: 0,
  appointments: 0,
  calls: 0,
  lastActivityAt: null,
  createdAt: gunOnce(200),
  blacklist: false,
};

const ile = (p: Partial<LeadSignals>): LeadSignals => ({ ...bos, ...p });

describe("kara liste", () => {
  it("diğer tüm sinyaller güçlü olsa bile sıfırlar", () => {
    const s = computeLeadScore(
      ile({
        blacklist: true,
        hasPhone: true,
        hasEmail: true,
        source: "referral",
        activeDemands: 5,
        communications: 20,
        appointments: 3,
        calls: 10,
        lastActivityAt: gunOnce(0),
      }),
    );
    expect(s.score).toBe(0);
    expect(s.tier).toBe("cold");
    expect(s.factors).toEqual([{ label: "Kara liste", points: 0 }]);
  });
});

describe("skor sınırları", () => {
  it("hiçbir zaman 0..100 dışına çıkmaz", () => {
    const maks = computeLeadScore(
      ile({
        hasPhone: true,
        hasEmail: true,
        source: "referral",
        activeDemands: 99,
        communications: 999,
        appointments: 99,
        calls: 999,
        lastActivityAt: gunOnce(0),
      }),
    );
    expect(maks.score).toBeLessThanOrEqual(100);
    expect(maks.score).toBeGreaterThanOrEqual(0);

    // Çok eski + hiç sinyal yok: güncellik -8 veriyor, skor negatife düşmemeli.
    const min = computeLeadScore(ile({ createdAt: gunOnce(500) }));
    expect(min.score).toBeGreaterThanOrEqual(0);
  });

  it("tavanlar uygulanıyor: 3 talep ile 30 talep aynı puanı verir", () => {
    const uc = computeLeadScore(ile({ activeDemands: 3 }));
    const otuz = computeLeadScore(ile({ activeDemands: 30 }));
    expect(uc.score).toBe(otuz.score);
  });
});

describe("kademe eşikleri", () => {
  it("65 ve üzeri sıcak, 35-64 ılık, altı soğuk", () => {
    // Eşikleri doğrudan sabitliyoruz: bir yeniden düzenlemede kaymasınlar.
    const sicak = computeLeadScore(
      ile({
        hasPhone: true,
        hasEmail: true,
        source: "referral",
        activeDemands: 2,
        appointments: 2,
        communications: 5,
        lastActivityAt: gunOnce(1),
      }),
    );
    expect(sicak.tier).toBe("hot");
    expect(sicak.label).toBe("Sıcak");
    expect(sicak.score).toBeGreaterThanOrEqual(65);

    const soguk = computeLeadScore(ile({ createdAt: gunOnce(400) }));
    expect(soguk.tier).toBe("cold");
    expect(soguk.label).toBe("Soğuk");
    expect(soguk.score).toBeLessThan(35);
  });

  it("kademe ile skor her zaman tutarlı", () => {
    const ornekler: LeadSignals[] = [
      bos,
      ile({ hasPhone: true }),
      ile({ hasPhone: true, hasEmail: true, source: "portal", activeDemands: 1 }),
      ile({ hasPhone: true, source: "referral", appointments: 2, lastActivityAt: gunOnce(2) }),
    ];
    for (const s of ornekler) {
      const r = computeLeadScore(s);
      const beklenen = r.score >= 65 ? "hot" : r.score >= 35 ? "warm" : "cold";
      expect(r.tier, `skor ${r.score}`).toBe(beklenen);
    }
  });
});

describe("sinyal katkıları", () => {
  it("telefon e-postadan daha değerli", () => {
    const t = computeLeadScore(ile({ hasPhone: true })).score;
    const e = computeLeadScore(ile({ hasEmail: true })).score;
    expect(t).toBeGreaterThan(e);
  });

  it("referans kaynağı 'diğer'den yüksek puan alır", () => {
    const ref = computeLeadScore(ile({ source: "referral" })).score;
    const diger = computeLeadScore(ile({ source: "other" })).score;
    expect(ref).toBeGreaterThan(diger);
  });

  it("bilinmeyen kaynak 'diğer' ile aynı puanı alır", () => {
    expect(computeLeadScore(ile({ source: "hicbiryerden" })).score).toBe(
      computeLeadScore(ile({ source: "other" })).score,
    );
  });

  it("kaynak eşleşmesi büyük/küçük harf duyarsız", () => {
    expect(computeLeadScore(ile({ source: "REFERRAL" })).score).toBe(
      computeLeadScore(ile({ source: "referral" })).score,
    );
  });

  it("yakın etkileşim eski etkileşimden yüksek puan alır", () => {
    const dun = computeLeadScore(ile({ lastActivityAt: gunOnce(1) })).score;
    const gecenAy = computeLeadScore(ile({ lastActivityAt: gunOnce(20) })).score;
    const gecenYil = computeLeadScore(ile({ lastActivityAt: gunOnce(400) })).score;
    expect(dun).toBeGreaterThan(gecenAy);
    expect(gecenAy).toBeGreaterThan(gecenYil);
  });

  it("lastActivityAt yoksa createdAt'e düşer", () => {
    const a = computeLeadScore(ile({ lastActivityAt: null, createdAt: gunOnce(1) }));
    const b = computeLeadScore(ile({ lastActivityAt: gunOnce(1), createdAt: gunOnce(300) }));
    expect(a.score).toBe(b.score);
  });

  it("geçersiz tarih skoru bozmaz", () => {
    const r = computeLeadScore(ile({ lastActivityAt: "tarih-degil" }));
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.factors.some((f) => f.label === "Güncellik")).toBe(false);
  });
});

describe("faktör listesi", () => {
  it("yalnızca puan üreten sinyalleri listeler", () => {
    const r = computeLeadScore(ile({ hasPhone: true, lastActivityAt: gunOnce(1) }));
    const etiketler = r.factors.map((f) => f.label);
    expect(etiketler).toContain("Telefon var");
    expect(etiketler).not.toContain("E-posta var");
    expect(etiketler).not.toContain("Randevu");
  });

  it("faktör puanlarının toplamı skorla uyumlu (kırpma öncesi)", () => {
    const s = ile({ hasPhone: true, hasEmail: true, source: "web", activeDemands: 1 });
    const r = computeLeadScore(s);
    const toplam = r.factors.reduce((acc, f) => acc + f.points, 0);
    expect(r.score).toBe(Math.max(0, Math.min(100, Math.round(toplam))));
  });
});
