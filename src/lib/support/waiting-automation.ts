import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyTenant } from "@/lib/notify";
import { getSettings } from "@/lib/settings/read";

/**
 * Yanıt bekleyen bilet otomasyonu (AD9): ticket-sla cron'unun AYRI adımı (yeni cron route yok).
 * Ayar kapalıysa hiçbir şey yapmaz. RPC (20261013004800) yoksa adım "kurulum bekliyor" olarak atlanır;
 * SLA yükseltme adımı bundan etkilenmez.
 */
export type WaitingAutomationSummary =
  | { ran: false; reason: "disabled" | "not_installed" | "error"; detail?: string }
  | { ran: true; reminded: number; closed: number };

type Item = { ticketId: string; tenantId: string; createdBy: string | null; ticketNo: string | null; subject: string };

function items(value: unknown): Item[] {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === "object" && typeof (v as Item).ticketId === "string") as Item[]) : [];
}

export async function runWaitingAutomation(admin: SupabaseClient): Promise<WaitingAutomationSummary> {
  const s = await getSettings(["support.waiting_automation_enabled", "support.waiting_reminder_days", "support.waiting_autoclose_days"]);
  if (s["support.waiting_automation_enabled"] !== true) return { ran: false, reason: "disabled" };
  const reminderDays = Number(s["support.waiting_reminder_days"] ?? 0);
  const closeDays = Number(s["support.waiting_autoclose_days"] ?? 0);

  const { data, error } = await admin.rpc("process_support_ticket_waiting_automation", {
    p_reminder_days: reminderDays,
    p_close_days: closeDays,
    p_limit: 100,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return { ran: false, reason: "not_installed" };
    return { ran: false, reason: "error", detail: error.message };
  }
  const payload = (data ?? {}) as { reminded?: unknown; closed?: unknown };
  const reminded = items(payload.reminded);
  const closed = items(payload.closed);

  // Bildirimler bağımsız; biri düşerse diğerleri sürer.
  await Promise.allSettled([
    ...reminded.map((t) =>
      notifyTenant({
        tenantId: t.tenantId,
        userId: t.createdBy,
        title: "Destek talebiniz yanıtınızı bekliyor",
        body: `${t.ticketNo ?? "Destek talebi"} · ${t.subject}`,
        href: `/app/destek/${t.ticketId}`,
        kind: "warning",
        prefKey: "support",
      }),
    ),
    ...closed.map((t) =>
      notifyTenant({
        tenantId: t.tenantId,
        userId: t.createdBy,
        title: "Destek talebiniz otomatik kapatıldı",
        body: `${t.ticketNo ?? "Destek talebi"} · ${t.subject} — yanıt gelmediği için kapatıldı; dilediğiniz zaman yeniden açabilirsiniz.`,
        href: `/app/destek/${t.ticketId}`,
        kind: "info",
        prefKey: "support",
      }),
    ),
  ]);
  return { ran: true, reminded: reminded.length, closed: closed.length };
}
