import { quoteSeats, seatUtilization } from "@/lib/billing/seat-pricing";
import type { PlanDef } from "@/lib/billing/plans";

/**
 * GELİR BÜYÜME ANALİTİĞİ + FİYAT SİMÜLATÖRÜ (saf, deterministik).
 * Tahmin/elastikiyet iddiası YOK: yalnız kayıtlı abonelik verisi ve admin'in girdiği açık varsayımlar.
 * Tutarlar KDV hariç TRY; MRR = aylık eşdeğer (yıllık tutar / 12).
 */

export type SeatSubscriberRow = {
  tenantId: string;
  tenantName: string;
  plan: string;
  status: string;
  cycle: "monthly" | "yearly";
  /** Kayıtlı dönem tutarı (subscriptions.amount_try). */
  amountTry: number;
  /** subscriptions.extra_seats; sütun yoksa null (genişleme ölçülemez). */
  extraSeats: number | null;
  /** Aktif kullanıcı sayısı; bilinmiyorsa null. */
  usedSeats: number | null;
  /** Kilitli fiyat (price_lock_try) var mı. */
  locked: boolean;
};

export function monthlyEquivalent(row: Pick<SeatSubscriberRow, "amountTry" | "cycle">): number {
  const a = Number.isFinite(row.amountTry) ? Math.max(0, row.amountTry) : 0;
  return row.cycle === "yearly" ? a / 12 : a;
}

export type SeatAnalytics = {
  /** extra_seats sütunu okunabildi mi (false = genişleme ve ek koltuk ölçümü "etkin değil"). */
  extraSeatsEnabled: boolean;
  activeSubscribers: number;
  mrrTry: number;
  arpaTry: number;
  /** Ek kullanıcıdan gelen aylık gelir: liste kademeleriyle hesaplanan tahmini TUTAR DEĞİL, kayıtlı ek koltuk x kademe. */
  expansionMrrTry: number;
  extraSeatsTotal: number;
  officesWithExtraSeats: number;
  utilization: { ok: number; warn: number; full: number; unknown: number };
  warnTenants: SeatSubscriberRow[];
  fullTenants: SeatSubscriberRow[];
  planDistribution: { plan: string; offices: number; mrrTry: number; extraSeats: number; avgUtilization: number | null }[];
};

export function computeSeatAnalytics(
  rows: readonly SeatSubscriberRow[],
  plans: PlanDef[],
  warnRatio: number,
  extraSeatsEnabled: boolean,
): SeatAnalytics {
  const active = rows.filter((r) => r.status === "active");
  const mrr = active.reduce((s, r) => s + monthlyEquivalent(r), 0);
  const util = { ok: 0, warn: 0, full: 0, unknown: 0 };
  const warnTenants: SeatSubscriberRow[] = [];
  const fullTenants: SeatSubscriberRow[] = [];
  let expansion = 0;
  let extraTotal = 0;
  let withExtra = 0;
  const byPlan = new Map<string, { offices: number; mrr: number; extra: number; ratioSum: number; ratioN: number }>();

  for (const r of active) {
    const def = plans.find((p) => p.id === r.plan);
    const included = def?.limits.seats ?? 0;
    const extra = extraSeatsEnabled ? Math.max(0, r.extraSeats ?? 0) : 0;
    const agg = byPlan.get(r.plan) ?? { offices: 0, mrr: 0, extra: 0, ratioSum: 0, ratioN: 0 };
    agg.offices += 1;
    agg.mrr += monthlyEquivalent(r);
    agg.extra += extra;

    if (extra > 0 && def) {
      withExtra += 1;
      extraTotal += extra;
      expansion += quoteSeats(plans, def.id, included + extra, "monthly").extraMonthlyTry;
    }
    if (r.usedSeats === null || !def) {
      util.unknown += 1;
    } else {
      const u = seatUtilization(r.usedSeats, included, extra, warnRatio);
      agg.ratioSum += u.ratio;
      agg.ratioN += 1;
      if (u.level === "full") {
        util.full += 1;
        fullTenants.push(r);
      } else if (u.level === "warn80") {
        util.warn += 1;
        warnTenants.push(r);
      } else util.ok += 1;
    }
    byPlan.set(r.plan, agg);
  }

  const planDistribution = [...byPlan.entries()]
    .map(([plan, a]) => ({
      plan,
      offices: a.offices,
      mrrTry: Math.round(a.mrr),
      extraSeats: a.extra,
      avgUtilization: a.ratioN > 0 ? a.ratioSum / a.ratioN : null,
    }))
    .sort((x, y) => y.offices - x.offices);

  return {
    extraSeatsEnabled,
    activeSubscribers: active.length,
    mrrTry: Math.round(mrr),
    arpaTry: active.length > 0 ? Math.round(mrr / active.length) : 0,
    expansionMrrTry: Math.round(expansion),
    extraSeatsTotal: extraTotal,
    officesWithExtraSeats: withExtra,
    utilization: util,
    warnTenants,
    fullTenants,
    planDistribution,
  };
}

// ---------------------------------------------------------------------------
// Fiyat simülatörü
// ---------------------------------------------------------------------------

export type NewSalesAssumption = { planId: string; totalSeats: number; count: number; cycle: "monthly" | "yearly" };

export type SimulationInput = {
  /** Şu an yayında olan katalog. */
  currentPlans: PlanDef[];
  /** Admin'in girdiği (kaydedilmemiş) önerilen katalog. */
  proposedPlans: PlanDef[];
  subscribers: readonly Pick<SeatSubscriberRow, "plan" | "status" | "cycle" | "amountTry" | "extraSeats" | "locked">[];
  newSales: NewSalesAssumption[];
  /**
   * false (varsayılan, mevcut politika): mevcut abonelerin KAYITLI tutarı değişmez; yeni fiyat yalnız yeni satışlara.
   * true: kilitsiz mevcut aboneler yenilemede yeni liste fiyatına geçer; kilitli tutarlar yine değişmez.
   */
  repriceExistingAtRenewal: boolean;
};

export type SimulationSide = { subscribers: number; mrrTry: number; arpaTry: number; newSalesMrrTry: number };

export type SimulationResult = {
  before: SimulationSide;
  after: SimulationSide;
  deltaMrrTry: number;
  deltaArpaTry: number;
  /** Fiyatı değişmeyen (kilitli ya da politika gereği kayıtlı) aboneler. */
  unchangedSubscribers: number;
  repricedSubscribers: number;
  lockedSubscribers: number;
  /** Kayıtlı koltuk sayısı bilinmediği için yeniden fiyatlanamayan kilitsiz aboneler (kayıtlı tutarla kalır). */
  skippedUnknownSeats: number;
};

function newSalesMrr(plans: PlanDef[], sales: readonly NewSalesAssumption[]): { mrr: number; count: number } {
  let mrr = 0;
  let count = 0;
  for (const s of sales) {
    if (!Number.isInteger(s.count) || s.count <= 0 || !plans.some((p) => p.id === s.planId)) continue;
    const q = quoteSeats(plans, s.planId, s.totalSeats, "monthly");
    mrr += q.totalMonthlyTry * s.count;
    count += s.count;
  }
  return { mrr, count };
}

export function simulatePriceChange(input: SimulationInput): SimulationResult {
  const active = input.subscribers.filter((s) => s.status === "active");
  const currentMrr = active.reduce((s, r) => s + monthlyEquivalent(r), 0);

  let afterMrr = 0;
  let repriced = 0;
  let unchanged = 0;
  let locked = 0;
  let skipped = 0;
  for (const r of active) {
    const recorded = monthlyEquivalent(r);
    if (r.locked) {
      locked += 1;
      unchanged += 1;
      afterMrr += recorded;
      continue;
    }
    const proposed = input.proposedPlans.find((p) => p.id === r.plan);
    if (!input.repriceExistingAtRenewal || !proposed) {
      unchanged += 1;
      afterMrr += recorded;
      continue;
    }
    if (r.extraSeats === null) {
      // extra_seats ölçülemiyor: yalnız taban fiyat farkı güvenle hesaplanır.
      const current = input.currentPlans.find((p) => p.id === r.plan);
      if (!current) {
        skipped += 1;
        afterMrr += recorded;
        continue;
      }
      afterMrr += recorded + (proposed.monthlyTry - current.monthlyTry);
      repriced += 1;
      continue;
    }
    const q = quoteSeats(input.proposedPlans, r.plan, proposed.limits.seats + r.extraSeats, "monthly");
    afterMrr += q.totalMonthlyTry;
    repriced += 1;
  }

  const salesBefore = newSalesMrr(input.currentPlans, input.newSales);
  const salesAfter = newSalesMrr(input.proposedPlans, input.newSales);
  const subsBefore = active.length + salesBefore.count;
  const subsAfter = active.length + salesAfter.count;
  const mrrBefore = currentMrr + salesBefore.mrr;
  const mrrAfter = afterMrr + salesAfter.mrr;
  const arpaBefore = subsBefore > 0 ? mrrBefore / subsBefore : 0;
  const arpaAfter = subsAfter > 0 ? mrrAfter / subsAfter : 0;

  return {
    before: { subscribers: subsBefore, mrrTry: Math.round(mrrBefore), arpaTry: Math.round(arpaBefore), newSalesMrrTry: Math.round(salesBefore.mrr) },
    after: { subscribers: subsAfter, mrrTry: Math.round(mrrAfter), arpaTry: Math.round(arpaAfter), newSalesMrrTry: Math.round(salesAfter.mrr) },
    deltaMrrTry: Math.round(mrrAfter - mrrBefore),
    deltaArpaTry: Math.round(arpaAfter - arpaBefore),
    unchangedSubscribers: unchanged,
    repricedSubscribers: repriced,
    lockedSubscribers: locked,
    skippedUnknownSeats: skipped,
  };
}
