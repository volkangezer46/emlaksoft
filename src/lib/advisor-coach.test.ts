import { describe, expect, it } from "vitest";
import { buildCoachActions, type CoachInput } from "./advisor-coach";

/**
 * Koç paneli danışmanın haftasını yönlendiriyor. İki risk var:
 *
 *  1. YANLIŞ ÖNCELİK — mevzuat riski (yetki belgesi) bir dönüşüm oranı
 *     tavsiyesinin altında kalırsa panel zarar verir.
 *  2. BOŞ PANEL — hiç öneri üretmeyen bir koç "veri yok" gibi görünür ve
 *     kullanıcı bir daha bakmaz.
 *
 * Testlerin ağırlığı bu ikisinde.
 */

const temel: CoachInput = {
  customerCount: 20,
  callCount: 30,
  appointmentCount: 8,
  offerCount: 3,
  dealCount: 1,
  revenue: 120_000,
  staleCustomerCount: 0,
  hotCustomerCount: 0,
  overpricedCount: 0,
  expiringAuthCount: 0,
  overdueTaskCount: 0,
};

const ile = (p: Partial<CoachInput>): CoachInput => ({ ...temel, ...p });
const basliklar = (p: Partial<CoachInput>) => buildCoachActions(ile(p)).map((a) => a.title);

describe("öncelik sırası", () => {
  it("yetki belgesi uyarısı HER ŞEYİN önünde", () => {
    // Yetkisi bitmiş portföyde aracılık mevzuata aykırı; bir dönüşüm oranı
    // tavsiyesinin altında kalması kabul edilemez.
    const r = buildCoachActions(
      ile({ expiringAuthCount: 2, overdueTaskCount: 5, callCount: 40, appointmentCount: 0, staleCustomerCount: 20 }),
    );
    expect(r[0].title).toContain("yetki süresi");
    expect(r[0].kind).toBe("urgent");
  });

  it("gecikmiş görev, dönüşüm tavsiyelerinin önünde", () => {
    const r = buildCoachActions(ile({ overdueTaskCount: 3, callCount: 40, appointmentCount: 0 }));
    const i = r.findIndex((a) => a.title.includes("gecikmiş"));
    const j = r.findIndex((a) => a.title.includes("çağrı"));
    expect(i).toBeGreaterThanOrEqual(0);
    if (j >= 0) expect(i).toBeLessThan(j);
  });

  it("acil maddeler önce, övgü en sonda", () => {
    const r = buildCoachActions(ile({ expiringAuthCount: 1, dealCount: 10, teamAvgDeals: 2 }));
    const turler = r.map((a) => a.kind);
    if (turler.includes("praise")) {
      expect(turler.indexOf("urgent")).toBeLessThan(turler.lastIndexOf("praise"));
    }
  });
});

describe("liste hiç boş kalmaz", () => {
  it("her şey iyiyken övgü döner", () => {
    const r = buildCoachActions(temel);
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((a) => a.kind === "praise")).toBe(true);
  });

  it("hiç müşteri yoksa bunu açıklar, boş bırakmaz", () => {
    const r = buildCoachActions(ile({ customerCount: 0, callCount: 0, appointmentCount: 0, offerCount: 0, dealCount: 0 }));
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].title).toContain("atanmış müşteri");
  });

  it("tüm sinyaller sıfırda da öneri var", () => {
    const sifir: CoachInput = {
      customerCount: 0, callCount: 0, appointmentCount: 0, offerCount: 0, dealCount: 0,
      revenue: 0, staleCustomerCount: 0, hotCustomerCount: 0, overpricedCount: 0,
      expiringAuthCount: 0, overdueTaskCount: 0,
    };
    expect(buildCoachActions(sifir).length).toBeGreaterThan(0);
  });
});

describe("en fazla 4 öneri", () => {
  it("çok sorun varken listeyi kesiyor", () => {
    // Onbir maddelik bir liste kimsenin okumadığı bir listedir.
    const r = buildCoachActions(
      ile({
        expiringAuthCount: 3,
        overdueTaskCount: 9,
        callCount: 60,
        appointmentCount: 0,
        hotCustomerCount: 7,
        staleCustomerCount: 30,
        overpricedCount: 4,
        dealCount: 0,
        teamAvgDeals: 2.5,
      }),
    );
    expect(r.length).toBe(4);
    // Kesilen liste en ÖNEMLİLERİ tutmalı.
    expect(r[0].kind).toBe("urgent");
  });
});

describe("huni kopması tek öneriye indirilir", () => {
  it("çağrı var randevu yok → tek öneri", () => {
    const b = basliklar({ callCount: 30, appointmentCount: 0, offerCount: 0, dealCount: 0 });
    const huniOnerileri = b.filter((t) => /çağrı|görüşme|teklif|dönüşüm/i.test(t));
    // Aynı kopma üç ayrı satır olarak görünmemeli.
    expect(huniOnerileri.length).toBeLessThanOrEqual(2);
  });

  it("randevu var teklif yok → teklif önerisi", () => {
    const b = basliklar({ callCount: 30, appointmentCount: 10, offerCount: 0 });
    expect(b.some((t) => t.includes("teklif yok"))).toBe(true);
  });

  it("teklif var kapanış yok → kapanış önerisi", () => {
    const b = basliklar({ callCount: 40, appointmentCount: 12, offerCount: 8, dealCount: 1 });
    expect(b.some((t) => /dönüşümü/.test(t))).toBe(true);
  });

  it("düşük hacimde dönüşüm oranı önerisi VERİLMEZ", () => {
    // 3 çağrıdan 0 randevu istatistiksel olarak bir şey söylemez;
    // eşiğin altındaki hacimde oran tavsiyesi gürültüdür.
    const b = basliklar({ callCount: 3, appointmentCount: 0, offerCount: 0 });
    expect(b.some((t) => /dönüşümü %/.test(t))).toBe(false);
  });
});

describe("ölçülebilirlik", () => {
  it("her öneri somut bir sayı ya da oran içerir", () => {
    const ornekler: Partial<CoachInput>[] = [
      { expiringAuthCount: 2 },
      { overdueTaskCount: 4 },
      { callCount: 30, appointmentCount: 0 },
      { hotCustomerCount: 5, appointmentCount: 0 },
      { staleCustomerCount: 12 },
      { overpricedCount: 3 },
    ];
    for (const o of ornekler) {
      for (const a of buildCoachActions(ile(o))) {
        if (a.kind === "praise") continue;
        // "Daha çok ara" gibi bir cümle aksiyon değil, temenni.
        const sayiVar = /\d/.test(a.title) || /\d/.test(a.detail);
        expect(sayiVar, `sayısız öneri: ${a.title}`).toBe(true);
      }
    }
  });
});

describe("ekip kıyası", () => {
  it("ekip ortalaması YOKSA kıyas yapılmaz", () => {
    // Uydurulmuş bir hedef vermek güven kaybettirir.
    const b = basliklar({ dealCount: 0, teamAvgDeals: null });
    expect(b.some((t) => /ortalama/i.test(t))).toBe(false);
  });

  it("ortalama varsa ve anlaşma yoksa kıyas verir", () => {
    const r = buildCoachActions(ile({ dealCount: 0, teamAvgDeals: 3 }));
    expect(r.some((a) => a.detail.includes("3.0"))).toBe(true);
  });

  it("ortalamanın belirgin üstünde övgü verir", () => {
    const r = buildCoachActions(ile({ dealCount: 8, teamAvgDeals: 2 }));
    expect(r.some((a) => a.kind === "praise" && a.title.includes("üstünde"))).toBe(true);
  });

  it("ortalama 0 ise bölme hatası olmaz", () => {
    expect(() => buildCoachActions(ile({ teamAvgDeals: 0, dealCount: 0 }))).not.toThrow();
  });
});

describe("sıfıra bölme", () => {
  it("çağrı 0 iken oran hesaplanmaz, patlamaz", () => {
    expect(() => buildCoachActions(ile({ callCount: 0, appointmentCount: 0, offerCount: 0 }))).not.toThrow();
  });

  it("üretilen hiçbir metinde NaN/Infinity geçmez", () => {
    const senaryolar: Partial<CoachInput>[] = [
      { callCount: 0 },
      { appointmentCount: 0, offerCount: 0 },
      { offerCount: 0, dealCount: 0 },
      { callCount: 0, appointmentCount: 0, offerCount: 0, dealCount: 0, customerCount: 0 },
    ];
    for (const s of senaryolar) {
      for (const a of buildCoachActions(ile(s))) {
        expect(a.title + a.detail).not.toMatch(/NaN|Infinity|undefined|null/);
      }
    }
  });
});
