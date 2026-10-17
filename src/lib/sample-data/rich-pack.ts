import { buildSplits, calculateCommission } from "@/lib/commission";
import { DEMO_PHOTO_SETS, type DemoPhotoSetMeta } from "@/lib/media/demo-photos";
import { DISTRICT_BY_KEY, SAMPLE_CUSTOMERS, samplePhone, samplePrice, type DistrictKey } from "./catalog";
import { after, createRng, dateKeyOf, dayAt, intBetween, iso, monthKey, pick, spreadOverMonths } from "./timeline";

/**
 * ZENGİN ÖRNEK OFİS PLANI — SAF (ağ/DB yok; aynı tohum + aynı an = aynı plan). `insertSampleRecords` bu planı satır
 * satır yazar; anahtarlar (müşteri adı, portföy kodu, anlaşma anahtarı) yazım sırasında kimliğe çevrilir.
 *
 * Tutarlılık kuralları (rich-pack.test.ts kilitler):
 *  - Her anlaşma GERÇEK bir örnek müşteriye ve portföye bağlıdır; kazanılmış satışın portföyü "sold", kiralamanın "rented".
 *  - Komisyon = uygulamanın kazanma akışıyla aynı formül (`calculateCommission`, portföy oranı, anlaşma fiyatı).
 *  - Tarih zinciri: müşteri/portföy → talep → anlaşma → kazanma → komisyon; hiçbir `created_at` gelecekte değildir.
 *  - Fiyatlar tam TL, ilçe m² bandından (catalog.ts). Telefonlar kurgusal aralıkta.
 */

export type SamplePlanPack = "konut" | "ticari" | "arsa";

export type PlanCustomer = {
  key: string;
  full_name: string;
  phone: string;
  customer_types: string[];
  tags: string[];
  source: string;
  notes: string;
  district: DistrictKey;
  assignee: number;
  created_at: string;
};

export type PlanProperty = {
  code: string;
  title: string;
  tx: "Satılık" | "Kiralık";
  type: string;
  status: "live" | "draft" | "sold" | "rented";
  price: number;
  rate: number;
  rooms: string | null;
  sqm: number;
  /** Yedek fiyat/mahalle tablosu anahtarı (set kullanılan ilanda da dolu; coğrafya `city` + `districtName` ile çözülür). */
  district: DistrictKey;
  city: string;
  districtName: string;
  neighborhood: string | null;
  /** Fotoğraf seti (kütüphane); yoksa null. */
  setId: string | null;
  ownerKey: string | null;
  assignee: number;
  created_at: string;
  published_at: string | null;
  features: Record<string, unknown>;
};

export type PlanDeal = {
  key: string;
  customerKey: string;
  propertyCode: string;
  deal_type: "sale" | "rent";
  stage: "new" | "qualified" | "negotiation" | "won" | "lost";
  deal_value: number;
  probability: number;
  loss_reason: string | null;
  assignee: number;
  created_at: string;
  updated_at: string;
};

export type PlanCommission = { dealKey: string; gross_amount: number; vat_amount: number; status: "paid" | "calculated"; splits: ReturnType<typeof buildSplits>; created_at: string };

export type SamplePlan = {
  customers: PlanCustomer[];
  properties: PlanProperty[];
  demands: {
    customerKey: string; transaction_type: string; property_type: string; city: string; districtName: string | null; budget_min: number; budget_max: number;
    rooms: string | null; min_sqm: number; urgency: string; status: string; created_at: string;
  }[];
  deals: PlanDeal[];
  commissions: PlanCommission[];
  offers: { propertyCode: string; customerKey: string; amount: number; status: string; counter_amount: number | null; valid_until: string; notes: string; submitted_at: string; created_at: string }[];
  contracts: { title: string; contract_type: "satis" | "kira" | "diger"; status: "draft" | "sent" | "signed"; propertyCode: string; customerKey: string; body: string; created_at: string; signed_at: string | null }[];
  rentals: { propertyCode: string; renterKey: string; monthly_rent: number; deposit: number; due_day: number; start_date: string; end_date: string; created_at: string; charges: { period: string; amount: number; status: "paid" | "pending" | "overdue"; paid_at: string | null }[] }[];
  tasks: { title: string; kind: string; priority: string; status: "open" | "done"; due_at: string; customerKey: string | null; propertyCode: string | null; assignee: number; created_at: string }[];
  appointments: { appointment_type: string; scheduled_at: string; duration_min: number; location: string; status: string; customerKey: string; propertyCode: string | null; assignee: number; created_at: string }[];
  expenses: { category: string; title: string; amount: number; expense_date: string }[];
  calls: { customerKey: string; direction: "inbound" | "outbound" | "missed"; duration_sec: number; disposition: string | null; started_at: string; assignee: number }[];
  messages: { customerKey: string; channel: "whatsapp" | "sms" | "email" | "note"; direction: "inbound" | "outbound"; subject: string | null; body: string; created_at: string; assignee: number }[];
  campaigns: { title: string; channel: "sms" | "whatsapp"; message: string; status: "done" | "draft"; total_count: number; sent_count: number; failed_count: number; sent_at: string | null; created_at: string }[];
  notifications: { title: string; body: string; href: string; kind: "info" | "success" | "warning"; created_at: string; assignee: number }[];
};

type PropDef = {
  code: string; tx: "Satılık" | "Kiralık"; type: string; status: PlanProperty["status"]; rooms: string | null; sqm: number; district: DistrictKey; hood: number;
  premium?: number; owner?: string; label: string; floor?: number; age?: number; heating?: string;
  /** Demo fotoğraf kütüphanesi seti (src/lib/media/demo-photos.ts). Set varsa başlık, tür, oda, m², il/ilçe ve fiyat SETTEN gelir. */
  set: string;
};

/**
 * 22 portföy = kütüphanedeki 22 fotoğraf seti (her ilan kendi fotoğraflarıyla tutarlı): canlı satılık/kiralık, bir taslak,
 * 5 satılmış (kazanılmış anlaşma) ve 3 kiradaki. Set manifestte yoksa yedek (sentetik) alanlar kullanılır ve ilan
 * fotoğrafsız kalır.
 */
const PROPERTY_SLOTS: readonly PropDef[] = [
  { code: "EMS-1001", set: "kadikoy-moda-3p1", tx: "Satılık", type: "Daire", status: "live", rooms: "3+1", sqm: 140, district: "kadikoy", hood: 0, owner: "Serkan Bulut", label: "deniz manzaralı 3+1", floor: 5, age: 8, heating: "Kombi" },
  { code: "EMS-1002", set: "ist-atasehir-2p1", tx: "Satılık", type: "Rezidans", status: "live", rooms: "2+1", sqm: 105, district: "atasehir", hood: 0, owner: "Murat Erdem", label: "rezidansta 2+1", floor: 9, age: 4, heating: "Merkezi" },
  { code: "EMS-1004", set: "urla-mustakil-ev", tx: "Satılık", type: "Müstakil ev", status: "live", rooms: "4+1", sqm: 210, district: "uskudar", hood: 0, owner: "Sevgi Kılıç", label: "bahçeli müstakil ev", age: 12, heating: "Doğalgaz" },
  { code: "EMS-1005", set: "sariyer-bogaz-yali", tx: "Satılık", type: "Villa", status: "live", rooms: "7+2", sqm: 650, district: "sariyer", hood: 2, premium: 3, owner: "Volkan Erim", label: "Boğaz'a sıfır tarihi yalı", age: 120, heating: "Yerden ısıtma" },
  { code: "EMS-1006", set: "nisantasi-cadde-dukkan", tx: "Kiralık", type: "Dükkan", status: "live", rooms: null, sqm: 85, district: "sisli", hood: 0, owner: "Esra Duman", label: "cadde üstü vitrinli dükkan" },
  { code: "EMS-1008", set: "kadikoy-butik-ofis", tx: "Satılık", type: "Ofis", status: "live", rooms: "4+1", sqm: 120, district: "kadikoy", hood: 3, owner: "Burak Çelik", label: "metroya yakın butik ofis", floor: 3, age: 15 },
  { code: "EMS-1009", set: "silivri-imarli-arsa", tx: "Satılık", type: "Arsa", status: "live", rooms: null, sqm: 1000, district: "sariyer", hood: 3, owner: "Volkan Erim", label: "konut imarlı arsa" },
  { code: "EMS-1010", set: "besiktas-bogaz-2p1", tx: "Satılık", type: "Daire", status: "live", rooms: "2+1", sqm: 110, district: "besiktas", hood: 2, label: "Boğaz manzaralı 2+1", floor: 4, age: 35, heating: "Kombi" },
  { code: "EMS-1011", set: "basaksehir-site-3p1", tx: "Satılık", type: "Daire", status: "live", rooms: "3+1", sqm: 145, district: "atasehir", hood: 1, label: "havuzlu sitede 3+1", floor: 6, age: 5, heating: "Merkezi" },
  { code: "EMS-1013", set: "ist-maslak-3p1", tx: "Satılık", type: "Rezidans", status: "live", rooms: "3+1", sqm: 155, district: "sariyer", hood: 3, label: "site içinde 3+1 rezidans", floor: 12, age: 6, heating: "Merkezi" },
  { code: "EMS-1014", set: "sisli-rezidans-penthouse", tx: "Satılık", type: "Rezidans", status: "live", rooms: "4+1", sqm: 290, district: "sisli", hood: 3, label: "teraslı dubleks penthouse", floor: 24, age: 3, heating: "Yerden ısıtma" },
  { code: "EMS-1015", set: "maslak-plaza-ofis", tx: "Kiralık", type: "Ofis", status: "live", rooms: null, sqm: 450, district: "sariyer", hood: 3, label: "plaza katında ofis", floor: 15, age: 8 },
  { code: "EMS-1017", set: "urla-zeytinlik", tx: "Satılık", type: "Arsa", status: "live", rooms: null, sqm: 12500, district: "sariyer", hood: 0, premium: 0.05, label: "yola cepheli zeytinlik" },
  { code: "EMS-1016", set: "kas-deniz-manzarali-villa", tx: "Satılık", type: "Villa", status: "draft", rooms: "3+1", sqm: 220, district: "sariyer", hood: 1, label: "havuzlu villa (yayına hazırlanıyor)", age: 7, heating: "Klima" },
  // Kapanmış portföyler (kazanılmış anlaşmalar)
  { code: "EMS-0901", set: "ayvalik-yazlik", tx: "Satılık", type: "Müstakil ev", status: "sold", rooms: "3+1", sqm: 135, district: "uskudar", hood: 1, label: "taş yazlık", age: 60, heating: "Soba" },
  { code: "EMS-0902", set: "cesme-alacati-tas-villa", tx: "Satılık", type: "Villa", status: "sold", rooms: "4+1", sqm: 260, district: "sariyer", hood: 1, label: "taş villa", age: 15, heating: "Yerden ısıtma" },
  { code: "EMS-0903", set: "fethiye-modern-villa", tx: "Satılık", type: "Villa", status: "sold", rooms: "4+1", sqm: 280, district: "sariyer", hood: 2, label: "modern havuzlu villa", age: 4, heating: "Klima" },
  { code: "EMS-0904", set: "bodrum-yalikavak-villa", tx: "Satılık", type: "Villa", status: "sold", rooms: "4+1", sqm: 320, district: "sariyer", hood: 0, label: "deniz manzaralı villa", age: 6, heating: "Klima" },
  { code: "EMS-0905", set: "beykoz-bahceli-villa", tx: "Satılık", type: "Villa", status: "sold", rooms: "5+1", sqm: 380, district: "uskudar", hood: 1, label: "bahçeli müstakil villa", age: 10, heating: "Doğalgaz" },
  { code: "EMS-0801", set: "besiktas-ogrenci-1p1", tx: "Kiralık", type: "Daire", status: "rented", rooms: "1+1", sqm: 55, district: "besiktas", hood: 4, owner: "Derya Arslan", label: "eşyalı 1+1 (kiracılı)", floor: 2, age: 25, heating: "Kombi" },
  { code: "EMS-0802", set: "levent-bos-ofis-kati", tx: "Kiralık", type: "Ofis", status: "rented", rooms: null, sqm: 900, district: "besiktas", hood: 0, owner: "Tolga Aydemir", label: "ofis katı (kiracılı)", floor: 7, age: 12 },
  { code: "EMS-0803", set: "moda-kafe-dukkan", tx: "Kiralık", type: "Dükkan", status: "rented", rooms: null, sqm: 140, district: "kadikoy", hood: 0, owner: "Fatma Şahin", label: "kafe olarak işletilen dükkan (kiracılı)" },
];

/** Paket damgası (konut | ticari | arsa) içerik setini değiştirmez: 22 fotoğraflı ilan her pakette aynıdır. */
function propertyDefs(_pack: SamplePlanPack): readonly PropDef[] {
  return PROPERTY_SLOTS;
}

/** Kütüphane mülk türü → properties.property_type. */
const SET_TYPE: Record<string, string> = {
  daire: "Daire", rezidans: "Rezidans", villa: "Villa", mustakil: "Müstakil ev", yali: "Villa", yazlik: "Müstakil ev", ofis: "Ofis", dukkan: "Dükkan", arsa: "Arsa",
};

/** Fiyat bandı içinde tam TL ilan fiyatı (satış 50.000, kira 500 / 5.000 TL adımı; bant dışına taşmaz). */
export function priceInBand(band: { min: number; max: number }, f: number, rent: boolean): number {
  const step = rent ? (band.max >= 100_000 ? 5_000 : 500) : 50_000;
  const lo = Math.ceil(band.min / step) * step;
  const hi = Math.floor(band.max / step) * step;
  const raw = band.min + (band.max - band.min) * Math.min(1, Math.max(0, f));
  return Math.min(hi, Math.max(lo, Math.round(raw / step) * step));
}

const RATE = { sale: 2, rent: 100 / 12 } as const;

/** Türkçe bulunma eki: "Caferağa'da", "Levent'te", "Teşvikiye'de" (son ünlü uyumu + sert ünsüz benzeşmesi). */
export function locative(word: string): string {
  const lower = word.toLocaleLowerCase("tr-TR");
  const vowels = [...lower].filter((ch) => "aıoueiöü".includes(ch));
  const last = vowels.at(-1) ?? "e";
  const vowel = "aıou".includes(last) ? "a" : "e";
  const hard = "çfhkpsşt".includes(lower.at(-1) ?? "");
  return `${word}'${hard ? "t" : "d"}${vowel}`;
}

function title(def: PropDef): string {
  const d = DISTRICT_BY_KEY[def.district];
  const hood = d.neighborhoods[def.hood] ?? null;
  return hood ? `${d.name} ${locative(hood)} ${def.label}` : `${locative(d.name)} ${def.label}`;
}

export function buildSamplePlan(input: { nowMs: number; seed: string; pack?: SamplePlanPack; teamSize: number; sets?: readonly DemoPhotoSetMeta[] }): SamplePlan {
  const rng = createRng(`ornek:${input.seed}`);
  const now = input.nowMs;
  const team = Math.max(1, input.teamSize); // 0 = sahip; 1..n = demo ekip
  const who = (i: number) => i % team;

  // ---- müşteriler: son 6 aya yayılmış ----
  const custStamps = spreadOverMonths({ count: SAMPLE_CUSTOMERS.length, nowMs: now, months: 6, rng });
  const customers: PlanCustomer[] = SAMPLE_CUSTOMERS.map((c, i) => ({
    key: c.name,
    full_name: c.name,
    phone: samplePhone(i + 1),
    customer_types: [...c.types],
    tags: [c.heat, ...(c.vip ? ["vip"] : [])],
    source: c.source,
    notes: c.note,
    district: c.district,
    assignee: who(i),
    created_at: iso(custStamps[i]!),
  }));
  const custAt = new Map(customers.map((c) => [c.key, Date.parse(c.created_at)]));

  // ---- portföyler ----
  const defs = propertyDefs(input.pack ?? "konut");
  const closed = defs.filter((d) => d.status === "sold" || d.status === "rented");
  const openDefs = defs.filter((d) => !closed.includes(d));
  // Kapanmışlar en eski dönemden, açık ilanlar 6 aya yayılır.
  const openStamps = spreadOverMonths({ count: openDefs.length, nowMs: now, months: 6, rng });
  const closedStamps = spreadOverMonths({ count: closed.length, nowMs: now - 75 * 86_400_000, months: 4, rng });
  const propStamp = new Map<string, number>();
  openDefs.forEach((d, i) => propStamp.set(d.code, openStamps[i]!));
  closed.forEach((d, i) => propStamp.set(d.code, closedStamps[i]!));

  const setById = new Map<string, DemoPhotoSetMeta>((input.sets ?? DEMO_PHOTO_SETS).map((x) => [x.id, x]));
  const properties: PlanProperty[] = defs.map((d, i) => {
    const created = propStamp.get(d.code)!;
    const ownerCreated = d.owner ? custAt.get(d.owner) : undefined;
    // Malik müşteri portföyden önce kaydolmuş olmalı: değilse portföy malikten sonraya kayar.
    const createdMs = ownerCreated && ownerCreated > created ? after(ownerCreated, 0.2, 3, now, rng) : created;
    const set = setById.get(d.set) ?? null;
    const tx: "Satılık" | "Kiralık" = set ? (set.listingType === "kiralik" ? "Kiralık" : "Satılık") : d.tx;
    const type = set ? (SET_TYPE[set.propertyType] ?? d.type) : d.type;
    const rooms = set ? set.rooms : d.rooms;
    const sqm = set ? set.areaM2 : d.sqm;
    const f = 0.3 + rng() * 0.4;
    const price = set
      ? priceInBand(set.priceBand, f, set.priceBand.period === "aylik")
      : samplePrice({ district: d.district, type: d.type, tx: d.tx, sqm: d.sqm, premium: d.premium });
    const hood = set ? null : (DISTRICT_BY_KEY[d.district].neighborhoods[d.hood] ?? null);
    const features: Record<string, unknown> = { sqm };
    if (rooms) features.rooms = rooms;
    if (d.floor != null) features.floor = d.floor;
    if (d.age != null) features.building_age = d.age;
    if (d.heating) features.heating = d.heating;
    return {
      code: d.code,
      title: set ? set.title : title(d),
      tx,
      type,
      status: d.status,
      price,
      rate: tx === "Kiralık" ? 10 : type === "Arsa" ? 3 : RATE.sale,
      rooms,
      sqm,
      district: d.district,
      city: set ? set.city : "İstanbul",
      districtName: set ? set.district : DISTRICT_BY_KEY[d.district].name,
      neighborhood: hood,
      setId: set ? set.id : null,
      ownerKey: d.owner ?? null,
      assignee: who(i + 1),
      created_at: iso(createdMs),
      published_at: d.status === "draft" ? null : iso(after(createdMs, 0.5, 2, now, rng)),
      features,
    };
  });
  const prop = new Map(properties.map((p) => [p.code, p]));
  const propAt = (code: string) => Date.parse(prop.get(code)!.created_at);

  // ---- anlaşmalar: tüm aşamalar ----
  const deals: PlanDeal[] = [];
  const dealAfter = (customerKey: string, code: string, minD: number, maxD: number) =>
    after(Math.max(custAt.get(customerKey)!, propAt(code)), minD, maxD, now, rng);
  const open: [string, string, PlanDeal["stage"], number, number][] = [
    // müşteri, portföy, aşama, fiyat çarpanı, olasılık
    ["Selin Aksoy", "EMS-1001", "negotiation", 0.97, 65],
    ["Aylin Demirtaş", "EMS-1002", "negotiation", 0.96, 70],
    ["Ece Tunalı", "EMS-1005", "qualified", 0.93, 40],
    ["Onur Kaplan", "EMS-1010", "qualified", 0.98, 45],
    ["Okan Tekin", "EMS-1008", "negotiation", 0.94, 60],
    ["Nazlı Öztürk", "EMS-1014", "new", 1, 20],
    ["Hakan Polat", "EMS-1009", "new", 1, 15],
    ["Gizem Uçar", "EMS-1011", "qualified", 0.97, 35],
    ["Melis Ateş", "EMS-1013", "new", 1, 20],
  ];
  open.forEach(([c, code, stage, f, prob], i) => {
    const created = dealAfter(c, code, 1, 25);
    const p = prop.get(code)!;
    deals.push({
      key: `acik-${i}`, customerKey: c, propertyCode: code, deal_type: "sale", stage, probability: prob, loss_reason: null,
      deal_value: Math.round((p.price * f) / 50_000) * 50_000, assignee: p.assignee,
      created_at: iso(created), updated_at: iso(after(created, 0.5, 10, now, rng)),
    });
  });
  const won: [string, string][] = [
    ["Gamze Korkmaz", "EMS-0901"],
    ["Kerem Ünal", "EMS-0902"],
    ["Hande Çınar", "EMS-0905"],
    ["Derya Arslan", "EMS-0904"],
    ["Tolga Aydemir", "EMS-0903"],
  ];
  const commissions: PlanCommission[] = [];
  won.forEach(([c, code], i) => {
    const p = prop.get(code)!;
    const created = dealAfter(c, code, 3, 20);
    const wonAt = after(created, 12, 40, now, rng);
    const value = Math.round((p.price * (0.95 + rng() * 0.04)) / 50_000) * 50_000;
    deals.push({ key: `kazanildi-${i}`, customerKey: c, propertyCode: code, deal_type: "sale", stage: "won", probability: 100, loss_reason: null, deal_value: value, assignee: p.assignee, created_at: iso(created), updated_at: iso(wonAt) });
    const calc = calculateCommission({ amount: value, rate: p.rate });
    commissions.push({
      dealKey: `kazanildi-${i}`, gross_amount: calc.net, vat_amount: calc.vat, splits: buildSplits(calc.net),
      // Eski kazançlar tahsil edilmiş, son iki ay "hesaplandı" (tahsil bekliyor).
      status: now - wonAt > 45 * 86_400_000 ? "paid" : "calculated",
      created_at: iso(wonAt),
    });
  });
  const lost: [string, string, string][] = [
    ["Cem Yıldırım", "EMS-1004", "fiyat_yuksek"],
    ["Can Özer", "EMS-1004", "baska_ofis"],
    ["Kaan Sezer", "EMS-1013", "vazgecti"],
  ];
  lost.forEach(([c, code, reason], i) => {
    const created = dealAfter(c, code, 2, 15);
    deals.push({
      key: `kayip-${i}`, customerKey: c, propertyCode: code, deal_type: "sale", stage: "lost", probability: 0, loss_reason: reason,
      deal_value: prop.get(code)!.price, assignee: prop.get(code)!.assignee, created_at: iso(created), updated_at: iso(after(created, 5, 25, now, rng)),
    });
  });

  // ---- talepler: ilana bağlı olanlar ilanın kendisinden türer (tür, il/ilçe, oda, m², fiyatın ±%10 bandı) ----
  const demandDefs: [string, string | null, string, string, DistrictKey | null, number, number, string | null, number, string, string][] = [
    // müşteri, bağlı ilan | null, (bağsızsa) işlem, tür, ilçe, bütçe alt/üst, oda, min m², aciliyet, durum
    ["Selin Aksoy", "EMS-1001", "", "", null, 0, 0, null, 0, "yüksek", "matched"],
    ["Deniz Karaca", null, "Kiralık", "Rezidans", "besiktas", 40_000, 55_000, "1+1", 50, "orta", "active"],
    ["Aylin Demirtaş", "EMS-1002", "", "", null, 0, 0, null, 0, "orta", "matched"],
    ["Ece Tunalı", "EMS-1005", "", "", null, 0, 0, null, 0, "yüksek", "active"],
    ["Hakan Polat", "EMS-1009", "", "", null, 0, 0, null, 0, "orta", "active"],
    ["Zeynep Akın", "EMS-1006", "", "", null, 0, 0, null, 0, "düşük", "new"],
    ["Onur Kaplan", "EMS-1010", "", "", null, 0, 0, null, 0, "orta", "matched"],
    ["Emre Doğan", null, "Kiralık", "Daire", "atasehir", 45_000, 65_000, "3+1", 120, "yüksek", "active"],
    ["Nazlı Öztürk", "EMS-1014", "", "", null, 0, 0, null, 0, "orta", "active"],
    ["İpek Güneş", null, "Kiralık", "Daire", "sisli", 60_000, 80_000, "3+1", 110, "yüksek", "active"],
    ["Buse Yalçın", "EMS-0801", "", "", null, 0, 0, null, 0, "düşük", "new"],
    ["Okan Tekin", "EMS-1008", "", "", null, 0, 0, null, 0, "orta", "matched"],
    ["Gizem Uçar", "EMS-1011", "", "", null, 0, 0, null, 0, "orta", "active"],
    ["Mert Karahan", "EMS-1015", "", "", null, 0, 0, null, 0, "orta", "new"],
  ];
  const band = (price: number, rent: boolean, up: boolean) => {
    const step = rent ? (price >= 100_000 ? 5_000 : 500) : 50_000;
    return Math.round((price * (up ? 1.1 : 0.9)) / step) * step;
  };
  const demands = demandDefs.map(([c, code, tx0, type0, d0, min0, max0, rooms0, sqm0, urgency, status]) => {
    const p = code ? prop.get(code) : undefined;
    const rent = p ? p.tx === "Kiralık" : tx0 === "Kiralık";
    return {
      customerKey: c,
      transaction_type: p ? p.tx : tx0,
      property_type: p ? p.type : type0,
      city: p ? p.city : "İstanbul",
      districtName: p ? p.districtName : d0 ? DISTRICT_BY_KEY[d0].name : null,
      budget_min: p ? band(p.price, rent, false) : min0,
      budget_max: p ? band(p.price, rent, true) : max0,
      rooms: p ? p.rooms : rooms0,
      min_sqm: p ? Math.round(p.sqm * 0.85) : sqm0,
      urgency,
      status,
      created_at: iso(after(custAt.get(c)!, 0, 4, now, rng)),
    };
  });

  // ---- teklifler (müzakere ekranı) ----
  const offerDefs: [string, string, number, string, number | null, string][] = [
    ["EMS-1001", "Selin Aksoy", 0.93, "countered", 0.97, "Peşin ödeme; mal sahibi karşı teklif verdi."],
    ["EMS-1002", "Aylin Demirtaş", 0.95, "submitted", null, "Kredi onaylı alıcı."],
    ["EMS-1008", "Okan Tekin", 0.9, "countered", 0.95, "Şirket adına alım; KDV teyidi bekleniyor."],
    ["EMS-1005", "Ece Tunalı", 0.88, "submitted", null, "İlk teklif; ekspertiz sonrası revize edilecek."],
    ["EMS-0902", "Kerem Ünal", 0.97, "accepted", null, "Kabul edildi; tapu tamamlandı."],
  ];
  const offers = offerDefs.map(([code, c, f, status, cf, notes]) => {
    const p = prop.get(code)!;
    const created = dealAfter(c, code, 2, 20);
    return {
      propertyCode: code, customerKey: c, amount: Math.round((p.price * f) / 50_000) * 50_000, status,
      counter_amount: cf ? Math.round((p.price * cf) / 50_000) * 50_000 : null,
      valid_until: dateKeyOf(now + intBetween(rng, 3, 12) * 86_400_000), notes, submitted_at: iso(created), created_at: iso(created),
    };
  });

  // ---- kiralar: biri gecikmiş ----
  const rentalDefs: [string, string, number][] = [
    ["EMS-0801", "Deniz Karaca", 5],
    ["EMS-0802", "Mert Karahan", 1],
    ["EMS-0803", "Zeynep Akın", 10],
  ];
  const rentals = rentalDefs.map(([code, renter, due], i) => {
    const p = prop.get(code)!;
    const startMonthsBack = 4 + i;
    const charges = [] as SamplePlan["rentals"][number]["charges"];
    for (let m = startMonthsBack - 1; m >= 0; m--) {
      const period = monthKey(now, m);
      const late = i === 1 && m <= 1; // ikinci kirada son iki dönem gecikmiş
      const status: "paid" | "pending" | "overdue" = m === 0 ? (late ? "overdue" : "pending") : late ? "overdue" : "paid";
      charges.push({ period, amount: p.price, status, paid_at: status === "paid" ? iso(dayAt(Date.parse(`${period}T09:00:00Z`), due + intBetween(rng, -1, 3), 11)) : null });
    }
    const startDate = monthKey(now, startMonthsBack);
    return {
      propertyCode: code, renterKey: renter, monthly_rent: p.price, deposit: p.price * 2, due_day: due, start_date: startDate,
      end_date: dateKeyOf(Date.parse(`${startDate}T09:00:00Z`) + 365 * 86_400_000), created_at: iso(Math.max(propAt(code), custAt.get(renter)!) + 86_400_000),
      charges,
    };
  });

  // ---- sözleşmeler ----
  const contracts: SamplePlan["contracts"] = [
    { title: "EMS-0901 satış sözleşmesi", contract_type: "satis", status: "signed", propertyCode: "EMS-0901", customerKey: "Gamze Korkmaz", body: "Taraflar arasında taşınmaz satış vaadi ve komisyon şartları.", created_at: deals.find((d) => d.key === "kazanildi-0")!.updated_at, signed_at: deals.find((d) => d.key === "kazanildi-0")!.updated_at },
    { title: "EMS-0801 kira sözleşmesi", contract_type: "kira", status: "signed", propertyCode: "EMS-0801", customerKey: "Deniz Karaca", body: "Konut kira sözleşmesi; depozito iki aylık kira bedelidir.", created_at: rentals[0]!.created_at, signed_at: rentals[0]!.created_at },
    { title: "EMS-1002 satış ön protokolü", contract_type: "satis", status: "sent", propertyCode: "EMS-1002", customerKey: "Aylin Demirtaş", body: "Kapora ve tapu devir tarihi taslağı; imza bekleniyor.", created_at: iso(after(Date.parse(deals[1]!.created_at), 1, 6, now, rng)), signed_at: null },
    { title: "EMS-1005 yetki sözleşmesi", contract_type: "diger", status: "draft", propertyCode: "EMS-1005", customerKey: "Volkan Erim", body: "Münhasır satış yetkisi, 6 ay.", created_at: iso(after(propAt("EMS-1005"), 0, 2, now, rng)), signed_at: null },
  ];

  // ---- görevler: gecikmiş, bugün, ileri ve tamamlanmış ----
  const taskDefs: [string, string, string, number, number, string | null, string | null, "open" | "done"][] = [
    ["Selin Aksoy'a karşı teklifi ilet", "call", "high", 0, 11, "Selin Aksoy", "EMS-1001", "open"],
    ["EMS-1002 ilanının fotoğraflarını yenile", "followup", "normal", 0, 15, null, "EMS-1002", "open"],
    ["Okan Tekin için KDV yazısını hazırla", "document", "high", 0, 17, "Okan Tekin", "EMS-1008", "open"],
    ["Zeynep Akın'a dükkan seçeneklerini gönder", "followup", "normal", 0, 16, "Zeynep Akın", "EMS-1006", "open"],
    ["Murat Erdem'den yetki belgesi imzası al", "document", "high", -1, 11, "Murat Erdem", "EMS-1002", "open"],
    ["Fatma Şahin'in dairesi için fotoğraf çekimi", "visit", "normal", -2, 15, "Fatma Şahin", null, "open"],
    ["Cem Yıldırım'ı tekrar ara", "call", "normal", -3, 10, "Cem Yıldırım", null, "open"],
    ["Mert Karahan'a geciken kira için hatırlatma", "call", "high", -4, 10, "Mert Karahan", "EMS-0802", "open"],
    ["Buse Yalçın'a uygun 1+1'leri ilet", "followup", "low", -6, 14, "Buse Yalçın", null, "open"],
    ["Ece Tunalı için yalı sunumunu hazırla", "followup", "high", 1, 12, "Ece Tunalı", "EMS-1005", "open"],
    ["Hakan Polat'a imar durumu belgesini gönder", "document", "normal", 2, 16, "Hakan Polat", "EMS-1009", "open"],
    ["Burak Çelik'in butik ofisi için değerleme raporu iste", "followup", "normal", 3, 13, "Burak Çelik", "EMS-1008", "open"],
    ["Nazlı Öztürk ile penthouse gösterimi planla", "visit", "normal", 4, 11, "Nazlı Öztürk", "EMS-1014", "open"],
    ["Derya Arslan'a aylık malik raporunu gönder", "followup", "low", 6, 10, "Derya Arslan", "EMS-0801", "open"],
    ["Volkan Erim ile yetki sözleşmesini imzala", "document", "high", 2, 15, "Volkan Erim", "EMS-1005", "open"],
    ["Gizem Uçar'a site aidat bilgisini ilet", "call", "low", 5, 17, "Gizem Uçar", "EMS-1011", "open"],
    ["Gamze Korkmaz tapu randevusunu teyit et", "call", "high", -20, 11, "Gamze Korkmaz", "EMS-0901", "done"],
    ["Kerem Ünal'ın kredi evraklarını topla", "document", "normal", -35, 14, "Kerem Ünal", "EMS-0902", "done"],
    ["Deniz Karaca kira sözleşmesini taranmış olarak arşivle", "document", "low", -60, 10, "Deniz Karaca", "EMS-0801", "done"],
    ["Hande Çınar'a anahtar teslimi", "visit", "normal", -12, 16, "Hande Çınar", "EMS-0905", "done"],
  ];
  const tasks = taskDefs.map(([t, kind, priority, off, hour, c, code, status], i) => {
    const due = dayAt(now, off, hour);
    const created = Math.min(due - intBetween(rng, 1, 6) * 86_400_000, now - 2 * 3_600_000);
    const floor = c ? custAt.get(c)! + 3_600_000 : 0;
    return { title: t, kind, priority, status, due_at: iso(due), customerKey: c, propertyCode: code, assignee: who(i), created_at: iso(Math.max(created, floor)) };
  });

  // ---- randevular: geçmiş (tamamlandı), bugün, ileri ----
  const apptDefs: [string, number, number, number, string, string, string | null, number][] = [
    ["showing", 0, 11, 0, "confirmed", "Ece Tunalı", "EMS-1005", 60],
    ["showing", 0, 16, 30, "confirmed", "Selin Aksoy", "EMS-1001", 45],
    ["office", 0, 18, 0, "pending", "Okan Tekin", "EMS-1008", 30],
    ["valuation", 1, 10, 30, "pending", "Volkan Erim", "EMS-1005", 60],
    ["showing", 1, 14, 0, "confirmed", "Gizem Uçar", "EMS-1011", 45],
    ["office", 2, 11, 0, "pending", "Deniz Karaca", null, 30],
    ["showing", 3, 15, 0, "pending", "Nazlı Öztürk", "EMS-1014", 45],
    ["signing", 4, 13, 30, "pending", "Aylin Demirtaş", "EMS-1002", 90],
    ["showing", 6, 12, 0, "pending", "Melis Ateş", "EMS-1013", 45],
    ["showing", -1, 15, 0, "completed", "Aylin Demirtaş", "EMS-1002", 45],
    ["showing", -2, 17, 0, "completed", "Onur Kaplan", "EMS-1010", 45],
    ["valuation", -4, 11, 0, "completed", "Burak Çelik", "EMS-1008", 60],
    ["showing", -6, 14, 0, "completed", "Gizem Uçar", "EMS-1011", 45],
    ["office", -9, 10, 30, "completed", "Hakan Polat", "EMS-1009", 30],
    ["signing", -20, 14, 0, "completed", "Gamze Korkmaz", "EMS-0901", 90],
    ["showing", -27, 16, 0, "completed", "Hande Çınar", "EMS-0905", 45],
  ];
  const appointments = apptDefs.map(([type, off, h, m, status, c, code, dur], i) => {
    const at = dayAt(now, off, h, m);
    const loc = code ? `${prop.get(code)!.title}` : "Ofis";
    const created = Math.max(custAt.get(c)! + 3_600_000, Math.min(at - intBetween(rng, 1, 5) * 86_400_000, now - 3_600_000));
    return { appointment_type: type, scheduled_at: iso(at), duration_min: dur, location: loc.slice(0, 120), status, customerKey: c, propertyCode: code, assignee: who(i), created_at: iso(created) };
  });

  // ---- giderler: 6 ay, aylık sabitler + değişkenler ----
  const expenses: SamplePlan["expenses"] = [];
  for (let m = 5; m >= 0; m--) {
    const month = monthKey(now, m);
    const day = (d: number) => `${month.slice(0, 8)}${String(d).padStart(2, "0")}`;
    const inPast = (key: string) => Date.parse(`${key}T12:00:00Z`) <= now;
    const rows: [string, string, number, number][] = [
      ["ofis", "Ofis kirası", 48_000, 3],
      ["reklam", "Portal premium ilan paketi", 9_500 + intBetween(rng, 0, 6) * 500, 6],
      ["ulasim", "Yer gösterme yakıt ve otopark", 2_400 + intBetween(rng, 0, 10) * 150, 18],
    ];
    if (m % 2 === 0) rows.push(["reklam", "Sosyal medya reklamı", 6_000 + intBetween(rng, 0, 8) * 250, 12]);
    if (m === 3) rows.push(["egitim", "Danışman eğitimi (müzakere teknikleri)", 7_500, 22]);
    for (const [category, t, amount, d] of rows) {
      const key = day(d);
      if (inPast(key)) expenses.push({ category, title: t, amount, expense_date: key });
    }
  }

  // ---- aramalar (son 30 gün) ----
  const callCustomers = ["Selin Aksoy", "Cem Yıldırım", "Hakan Polat", "Okan Tekin", "Emre Doğan", "Ece Tunalı", "Nazlı Öztürk", "Zeynep Akın", "Murat Erdem", "Gizem Uçar", "Melis Ateş", "Buse Yalçın", "Derya Arslan", "Onur Kaplan", "İpek Güneş", "Volkan Erim"];
  const dispositions = ["Randevu alındı", "Bilgi verildi", "Geri aranacak", "Teklif iletildi", null];
  const calls = callCustomers.map((c, i) => {
    const direction = (["outbound", "inbound", "outbound", "missed"] as const)[i % 4]!;
    const at = Math.max(custAt.get(c)! + 3_600_000, now - intBetween(rng, 1, 30 * 24) * 3_600_000);
    return { customerKey: c, direction, duration_sec: direction === "missed" ? 0 : intBetween(rng, 45, 540), disposition: direction === "missed" ? null : pick(rng, dispositions), started_at: iso(Math.min(at, now - 30 * 60_000)), assignee: who(i) };
  });

  // ---- gelen kutusu mesajları (son 14 gün) ----
  const msgDefs: [string, "whatsapp" | "sms" | "email" | "note", "inbound" | "outbound", string | null, string][] = [
    ["Selin Aksoy", "whatsapp", "inbound", null, "Merhaba, karşı teklifi değerlendirdik; cumartesi tekrar görebilir miyiz?"],
    ["Selin Aksoy", "whatsapp", "outbound", null, "Tabii, cumartesi 11:00 uygun mu? Mal sahibine de haber veriyorum."],
    ["Deniz Karaca", "email", "inbound", "Eşyalı daire listesi", "Şirketimiz için iki ayrı daire bakıyoruz, liste paylaşabilir misiniz?"],
    ["Okan Tekin", "whatsapp", "inbound", null, "Kadıköy'deki butik ofisin aidat ve KDV bilgisini rica ederim."],
    ["Mert Karahan", "sms", "outbound", null, "Sayın Mert Bey, ofis katının bu ayki kira ödemesi henüz görünmüyor; bilginize."],
    ["Mert Karahan", "sms", "inbound", null, "Hafta sonu ödüyorum, kusura bakmayın."],
    ["Ece Tunalı", "email", "outbound", "Yalı sunumu", "Ekte Sarıyer'deki yalının sunumunu ve tapu özetini bulabilirsiniz."],
    ["Zeynep Akın", "whatsapp", "inbound", null, "Nişantaşı'ndaki dükkanın kira artış maddesi nasıl olacak?"],
    ["Hakan Polat", "note", "outbound", "Arsa görüşmesi", "İmar durumu belediyeden alındı; emsal 0,40. Müşteri olumlu."],
    ["Nazlı Öztürk", "whatsapp", "inbound", null, "Şişli'deki penthouse için kat planı var mı?"],
    ["Melis Ateş", "email", "inbound", "Maslak'ta 3+1", "Maslak'taki 3+1 rezidans hâlâ müsait mi? Fiyatta esneklik var mı?"],
    ["İpek Güneş", "whatsapp", "outbound", null, "Nişantaşı tarafındaki eşyalı daire seçenekleri için yarın 14:00'te görüşelim mi?"],
  ];
  const messages = msgDefs.map(([c, channel, direction, subject, body], i) => ({
    customerKey: c, channel, direction, subject, body,
    created_at: iso(Math.max(custAt.get(c)! + 3_600_000, now - (14 - i) * 86_400_000 + intBetween(rng, 9, 18) * 3_600_000 - 86_400_000)),
    assignee: who(i),
  }));

  // ---- kampanyalar ----
  const campaigns: SamplePlan["campaigns"] = [
    { title: "Kadıköy yeni ilanlar duyurusu", channel: "sms", message: "Kadıköy'de yeni 3+1 ve 4+1 ilanlarımız yayında. Detay için bizi arayın.", status: "done", total_count: 18, sent_count: 17, failed_count: 1, sent_at: iso(now - 21 * 86_400_000), created_at: iso(now - 22 * 86_400_000) },
    { title: "Yatırımcılara kira getirisi bülteni", channel: "whatsapp", message: "Bu ay %5,4 kira getirili yatırımlık daireler listemiz hazır.", status: "draft", total_count: 0, sent_count: 0, failed_count: 0, sent_at: null, created_at: iso(now - 2 * 86_400_000) },
  ];

  // ---- bildirimler ----
  const notifications: SamplePlan["notifications"] = [
    { title: "Yeni talep: Mert Karahan", body: "Şişli'de ofis kiralama talebi geldi.", href: "/app/talepler", kind: "info", created_at: iso(now - 3 * 3_600_000), assignee: 0 },
    { title: "Anlaşma kazanıldı", body: "EMS-0905 satışı tamamlandı, komisyon hesaplandı.", href: "/app/anlasmalar", kind: "success", created_at: iso(Date.parse(deals.find((d) => d.key === "kazanildi-2")!.updated_at)), assignee: 0 },
    { title: "Geciken kira", body: "EMS-0802 ofis katının kirası iki dönemdir gecikmede.", href: "/app/kiralama", kind: "warning", created_at: iso(now - 26 * 3_600_000), assignee: 0 },
    { title: "Geciken görev", body: "Murat Erdem'den yetki belgesi imzası alınacaktı.", href: "/app/gorevler", kind: "warning", created_at: iso(now - 20 * 3_600_000), assignee: 0 },
    { title: "Karşı teklif geldi", body: "EMS-1001 için mal sahibi karşı teklif verdi.", href: "/app/teklifler", kind: "info", created_at: iso(now - 6 * 3_600_000), assignee: 0 },
    { title: "Bugün 3 randevun var", body: "İlki 11:00'de Sarıyer'deki yalının gösterimi.", href: "/app/randevular", kind: "info", created_at: iso(Math.min(dayAt(now, 0, 8), now - 30 * 60_000)), assignee: 0 },
  ];

  return { customers, properties, demands, deals, commissions, offers, contracts, rentals, tasks, appointments, expenses, calls, messages, campaigns, notifications };
}
