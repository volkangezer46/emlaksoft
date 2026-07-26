import { describe, expect, it } from "vitest";
import { computeDealScore, scoreGap, type DealSignals } from "./deal-score";

/**
 * Bu skor danışmanın hangi anlaşmaya zaman ayıracağını etkiliyor. Asıl risk
 * hesabın AŞAMAYI TEKRARLAMASI: eğer iki farklı anlaşma aynı aşamada aynı
 * puanı alıyorsa, skor hiçbir şey eklemiyor demektir ve özellik amacını
 * boşa çıkarıyor. Testlerin çoğu tam olarak bunu kontrol ediyor.
 */

const AN = new Date("2026-07-26T12:00:00Z").getTime();
const gunOnce = (n: number) => new Date(AN - n * 86_400_000).toISOString();

const temel: DealSignals = {
  stage: "negotiation",
  createdAt: gunOnce(10),
  updatedAt: gunOnce(2),
  offerCount: 0,
  hasAcceptedOffer: false,
  appointmentCount: 0,
  openTaskCount: 0,
};

const ile = (p: Partial<DealSignals>): DealSignals => ({ ...temel, ...p });
const puan = (p: Partial<DealSignals>) => computeDealScore(ile(p), AN).score;

describe("aşamayı tekrarlamıyor", () => {
  it("aynı aşamadaki iki anlaşma FARKLI puan alabilir", () => {
    // Eski `probability` alanının tek yaptığı buydu; skorun varlık sebebi bu.
    const canli = puan({ offerCount: 1, appointmentCount: 2, updatedAt: gunOnce(1) });
    const olu = puan({ updatedAt: gunOnce(70), createdAt: gunOnce(120) });
    expect(canli).toBeGreaterThan(olu);
    expect(canli - olu).toBeGreaterThan(30);
  });

  it("hareketsizlik puanı belirgin düşürür", () => {
    expect(puan({ updatedAt: gunOnce(2) })).toBeGreaterThan(puan({ updatedAt: gunOnce(20) }));
    expect(puan({ updatedAt: gunOnce(20) })).toBeGreaterThan(puan({ updatedAt: gunOnce(40) }));
    expect(puan({ updatedAt: gunOnce(40) })).toBeGreaterThan(puan({ updatedAt: gunOnce(90) }));
  });

  it("yaş, hareketsizlikten AYRI cezalandırılır", () => {
    // Sürekli dokunulan ama 4 aydır kapanmayan anlaşma da sorunludur.
    const taze = puan({ createdAt: gunOnce(20), updatedAt: gunOnce(1) });
    const eski = puan({ createdAt: gunOnce(200), updatedAt: gunOnce(1) });
    expect(eski).toBeLessThan(taze);
  });
});

describe("olumlu sinyaller", () => {
  it("kabul edilmiş teklif en güçlü artışı verir", () => {
    const kabul = puan({ hasAcceptedOffer: true, offerCount: 1 });
    const bekleyen = puan({ offerCount: 1 });
    expect(kabul).toBeGreaterThan(bekleyen);
  });

  it("teklif sayısı artışı doygunluğa ulaşır", () => {
    // 5 teklif ile 20 teklif arasında anlamlı fark yok; ikisi de "pazarlık var".
    expect(puan({ offerCount: 5 })).toBe(puan({ offerCount: 20 }));
  });

  it("görüşme sayısı puanı artırır ama sınırlı", () => {
    expect(puan({ appointmentCount: 1 })).toBeGreaterThan(puan({ appointmentCount: 0 }));
    expect(puan({ appointmentCount: 2 })).toBe(puan({ appointmentCount: 10 }));
  });

  it("açık takip görevi küçük bir artı", () => {
    expect(puan({ openTaskCount: 1 })).toBeGreaterThan(puan({ openTaskCount: 0 }));
  });
});

describe("fiyat açığı", () => {
  it("liste fiyatının belirgin altındaki anlaşma cezalanır", () => {
    const yakin = puan({ dealValue: 9_500_000, listPrice: 10_000_000 });
    const uzak = puan({ dealValue: 7_500_000, listPrice: 10_000_000 });
    expect(uzak).toBeLessThan(yakin);
  });

  it("liste fiyatı yoksa ceza yok", () => {
    expect(puan({ dealValue: 5_000_000, listPrice: null })).toBe(puan({}));
  });

  it("sıfır liste fiyatı bölme hatası üretmez", () => {
    expect(() => computeDealScore(ile({ dealValue: 100, listPrice: 0 }), AN)).not.toThrow();
    expect(Number.isFinite(puan({ dealValue: 100, listPrice: 0 }))).toBe(true);
  });
});

describe("kapanmış anlaşmalar", () => {
  it("kazanılan 100, kaybedilen 0 — tahmin yapılmaz", () => {
    const w = computeDealScore(ile({ stage: "won", updatedAt: gunOnce(400) }), AN);
    const l = computeDealScore(ile({ stage: "lost", offerCount: 5, hasAcceptedOffer: true }), AN);
    expect(w.score).toBe(100);
    expect(l.score).toBe(0);
    // Diğer sinyaller sonucu değiştirmemeli: sonuç zaten belli.
    expect(w.factors).toHaveLength(1);
    expect(l.factors).toHaveLength(1);
  });
});

describe("sınırlar ve tutarlılık", () => {
  it("her zaman 0..100 arasında", () => {
    const enIyi = puan({
      stage: "negotiation",
      hasAcceptedOffer: true,
      offerCount: 9,
      appointmentCount: 9,
      openTaskCount: 3,
      updatedAt: gunOnce(0),
      createdAt: gunOnce(1),
    });
    const enKotu = puan({
      stage: "new",
      updatedAt: gunOnce(400),
      createdAt: gunOnce(500),
      dealValue: 1,
      listPrice: 10_000_000,
    });
    expect(enIyi).toBeLessThanOrEqual(100);
    expect(enKotu).toBeGreaterThanOrEqual(0);
  });

  it("kademe ile puan tutarlı", () => {
    for (const s of [temel, ile({ updatedAt: gunOnce(100) }), ile({ hasAcceptedOffer: true })]) {
      const r = computeDealScore(s, AN);
      const beklenen = r.score >= 65 ? "high" : r.score >= 35 ? "medium" : "low";
      expect(r.tier, `puan ${r.score}`).toBe(beklenen);
    }
  });

  it("geçersiz tarih patlatmaz", () => {
    expect(() => computeDealScore(ile({ createdAt: "yok", updatedAt: "yok" }), AN)).not.toThrow();
  });

  it("her faktör gerekçesiyle döner", () => {
    // Kullanıcı katılmadığında NEDENİNİ görebilmeli.
    const r = computeDealScore(ile({ offerCount: 2, updatedAt: gunOnce(45) }), AN);
    expect(r.factors.length).toBeGreaterThan(1);
    expect(r.factors.some((f) => f.points < 0)).toBe(true);
    expect(r.factors.some((f) => f.label.includes("teklif"))).toBe(true);
  });
});

describe("scoreGap", () => {
  it("20 puan altındaki sapmayı gürültü sayar", () => {
    expect(scoreGap(60, 50)).toBeNull();
    expect(scoreGap(50, 60)).toBeNull();
  });

  it("anlamlı sapmayı işaretli döndürür", () => {
    expect(scoreGap(80, 35)).toBe(45);
    expect(scoreGap(20, 70)).toBe(-50);
  });

  it("kullanıcı değeri yoksa null", () => {
    expect(scoreGap(null, 50)).toBeNull();
    expect(scoreGap(undefined, 50)).toBeNull();
    expect(scoreGap(Number.NaN, 50)).toBeNull();
  });
});
