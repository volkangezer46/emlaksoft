export type PlanId = "advisor" | "office" | "professional" | "business" | "enterprise";

/** Fatura KDV oranı (%20). Ön izlemeler bunu kullanır; asıl fatura tutarını `invoiceAmountsTry` (fulfillment.ts) hesaplar. */
export const BILLING_VAT_RATE = 0.2;

/** Yıllık ödemede ödenen ay sayısı varsayılanı ("10 öde 12 kullan"); plan başına panelden değişir. */
export const DEFAULT_YEARLY_PAID_MONTHS = 10;
export type BillingCycle = "monthly" | "yearly";

export type PlanLimits = {
  seats: number;
  customers: number | null;
  activeProperties: number | null;
  branches: number | null;
};

/** Ek kullanıcı kademesi; sıra "ek kullanıcı" sırasıdır (1 = ilk ek kullanıcı). toSeat null = sınırsız (son kademe). */
export type SeatTier = { fromSeat: number; toSeat: number | null; monthlyTry: number };

/** Ek kullanıcı birim fiyatı yuvarlama düzeni: x9 (…9 ile biter), x0 (onluk) ya da yok. */
export type SeatRounding = "none" | "x9" | "x0";

export type PlanDef = {
  id: PlanId;
  name: string;
  monthlyTry: number;
  blurb: string;
  eyebrow: string;
  popular?: boolean;
  features: string[];
  limits: PlanLimits;
  /** Yıllık ödemede ödenen ay sayısı (varsayılan 10). Yıllık tutar = aylık x bu sayı. */
  yearlyPaidMonths?: number;
  /** Ek kullanıcı aylık fiyatı (KDV hariç); yoksa ek kullanıcı satılmaz. */
  extraSeatMonthlyTry?: number | null;
  /** Kademeli (marjinal) ek kullanıcı fiyatı; doluysa extraSeatMonthlyTry'yi ezer. Bkz. seat-pricing.ts. */
  extraSeatTiers?: SeatTier[] | null;
  /** Bu pakette satılabilecek en yüksek TOPLAM kullanıcı; aşımı için zorunlu yükseltme/Kurumsal. */
  maxSeats?: number | null;
  /** Ek kullanıcı birim fiyatı yuvarlama düzeni (doğrulayıcı kontrol eder). */
  seatRounding?: SeatRounding | null;
  /** Aylık AI kredi kotası (yalnız alan; ölçüm altyapısı ayrı paketle gelir). */
  aiCreditsMonthly?: number | null;
  /** Aylık profesyonel değerleme raporu kotası (yalnız alan). */
  valuationReportsMonthly?: number | null;
  /**
   * Aylık dahil EmlakFiyati kontörü (null/0 = hak yok). Cron `ef-kontor-hak` her ay `plan_monthly` hibesi verir;
   * kontör tarifesi `src/lib/ef-credits/config.ts`te, "yaklaşık N değerleme" ondan hesaplanır.
   */
  efCreditsMonthly?: number | null;
  /** Satın alınan HER EK kullanıcı başına aylık ek EmlakFiyati kontörü (ek kullanıcı sayısı x bu değer, plan hakkına eklenir). */
  efCreditsPerExtraSeat?: number | null;
  /** true: kayıt/fiyat sayfası ve yeni ödemede gizli; mevcut aboneler etkilenmez. */
  hidden?: boolean;
  /** Listeleme sırası (küçük önce). */
  order?: number;
  /** Kampanya (Founders) indirimli aylık fiyatı; kampanya aktif değilse yok sayılır. */
  campaignMonthlyTry?: number | null;
};

/**
 * Paket, fiyat, satış metni ve kullanım sınırları için kod tarafı varsayılanı (ham katalog).
 * Sahibin onayladığı katalog: Danışman 749, Ofis 2.490 (ek kullanıcı kademeli 399/349/299),
 * Profesyonel 4.990 (15 kullanıcı, ek 349/299), Business 8.990 (gizli), Kurumsal Operasyon 12.900 (50 kullanıcı dahil, 500'e kadar kademeli ek kullanıcı).
 * `RECOMMENDED_CATALOG_OVERRIDES` (plan-overrides.ts) ile AYNI değerleri taşır; ikisinin
 * uyumu plan-default-catalog.test.ts ile korunur. Fiyat değişikliği yalnız yeni satışları etkiler.
 * Yalnızca bugün çalışan özellikler burada listelenir; yol haritasındaki
 * API/softphone/white-label özellikleri ürün gerçekten hazır olmadan eklenmez.
 */
export const PLANS: readonly PlanDef[] = [
  {
    id: "advisor",
    name: "Danışman",
    monthlyTry: 749,
    blurb: "Bağımsız danışman",
    eyebrow: "BAŞLANGIÇ",
    features: [
      "1 kullanıcı · 1 şube",
      "1.000 müşteri · 150 aktif portföy",
      "Talep ve portföy eşleştirme",
      "Randevu, görev ve gelen kutusu",
      "Komisyon takibi ve emsal bazlı değerleme",
    ],
    limits: { seats: 1, customers: 1_000, activeProperties: 150, branches: 1 },
    // Ek kullanıcı: 5 kullanıcıda 749 + 4 x 499 = 2.745 TL > Ofis 2.490 TL (ve 499 > Ofis kişi başı 498): Ofis 5. kullanıcıdan itibaren hem ucuz hem kapsamlı.
    extraSeatMonthlyTry: 499,
    maxSeats: 500,
    seatRounding: "x9",
    efCreditsMonthly: 10,
  },
  {
    id: "office",
    name: "Ofis",
    monthlyTry: 2490,
    blurb: "Küçük ve orta ölçekli ofis",
    eyebrow: "EN ÇOK TERCİH",
    popular: true,
    features: [
      "5 kullanıcı · 3 şubeye kadar",
      "Sınırsız müşteri ve portföy",
      "Ekip yönetimi ve komisyon paylaşımı",
      "Teklif, sözleşme ve SMS onaylı dijital imza",
      "Kiralama, açık ev ve portal teyit",
      "Kampanya, gider ve raporlar",
    ],
    limits: { seats: 5, customers: null, activeProperties: null, branches: 3 },
    extraSeatMonthlyTry: 399,
    extraSeatTiers: [
      { fromSeat: 1, toSeat: 5, monthlyTry: 399 },
      { fromSeat: 6, toSeat: 15, monthlyTry: 349 },
      { fromSeat: 16, toSeat: null, monthlyTry: 299 },
    ],
    maxSeats: 500,
    seatRounding: "x9",
    efCreditsMonthly: 40,
  },
  {
    id: "professional",
    name: "Profesyonel",
    monthlyTry: 4990,
    blurb: "Büyük ofis ve çok şube",
    eyebrow: "ÖLÇEKLENEN EKİP",
    features: [
      "15 kullanıcıya kadar · 10 şube",
      "Kayıp-kaçak komisyon motoru",
      "Danışman KPI, lig ve hedefler",
      "Otomasyon, iş akışı ve onay akışları",
      "KVKK uyum ve ofisler arası ağ",
    ],
    limits: { seats: 15, customers: null, activeProperties: null, branches: 10 },
    extraSeatMonthlyTry: 349,
    extraSeatTiers: [
      { fromSeat: 1, toSeat: 10, monthlyTry: 349 },
      { fromSeat: 11, toSeat: null, monthlyTry: 299 },
    ],
    maxSeats: 500,
    seatRounding: "x9",
    efCreditsMonthly: 120,
  },
  {
    id: "enterprise",
    name: "Kurumsal",
    monthlyTry: 12900,
    blurb: "Franchise ve proje satış ekipleri",
    eyebrow: "KURUMSAL OPERASYON",
    features: [
      "50 kullanıcı dahil · 500 kullanıcıya kadar",
      "Sınırsız şube",
      "Proje satışı ve franchise BI",
      "Merkezi rol ve denetim yönetimi",
    ],
    limits: { seats: 50, customers: null, activeProperties: null, branches: null },
    // Hacim indirimi: Profesyonel'in son kademesi 299 TL; Kurumsal bunun altından başlar ve ölçekle düşer.
    extraSeatMonthlyTry: 249,
    extraSeatTiers: [
      { fromSeat: 1, toSeat: 50, monthlyTry: 249 },
      { fromSeat: 51, toSeat: 200, monthlyTry: 199 },
      { fromSeat: 201, toSeat: null, monthlyTry: 149 },
    ],
    maxSeats: 500,
    seatRounding: "x9",
    efCreditsMonthly: 400,
    efCreditsPerExtraSeat: 6,
  },
] as const;

const PLAN_IDS = new Set<PlanId>([...PLANS.map((plan) => plan.id), "business"]);

export function isPlanId(value: string): value is PlanId {
  return PLAN_IDS.has(value as PlanId);
}

export function normalizePlanId(value: string | null | undefined, fallback: PlanId = "office"): PlanId {
  return value && isPlanId(value) ? value : fallback;
}

export function normalizeBillingCycle(value: string | null | undefined): BillingCycle {
  return value === "yearly" ? "yearly" : "monthly";
}

export function getPlan(id: string): PlanDef {
  return PLANS.find((plan) => plan.id === id) ?? PLANS[1]!;
}

/** Yıllık tutar = aylık x yıllık ödenen ay sayısı (varsayılan 10). */
export function planAmountTry(planId: PlanId, cycle: BillingCycle): number {
  return planAmountOf(getPlan(planId), cycle);
}

/** Verilen tanım için dönem tutarı (panelden düzenlenmiş tanımlar dahil). */
export function planAmountOf(
  def: Pick<PlanDef, "monthlyTry" | "yearlyPaidMonths">,
  cycle: BillingCycle,
): number {
  const months = def.yearlyPaidMonths ?? DEFAULT_YEARLY_PAID_MONTHS;
  return cycle === "yearly" ? Math.round(def.monthlyTry * months) : def.monthlyTry;
}

/** Yıllık ödemede aylığa göre indirim yüzdesi (yuvarlanmış). */
export function yearlyDiscountPercentOf(def: Pick<PlanDef, "yearlyPaidMonths">): number {
  const months = def.yearlyPaidMonths ?? DEFAULT_YEARLY_PAID_MONTHS;
  return Math.max(0, Math.round((1 - months / 12) * 100));
}

/** "10 öde 12 kullan" biçiminde kısa etiket. */
export function yearlyOfferLabel(def: Pick<PlanDef, "yearlyPaidMonths">): string {
  const months = def.yearlyPaidMonths ?? DEFAULT_YEARLY_PAID_MONTHS;
  return `${months} öde 12 kullan`;
}

/** Kayıt/fiyat sayfası ve yeni ödemede gösterilecek (gizli olmayan) tanımlar, sıraya göre. */
export function visiblePlans<T extends Pick<PlanDef, "hidden" | "order">>(defs: readonly T[]): T[] {
  return defs
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => !d.hidden)
    .sort((a, b) => (a.d.order ?? a.i) - (b.d.order ?? b.i))
    .map(({ d }) => d);
}

export function planLabel(id: string): string {
  return isPlanId(id) ? getPlan(id).name : id;
}

export function planLimit(planId: string, key: keyof PlanLimits): number | null {
  return getPlan(planId).limits[key];
}

/**
 * "Business" paketi şablonu. PLANS (veritabanı sözleşmeli kimlikler) içinde DEĞİLDİR:
 * `plan` CHECK kısıtı ve plan_entitlements satırı forward-only migration
 * (20260817000210_plan_business_and_pricing_support.sql) uygulanana kadar satılamaz.
 * Yalnız okuyucu ve panel düzenleyicisi bunu "gizli" başlangıç tanımı olarak bilir.
 */
export const BUSINESS_PLAN_TEMPLATE: PlanDef = {
  id: "business",
  name: "Business",
  monthlyTry: 8990,
  blurb: "Çok şubeli büyük ofis",
  eyebrow: "BÜYÜME",
  features: ["40 kullanıcıya kadar", "Profesyonel paketin tüm özellikleri"],
  limits: { seats: 40, customers: null, activeProperties: null, branches: 20 },
  hidden: true,
  order: 35,
  efCreditsMonthly: 300,
};
