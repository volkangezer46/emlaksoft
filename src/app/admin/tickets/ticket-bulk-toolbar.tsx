"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Layers3, X } from "lucide-react";
import { bulkUpdateTickets } from "@/app/actions/admin-ticket-ops";
import { Button } from "@/components/ui/button";
import {
  TICKET_CATEGORY_KEYS,
  TICKET_CATEGORY_LABEL,
  TICKET_PRIORITY_KEYS,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_LABEL,
  bulkStatusTargetsFor,
} from "./ticket-list-model";

type BulkField = "status" | "priority" | "category" | "assigned_staff_id";

type BulkResult = {
  ok?: boolean;
  error?: string;
  updated?: number;
};

const FIELD_DEFAULT: Record<BulkField, string> = {
  status: "in_progress",
  priority: "normal",
  category: TICKET_CATEGORY_KEYS[0],
  assigned_staff_id: "__unassigned",
};

export function TicketBulkToolbar({
  selectedTickets,
  staff,
  onClear,
  onCompleted,
}: {
  selectedTickets: { id: string; status: string }[];
  staff: { id: string; full_name: string }[];
  onClear: () => void;
  onCompleted: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [field, setField] = useState<BulkField>("status");
  const [value, setValue] = useState(FIELD_DEFAULT.status);
  const [error, setError] = useState<string>();
  const selectedIds = selectedTickets.map((ticket) => ticket.id);
  const statusTargets = bulkStatusTargetsFor(
    selectedTickets.map((ticket) => ticket.status),
  );
  const effectiveValue = field === "status" && !statusTargets.includes(value as (typeof statusTargets)[number])
    ? (statusTargets[0] ?? "")
    : value;

  function changeField(next: BulkField) {
    setField(next);
    setValue(FIELD_DEFAULT[next]);
    setError(undefined);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedIds.length === 0 || selectedIds.length > 50) return;

    startTransition(async () => {
      const formData = new FormData();
      selectedIds.forEach((id) => formData.append("ids", id));
      formData.set("field", field);
      formData.set("value", effectiveValue === "__unassigned" ? "" : effectiveValue);

      const result = (await bulkUpdateTickets({}, formData)) as BulkResult;
      if (!result.ok) {
        setError(result.error ?? "Toplu işlem tamamlanamadı.");
        return;
      }

      const updated = result.updated ?? selectedIds.length;
      setError(undefined);
      onClear();
      onCompleted(`${updated} talep başarıyla güncellendi.`);
      router.refresh();
    });
  }

  return (
    <aside
      aria-label="Seçili talepler için toplu işlem"
      className="fixed bottom-20 left-3 right-3 z-40 md:bottom-4 md:left-[280px] md:right-4"
    >
      <form
        onSubmit={submit}
        className="mx-auto flex max-w-[1120px] flex-col gap-3 rounded-[var(--radius-card)] border border-white/12 bg-ink-950/95 p-3 text-white shadow-[var(--elev-4)] backdrop-blur-xl lg:flex-row lg:items-center"
      >
        <div className="flex items-center gap-3 lg:mr-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-amber-400 text-ink-950">
            <Layers3 className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="numeric text-sm font-extrabold">{selectedIds.length} talep seçildi</p>
            <p className="text-xs text-white/55">En fazla 50 kayıt birlikte güncellenebilir.</p>
          </div>
        </div>

        <div className="grid flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(150px,0.8fr)_minmax(190px,1fr)]">
          <label className="sr-only" htmlFor="ticket-bulk-field">Güncellenecek alan</label>
          <select
            id="ticket-bulk-field"
            value={field}
            onChange={(event) => changeField(event.target.value as BulkField)}
            disabled={pending}
            className="focus-ring h-10 rounded-[var(--radius-control)] border border-white/12 bg-white/[0.08] px-3 text-xs font-semibold text-white outline-none"
          >
            <option className="text-ink-950" value="status">Durumu değiştir</option>
            <option className="text-ink-950" value="priority">Önceliği değiştir</option>
            <option className="text-ink-950" value="category">Kategoriyi değiştir</option>
            <option className="text-ink-950" value="assigned_staff_id">Personel ata</option>
          </select>

          <label className="sr-only" htmlFor="ticket-bulk-value">Yeni değer</label>
          <select
            id="ticket-bulk-value"
            value={effectiveValue}
            onChange={(event) => setValue(event.target.value)}
            disabled={pending}
            className="focus-ring h-10 rounded-[var(--radius-control)] border border-white/12 bg-white/[0.08] px-3 text-xs font-semibold text-white outline-none"
          >
            {field === "status"
              ? statusTargets.map((status) => (
                  <option className="text-ink-950" key={status} value={status}>{TICKET_STATUS_LABEL[status]}</option>
                ))
              : null}
            {field === "priority"
              ? TICKET_PRIORITY_KEYS.map((priority) => (
                  <option className="text-ink-950" key={priority} value={priority}>{TICKET_PRIORITY_LABEL[priority]}</option>
                ))
              : null}
            {field === "category"
              ? TICKET_CATEGORY_KEYS.map((category) => (
                  <option className="text-ink-950" key={category} value={category}>{TICKET_CATEGORY_LABEL[category]}</option>
                ))
              : null}
            {field === "assigned_staff_id" ? (
              <>
                <option className="text-ink-950" value="__unassigned">Atamayı kaldır</option>
                {staff.map((person) => (
                  <option className="text-ink-950" key={person.id} value={person.id}>{person.full_name}</option>
                ))}
              </>
            ) : null}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" size="md" variant="gold" icon={CheckCircle2} loading={pending} disabled={!effectiveValue} className="flex-1 lg:flex-none">
            Uygula
          </Button>
          <button
            type="button"
            onClick={onClear}
            disabled={pending}
            aria-label="Seçimi temizle"
            className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] border border-white/12 text-white/65 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {error ? (
          <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/15 px-3 py-2 text-xs font-semibold text-danger-200 lg:absolute lg:bottom-full lg:right-0 lg:mb-2">
            {error}
          </p>
        ) : null}
      </form>
    </aside>
  );
}
