"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserRound } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { setTicketStatus } from "@/app/actions/tickets";
import { assignTicketStaffAction } from "@/app/actions/admin-ticket-ops";
import { cn } from "@/lib/utils";

/**
 * Ticket detay yan panelindeki işlem kontrolleri — kuyruk satırıyla aynı premium
 * dil (Radix `Select`, bkz. `ticket-row-actions.tsx`): animasyonlu popover, renk
 * kodlu durum noktası, personel için baş harf rozeti. Değişince otomatik uygulanır,
 * ayrı "Güncelle/Ata" butonu yok.
 */

const UNASSIGNED = "__unassigned";

const STATUS_DOT: Record<string, string> = {
  open: "bg-amber-500",
  in_progress: "bg-brand-500",
  waiting: "bg-violet-500",
  resolved: "bg-mint-500",
  closed: "bg-ink-950/30",
};

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function TicketDetailControls({
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
    <div className="space-y-3.5">
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">Durum</label>
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger aria-label="Durum güncelle" disabled={statusPending} className={cn("font-semibold", statusPending && "opacity-70")}>
            <span className="flex min-w-0 items-center gap-2">
              {statusPending ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-faint" />
              ) : (
                <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[status] ?? STATUS_DOT.closed)} aria-hidden />
              )}
              <span className="truncate">{statusLabelOf.get(status) ?? status}</span>
            </span>
          </SelectTrigger>
          <SelectContent>
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
      </div>

      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">Atanan personel</label>
        <Select value={assignValue} onValueChange={onAssignChange}>
          <SelectTrigger aria-label="Personel ata" disabled={assignPending} className={cn("font-semibold", assignPending && "opacity-70")}>
            <span className="flex min-w-0 items-center gap-2">
              {assignPending ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-faint" />
              ) : assignedId ? (
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cyan-500/15 text-[9px] font-bold text-cyan-700">
                  {initials(staffNameOf.get(assignedId) ?? "?")}
                </span>
              ) : (
                <UserRound className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
              )}
              <span className="truncate">{assignedId ? (staffNameOf.get(assignedId) ?? "Personel") : "Atanmadı"}</span>
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>
              <span className="flex items-center gap-2 text-text-muted">
                <UserRound className="h-3.5 w-3.5" /> Atanmadı
              </span>
            </SelectItem>
            {staff.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className="flex items-center gap-2">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600/10 text-[9px] font-bold text-brand-700">
                    {initials(s.full_name)}
                  </span>
                  {s.full_name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
