"use client";

import { useFormStatus } from "react-dom";
import { ChevronDown, Loader2 } from "lucide-react";
import { setTicketStatus } from "@/app/actions/tickets";
import { assignTicketStaffAction } from "@/app/actions/admin-ticket-ops";

/**
 * Ticket detay yan panelindeki işlem kontrolleri — durum + atama, ayrı "Güncelle/Ata"
 * butonu olmadan DEĞİŞİNCE otomatik uygulanır (kuyruk satırıyla aynı dil). Etiketli,
 * tam-genişlik selectler; native <select> erişilebilirliği + pending göstergesi korunur.
 */
function AutoSelect({
  name,
  defaultValue,
  ariaLabel,
  children,
}: {
  name: string;
  defaultValue: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="relative">
      <select
        name={name}
        defaultValue={defaultValue}
        aria-label={ariaLabel}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="focus-ring w-full cursor-pointer appearance-none rounded-lg border border-line bg-canvas px-3 py-2 pr-9 text-sm font-semibold text-ink-950 outline-none transition focus:border-brand-400 disabled:cursor-wait disabled:opacity-60"
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin text-text-faint" /> : <ChevronDown className="h-4 w-4 text-text-faint" />}
      </span>
    </div>
  );
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
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">Durum</label>
        <form action={setTicketStatus}>
          <input type="hidden" name="id" value={id} />
          <AutoSelect name="status" defaultValue={status} ariaLabel="Durum güncelle">
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </AutoSelect>
        </form>
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">Atanan personel</label>
        <form action={assignTicketStaffAction}>
          <input type="hidden" name="id" value={id} />
          <AutoSelect name="staff_id" defaultValue={assignedId ?? ""} ariaLabel="Personel ata">
            <option value="">Atanmadı</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.full_name}</option>
            ))}
          </AutoSelect>
        </form>
      </div>
    </div>
  );
}
