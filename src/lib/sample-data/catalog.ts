/**
 * ÖRNEK VERİ SÖZLÜĞÜ — SAF. Gerçekçi Türkçe adlar, ayrılmış kurgusal telefon aralığı ve İstanbul ilçe/mahalle fiyat
 * tablosu (TAM TL; 2026 sonbaharı piyasa bandına yakın, yalnız demo görünümü içindir — değerleme motoru bunu KULLANMAZ).
 * İlçe/mahalle adları coğrafya tablosundaki (geo_districts / geo_neighborhoods) adlarla aynıdır; çözümlenemeyen mahalle
 * boş bırakılır (tahmin edilmez).
 */

/** Kurgusal telefon aralığı: 0532 000 0x xx (gerçek abone numarası değildir; tüm örnek kişiler bu aralıkta). */
export const SAMPLE_PHONE_PREFIX = "0532000";
export function samplePhone(n: number): string {
  return `${SAMPLE_PHONE_PREFIX}${String(100 + (n % 900)).padStart(4, "0")}`;
}
export function isSamplePhone(phone: string | null | undefined): boolean {
  return typeof phone === "string" && phone.startsWith(SAMPLE_PHONE_PREFIX);
}
/** Demo ekip üyelerinin telefonları (müşteri aralığıyla çakışmaz). */
export const SAMPLE_TEAM_PHONES = ["05320000901", "05320000902", "05320000903"] as const;

export type DistrictKey = "kadikoy" | "besiktas" | "sariyer" | "sisli" | "atasehir" | "maltepe" | "uskudar";

export type DistrictInfo = {
  key: DistrictKey;
  name: string;
  /** Satılık konut ortalama TL/m² (tam TL). */
  saleM2: number;
  /** Kiralık konut aylık TL/m². */
  rentM2: number;
  neighborhoods: readonly string[];
};

export const SAMPLE_DISTRICTS: readonly DistrictInfo[] = [
  { key: "kadikoy", name: "Kadıköy", saleM2: 112_000, rentM2: 520, neighborhoods: ["Caferağa", "Fenerbahçe", "Koşuyolu", "Acıbadem", "Göztepe"] },
  { key: "besiktas", name: "Beşiktaş", saleM2: 138_000, rentM2: 640, neighborhoods: ["Levent", "Etiler", "Ortaköy", "Bebek", "Abbasağa"] },
  { key: "sariyer", name: "Sarıyer", saleM2: 124_000, rentM2: 590, neighborhoods: ["Tarabya", "Yeniköy", "Emirgan", "Maslak"] },
  { key: "sisli", name: "Şişli", saleM2: 104_000, rentM2: 520, neighborhoods: ["Teşvikiye", "Mecidiyeköy", "Fulya", "Esentepe"] },
  { key: "atasehir", name: "Ataşehir", saleM2: 84_000, rentM2: 420, neighborhoods: ["Atatürk", "Barbaros", "Küçükbakkalköy", "İçerenköy"] },
  { key: "maltepe", name: "Maltepe", saleM2: 69_000, rentM2: 360, neighborhoods: ["Altayçeşme", "Cevizli", "Bağlarbaşı", "Feyzullah"] },
  { key: "uskudar", name: "Üsküdar", saleM2: 92_000, rentM2: 440, neighborhoods: ["Kuzguncuk", "Beylerbeyi", "Altunizade", "Acıbadem"] },
];

export const DISTRICT_BY_KEY: Readonly<Record<DistrictKey, DistrictInfo>> = Object.fromEntries(
  SAMPLE_DISTRICTS.map((d) => [d.key, d]),
) as Record<DistrictKey, DistrictInfo>;

/** Mülk tipine göre m² çarpanı (konut = 1). */
const TYPE_FACTOR: Readonly<Record<string, number>> = {
  Daire: 1,
  Rezidans: 1.25,
  Villa: 1.55,
  "Müstakil ev": 1.2,
  Dükkan: 1.35,
  Ofis: 1.05,
  Arsa: 0.32,
};

/** Satış fiyatı 50.000 TL'ye, kira 500 TL'ye yuvarlanır (ilan fiyatı görünümü). */
export function samplePrice(input: { district: DistrictKey; type: string; tx: "Satılık" | "Kiralık"; sqm: number; premium?: number }): number {
  const d = DISTRICT_BY_KEY[input.district];
  const f = (TYPE_FACTOR[input.type] ?? 1) * (input.premium ?? 1);
  if (input.tx === "Kiralık") return Math.max(5_000, Math.round((d.rentM2 * input.sqm * f) / 500) * 500);
  return Math.max(500_000, Math.round((d.saleM2 * input.sqm * f) / 50_000) * 50_000);
}

/** Demo ekip üyeleri (giriş yapamayan örnek profiller; "Gerçek kullanıma geç" ile kaldırılır). */
export const SAMPLE_TEAM = [
  { key: "lead", full_name: "Elif Yıldız", role: "team_lead", title: "Kıdemli gayrimenkul danışmanı" },
  { key: "adv1", full_name: "Burak Şen", role: "advisor", title: "Gayrimenkul danışmanı" },
  { key: "adv2", full_name: "Ceren Aydın", role: "advisor", title: "Kiralama uzmanı" },
] as const;

/** Müşteri türü: tanım tablosunun kanonik değerleri (src/lib/customer-types.ts); burada yalnız tür, liste yok. */
export type CustomerType = string;

/** Örnek müşteriler: gerçekçi ad, tür, kaynak, ilçe ve kısa not. Telefonlar `samplePhone(i)`. */
export const SAMPLE_CUSTOMERS: readonly {
  name: string;
  types: readonly CustomerType[];
  source: "web" | "referral" | "phone" | "walk_in" | "social" | "portal";
  district: DistrictKey;
  heat: "sıcak" | "ılık" | "soğuk";
  vip?: boolean;
  note: string;
}[] = [
  { name: "Selin Aksoy", types: ["Alıcı"], source: "web", district: "kadikoy", heat: "sıcak", note: "3+1, okula yakın daire arıyor. Hafta içi 18:00 sonrası müsait." },
  { name: "Murat Erdem", types: ["Satıcı"], source: "referral", district: "maltepe", heat: "sıcak", note: "Ataşehir'deki 2+1 rezidansını satıp büyük daireye geçmek istiyor." },
  { name: "Deniz Karaca", types: ["Kiracı"], source: "phone", district: "besiktas", heat: "ılık", note: "Kurumsal kiracı; eşyalı 1+1 / 2+1 rezidans arıyor." },
  { name: "Fatma Şahin", types: ["Mülk sahibi"], source: "walk_in", district: "kadikoy", heat: "ılık", vip: true, note: "Moda'daki dükkanı kirada; yönetim hizmeti soruyor." },
  { name: "Kerem Ünal", types: ["Yatırımcı"], source: "social", district: "besiktas", heat: "sıcak", note: "Kira getirisi yüksek küçük daireler topluyor." },
  { name: "Aylin Demirtaş", types: ["Alıcı", "Yatırımcı"], source: "web", district: "maltepe", heat: "sıcak", note: "Sahile yakın 2+1; hem oturum hem yatırım." },
  { name: "Cem Yıldırım", types: ["Alıcı"], source: "portal", district: "atasehir", heat: "soğuk", note: "Portaldan yazdı; bütçesi netleşmedi, ayda bir aranacak." },
  { name: "Ece Tunalı", types: ["Yatırımcı"], source: "referral", district: "sariyer", heat: "sıcak", vip: true, note: "Boğaz'da yalı ya da villa bakıyor; gizlilik önemli." },
  { name: "Hakan Polat", types: ["Alıcı", "Yatırımcı"], source: "portal", district: "sariyer", heat: "ılık", note: "İmarlı arsa; ulaşımı kolay, 1.000 m² üstü." },
  { name: "Zeynep Akın", types: ["Kiracı"], source: "social", district: "kadikoy", heat: "ılık", note: "Butik kafe için cadde üstü dükkan arıyor." },
  { name: "Burak Çelik", types: ["Satıcı", "Mülk sahibi"], source: "phone", district: "atasehir", heat: "ılık", note: "Ofis katını satıyor; peşin alıcı bekliyor." },
  { name: "Gamze Korkmaz", types: ["Alıcı"], source: "walk_in", district: "uskudar", heat: "sıcak", note: "İlk evini alacak; konut kredisi onaylandı." },
  { name: "Onur Kaplan", types: ["Alıcı"], source: "web", district: "sisli", heat: "ılık", note: "Metroya yürüme mesafesinde 2+1." },
  { name: "Derya Arslan", types: ["Mülk sahibi", "Satıcı"], source: "referral", district: "besiktas", heat: "sıcak", vip: true, note: "Levent'teki rezidans dairesi için yetki verdi." },
  { name: "Emre Doğan", types: ["Kiracı"], source: "portal", district: "atasehir", heat: "ılık", note: "Aile; 3+1, site içinde, otoparklı kiralık." },
  { name: "Nazlı Öztürk", types: ["Alıcı"], source: "social", district: "kadikoy", heat: "sıcak", note: "Moda tarafında bahçe katı istiyor." },
  { name: "Tolga Aydemir", types: ["Yatırımcı"], source: "phone", district: "maltepe", heat: "ılık", note: "Levent'teki ofis katını kiraya verdi; villa yatırımı yaptı." },
  { name: "Sevgi Kılıç", types: ["Mülk sahibi"], source: "walk_in", district: "uskudar", heat: "ılık", note: "Urla'daki bahçeli müstakil evini satıyor." },
  { name: "Can Özer", types: ["Alıcı"], source: "web", district: "sariyer", heat: "soğuk", note: "Yazlık değil, kışlık oturum için müstakil ev." },
  { name: "İpek Güneş", types: ["Kiracı"], source: "referral", district: "sisli", heat: "sıcak", note: "Teşvikiye'de eşyalı daire; şirket kiralaması." },
  { name: "Serkan Bulut", types: ["Satıcı"], source: "portal", district: "kadikoy", heat: "ılık", note: "Moda'daki 3+1'i satıyor, takas düşünmüyor." },
  { name: "Melis Ateş", types: ["Alıcı"], source: "social", district: "besiktas", heat: "ılık", note: "Maslak'ta site içinde 3+1 bakıyor." },
  { name: "Okan Tekin", types: ["Yatırımcı", "Alıcı"], source: "referral", district: "atasehir", heat: "sıcak", note: "Finans merkezi yakınında ofis yatırımı." },
  { name: "Buse Yalçın", types: ["Kiracı"], source: "web", district: "maltepe", heat: "soğuk", note: "Öğrenci; Beşiktaş'ta eşyalı 1+1 arıyor." },
  { name: "Volkan Erim", types: ["Mülk sahibi", "Satıcı"], source: "phone", district: "sariyer", heat: "ılık", note: "Sarıyer'deki yalısını ve Silivri'deki arsasını satışa çıkardı." },
  { name: "Hande Çınar", types: ["Alıcı"], source: "walk_in", district: "uskudar", heat: "sıcak", note: "Altunizade'de yeni bina, asansörlü." },
  { name: "Mert Karahan", types: ["Kiracı"], source: "portal", district: "kadikoy", heat: "ılık", note: "Şirketi için geniş ofis katı kiraladı; ikinci ofis arıyor." },
  { name: "Gizem Uçar", types: ["Alıcı"], source: "referral", district: "sisli", heat: "ılık", note: "Fulya'da 3+1, otoparklı." },
  { name: "Kaan Sezer", types: ["Yatırımcı"], source: "social", district: "besiktas", heat: "soğuk", note: "Kısa dönem kiralamaya uygun daire soruyor." },
  { name: "Esra Duman", types: ["Mülk sahibi"], source: "referral", district: "maltepe", heat: "ılık", note: "Nişantaşı'ndaki dükkanını kiraya veriyor." },
];
