import { computeLoanPlan, type AmortizationRow } from "@/lib/purchase-costs";
import { hasEmpty, invalidKeys, readField, val } from "./inputs";

export type LoanRaw = { amount: string; monthlyRatePct: string; months: string };
export type LoanKey = "amount" | "monthlyRatePct" | "months";

export type LoanToolResult =
  | { status: "empty" }
  | { status: "invalid"; fields: LoanKey[] }
  | {
      status: "ok";
      monthlyPayment: number;
      totalPayment: number;
      totalInterest: number;
      annualRatePct: number;
      schedule: AmortizationRow[];
    };

/** Faiz alanı BOŞ gelir: güncel oran kullanıcıdan alınır. Formül `computeLoanPlan` (anuite). */
export function computeLoanTool(raw: LoanRaw): LoanToolResult {
  const f = {
    amount: readField(raw.amount, { positive: true }),
    monthlyRatePct: readField(raw.monthlyRatePct, { min: 0, max: 20 }),
    months: readField(raw.months, { min: 1, max: 360 }),
  };
  const bad = invalidKeys(f);
  if (bad.length) return { status: "invalid", fields: bad };
  if (hasEmpty(f, ["amount", "monthlyRatePct", "months"])) return { status: "empty" };
  if (!Number.isInteger(val(f.months))) return { status: "invalid", fields: ["months"] };
  const p = computeLoanPlan({
    amount: val(f.amount),
    monthlyRatePct: val(f.monthlyRatePct),
    months: val(f.months),
    scheduleRows: 12,
  });
  return {
    status: "ok",
    monthlyPayment: p.monthlyPayment,
    totalPayment: p.totalPayment,
    totalInterest: p.totalInterest,
    annualRatePct: p.annualRatePct,
    schedule: p.amortizationSchedule,
  };
}
