"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { ChevronDown, Loader2, UserRound } from "lucide-react";
import { setTicketStatus } from "@/app/actions/tickets";
import { assignTicketStaffAction } from "@/app/actions/admin-ticket-ops";

/**
 * Ticket satırı aksiyonları — dünya standardı help-desk deseni (Linear/Zendesk):
 * durum ve atama, ayrı "Güncelle/Ata" butonu olmadan DEĞİŞİNCE otomatik uygulanır
 * (inline pill dropdown). Tam responsive: masaüstünde sağa hizalı, mobilde tam
 * genişlik akıcı sarar. Native <select> erişilebilirliği korunur (klavye/okuyucu),
 * appearance-none + özel chevron ile pill görünümü verilir.
 */

// Durum → pill rengi (renk-kodlu durum, araştırma: görsel durum göstergesi şart)
const STATUS_PILL: Record<string, string> = {
  open: "border-amber-400/40 bg-amber-400/12 text-amber-700 focus-within:border-amber-500",
  in_progress: "border-brand-500/40 bg-brand-600/10 text-brand-700 focus-within:border-brand-500",
  waiting: "border-violet-400/40 bg-violet-400/12 text-violet-700 focus-within:border-violet-500",
  resolved: "border-mint-500/40 bg-mint-500/12 text-mint-700 focus-within:border-mint-500",
  closed: "border-line bg-canvas text-text-muted focus-within:border-brand-400",
};

/** Native select'i submit-on-change + pending durumlu pill'e saran ortak kabuk. */
function PillSelect({
  name,
  defaultValue,
  ariaLabel,
  wrapCls,
  children,
  leading,
}: {
  name: string;
  defaultValue: string;
  ariaLabel: string;
  wrapCls: string;
  children: React.ReactNode;
  leading?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <label
      className={`focus-ring group relative inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${wrapCls} ${pending ? "opacity-60" : ""}`}
    >
      {leading}
      <select
        name={name}
        defaultValue={defaultValue}
        aria-label={ariaLabel}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="peer min-w-0 max-w-[9.5rem] cursor-pointer truncate appearance-none bg-transparent pr-4 font-bold outline-none disabled:cursor-wait"
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-2.5 grid place-items-center">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5 opacity-60 transition group-hover:opacity-100" />}
      </span>
    </label>
  );
}

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
  const statusForm = useRef<HTMLFormElement>(null);
  const assignForm = useRef<HTMLFormElement>(null);
  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto lg:justify-end">
      <form ref={statusForm} action={setTicketStatus} className="min-w-0">
        <input type="hidden" name="id" value={id} />
        <PillSelect
          name="status"
          defaultValue={status}
          ariaLabel="Durum değiştir"
          wrapCls={STATUS_PILL[status] ?? STATUS_PILL.closed}
        >
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </PillSelect>
      </form>

      <form ref={assignForm} action={assignTicketStaffAction} className="min-w-0">
        <input type="hidden" name="id" value={id} />
        <PillSelect
          name="staff_id"
          defaultValue={assignedId ?? ""}
          ariaLabel="Personel ata"
          wrapCls={
            assignedId
              ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-700 focus-within:border-cyan-500"
              : "border-line bg-canvas text-text-muted focus-within:border-brand-400"
          }
          leading={<UserRound className="h-3.5 w-3.5 shrink-0" />}
        >
          <option value="">Atanmadı</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.full_name}</option>
          ))}
        </PillSelect>
      </form>
    </div>
  );
}
