import { DEFAULT_YEARLY_PAID_MONTHS, PLANS, getPlan, planAmountOf, planAmountTry, yearlyDiscountPercentOf, type PlanDef, type PlanId } from "@/lib/billing/plans";
import { PLAN_GATES, findGate, planRank, requiredPlanName } from "@/lib/billing/page-gates";

/**
 * /fiyatlar için veri modeli. Fiyat, limit ve özellik kapsamı YALNIZ
 * `billing/plans.ts` ve `billing/page-gates.ts` içinden türetilir; burada
 * TL tutarı veya paket kapsamı yazılmaz (bkz. pricing-page-contract.test.ts).
 */

/**
 * Yıllık ödeme indirimi (%). `plans` verilirse (admin etkin tanımları) satılan paketlerin ortak değeri;
 * paketler farklıysa en küçük değer ("en az") döner. Verilmezse plans.ts varsayılanından türetilir.
 */
export function yearlyDiscountPercent(plans?: readonly PlanDef[]): number {
  if (plans && plans.length > 0) {
    const list = plans.filter((p) => !p.customPricing);
    if (list.length > 0) return Math.min(...list.map((p) => yearlyDiscountPercentOf(p)));
  }
  const base = PLANS[0]!;
  const full = base.monthlyTry * 12;
  return Math.round((1 - planAmountTry(base.id, "yearly") / full) * 100);
}

export type CompareCell = { text: string; included?: boolean };
export type CompareRow = { label: string; cells: CompareCell[] };
export type CompareGroup = { title: string; rows: CompareRow[] };

const tl = new Intl.NumberFormat("tr-TR");
const fmt = (n: number) => `${tl.format(n)} ₺`;
const priceCell = (p: PlanDef, text: string) => (p.customPricing ? "Özel teklif" : text);
const limit = (n: number | null, unit: string) => (n === null ? "Sınırsız" : `${tl.format(n)} ${unit}`.trim());

function numericRow(plans: readonly PlanDef[], label: string, pick: (p: PlanDef) => string): CompareRow {
  return { label, cells: plans.map((p) => ({ text: pick(p) })) };
}

export function buildComparison(plans: readonly PlanDef[] = PLANS, opts: { efValuationCost?: number } = {}): CompareGroup[] {
  const pricing: CompareGroup = {
    title: "Fiyat ve limitler",
    rows: [
      numericRow(plans, "Aylık fiyat (KDV hariç)", (p) => priceCell(p, fmt(p.monthlyTry))),
      numericRow(plans, "Yıllık ödemede aylık karşılığı (KDV hariç)", (p) => priceCell(p, fmt(Math.round(planAmountOf(p, "yearly") / 12)))),
      numericRow(plans, "Yıllık ödemede ödenen ay", (p) => priceCell(p, `${p.yearlyPaidMonths ?? DEFAULT_YEARLY_PAID_MONTHS} / 12`)),
      numericRow(plans, "Kullanıcı", (p) => `${tl.format(p.limits.seats)}`),
      numericRow(plans, "Şube", (p) => limit(p.limits.branches, "")),
      numericRow(plans, "Müşteri kaydı", (p) => limit(p.limits.customers, "")),
      numericRow(plans, "Aktif portföy", (p) => limit(p.limits.activeProperties, "")),
    ],
  };
  // Panelden tanımlanan isteğe bağlı alanlar: yalnız en az bir pakette doluysa satır çıkar (boş vaat yok).
  if (plans.some((p) => p.extraSeatMonthlyTry)) {
    pricing.rows.push(numericRow(plans, "Ek kullanıcı (aylık, KDV hariç)", (p) => (p.extraSeatMonthlyTry ? fmt(p.extraSeatMonthlyTry) : "Satılmaz")));
  }
  if (plans.some((p) => p.aiCreditsMonthly != null)) {
    pricing.rows.push(numericRow(plans, "Aylık AI kredisi", (p) => (p.aiCreditsMonthly == null ? "Belirtilmedi" : tl.format(p.aiCreditsMonthly))));
  }
  if (plans.some((p) => p.valuationReportsMonthly != null)) {
    pricing.rows.push(numericRow(plans, "Aylık değerleme raporu", (p) => (p.valuationReportsMonthly == null ? "Belirtilmedi" : tl.format(p.valuationReportsMonthly))));
  }

  if (plans.some((p) => (p.efCreditsMonthly ?? 0) > 0)) {
    const cost = opts.efValuationCost ?? 0;
    pricing.rows.push(
      numericRow(plans, "Aylık EmlakFiyati kontörü", (p) => {
        const n = p.efCreditsMonthly ?? 0;
        if (n <= 0) return "Yok";
        const m = cost > 0 ? Math.floor(n / cost) : 0;
        return m > 0 ? `${tl.format(n)} (≈ ${tl.format(m)} değerleme)` : tl.format(n);
      }),
    );
  }

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

/** Deneme günü yalnız getEffectiveTrialDays değeriyle yazılır; verilmezse sayı geçmeyen genel ifade. */
export function trialPhrase(trialDays?: number): string {
  return trialDays ? `${trialDays} gün ücretsiz deneme` : "Ücretsiz deneme";
}

export function buildFaq(opts: { trialDays?: number; plans?: readonly PlanDef[] } = {}): FaqItem[] {
  const discount = yearlyDiscountPercent(opts.plans);
  const days = opts.trialDays;
  const uniform = !opts.plans || new Set(opts.plans.filter((p) => !p.customPricing).map((p) => yearlyDiscountPercentOf(p))).size <= 1;
  const lost = lostCommissionPlanName();
  const contractGate = findGate("/app/sozlesmeler");
  const contractPlan = contractGate ? requiredPlanName(contractGate) : getPlan("office").name;
  return [
    {
      q: "Deneme ücretsiz mi, kredi kartı gerekir mi?",
      a: `Kayıt olunca ${days ? `${days} gün ` : ""}ücretsiz deneme başlar ve kredi kartı istenmez. Deneme boyunca tüm paketlerin özellikleri açıktır; seçtiğiniz paketin kapsamı denemeden sonra geçerli olur.`,
    },
    {
      q: "Fiyatlara KDV dahil mi?",
      a: "Hayır. Bu sayfadaki tüm aylık ve yıllık tutarlar KDV hariçtir.",
    },
    {
      q: "Yıllık ödemede indirim var mı?",
      a: discount > 0
        ? `Evet. Yıllık ödemede ${uniform ? `%${discount}` : `en az %${discount}`} indirim uygulanır; sayfadaki aylık/yıllık anahtarı bu hesabı fiyatlara yansıtır.`
        : "Şu an yıllık ödemede ayrı bir indirim tanımlı değildir; aylık ve yıllık fiyatlar sayfada yazar.",
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
