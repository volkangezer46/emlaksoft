/** Ofis komisyon oranı bilinmiyorsa varsayılan (yüzde). */
export const DEFAULT_COMMISSION_RATE = 2;

export type LeakCalcInput = {
  reason: string;
  dealHappened: boolean;
  closedByUs: boolean;
  competitorClosed: boolean;
  dealAmount: number | null;
  listPrice: number | null;
  commissionRate: number | null;
};

export type LeakCalcResult = {
  dealHappened: boolean;
  closedByUs: boolean;
  competitorClosed: boolean;
  estimatedLostCommission: number;
  baseAmount: number;
  rate: number;
};

export function normalizeCloseFlags(input: {
  reason: string;
  dealHappened: boolean;
  closedByUs: boolean;
  competitorClosed: boolean;
}): Pick<LeakCalcResult, "dealHappened" | "closedByUs" | "competitorClosed"> {
  const reason = input.reason.toLowerCase();
  let closedByUs = input.closedByUs;
  let competitorClosed = input.competitorClosed;
  let dealHappened = input.dealHappened;

  if (reason.includes("kendi satış") || reason.includes("biz kapatt")) {
    closedByUs = true;
    competitorClosed = false;
    dealHappened = true;
  }
  if (reason.includes("rakip")) {
    competitorClosed = true;
    closedByUs = false;
    dealHappened = true;
  }

  return { dealHappened, closedByUs, competitorClosed };
}

/** Rakip / ofis dışı kapanışta tahmini kaçan komisyon. */
export function estimateLostCommission(input: LeakCalcInput): LeakCalcResult {
  const flags = normalizeCloseFlags(input);
  const rate = Number.isFinite(input.commissionRate) && (input.commissionRate ?? 0) > 0
    ? Number(input.commissionRate)
    : DEFAULT_COMMISSION_RATE;
  const baseAmount =
    input.dealAmount && input.dealAmount > 0
      ? input.dealAmount
      : input.listPrice && input.listPrice > 0
        ? input.listPrice
        : 0;

  const isLeak = flags.competitorClosed || (flags.dealHappened && !flags.closedByUs);
  const estimatedLostCommission = isLeak && baseAmount > 0
    ? Math.round(baseAmount * (rate / 100))
    : 0;

  return {
    ...flags,
    estimatedLostCommission,
    baseAmount,
    rate,
  };
}

export function moneyTry(n: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(n);
}
