import { buildSplits, calculateCommission } from "@/lib/commission";
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
  district: DistrictKey;
  neighborhood: string | null;
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
    customerKey: string; transaction_type: string; property_type: string; district: DistrictKey | null; budget_min: number; budget_max: number;
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
};

/** 24 portföy: canlı satılık/kiralık (konut, lüks, ticari, arsa), bir taslak, satılmış ve kiradaki portföyler. */
function propertyDefs(pack: SamplePlanPack): PropDef[] {
  const base: PropDef[] = [
    { code: "EMS-1001", tx: "Satılık", type: "Daire", status: "live", rooms: "3+1", sqm: 140, district: "kadikoy", hood: 1, owner: "Serkan Bulut", label: "deniz manzaralı 3+1", floor: 5, age: 8, heating: "Kombi" },
    { code: "EMS-1002", tx: "Satılık", type: "Daire", status: "live", rooms: "2+1", sqm: 105, district: "maltepe", hood: 0, owner: "Murat Erdem", label: "sahile yürüme mesafesinde 2+1", floor: 3, age: 12, heating: "Kombi" },
    { code: "EMS-1003", tx: "Kiralık", type: "Rezidans", status: "live", rooms: "1+1", sqm: 72, district: "besiktas", hood: 0, owner: "Derya Arslan", label: "eşyalı rezidans 1+1", floor: 14, age: 6, heating: "Merkezi" },
    { code: "EMS-1004", tx: "Satılık", type: "Müstakil ev", status: "live", rooms: "4+2", sqm: 260, district: "uskudar", hood: 0, owner: "Sevgi Kılıç", label: "bahçeli müstakil ev", age: 25, heating: "Doğalgaz" },
    { code: "EMS-1005", tx: "Satılık", type: "Villa", status: "live", rooms: "6+2", sqm: 520, district: "sariyer", hood: 0, premium: 1.35, owner: "Volkan Erim", label: "Boğaz manzaralı havuzlu villa", age: 10, heating: "Yerden ısıtma" },
    { code: "EMS-1006", tx: "Kiralık", type: "Dükkan", status: "live", rooms: null, sqm: 120, district: "kadikoy", hood: 0, owner: "Fatma Şahin", label: "cadde üstü köşe dükkan" },
    { code: "EMS-1007", tx: "Kiralık", type: "Daire", status: "live", rooms: "2+1", sqm: 95, district: "maltepe", hood: 1, owner: "Esra Duman", label: "ferah 2+1, site içinde", floor: 2, age: 9, heating: "Kombi" },
    { code: "EMS-1008", tx: "Satılık", type: "Ofis", status: "live", rooms: null, sqm: 210, district: "atasehir", hood: 1, owner: "Burak Çelik", label: "finans merkezine yakın plaza katı", floor: 11, age: 7 },
    { code: "EMS-1009", tx: "Satılık", type: "Arsa", status: "live", rooms: null, sqm: 1250, district: "sariyer", hood: 3, owner: "Volkan Erim", label: "imarlı 1.250 m² arsa" },
    { code: "EMS-1010", tx: "Satılık", type: "Daire", status: "live", rooms: "2+1", sqm: 98, district: "sisli", hood: 1, label: "metroya 3 dakika 2+1", floor: 4, age: 15, heating: "Kombi" },
    { code: "EMS-1011", tx: "Satılık", type: "Daire", status: "live", rooms: "3+1", sqm: 150, district: "atasehir", hood: 0, label: "site içinde havuzlu 3+1", floor: 8, age: 5, heating: "Merkezi" },
    { code: "EMS-1012", tx: "Kiralık", type: "Daire", status: "live", rooms: "3+1", sqm: 135, district: "sisli", hood: 0, label: "Teşvikiye'de eşyalı 3+1", floor: 3, age: 30, heating: "Kombi" },
    { code: "EMS-1013", tx: "Satılık", type: "Daire", status: "live", rooms: "1+1", sqm: 62, district: "besiktas", hood: 3, label: "manzaralı yatırımlık 1+1", floor: 2, age: 40, heating: "Kombi" },
    { code: "EMS-1014", tx: "Satılık", type: "Daire", status: "live", rooms: "4+1", sqm: 185, district: "kadikoy", hood: 4, label: "Göztepe'de geniş 4+1", floor: 6, age: 3, heating: "Yerden ısıtma" },
    { code: "EMS-1015", tx: "Kiralık", type: "Ofis", status: "live", rooms: null, sqm: 140, district: "sisli", hood: 3, label: "Esentepe'de hazır ofis", floor: 9, age: 11 },
    { code: "EMS-1016", tx: "Satılık", type: "Daire", status: "draft", rooms: "2+1", sqm: 90, district: "uskudar", hood: 2, label: "yenilenmiş 2+1 (fotoğraf bekliyor)", floor: 1, age: 18, heating: "Kombi" },
    // Kapanmış portföyler (kazanılmış anlaşmalar)
    { code: "EMS-0901", tx: "Satılık", type: "Daire", status: "sold", rooms: "2+1", sqm: 100, district: "kadikoy", hood: 3, label: "Koşuyolu'nda 2+1", floor: 2, age: 14, heating: "Kombi" },
    { code: "EMS-0902", tx: "Satılık", type: "Daire", status: "sold", rooms: "3+1", sqm: 125, district: "maltepe", hood: 1, label: "Cevizli'de 3+1", floor: 4, age: 10, heating: "Kombi" },
    { code: "EMS-0903", tx: "Satılık", type: "Daire", status: "sold", rooms: "3+1", sqm: 130, district: "atasehir", hood: 2, label: "Küçükbakkalköy'de 3+1", floor: 6, age: 6, heating: "Merkezi" },
    { code: "EMS-0904", tx: "Satılık", type: "Rezidans", status: "sold", rooms: "2+1", sqm: 110, district: "besiktas", hood: 0, label: "Levent'te rezidans 2+1", floor: 18, age: 4, heating: "Merkezi" },
    { code: "EMS-0905", tx: "Satılık", type: "Daire", status: "sold", rooms: "2+1", sqm: 95, district: "uskudar", hood: 2, label: "Altunizade'de 2+1", floor: 3, age: 2, heating: "Kombi" },
    { code: "EMS-0801", tx: "Kiralık", type: "Daire", status: "rented", rooms: "2+1", sqm: 90, district: "besiktas", hood: 4, owner: "Derya Arslan", label: "kiracılı 2+1", floor: 3, age: 20, heating: "Kombi" },
    { code: "EMS-0802", tx: "Kiralık", type: "Daire", status: "rented", rooms: "3+1", sqm: 120, district: "atasehir", hood: 1, owner: "Fatma Şahin", label: "kiracılı 3+1", floor: 5, age: 9, heating: "Merkezi" },
    { code: "EMS-0803", tx: "Kiralık", type: "Dükkan", status: "rented", rooms: null, sqm: 85, district: "maltepe", hood: 1, owner: "Esra Duman", label: "kiracılı dükkan" },
  ];
  if (pack === "ticari") {
    base.push(
      { code: "EMS-1017", tx: "Kiralık", type: "Dükkan", status: "live", rooms: null, sqm: 210, district: "sisli", hood: 1, label: "Mecidiyeköy'de geniş vitrinli mağaza" },
      { code: "EMS-1018", tx: "Satılık", type: "Ofis", status: "live", rooms: null, sqm: 420, district: "sariyer", hood: 3, premium: 1.1, label: "Maslak'ta kat mülkiyetli ofis katı", floor: 15, age: 6 },
    );
  } else if (pack === "arsa") {
    base.push(
      { code: "EMS-1017", tx: "Satılık", type: "Arsa", status: "live", rooms: null, sqm: 2400, district: "sariyer", hood: 1, label: "Yeniköy'de villa imarlı arsa" },
      { code: "EMS-1018", tx: "Satılık", type: "Arsa", status: "live", rooms: null, sqm: 900, district: "uskudar", hood: 1, label: "konut imarlı köşe parsel" },
    );
  }
  return base;
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

export function buildSamplePlan(input: { nowMs: number; seed: string; pack?: SamplePlanPack; teamSize: number }): SamplePlan {
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

  const properties: PlanProperty[] = defs.map((d, i) => {
    const created = propStamp.get(d.code)!;
    const ownerCreated = d.owner ? custAt.get(d.owner) : undefined;
    // Malik müşteri portföyden önce kaydolmuş olmalı: değilse portföy malikten sonraya kayar.
    const createdMs = ownerCreated && ownerCreated > created ? after(ownerCreated, 0.2, 3, now, rng) : created;
    const price = samplePrice({ district: d.district, type: d.type, tx: d.tx, sqm: d.sqm, premium: d.premium });
    const hood = DISTRICT_BY_KEY[d.district].neighborhoods[d.hood] ?? null;
    const features: Record<string, unknown> = { sqm: d.sqm };
    if (d.rooms) features.rooms = d.rooms;
    if (d.floor != null) features.floor = d.floor;
    if (d.age != null) features.building_age = d.age;
    if (d.heating) features.heating = d.heating;
    return {
      code: d.code,
      title: title(d),
      tx: d.tx,
      type: d.type,
      status: d.status,
      price,
      rate: d.tx === "Kiralık" ? 10 : d.type === "Arsa" ? 3 : RATE.sale,
      rooms: d.rooms,
      sqm: d.sqm,
      district: d.district,
      neighborhood: hood,
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

  // ---- talepler ----
  const demandDefs: [string, string, string, DistrictKey | null, number, number, string | null, number, string, string][] = [
    ["Selin Aksoy", "Satılık", "Daire", "kadikoy", 13_000_000, 17_000_000, "3+1", 120, "yüksek", "matched"],
    ["Deniz Karaca", "Kiralık", "Rezidans", "besiktas", 40_000, 55_000, "1+1", 55, "orta", "active"],
    ["Aylin Demirtaş", "Satılık", "Daire", "maltepe", 6_500_000, 8_000_000, "2+1", 90, "orta", "matched"],
    ["Ece Tunalı", "Satılık", "Villa", "sariyer", 90_000_000, 130_000_000, "5+1", 400, "yüksek", "active"],
    ["Hakan Polat", "Satılık", "Arsa", "sariyer", 30_000_000, 55_000_000, null, 1000, "orta", "active"],
    ["Zeynep Akın", "Kiralık", "Dükkan", "kadikoy", 60_000, 95_000, null, 80, "düşük", "new"],
    ["Onur Kaplan", "Satılık", "Daire", "sisli", 9_000_000, 11_500_000, "2+1", 85, "orta", "matched"],
    ["Emre Doğan", "Kiralık", "Daire", "atasehir", 45_000, 65_000, "3+1", 120, "yüksek", "active"],
    ["Nazlı Öztürk", "Satılık", "Daire", "kadikoy", 16_000_000, 22_000_000, "4+1", 160, "orta", "active"],
    ["İpek Güneş", "Kiralık", "Daire", "sisli", 60_000, 80_000, "3+1", 110, "yüksek", "matched"],
    ["Buse Yalçın", "Kiralık", "Daire", "maltepe", 18_000, 25_000, "1+1", 45, "düşük", "new"],
    ["Okan Tekin", "Satılık", "Ofis", "atasehir", 14_000_000, 20_000_000, null, 180, "orta", "matched"],
    ["Gizem Uçar", "Satılık", "Daire", "atasehir", 11_000_000, 14_000_000, "3+1", 130, "orta", "active"],
    ["Mert Karahan", "Kiralık", "Ofis", "sisli", 55_000, 90_000, null, 100, "orta", "new"],
  ];
  const demands = demandDefs.map(([c, tx, type, district, min, max, rooms, sqm, urgency, status]) => ({
    customerKey: c, transaction_type: tx, property_type: type, district, budget_min: min, budget_max: max, rooms, min_sqm: sqm, urgency, status,
    created_at: iso(after(custAt.get(c)!, 0, 4, now, rng)),
  }));

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
    ["EMS-0802", "Emre Doğan", 1],
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
    ["Emre Doğan'dan geciken kira için hatırlatma", "call", "high", -4, 10, "Emre Doğan", "EMS-0802", "open"],
    ["Buse Yalçın'a uygun 1+1'leri ilet", "followup", "low", -6, 14, "Buse Yalçın", null, "open"],
    ["Ece Tunalı için villa sunumunu hazırla", "followup", "high", 1, 12, "Ece Tunalı", "EMS-1005", "open"],
    ["Hakan Polat'a imar durumu belgesini gönder", "document", "normal", 2, 16, "Hakan Polat", "EMS-1009", "open"],
    ["Burak Çelik'in plaza katı için değerleme raporu iste", "followup", "normal", 3, 13, "Burak Çelik", "EMS-1008", "open"],
    ["Nazlı Öztürk ile Göztepe gösterimi planla", "visit", "normal", 4, 11, "Nazlı Öztürk", "EMS-1014", "open"],
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
    ["Okan Tekin", "whatsapp", "inbound", null, "Plaza katının aidat ve KDV bilgisini rica ederim."],
    ["Emre Doğan", "sms", "outbound", null, "Sayın Emre Bey, bu ayın kira ödemesi henüz görünmüyor; bilginize."],
    ["Emre Doğan", "sms", "inbound", null, "Hafta sonu ödüyorum, kusura bakmayın."],
    ["Ece Tunalı", "email", "outbound", "Villa sunumu", "Ekte Boğaz manzaralı villanın sunumunu ve tapu özetini bulabilirsiniz."],
    ["Zeynep Akın", "whatsapp", "inbound", null, "Köşe dükkanın kira artış maddesi nasıl olacak?"],
    ["Hakan Polat", "note", "outbound", "Arsa görüşmesi", "İmar durumu belediyeden alındı; emsal 0,40. Müşteri olumlu."],
    ["Nazlı Öztürk", "whatsapp", "inbound", null, "Göztepe'deki 4+1 için kat planı var mı?"],
    ["Melis Ateş", "email", "inbound", "Bebek'te daire", "Manzaralı 1+1 hâlâ müsait mi? Fiyatta esneklik var mı?"],
    ["İpek Güneş", "whatsapp", "outbound", null, "Teşvikiye'deki eşyalı 3+1 için yarın 14:00'te gösterim ayarladım."],
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
    { title: "Geciken kira", body: "EMS-0802 kirası iki dönemdir gecikmede.", href: "/app/kiralama", kind: "warning", created_at: iso(now - 26 * 3_600_000), assignee: 0 },
    { title: "Geciken görev", body: "Murat Erdem'den yetki belgesi imzası alınacaktı.", href: "/app/gorevler", kind: "warning", created_at: iso(now - 20 * 3_600_000), assignee: 0 },
    { title: "Karşı teklif geldi", body: "EMS-1001 için mal sahibi karşı teklif verdi.", href: "/app/teklifler", kind: "info", created_at: iso(now - 6 * 3_600_000), assignee: 0 },
    { title: "Bugün 3 randevun var", body: "İlki 11:00'de Sarıyer villa gösterimi.", href: "/app/randevular", kind: "info", created_at: iso(Math.min(dayAt(now, 0, 8), now - 30 * 60_000)), assignee: 0 },
  ];

  return { customers, properties, demands, deals, commissions, offers, contracts, rentals, tasks, appointments, expenses, calls, messages, campaigns, notifications };
}
