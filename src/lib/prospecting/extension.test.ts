import { describe, expect, it } from "vitest";
import { extractListing, type PageSnapshot } from "./extension-extract";
import { dueFsbo, enqueueFsbo, FSBO_MAX_ATTEMPTS, FSBO_QUEUE_MAX, markFsboDone, markFsboFailed, sanitizeFsboPayload } from "./extension-queue";

const snap = (over: Partial<PageSnapshot> = {}): PageSnapshot => ({
  url: "https://www.sahibinden.com/ilan/emlak-konut-satilik-moda-3-1-1234567890/detay?utm=x",
  title: "Moda 3+1 satılık daire - sahibinden.com",
  h1: "Moda'da 3+1 satılık daire",
  jsonLd: [],
  metaPrice: "",
  text: "İlan No 1234567890\nİlan Tarihi 12 Ekim 2026\nOda Sayısı 3+1\nm² (Brüt) 120\nFiyat 4.200.000 TL",
  crumbs: ["İstanbul", "Kadıköy", "Moda Mh."],
  telLinks: [],
  ownerName: "Ayşe K.",
  ...over,
});

describe("eklenti: sayfa anlık görüntüsünden ilan alanları", () => {
  it("başlık, fiyat, oda, m², konum, ilan tarihi ve işlem türü", () => {
    const x = extractListing(snap());
    expect(x).toMatchObject({
      url: "https://www.sahibinden.com/ilan/emlak-konut-satilik-moda-3-1-1234567890/detay",
      title: "Moda'da 3+1 satılık daire",
      price: 4200000,
      rooms: "3+1",
      grossM2: 120,
      locationText: "İstanbul / Kadıköy / Moda Mh.",
      listedAt: "2026-10-12",
      transactionType: "sale",
      phoneCandidate: null,
    });
  });
  it("JSON-LD fiyatı önceliklidir; kiralık adres kiralık sayılır; kalıp tutmazsa alan boş kalır (uydurma yok)", () => {
    const ld = JSON.stringify({ "@type": "Product", name: "X", offers: { price: "3950000" } });
    expect(extractListing(snap({ jsonLd: [ld] })).price).toBe(3950000);
    expect(extractListing(snap({ url: "https://www.sahibinden.com/ilan/emlak-konut-kiralik-x-1234567890/detay" })).transactionType).toBe("rent");
    const empty = extractListing(snap({ text: "", h1: "", title: "", crumbs: [], ownerName: "" }));
    expect(empty).toMatchObject({ title: null, price: null, rooms: null, grossM2: null, locationText: null, listedAt: null, ownerName: null });
  });
  it("telefon yalnız sayfada ZATEN görünen tel: bağlantısından önerilir; yoksa null", () => {
    expect(extractListing(snap({ telLinks: ["tel:+90 532 123 45 67"] })).phoneCandidate).toBe("+905321234567");
    expect(extractListing(snap({ telLinks: ["tel:123"] })).phoneCandidate).toBeNull();
  });
});

describe("eklenti: gönderim kuyruğu", () => {
  const p = sanitizeFsboPayload({ url: "https://www.sahibinden.com/ilan/x-1234567890/detay", title: "A", price: 100, transactionType: "sale", phone: "05321234567" })!;
  it("yük doğrulaması: https olmayan adres ve geçersiz girdi reddedilir", () => {
    expect(p).toMatchObject({ price: 100, phone: "05321234567" });
    expect(sanitizeFsboPayload({ url: "http://x.com/a" })).toBeNull();
    expect(sanitizeFsboPayload(null)).toBeNull();
    expect(sanitizeFsboPayload({ url: "https://a.com/x", price: -5 })?.price).toBeNull();
  });
  it("aynı ilan tekrar eklenince güncellenir (çift kayıt yok); kuyruk sınırı", () => {
    let q = enqueueFsbo([], p, 1000, "a");
    q = enqueueFsbo(q, { ...p, price: 90 }, 2000, "b");
    expect(q).toHaveLength(1);
    expect(q[0].payload.price).toBe(90);
    for (let i = 0; i < FSBO_QUEUE_MAX + 5; i += 1) q = enqueueFsbo(q, { ...p, url: `https://www.sahibinden.com/ilan/x-${1000000 + i}/detay` }, 3000, `i${i}`);
    expect(q.length).toBeLessThanOrEqual(FSBO_QUEUE_MAX);
  });
  it("başarısızlıkta geri çekilme, tamamlanınca silinir, çok denemeden sonra düşer", () => {
    let q = enqueueFsbo([], p, 0, "a");
    expect(dueFsbo(q, 0)).toHaveLength(1);
    q = markFsboFailed(q, "a", 0);
    expect(dueFsbo(q, 1000)).toHaveLength(0);
    expect(dueFsbo(q, 120_000)).toHaveLength(1);
    for (let i = 0; i < FSBO_MAX_ATTEMPTS; i += 1) q = markFsboFailed(q, "a", 0);
    expect(dueFsbo(q, 10 * 3_600_000)).toHaveLength(0);
    expect(markFsboDone(enqueueFsbo([], p, 0, "a"), "a")).toEqual([]);
  });
});
