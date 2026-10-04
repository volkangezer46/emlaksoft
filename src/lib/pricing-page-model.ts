import { PLANS, getPlan, planAmountOf, planAmountTry, type PlanDef, type PlanId } from "@/lib/billing/plans";
import { PLAN_GATES, findGate, planRank, requiredPlanName } from "@/lib/billing/page-gates";

/**
 * /fiyatlar için veri modeli. Fiyat, limit ve özellik kapsamı YALNIZ
 * `billing/plans.ts` ve `billing/page-gates.ts` içinden türetilir; burada
 * TL tutarı veya paket kapsamı yazılmaz (bkz. pricing-page-contract.test.ts).
 */

/** Yıllık ödeme indirimi (%), `planAmountTry` sonucundan türetilir. */
export function yearlyDiscountPercent(): number {
  const base = PLANS[0]!;
  const full = base.monthlyTry * 12;
  return Math.round((1 - planAmountTry(base.id, "yearly") / full) * 100);
}

export type CompareCell = { text: string; included?: boolean };
export type CompareRow = { label: string; cells: CompareCell[] };
export type CompareGroup = { title: string; rows: CompareRow[] };

const tl = new Intl.NumberFormat("tr-TR");
const fmt = (n: number) => `${tl.format(n)} ₺`;
const limit = (n: number | null, unit: string) => (n === null ? "Sınırsız" : `${tl.format(n)} ${unit}`.trim());

function numericRow(plans: readonly PlanDef[], label: string, pick: (p: PlanDef) => string): CompareRow {
  return { label, cells: plans.map((p) => ({ text: pick(p) })) };
}

export function buildComparison(plans: readonly PlanDef[] = PLANS): CompareGroup[] {
  const pricing: CompareGroup = {
    title: "Fiyat ve limitler",
    rows: [
      numericRow(plans, "Aylık fiyat (KDV hariç)", (p) => fmt(p.monthlyTry)),
      numericRow(plans, "Yıllık ödemede aylık karşılığı (KDV hariç)", (p) => fmt(Math.round(planAmountOf(p, "yearly") / 12))),
      numericRow(plans, "Kullanıcı", (p) => `${tl.format(p.limits.seats)}`),
      numericRow(plans, "Şube", (p) => limit(p.limits.branches, "")),
      numericRow(plans, "Müşteri kaydı", (p) => limit(p.limits.customers, "")),
      numericRow(plans, "Aktif portföy", (p) => limit(p.limits.activeProperties, "")),
    ],
  };

  const byTier = new Map<PlanId, CompareGroup>();
  for (const gate of PLAN_GATES) {
    let group = byTier.get(gate.minPlan);
    if (!group) {
      group = { title: `${requiredPlanName(gate)} ve üzeri`, rows: [] };
      byTier.set(gate.minPlan, group);
    }
    group.rows.push({
      label: gate.title,
      cells: plans.map((p) => {
        const included = planRank(p.id) >= planRank(gate.minPlan);
        return { text: included ? "Dahil" : "Pakette yok", included };
      }),
    });
  }
  const tiers = [...byTier.entries()].sort((a, b) => planRank(a[0]) - planRank(b[0])).map(([, g]) => g);
  return [pricing, ...tiers];
}

/** Kayıp-kaçak motorunun asgari paketi (page-gates'ten). */
export function lostCommissionPlanName(): string {
  const gate = findGate("/app/kayip-kacak");
  return gate ? requiredPlanName(gate) : getPlan("professional").name;
}

export type FaqItem = { q: string; a: string };

export function buildFaq(): FaqItem[] {
  const discount = yearlyDiscountPercent();
  const lost = lostCommissionPlanName();
  const contractGate = findGate("/app/sozlesmeler");
  const contractPlan = contractGate ? requiredPlanName(contractGate) : getPlan("office").name;
  return [
    {
      q: "Deneme ücretsiz mi, kredi kartı gerekir mi?",
      a: "Kayıt olunca 14 gün ücretsiz deneme başlar ve kredi kartı istenmez. Deneme boyunca tüm paketlerin özellikleri açıktır; seçtiğiniz paketin kapsamı denemeden sonra geçerli olur.",
    },
    {
      q: "Fiyatlara KDV dahil mi?",
      a: "Hayır. Bu sayfadaki tüm aylık ve yıllık tutarlar KDV hariçtir.",
    },
    {
      q: "Yıllık ödemede indirim var mı?",
      a: `Evet. Yıllık ödemede %${discount} indirim uygulanır; sayfadaki aylık/yıllık anahtarı bu hesabı fiyatlara yansıtır.`,
    },
    {
      q: "Dijital imza e-imza mı?",
      a: `Hayır. Sözleşmeler SMS onaylı dijital imza ile imzalanır; bu, nitelikli elektronik imza (e-imza) değildir. Sözleşme özelliği ${contractPlan} ve üzeri paketlerde açıktır.`,
    },
    {
      q: "Kayıp-kaçak komisyon motoru hangi pakette?",
      a: `Yalnızca ${lost} ve üzeri paketlerde açıktır. Deneme süresince tüm paketlerde denemek mümkündür.`,
    },
    {
      q: "Paket limitlerini aşarsam ne olur?",
      a: "Her paketin kullanıcı, şube, müşteri ve portföy limitleri yukarıdaki karşılaştırma tablosunda yazar. Ofisinizin ihtiyacı bir paketin kapsamını aşıyorsa bir üst paket daha uygun olur.",
    },
  ];
}
