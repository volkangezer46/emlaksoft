"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDot, Clock3, Hourglass, Lock, UserRound, UserX } from "lucide-react";
import { InlineSelect, type InlineSelectOption } from "@/components/ui/inline-select";
import { updateTicketStatus } from "@/app/actions/tickets";
import { assignTicketStaff } from "@/app/actions/admin-ticket-ops";
import { isTicketTransitionAllowed } from "@/lib/support/ticket-contract";

/**
 * Ticket satırı aksiyonları — `InlineSelect` (satır içi seçici; sayfa kaydırmasını kilitlemez, yapışkan yan
 * menüyü bozmaz). Değişince `startTransition` içinde server action doğrudan çağrılır: durum/atama ayrı bir
 * "Güncelle/Ata" düğmesi olmadan anında uygulanır (tek alanlı, geri alınabilir değişiklik → taslak gerekmez).
 */

const UNASSIGNED = "__unassigned";

const STATUS_META: Record<string, Pick<InlineSelectOption, "icon" | "tone">> = {
  open: { icon: CircleDot, tone: "brand" },
  in_progress: { icon: Clock3, tone: "brand" },
  waiting: { icon: Hourglass, tone: "warn" },
  resolved: { icon: CheckCircle2, tone: "success" },
  closed: { icon: Lock, tone: "neutral" },
};

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
  const [statusError, setStatusError] = useState<string>();
  const [assignError, setAssignError] = useState<string>();

  const statusChoices = useMemo<InlineSelectOption[]>(() => {
    const allowed = statusOptions.filter(
      (option) =>
        option.value === status ||
        (option.value !== "resolved" && option.value !== "closed" && isTicketTransitionAllowed(status, option.value, "staff")),
    );
    const list = allowed.some((o) => o.value === status) ? allowed : [{ value: status, label: status }, ...allowed];
    return list.map((o) => ({ value: o.value, label: o.label, ...(STATUS_META[o.value] ?? STATUS_META.closed) }));
  }, [status, statusOptions]);
  const staffChoices = useMemo<InlineSelectOption[]>(
    () => [
      { value: UNASSIGNED, label: "Atanmadı", icon: UserX, tone: "neutral" },
      ...staff.map((s) => ({ value: s.id, label: s.full_name, icon: UserRound, tone: "brand" as const })),
    ],
    [staff],
  );
  const assignValue = assignedId ?? UNASSIGNED;

  function onStatusChange(next: string) {
    setStatusError(undefined);
    setAssignError(undefined);
    startStatusTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("status", next);
      const result = await updateTicketStatus(fd);
      if (result.ok) router.refresh();
      else setStatusError(result.error ?? "Durum güncellenemedi.");
    });
  }

  function onAssignChange(next: string) {
    setStatusError(undefined);
    setAssignError(undefined);
    startAssignTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("staff_id", next === UNASSIGNED ? "" : next);
      const result = await assignTicketStaff(fd);
      if (result.ok) router.refresh();
      else setAssignError(result.error ?? "Personel ataması güncellenemedi.");
    });
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto lg:justify-end" aria-busy={statusPending || assignPending || undefined}>
      <InlineSelect
        value={status}
        onValueChange={onStatusChange}
        options={statusChoices}
        label="Durum değiştir"
        disabled={statusPending}
        className="min-w-[8rem]"
      />
      <InlineSelect
        value={assignValue}
        onValueChange={onAssignChange}
        options={staffChoices}
        label="Personel ata"
        disabled={assignPending}
        plain={!assignedId}
        className="min-w-[8rem] max-w-[12rem]"
      />
      {statusError || assignError ? (
        <p role="alert" aria-live="polite" className="basis-full text-right text-xs font-semibold text-danger-600">
          {statusError ?? assignError}
        </p>
      ) : null}
    </div>
  );
}
