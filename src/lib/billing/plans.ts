export type PlanId = "advisor" | "office" | "professional" | "enterprise";
export type BillingCycle = "monthly" | "yearly";

export type PlanDef = {
  id: PlanId;
  name: string;
  monthlyTry: number;
  blurb: string;
  features: string[];
};

/** KDV hariç liste fiyatları — docs/PRICING.md */
export const PLANS: PlanDef[] = [
  {
    id: "advisor",
    name: "Danışman",
    monthlyTry: 990,
    blurb: "Bağımsız danışman",
    features: ["1 kullanıcı", "Portföy & talep", "Eşleştirme", "Portal teyit"],
  },
  {
    id: "office",
    name: "Ofis",
    monthlyTry: 2490,
    blurb: "Küçük–orta ofis",
    features: ["Ekip & şube", "Kayıp-kaçak", "Komisyon", "Destek"],
  },
  {
    id: "professional",
    name: "Profesyonel",
    monthlyTry: 5990,
    blurb: "Çok şube / otomasyon",
    features: ["Gelişmiş rapor", "Öncelikli destek", "API erişimi", "SLA"],
  },
  {
    id: "enterprise",
    name: "Kurumsal",
    monthlyTry: 12900,
    blurb: "Franchise / özel SLA",
    features: ["Özel onboarding", "Dedicated destek", "Özel entegrasyon", "Sözleşmeli"],
  },
];

export function getPlan(id: string): PlanDef {
  return PLANS.find((p) => p.id === id) ?? PLANS[1]!;
}

/** Yıllık ≈ %20 indirim */
export function planAmountTry(planId: PlanId, cycle: BillingCycle): number {
  const monthly = getPlan(planId).monthlyTry;
  if (cycle === "yearly") return Math.round(monthly * 12 * 0.8);
  return monthly;
}

export function planLabel(id: string) {
  return getPlan(id).name;
}
