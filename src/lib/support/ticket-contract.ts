export const TICKET_CATEGORIES_FALLBACK = [
  "general",
  "billing",
  "bug",
  "feature",
  "compliance",
  "onboarding",
] as const;

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TICKET_STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
export const TICKET_VISIBILITIES = ["public", "internal"] as const;

export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketVisibility = (typeof TICKET_VISIBILITIES)[number];
export type TicketActorKind = "tenant" | "staff";

export const TICKET_LIMITS = {
  subjectMin: 3,
  subjectMax: 200,
  bodyMin: 3,
  bodyMax: 20_000,
  categoryMax: 80,
  resolutionCodeMax: 80,
  resolutionSummaryMax: 2_000,
  csatCommentMax: 1_000,
  macroTitleMax: 120,
  macroBodyMax: 10_000,
  bulkMax: 50,
} as const;

/**
 * Support SLA v2 deliberately uses elapsed calendar hours, not business hours.
 * The database migration carries the same policy so persisted due dates and UI
 * fallbacks cannot silently diverge.
 */
export const TICKET_SLA_CALENDAR_HOURS: Record<
  TicketPriority,
  { firstResponse: number; resolution: number }
> = {
  urgent: { firstResponse: 1, resolution: 8 },
  high: { firstResponse: 4, resolution: 24 },
  normal: { firstResponse: 8, resolution: 72 },
  low: { firstResponse: 24, resolution: 120 },
};

const STAFF_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["in_progress", "waiting", "resolved", "closed"],
  in_progress: ["open", "waiting", "resolved", "closed"],
  waiting: ["open", "in_progress", "resolved", "closed"],
  resolved: ["open", "waiting", "closed"],
  closed: ["open"],
};

const TENANT_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["closed"],
  in_progress: ["closed"],
  waiting: ["closed"],
  resolved: ["open", "closed"],
  closed: ["open"],
};

export function isTicketPriority(value: string): value is TicketPriority {
  return (TICKET_PRIORITIES as readonly string[]).includes(value);
}

export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}

export function isTicketVisibility(value: string): value is TicketVisibility {
  return (TICKET_VISIBILITIES as readonly string[]).includes(value);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isTicketTransitionAllowed(
  from: string,
  to: string,
  actorKind: TicketActorKind,
): boolean {
  if (!isTicketStatus(from) || !isTicketStatus(to)) return false;
  if (from === to) return true;
  const map = actorKind === "staff" ? STAFF_TRANSITIONS : TENANT_TRANSITIONS;
  return map[from].includes(to);
}

export function ticketSlaCalendarHours(priority: string) {
  return TICKET_SLA_CALENDAR_HOURS[isTicketPriority(priority) ? priority : "normal"];
}

export function normalizeOptionalRequestId(value: FormDataEntryValue | null): string | null {
  const id = String(value ?? "").trim();
  return id && isUuid(id) ? id : null;
}

export function validateTicketSubject(value: string): string | null {
  const length = value.trim().length;
  if (length < TICKET_LIMITS.subjectMin || length > TICKET_LIMITS.subjectMax) {
    return `Konu ${TICKET_LIMITS.subjectMin}-${TICKET_LIMITS.subjectMax} karakter olmalı.`;
  }
  return null;
}

export function validateTicketBody(value: string): string | null {
  const length = value.trim().length;
  if (length < TICKET_LIMITS.bodyMin || length > TICKET_LIMITS.bodyMax) {
    return `Mesaj ${TICKET_LIMITS.bodyMin}-${TICKET_LIMITS.bodyMax.toLocaleString("tr-TR")} karakter olmalı.`;
  }
  return null;
}

export function validateTicketCategory(value: string): string | null {
  const length = value.trim().length;
  if (length < 1 || length > TICKET_LIMITS.categoryMax) return "Geçersiz kategori.";
  return null;
}

export function validateTicketResolution(
  status: string,
  code: string,
  summary: string,
): string | null {
  const terminal = status === "resolved" || status === "closed";
  const normalizedCode = code.trim();
  const normalizedSummary = summary.trim();

  if (!terminal) {
    return normalizedCode || normalizedSummary
      ? "Aktif durumlarda çözüm bilgisi gönderilemez."
      : null;
  }
  if (normalizedCode.length < 1 || normalizedCode.length > TICKET_LIMITS.resolutionCodeMax) {
    return "Çözüm türü zorunludur.";
  }
  if (normalizedSummary.length < 3 || normalizedSummary.length > TICKET_LIMITS.resolutionSummaryMax) {
    return `Çözüm özeti 3-${TICKET_LIMITS.resolutionSummaryMax.toLocaleString("tr-TR")} karakter olmalı.`;
  }
  return null;
}

export function uniqueValidTicketIds(values: FormDataEntryValue[]): string[] | null {
  const ids = [...new Set(values.map(String).map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > TICKET_LIMITS.bulkMax || ids.some((id) => !isUuid(id))) {
    return null;
  }
  return ids;
}
