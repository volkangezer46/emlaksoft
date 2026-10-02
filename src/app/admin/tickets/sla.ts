import { ticketSlaCalendarHours } from "@/lib/support/ticket-contract";

/**
 * Veritabanındaki hedef tarih kanoniktir. Henüz bu alanı seçmeyen eski ekranlar
 * migration 142 ile aynı, öncelik bazlı takvim-saati politikasına düşer.
 * İş saati veya resmî tatil hesabı yapıldığı ima edilmez.
 */

export const SLA_OPEN_STATUSES = ["open", "in_progress", "waiting"] as const;

export type SlaState = {
  /** SLA takibi bu ticket için geçerli mi? */
  tracked: boolean;
  phase: "first_response" | "resolution" | null;
  breached: boolean;
  warning: boolean;
  hours: number;
  label: string; // "2 sa 15 dk" gibi; hedefe kalan veya aşılan süre
  dueAt?: string;
};

export function slaStateOf(opts: {
  status: string;
  createdAt: string;
  hasStaffReply: boolean;
  priority?: string;
  firstResponseDueAt?: string | null;
  firstResponseAt?: string | null;
  firstResponseBreachedAt?: string | null;
  resolutionDueAt?: string | null;
  resolutionBreachedAt?: string | null;
  now?: number;
}): SlaState {
  const idle: SlaState = {
    tracked: false,
    phase: null,
    breached: false,
    warning: false,
    hours: 0,
    label: "",
  };
  if (!(SLA_OPEN_STATUSES as readonly string[]).includes(opts.status)) return idle;

  const now = opts.now ?? Date.now();
  const policy = ticketSlaCalendarHours(opts.priority ?? "normal");
  const createdAtMs = new Date(opts.createdAt).getTime();
  const firstResponseDone = Boolean(opts.hasStaffReply || opts.firstResponseAt);
  const phase = firstResponseDone ? "resolution" : "first_response";
  const targetHours = phase === "first_response" ? policy.firstResponse : policy.resolution;
  const persistedDue = phase === "first_response" ? opts.firstResponseDueAt : opts.resolutionDueAt;
  const fallbackDue = createdAtMs + targetHours * 3_600_000;
  const parsedDue = persistedDue ? new Date(persistedDue).getTime() : fallbackDue;
  const dueAtMs = Number.isFinite(parsedDue) ? parsedDue : fallbackDue;
  const remainingMs = dueAtMs - now;
  // Breach timestamps are immutable history. A reopened ticket gets a fresh
  // due date, so the active-cycle badge must be derived from that current due.
  const breached = remainingMs < 0;
  const ms = breached ? Math.abs(Math.min(remainingMs, 0)) : Math.max(remainingMs, 0);
  const hours = ms / 3_600_000;
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const label = h >= 48 ? `${Math.floor(h / 24)} gün` : h > 0 ? `${h} sa ${m} dk` : `${m} dk`;

  const warningWindowMs = Math.min(targetHours * 0.25, 1) * 3_600_000;
  return {
    tracked: true,
    phase,
    breached,
    warning: !breached && remainingMs <= warningWindowMs,
    hours,
    label,
    dueAt: new Date(dueAtMs).toISOString(),
  };
}

/** Liste sıralama anahtarı: acil + SLA aşımı en öne. Küçük değer = önce. */
export function slaSortRank(priority: string, sla: SlaState): number {
  const urgent = priority === "urgent";
  if (urgent && sla.breached) return 0;
  if (sla.breached) return 1;
  if (urgent && sla.tracked) return 2;
  return 3;
}
