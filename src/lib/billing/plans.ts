export type PlanId = "advisor" | "office" | "professional" | "enterprise";
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
      "Öncelikli destek",
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
      "Özel onboarding",
      "Sözleşmeli destek SLA'sı",
    ],
    limits: { seats: 50, customers: null, activeProperties: null, branches: null },
  },
] as const;

const PLAN_IDS = new Set<PlanId>(PLANS.map((plan) => plan.id));

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

/** Yıllık ödemede yüzde 20 indirim uygulanır. */
export function planAmountTry(planId: PlanId, cycle: BillingCycle): number {
  const monthly = getPlan(planId).monthlyTry;
  return cycle === "yearly" ? Math.round(monthly * 12 * 0.8) : monthly;
}

export function planLabel(id: string): string {
  return isPlanId(id) ? getPlan(id).name : id;
}

export function planLimit(planId: string, key: keyof PlanLimits): number | null {
  return getPlan(planId).limits[key];
}
