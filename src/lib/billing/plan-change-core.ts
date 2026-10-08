import { planAmountOf, type BillingCycle, type PlanDef } from "@/lib/billing/plans";

/**
 * ORANSAL PAKET DEĞİŞİKLİĞİ DEĞERLENDİRMESİ (saf; istemci ve sunucu paylaşır, I/O yok).
 *
 * Yükseltme (dönem tutarı artar): dönemin KALAN oranı kadar fark ANINDA faturalanır; dönem sonu ve döngü değişmez,
 *   sonraki yenilemede yeni paketin tam tutarı alınır.
 *     oran   = (dönem_sonu - şimdi) / (dönem_sonu - dönem_başı)            [0..1]
 *     kredi  = mevcut_dönem_tutarı * oran                                   (KDV hariç; son ödenen yenileme net tutarıyla sınırlı)
 *     yeni   = yeni_dönem_tutarı   * oran
 *     ödenecek (net) = yeni - kredi
 * Düşürme (dönem tutarı azalır): DÖNEM SONUNDA uygulanır; iade ve kredi YOK. Mevcut dönemin sonuna kadar şu anki paket sürer.
 *
 * Tutar istemciden ALINMAZ: ekran canlı önizleme için, sunucu action'ı bağlayıcı hesap için AYNI fonksiyonu çağırır.
 * KDV bu katmanda yoktur; fatura `invoiceAmountsTry` ile (net -> KDV -> toplam) kesilir.
 */

export type PlanChangeInput = {
  plans: readonly PlanDef[];
  fromPlanId: string;
  toPlanId: string;
  cycle: BillingCycle;
  /** Mevcut aboneliğin kilitli (Founders) aylık fiyatı; varsa mevcut paketin dönem tutarı bununla hesaplanır. */
  lockedMonthlyTry?: number | null;
  /**
   * Son ödenen DÜZ yenileme faturasının net tutarı (kupon/indirimle liste fiyatından az ödenmiş olabilir).
   * Verilirse kredi bunu AŞAMAZ (fazladan kredi verilmez). Son fatura bir yükseltme faturasıysa verilmez.
   */
  paidCapNetTry?: number | null;
  periodStartMs: number | null;
  periodEndMs: number | null;
  nowMs: number;
  /** Kapasite denetimi (yalnız düşürmede): aktif kullanıcı ve satın alınmış ek koltuk. */
  usedSeats?: number;
  extraSeats?: number;
};

export type PlanChangeStatus =
  | "upgrade"
  | "downgrade"
  | "same_plan"
  | "same_price"
  | "unknown_plan"
  | "not_sold"
  | "no_period"
  | "period_over"
  | "tiny_charge"
  | "over_capacity";

export type PlanChangeEval = {
  status: PlanChangeStatus;
  /** Kullanıcıya gösterilecek açık Türkçe açıklama. */
  message: string;
  /** Kalan süre oranı (0..1). */
  ratio: number;
  /** Mevcut ve yeni paketin dönem tutarları (KDV hariç). */
  fromPeriodTry: number;
  toPeriodTry: number;
  /** Mevcut paketten kalan süre kredisi ve yeni paketin kalan süre bedeli (KDV hariç). */
  creditTry: number;
  newCostTry: number;
  /** Anında tahsil edilecek NET tutar (KDV hariç); yalnız `upgrade` durumunda > 0. */
  chargeNetTry: number;
  /** Düşürme dönem sonunda uygulanır. */
  effectiveAtPeriodEnd: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const tl = (n: number) => `${Math.round(n).toLocaleString("tr-TR")} ₺`;

/** Mevcut paketin dönem tutarı: kilitli aylık fiyat varsa o (yıllıkta yıllık ödenen ay çarpanıyla). */
export function currentPeriodAmount(def: PlanDef, cycle: BillingCycle, lockedMonthlyTry?: number | null): number {
  const monthly = lockedMonthlyTry && lockedMonthlyTry > 0 ? Math.min(lockedMonthlyTry, def.monthlyTry) : def.monthlyTry;
  return planAmountOf({ monthlyTry: monthly, yearlyPaidMonths: def.yearlyPaidMonths }, cycle);
}

export function remainingRatio(periodStartMs: number, periodEndMs: number, nowMs: number): number {
  const total = periodEndMs - periodStartMs;
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, (periodEndMs - nowMs) / total));
}

export function evaluatePlanChange(input: PlanChangeInput): PlanChangeEval {
  const from = input.plans.find((p) => p.id === input.fromPlanId);
  const to = input.plans.find((p) => p.id === input.toPlanId);
  const empty = {
    ratio: 0,
    fromPeriodTry: 0,
    toPeriodTry: 0,
    creditTry: 0,
    newCostTry: 0,
    chargeNetTry: 0,
    effectiveAtPeriodEnd: false,
  };
  if (!from || !to) {
    return { ...empty, status: "unknown_plan", message: "Paket bulunamadı." };
  }
  const fromPeriodTry = currentPeriodAmount(from, input.cycle, input.lockedMonthlyTry);
  const toPeriodTry = planAmountOf(to, input.cycle);
  const base = { ...empty, fromPeriodTry, toPeriodTry };

  if (from.id === to.id) return { ...base, status: "same_plan", message: "Zaten bu paketi kullanıyorsunuz." };
  if (to.hidden) return { ...base, status: "not_sold", message: "Bu paket çevrimiçi seçilemiyor." };
  if (toPeriodTry === fromPeriodTry) {
    return { ...base, status: "same_price", message: "İki paketin tutarı aynı; paket değişikliği için destek ile iletişime geçin." };
  }

  const startMs = input.periodStartMs;
  const endMs = input.periodEndMs;
  if (startMs == null || endMs == null || !(endMs > startMs)) {
    return { ...base, status: "no_period", message: "Çalışan bir ücretli dönem bulunamadı." };
  }
  if (endMs <= input.nowMs) {
    return { ...base, status: "period_over", message: "Dönem sona erdi; paketi yenileme ekranından seçin." };
  }
  const ratio = remainingRatio(startMs, endMs, input.nowMs);
  const pct = Math.round(ratio * 100);

  if (toPeriodTry < fromPeriodTry) {
    const toSeats = to.limits.seats + Math.max(0, Math.floor(input.extraSeats ?? 0));
    if (input.usedSeats != null && input.usedSeats > toSeats) {
      return {
        ...base,
        ratio,
        status: "over_capacity",
        message: `${to.name} paketinde en fazla ${toSeats} kullanıcı olur; şu an ${input.usedSeats} aktif kullanıcınız var. Önce kullanıcı sayısını azaltın.`,
      };
    }
    return {
      ...base,
      ratio,
      status: "downgrade",
      effectiveAtPeriodEnd: true,
      message: `${to.name} paketine geçiş mevcut dönemin sonunda uygulanır. İade ve kredi yoktur; dönem sonuna kadar ${from.name} paketini kullanmaya devam edersiniz.`,
    };
  }

  const creditRate = input.paidCapNetTry != null && input.paidCapNetTry >= 0 ? Math.min(fromPeriodTry, input.paidCapNetTry) : fromPeriodTry;
  const creditTry = round2(creditRate * ratio);
  const newCostTry = round2(toPeriodTry * ratio);
  const chargeNetTry = round2(newCostTry - creditTry);
  if (!(chargeNetTry >= 0.01)) {
    return {
      ...base,
      ratio,
      creditTry,
      newCostTry,
      status: "tiny_charge",
      message: "Dönem bitmek üzere olduğundan şimdi ek tutar çıkmıyor; yenileme sırasında yeni paketi seçebilirsiniz.",
    };
  }
  return {
    ...base,
    ratio,
    creditTry,
    newCostTry,
    chargeNetTry,
    status: "upgrade",
    message:
      `Değişiklik ödeme sonrası hemen geçerli olur. Dönemin kalan %${pct}'lik bölümü için ${to.name} bedeli (${tl(toPeriodTry)} x %${pct}) ` +
      `ile ${from.name} kredisi (${tl(creditRate)} x %${pct}) arasındaki fark şimdi faturalanır; sonraki yenilemede yeni paketin tam tutarı alınır.`,
  };
}
