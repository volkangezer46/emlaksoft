import type { PlanDef, SeatTier } from "@/lib/billing/plans";
import {
  maxTotalSeats,
  prorateSeatChange,
  quoteSeats,
  resolveSeatTiers,
  trBillingMonthPeriod,
  type SeatQuote,
} from "@/lib/billing/seat-pricing";

/**
 * KOLTUK DEĞİŞİKLİĞİ DEĞERLENDİRMESİ (saf; istemci ve sunucu paylaşır, I/O yok).
 * Ekran canlı önizleme için, sunucu action'ı bağlayıcı hesap için AYNI fonksiyonu çağırır; istemciden tutar alınmaz.
 */

export type SeatLocks = { baseMonthlyTry?: number | null; tiers?: SeatTier[] | null };

export type SeatChangeInput = {
  plans: PlanDef[];
  planId: string;
  cycle: "monthly" | "yearly";
  /** Aktif kullanıcı (profil) sayısı: bunun altına inilemez. */
  usedSeats: number;
  /** Mevcut toplam koltuk = dahil + satın alınmış ek. */
  currentTotalSeats: number;
  targetTotalSeats: number;
  locks?: SeatLocks;
  /** Dönem sınırları (abonelik dönemi; yoksa TR takvim ayı). */
  periodStartMs?: number | null;
  periodEndMs?: number | null;
  nowMs: number;
};

export type SeatChangeStatus =
  | "increase"
  | "decrease"
  | "no_change"
  | "below_used"
  | "below_included"
  | "over_max"
  | "not_sold";

export type SeatChangeEval = {
  status: SeatChangeStatus;
  /** Kullanıcıya gösterilecek açık Türkçe açıklama. */
  message: string;
  fromQuote: SeatQuote;
  toQuote: SeatQuote;
  /** Anlık tahsil edilecek (KDV hariç) tutar; yalnız artışta > 0. */
  immediateChargeTry: number;
  effectiveAtPeriodEnd: boolean;
  prorationNote: string;
  /** İnilebilecek en düşük / çıkılabilecek en yüksek toplam koltuk. */
  minTotalSeats: number;
  maxTotalSeats: number;
  period: { startMs: number; endMs: number };
};

function lockOpts(locks?: SeatLocks) {
  return {
    lockedBaseMonthlyTry: locks?.baseMonthlyTry && locks.baseMonthlyTry > 0 ? locks.baseMonthlyTry : undefined,
    lockedTiers: locks?.tiers && locks.tiers.length > 0 ? locks.tiers : undefined,
  };
}

export function resolveSeatPeriod(
  nowMs: number,
  startMs?: number | null,
  endMs?: number | null,
): { startMs: number; endMs: number } {
  if (typeof startMs === "number" && typeof endMs === "number" && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
    return { startMs, endMs };
  }
  return trBillingMonthPeriod(nowMs);
}

export function evaluateSeatChange(input: SeatChangeInput): SeatChangeEval {
  const def = input.plans.find((p) => p.id === input.planId);
  if (!def) throw new Error(`Bilinmeyen paket: ${input.planId}`);
  const opts = lockOpts(input.locks);
  const included = def.limits.seats;
  const tiers = opts.lockedTiers ?? resolveSeatTiers(def);
  const maxTotal = maxTotalSeats(def, tiers);
  const minTotal = Math.max(included, Math.max(0, Math.floor(input.usedSeats)));
  const target = Math.max(1, Math.floor(input.targetTotalSeats));
  const current = Math.max(included, Math.floor(input.currentTotalSeats));
  const period = resolveSeatPeriod(input.nowMs, input.periodStartMs, input.periodEndMs);

  const fromQuote = quoteSeats(input.plans, input.planId, current, input.cycle, opts);
  const toQuote = quoteSeats(input.plans, input.planId, target, input.cycle, opts);
  const pr = prorateSeatChange({
    fromQuote,
    toQuote,
    periodStartMs: period.startMs,
    periodEndMs: period.endMs,
    nowMs: input.nowMs,
  });
  const base = {
    fromQuote,
    toQuote,
    immediateChargeTry: 0,
    effectiveAtPeriodEnd: false,
    prorationNote: pr.note,
    minTotalSeats: minTotal,
    maxTotalSeats: maxTotal,
    period,
  };

  if (tiers.length === 0 && target > included) {
    return { ...base, status: "not_sold", message: `${def.name} paketinde ek kullanıcı satılmıyor; daha fazla kullanıcı için paketinizi yükseltin.` };
  }
  if (target > maxTotal) {
    return {
      ...base,
      status: "over_max",
      message: `${def.name} paketinde en fazla ${Number.isFinite(maxTotal) ? maxTotal : "?"} kullanıcı olur.${
        input.plans.some((p) => !p.hidden && p.id !== def.id && maxTotalSeats(p) > maxTotal)
          ? " Daha fazlası için bir üst pakete geçin."
          : ""
      }`,
    };
  }
  if (target < included) {
    return { ...base, status: "below_included", message: `Paketinize ${included} kullanıcı dahildir; bunun altına inilemez.` };
  }
  if (target < Math.floor(input.usedSeats)) {
    return {
      ...base,
      status: "below_used",
      message: `Şu an ${Math.floor(input.usedSeats)} aktif kullanıcınız var. Koltuk sayısını bunun altına indiremezsiniz; önce bir üyeyi pasife alın.`,
    };
  }
  if (target === current) {
    return { ...base, status: "no_change", message: "Koltuk sayınız değişmiyor." };
  }
  if (target > current) {
    return {
      ...base,
      status: "increase",
      immediateChargeTry: pr.immediateChargeTry,
      effectiveAtPeriodEnd: false,
      message: pr.note,
    };
  }
  return { ...base, status: "decrease", effectiveAtPeriodEnd: true, message: pr.note };
}
