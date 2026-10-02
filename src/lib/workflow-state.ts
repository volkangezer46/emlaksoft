/**
 * CRM durum makinelerinin sunucu tarafındaki tek doğruluk kaynağı.
 *
 * Arayüz, yalnız uygun düğmeleri göstermeye devam eder; ancak Server Action
 * doğrudan çağrılabildiği için gerçek iş kuralı burada ve DB RPC'lerinde de
 * uygulanır. `from === to` bir geçiş değil, güvenli/idempotent replay'dir.
 */

export const DEMAND_STATUSES = ["new", "active", "matched", "closed"] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

export const OFFER_STATUSES = [
  "draft",
  "submitted",
  "countered",
  "accepted",
  "rejected",
  "withdrawn",
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const DEAL_STAGES = ["new", "qualified", "negotiation", "won", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const APPOINTMENT_STATUSES = [
  "pending",
  "confirmed",
  "signature",
  "completed",
  "cancelled",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const CONTRACT_STATUSES = ["draft", "sent", "signed", "rejected", "cancelled"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

const OFFER_FLOW: Readonly<Record<OfferStatus, readonly OfferStatus[]>> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["countered", "accepted", "rejected", "withdrawn"],
  countered: ["countered", "accepted", "rejected", "withdrawn"],
  accepted: [],
  rejected: [],
  withdrawn: [],
};

const DEAL_FLOW: Readonly<Record<DealStage, readonly DealStage[]>> = {
  new: ["qualified", "lost"],
  qualified: ["negotiation", "lost"],
  negotiation: ["won", "lost"],
  won: ["negotiation"],
  lost: ["negotiation"],
};

const APPOINTMENT_FLOW: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["pending", "signature", "completed", "cancelled"],
  signature: ["confirmed", "completed", "cancelled"],
  completed: ["pending", "confirmed"],
  cancelled: ["pending"],
};

const CONTRACT_FLOW: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  draft: ["sent", "cancelled"],
  sent: ["signed", "rejected", "cancelled"],
  signed: [],
  rejected: [],
  cancelled: [],
};

function includes<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

export function isDemandStatus(value: string): value is DemandStatus {
  return includes(DEMAND_STATUSES, value);
}

export function isOfferStatus(value: string): value is OfferStatus {
  return includes(OFFER_STATUSES, value);
}

export function isDealStage(value: string): value is DealStage {
  return includes(DEAL_STAGES, value);
}

export function isAppointmentStatus(value: string): value is AppointmentStatus {
  return includes(APPOINTMENT_STATUSES, value);
}

export function isContractStatus(value: string): value is ContractStatus {
  return includes(CONTRACT_STATUSES, value);
}

function isTransitionAllowed<T extends string>(
  flow: Readonly<Record<T, readonly T[]>>,
  from: T,
  to: T,
): boolean {
  return from === to || flow[from].includes(to);
}

export function isOfferTransitionAllowed(from: OfferStatus, to: OfferStatus): boolean {
  return isTransitionAllowed(OFFER_FLOW, from, to);
}

export function isDealTransitionAllowed(from: DealStage, to: DealStage): boolean {
  return isTransitionAllowed(DEAL_FLOW, from, to);
}

export function isAppointmentTransitionAllowed(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return isTransitionAllowed(APPOINTMENT_FLOW, from, to);
}

export function isContractTransitionAllowed(from: ContractStatus, to: ContractStatus): boolean {
  return isTransitionAllowed(CONTRACT_FLOW, from, to);
}

/** YYYY-MM-DD ve takvimde gerçekten var olan bir tarih. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** datetime-local / ISO girdisini güvenli ISO'ya çevirir; RangeError fırlatmaz. */
export function toIsoDateTime(value: string): string | null {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
