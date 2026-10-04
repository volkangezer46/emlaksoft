export type PlanId = "advisor" | "office" | "professional" | "business" | "enterprise";

/** Yıllık ödemede ödenen ay sayısı varsayılanı ("10 öde 12 kullan"); plan başına panelden değişir. */
export const DEFAULT_YEARLY_PAID_MONTHS = 10;
export type BillingCycle = "monthly" | "yearly";

export type PlanLimits = {
  seats: number;
  customers: number | null;
  activeProperties: number | null;
  branches: number | null;
};

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
  /** Aylık AI kredi kotası (yalnız alan; ölçüm altyapısı ayrı paketle gelir). */
  aiCreditsMonthly?: number | null;
  /** Aylık profesyonel değerleme raporu kotası (yalnız alan). */
  valuationReportsMonthly?: number | null;
  /** true: fiyat yerine "Bize ulaşın" gösterilir, çevrimiçi ödeme açılmaz. */
  customPricing?: boolean;
  /** true: kayıt/fiyat sayfası ve yeni ödemede gizli; mevcut aboneler etkilenmez. */
  hidden?: boolean;
  /** Listeleme sırası (küçük önce). */
  order?: number;
  /** Kampanya (Founders) indirimli aylık fiyatı; kampanya aktif değilse yok sayılır. */
  campaignMonthlyTry?: number | null;
};

/**
 * Paket, fiyat, satış metni ve kullanım sınırları için tek kaynak.
 * Yalnızca bugün çalışan özellikler burada listelenir; yol haritasındaki
 * API/softphone/white-label özellikleri ürün gerçekten hazır olmadan eklenmez.
 */
export const PLANS: readonly PlanDef[] = [
  {
    id: "advisor",
    name: "Danışman",
    monthlyTry: 990,
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
  },
  {
    id: "professional",
    name: "Profesyonel",
    monthlyTry: 5990,
    blurb: "Büyük ofis ve çok şube",
    eyebrow: "ÖLÇEKLENEN EKİP",
    features: [
      "20 kullanıcıya kadar · 10 şube",
      "Kayıp-kaçak komisyon motoru",
      "Danışman KPI, lig ve hedefler",
      "Otomasyon, iş akışı ve onay akışları",
      "KVKK uyum ve ofisler arası ağ",
    ],
    limits: { seats: 20, customers: null, activeProperties: null, branches: 10 },
  },
  {
    id: "enterprise",
    name: "Kurumsal",
    monthlyTry: 12900,
    blurb: "Franchise ve proje satış ekipleri",
    eyebrow: "KURUMSAL OPERASYON",
    features: [
      "50 kullanıcıya kadar",
      "Sınırsız şube",
      "Proje satışı ve franchise BI",
      "Merkezi rol ve denetim yönetimi",
    ],
    limits: { seats: 50, customers: null, activeProperties: null, branches: null },
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
};
