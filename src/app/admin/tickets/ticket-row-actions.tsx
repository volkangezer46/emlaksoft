"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserRound } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { setTicketStatus } from "@/app/actions/tickets";
import { assignTicketStaffAction } from "@/app/actions/admin-ticket-ops";
import { cn } from "@/lib/utils";

/**
 * Ticket satırı aksiyonları — Radix `Select` tabanlı (bkz. `components/ui/select`):
 * animasyonlu popover, klavye ile harf-arama, seçili öğede tik işareti. Değişince
 * `startTransition` içinde server action doğrudan çağrılır (form/native-select
 * gerekmez) — durum/atama ayrı bir "Güncelle/Ata" butonu olmadan anında uygulanır.
 */

const UNASSIGNED = "__unassigned";

const STATUS_DOT: Record<string, string> = {
  open: "bg-amber-500",
  in_progress: "bg-brand-500",
  waiting: "bg-violet-500",
  resolved: "bg-mint-500",
  closed: "bg-ink-950/30",
};

const STATUS_TONE: Record<string, string> = {
  open: "border-amber-400/40 bg-amber-400/10 text-amber-700 hover:border-amber-400/70 data-[state=open]:border-amber-500",
  in_progress: "border-brand-500/40 bg-brand-600/10 text-brand-700 hover:border-brand-500/70 data-[state=open]:border-brand-500",
  waiting: "border-violet-400/40 bg-violet-400/10 text-violet-700 hover:border-violet-400/70 data-[state=open]:border-violet-500",
  resolved: "border-mint-500/40 bg-mint-500/10 text-mint-700 hover:border-mint-500/70 data-[state=open]:border-mint-500",
  closed: "border-line bg-canvas text-text-muted hover:border-line-strong data-[state=open]:border-brand-400",
};

/** Kompakt satır-içi tetikleyici — form select bileşenlerinden ayrı, dar dolgu. */
const TRIGGER_BASE =
  "h-auto min-h-0 w-auto min-w-[8rem] gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold shadow-none transition data-[state=open]:shadow-[var(--shadow-xs)]";

export function TicketRowActions({
  id,
  status,
  statusOptions,
  assignedId,
  staff,
}: {
  id: string;
  status: string;
  statusOptions: { value: string; label: string }[];
  assignedId: string | null;
  staff: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [statusPending, startStatusTransition] = useTransition();
  const [assignPending, startAssignTransition] = useTransition();

  const statusLabelOf = useMemo(() => new Map(statusOptions.map((o) => [o.value, o.label])), [statusOptions]);
  const staffNameOf = useMemo(() => new Map(staff.map((s) => [s.id, s.full_name])), [staff]);
  const assignValue = assignedId ?? UNASSIGNED;

  function onStatusChange(next: string) {
    startStatusTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("status", next);
      await setTicketStatus(fd);
      router.refresh();
    });
  }

  function onAssignChange(next: string) {
    startAssignTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("staff_id", next === UNASSIGNED ? "" : next);
      await assignTicketStaffAction(fd);
      router.refresh();
    });
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto lg:justify-end">
      <Select value={status} onValueChange={onStatusChange}>
        <SelectTrigger
          aria-label="Durum değiştir"
          disabled={statusPending}
          className={cn(TRIGGER_BASE, STATUS_TONE[status] ?? STATUS_TONE.closed, statusPending && "opacity-70")}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {statusPending ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            ) : (
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[status] ?? STATUS_DOT.closed)} aria-hidden />
            )}
            <span className="truncate">{statusLabelOf.get(status) ?? status}</span>
          </span>
        </SelectTrigger>
        <SelectContent align="end">
          {statusOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <span className="flex items-center gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[o.value] ?? STATUS_DOT.closed)} aria-hidden />
                {o.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={assignValue} onValueChange={onAssignChange}>
        <SelectTrigger
          aria-label="Personel ata"
          disabled={assignPending}
          className={cn(
            TRIGGER_BASE,
            assignedId
              ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-700 hover:border-cyan-400/70 data-[state=open]:border-cyan-500"
              : "border-line bg-canvas text-text-muted hover:border-line-strong data-[state=open]:border-brand-400",
            assignPending && "opacity-70",
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {assignPending ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="truncate">{assignedId ? (staffNameOf.get(assignedId) ?? "Personel") : "Atanmadı"}</span>
          </span>
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value={UNASSIGNED}>Atanmadı</SelectItem>
          {staff.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
