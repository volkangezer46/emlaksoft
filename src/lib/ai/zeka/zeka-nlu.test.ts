import { describe, expect, it } from "vitest";
import { classifyIntent } from "./intent";
import { cleanQuery, foldQuery, matchesLexeme, stemTr, tokens } from "./normalize";
import { extractDateTime, extractListingCode, extractPersonName, extractPhone, extractSlots, periodFor } from "./slots";
import type { ZekaEntity, ZekaIntent, ZekaSlots, ZekaStatus } from "./types";

/**
 * Zeka Türkçe NLU sözleşmesi: normalleştirme, niyet sınıflandırma ve yuva çıkarımı. Saat sabittir:
 * 17 Ekim 2026 Cumartesi 09:00 (TR). Konum listesi küçük bir il/ilçe kümesidir (gerçekte geo_* tablolarından).
 */

const NOW = Date.parse("2026-10-17T09:00:00+03:00");
const GEO = {
  provinces: [
    { id: "p34", name: "İstanbul" },
    { id: "p06", name: "Ankara" },
    { id: "p35", name: "İzmir" },
  ],
  districts: [
    { id: "d-kadikoy", name: "Kadıköy", parentId: "p34" },
    { id: "d-besiktas", name: "Beşiktaş", parentId: "p34" },
    { id: "d-uskudar", name: "Üsküdar", parentId: "p34" },
    { id: "d-cankaya", name: "Çankaya", parentId: "p06" },
    { id: "d-karsiyaka", name: "Karşıyaka", parentId: "p35" },
    { id: "d-atasehir", name: "Ataşehir", parentId: "p34" },
  ],
};

const slots = (q: string) => extractSlots(q, { nowMs: NOW, geo: GEO });
const intentOf = (q: string) => classifyIntent(q, slots(q)).intent;

describe("normalleştirme", () => {
  it("Türkçe büyük/küçük harf ve aksan katlama", () => {
    expect(foldQuery("İSTANBUL Şişli ÇAĞRI")).toBe("istanbul sisli cagri");
    expect(foldQuery("Iğdır")).toBe("igdir");
  });
  it("kesme işaretli ekler atılır", () => {
    expect(foldQuery("Kadıköy'deki daireler")).toBe("kadikoy daireler");
    expect(foldQuery("Ahmet’in talebi")).toBe("ahmet talebi");
  });
  it("oda/saat/para işaretleri korunur", () => {
    expect(tokens("3+1 14:00 5.000.000")).toEqual(["3+1", "14:00", "5.000.000"]);
  });
  it("girdi kırpılır, kontrol karakteri atılır, 300 sınırı", () => {
    expect(cleanQuery("  a\u0000b   c ")).toBe("a b c");
    expect(cleanQuery("x".repeat(400))).toHaveLength(300);
  });
  it.each([
    ["müşterileri", "musteri"],
    ["Kadıköy'deki", "kadikoy"],
    ["dairesi", "daire"],
    ["randevuları", "randevu"],
    ["portföylerim", "portfoy"],
    ["danışmanlar", "danisman"],
    ["görevlerimizi", "gorev"],
    ["talepleri", "talep"],
    ["sözleşmesi", "sozlesme"],
    ["kira", "kira"],
    ["takvim", "takvim"],
  ])("kök: %s → %s", (w, stem) => {
    expect(stemTr(w)).toBe(stem);
  });
  it("ön ek eşleşmesi eklemeli biçimleri yakalar, kısa sözcükte tam eşitlik ister", () => {
    expect(matchesLexeme("musterilerim", "musteri")).toBe(true);
    expect(matchesLexeme("randev", "randevu")).toBe(true);
    expect(matchesLexeme("evrak", "ev")).toBe(false);
    expect(matchesLexeme("kadikoy", "koy")).toBe(false);
  });
});

describe("yuvalar: tarih ve saat", () => {
  it("yarın 14:00", () => {
    const d = extractDateTime(foldQuery("yarın 14:00"), NOW);
    expect(d.date).toBe("2026-10-18");
    expect(d.time).toBe("14:00");
  });
  it("öğleden sonra 3 → 15:00, saat 10 → 10:00", () => {
    expect(extractDateTime(foldQuery("pazartesi öğleden sonra 3"), NOW).time).toBe("15:00");
    expect(extractDateTime(foldQuery("saat 10'da"), NOW).time).toBe("10:00");
  });
  it("hafta günü en yakın gelecek gündür (Cumartesi → Pazartesi 19 Ekim)", () => {
    expect(extractDateTime(foldQuery("pazartesi"), NOW).date).toBe("2026-10-19");
    expect(extractDateTime(foldQuery("cumartesi"), NOW).date).toBe("2026-10-24");
  });
  it("15 kasım ve 03.11", () => {
    expect(extractDateTime(foldQuery("15 kasım"), NOW).date).toBe("2026-11-15");
    expect(extractDateTime(foldQuery("03.11 saat 11"), NOW).date).toBe("2026-11-03");
  });
  it("dönemler: bu hafta (Pzt-Paz), geçen ay, bu yıl", () => {
    expect(periodFor("this_week", NOW)).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });
    expect(periodFor("last_month", NOW)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodFor("this_month", NOW)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodFor("this_year", NOW)).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });
    expect(slots("geçen hafta kaç randevu").period).toMatchObject({ key: "last_week", from: "2026-10-05", to: "2026-10-11" });
  });
});

describe("yuvalar: telefon, kod, ad", () => {
  it.each([
    ["0532 123 45 67", "05321234567"],
    ["+90 532 123 45 67", "05321234567"],
    ["5321234567 kimin", "05321234567"],
    ["0212 555 66 77", "02125556677"],
  ])("telefon %s", (q, phone) => {
    expect(extractPhone(foldQuery(q)).phone).toBe(phone);
  });
  it("portföy kodu", () => {
    expect(extractListingCode("ORNEK-012 nerede").code).toBe("ORNEK-012");
    expect(extractListingCode("kod 4512 olan ilan").code).toBe("4512");
    expect(extractListingCode("#P1023").code).toBe("P1023");
  });
  it("kişi adı: 'için' öncesi, büyük harfli dizi, kesme işaretli ad; yer adı ad sayılmaz", () => {
    expect(extractPersonName("Ahmet Yılmaz için yarın 14:00 randevu")).toBe("Ahmet Yılmaz");
    expect(extractPersonName("ayşe demir için görev")).toBe("ayşe demir");
    expect(extractPersonName("Mehmet Kaya'ya görev ekle")).toBe("Mehmet Kaya");
    expect(extractPersonName("Kadıköy'de 3+1", new Set(["kadikoy"]))).toBeNull();
    expect(extractPersonName("Bugün kaç randevum var")).toBeNull();
  });
});

type Case = {
  q: string;
  intent: ZekaIntent;
  entity?: ZekaEntity | null;
  status?: ZekaStatus | null;
  expect?: Partial<Pick<ZekaSlots, "rooms" | "priceMin" | "priceMax" | "districtId" | "date" | "time" | "personName" | "phone" | "listingCode" | "transaction" | "propertyType">> & { period?: string };
  /** Hangi rolün tipik sorusu (belgeleme). */
  role: "owner" | "advisor" | "call_center" | "accounting" | "team_lead";
};

/** 60+ gerçekçi Türkçe sorgu: beklenen niyet ve yuvalar. */
const CASES: Case[] = [
  // Veri soruları (sayı/toplam)
  { role: "owner", q: "bu ay kaç satış yaptık", intent: "data", entity: "deal", expect: { period: "this_month" } },
  { role: "owner", q: "geçen ay kaç satış yaptık?", intent: "data", entity: "deal", expect: { period: "last_month" } },
  { role: "accounting", q: "geciken kira kaç", intent: "data", entity: "rental", status: "overdue" },
  { role: "owner", q: "en çok satış yapan danışman kim", intent: "data", entity: "deal" },
  { role: "owner", q: "Kadıköy'de 3+1 kaç portföy var", intent: "data", entity: "property", expect: { rooms: ["3+1"], districtId: "d-kadikoy" } },
  { role: "advisor", q: "bugün kaç randevum var", intent: "data", entity: "appointment", expect: { period: "today" } },
  { role: "advisor", q: "yarın kaç randevu var?", intent: "data", entity: "appointment", expect: { period: "tomorrow", date: "2026-10-18" } },
  { role: "team_lead", q: "bu hafta kaç gösterim yaptık", intent: "data", entity: "appointment", expect: { period: "this_week" } },
  { role: "advisor", q: "kaç tane açık talebim var", intent: "data", entity: "demand", status: "open" },
  { role: "owner", q: "toplam müşteri sayısı", intent: "data", entity: "customer" },
  { role: "owner", q: "bu ay ciro ne kadar", intent: "data", entity: "commission", expect: { period: "this_month" } },
  { role: "accounting", q: "bekleyen komisyon toplamı ne kadar", intent: "data", entity: "commission", status: "open" },
  { role: "owner", q: "kaç aktif kiralama var", intent: "data", entity: "rental", status: "open" },
  { role: "owner", q: "bekleyen teklif sayısı", intent: "data", entity: "offer", status: "open" },
  { role: "owner", q: "Çankaya'da kaç satılık daire var", intent: "data", entity: "property", expect: { districtId: "d-cankaya", transaction: "Satılık", propertyType: "Daire" } },
  { role: "owner", q: "5 milyon altı kaç portföy var", intent: "data", entity: "property", expect: { priceMax: 5_000_000 } },
  { role: "owner", q: "2-4 milyon arası 2+1 kaç ilan var", intent: "data", entity: "property", expect: { priceMin: 2_000_000, priceMax: 4_000_000, rooms: ["2+1"] } },
  { role: "advisor", q: "geciken görevlerim kaç", intent: "data", entity: "task", status: "overdue" },
  { role: "owner", q: "geçen yıl kaç anlaşma kapattık", intent: "data", entity: "deal", expect: { period: "last_year" } },
  { role: "owner", q: "Beşiktaş'ta kiralık 2+1 var mı", intent: "data", entity: "property", expect: { districtId: "d-besiktas", transaction: "Kiralık", rooms: ["2+1"] } },
  // Durumlu listeler
  { role: "advisor", q: "geciken görevler", intent: "data", entity: "task", status: "overdue" },
  { role: "advisor", q: "bugünkü görevlerim", intent: "data", entity: "task", status: "today" },
  { role: "accounting", q: "ödenmeyen kiralar", intent: "data", entity: "rental", status: "overdue" },
  { role: "owner", q: "yeni talepler", intent: "data", entity: "demand", status: "new" },
  { role: "owner", q: "kazanılan anlaşmalar", intent: "data", entity: "deal", status: "won" },
  { role: "owner", q: "açık anlaşmaları göster", intent: "data", entity: "deal", status: "open" },
  { role: "advisor", q: "yaklaşan randevular", intent: "data", entity: "appointment", status: "upcoming" },
  // Oluşturma
  { role: "advisor", q: "Ahmet Yılmaz için yarın 14:00 randevu", intent: "create", entity: "appointment", expect: { personName: "Ahmet Yılmaz", date: "2026-10-18", time: "14:00" } },
  { role: "advisor", q: "yeni müşteri ekle", intent: "create", entity: "customer" },
  { role: "call_center", q: "0532 111 22 33 numaralı müşteriyi kaydet", intent: "create", entity: "customer", expect: { phone: "05321112233" } },
  { role: "advisor", q: "Mehmet Kaya'ya görev ekle", intent: "create", entity: "task", expect: { personName: "Mehmet Kaya" } },
  { role: "advisor", q: "pazartesi saat 10 Ayşe Demir ile gösterim planla", intent: "create", entity: "appointment", expect: { date: "2026-10-19", time: "10:00", personName: "Ayşe Demir" } },
  { role: "owner", q: "yeni portföy oluştur", intent: "create", entity: "property" },
  { role: "advisor", q: "talep oluştur", intent: "create", entity: "demand" },
  { role: "owner", q: "kampanya oluştur", intent: "create", entity: "campaign" },
  { role: "owner", q: "yeni danışman ekle", intent: "create", entity: "team" },
  { role: "accounting", q: "gider ekle 5000 TL", intent: "create", entity: "finance" },
  { role: "advisor", q: "Selin Ak için teklif hazırla", intent: "create", entity: "offer", expect: { personName: "Selin Ak" } },
  { role: "advisor", q: "sözleşme oluştur", intent: "create", entity: "contract" },
  { role: "advisor", q: "15 kasım 11:30 randevu ayarla", intent: "create", entity: "appointment", expect: { date: "2026-11-15", time: "11:30" } },
  { role: "advisor", q: "yarın hatırlat görev", intent: "create", entity: "task", expect: { date: "2026-10-18" } },
  // Nasıl yapılır
  { role: "advisor", q: "müşteri nasıl eklenir", intent: "howto", entity: "customer" },
  { role: "advisor", q: "portföy nasıl yayına alınır?", intent: "howto", entity: "property" },
  { role: "owner", q: "Excel'den müşteri nasıl aktarırım", intent: "howto", entity: "customer" },
  { role: "owner", q: "eşleştirme nedir", intent: "howto" },
  { role: "owner", q: "yetki belgesi ne demek", intent: "howto", entity: "contract" },
  { role: "accounting", q: "komisyon nasıl hesaplanır", intent: "howto", entity: "commission" },
  { role: "owner", q: "danışmana yetki nasıl verilir", intent: "howto", entity: "team" },
  { role: "owner", q: "randevu hatırlatma SMS'i nasıl açılır", intent: "howto", entity: "appointment" },
  // Gezinme
  { role: "owner", q: "ayarlar", intent: "navigate" },
  { role: "owner", q: "portföyler sayfasını aç", intent: "navigate", entity: "property" },
  { role: "advisor", q: "müşteriler", intent: "navigate", entity: "customer" },
  { role: "owner", q: "takvime git", intent: "navigate" },
  { role: "owner", q: "kampanyalar ekranı", intent: "navigate", entity: "campaign" },
  { role: "owner", q: "ekip", intent: "navigate", entity: "team" },
  // Rapor
  { role: "owner", q: "komisyon raporu", intent: "report", entity: "commission" },
  { role: "owner", q: "danışman performans raporu", intent: "report", entity: "team" },
  { role: "accounting", q: "aylık gelir gider özeti", intent: "report", entity: "finance" },
  // Kayıt arama
  { role: "call_center", q: "0532 123 45 67", intent: "search", expect: { phone: "05321234567" } },
  { role: "advisor", q: "Ahmet Yılmaz", intent: "search", expect: { personName: "Ahmet Yılmaz" } },
  { role: "advisor", q: "Beşiktaş kiralık 2+1 30 bin altı", intent: "search", entity: "property", expect: { districtId: "d-besiktas", transaction: "Kiralık", rooms: ["2+1"], priceMax: 30_000 } },
  { role: "advisor", q: "Kadıköy 3+1 satılık 15 milyon altı", intent: "search", entity: "property", expect: { districtId: "d-kadikoy", rooms: ["3+1"], priceMax: 15_000_000 } },
  { role: "advisor", q: "ORNEK-012", intent: "search", expect: { listingCode: "ORNEK-012" } },
  { role: "advisor", q: "Üsküdar'daki villalar", intent: "search", entity: "property", expect: { districtId: "d-uskudar", propertyType: "Villa" } },
  { role: "advisor", q: "3 milyon ile 5 milyon arası daire", intent: "search", entity: "property", expect: { priceMin: 3_000_000, priceMax: 5_000_000 } },
  { role: "advisor", q: "Karşıyaka 2+1 kiralık", intent: "search", entity: "property", expect: { districtId: "d-karsiyaka", rooms: ["2+1"] } },
];

describe(`niyet + yuva tablosu (${CASES.length} sorgu)`, () => {
  it("en az 60 gerçekçi sorgu ve her rolden örnek", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(60);
    for (const r of ["owner", "advisor", "call_center", "accounting", "team_lead"] as const) expect(CASES.some((c) => c.role === r)).toBe(true);
  });
  it.each(CASES.map((c) => [c.q, c] as const))("%s", (_q, c) => {
    const s = slots(c.q);
    const d = classifyIntent(c.q, s);
    expect(d.intent, `niyet (${d.reason})`).toBe(c.intent);
    if (c.entity !== undefined) expect(s.entity, "varlık").toBe(c.entity);
    if (c.status !== undefined) expect(s.status, "durum").toBe(c.status);
    const { period, ...rest } = c.expect ?? {};
    if (period) expect(s.period?.key, "dönem").toBe(period);
    for (const [k, v] of Object.entries(rest)) expect((s as Record<string, unknown>)[k], k).toEqual(v);
  });
  it("para tam TL (kısaltma yok)", () => {
    expect(slots("10 milyon altı deniz manzaralı").priceMax).toBe(10_000_000);
    expect(slots("kiralık 25 bin altı").priceMax).toBe(25_000);
  });
  it("'satış' kelimesi portföy dışı bağlamda işlem türü sayılmaz", () => {
    expect(slots("bu ay kaç satış yaptık").transaction).toBeNull();
  });
  it("boş girdi = anlaşılamadı", () => {
    expect(intentOf("   ")).toBe("unknown");
  });
});
