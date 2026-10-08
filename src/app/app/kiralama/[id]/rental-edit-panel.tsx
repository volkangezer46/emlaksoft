"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, FileText, Pencil, Wallet } from "lucide-react";
import { extendRental, updateRental } from "@/app/actions/rentals";
import { useToast } from "@/components/app/toast-provider";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";

const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300";
const triggerClass =
  "focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] surface-interactive border border-border-interactive bg-surface px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-border-strong";

type RentalLite = {
  id: string;
  due_day: number;
  start_date: string;
  end_date: string | null;
  deposit: number | null;
  notes: string | null;
};

/**
 * Kira sözleşmesi düzenleme ve uzatma (P0-5). Popup yok: sayfa içi sekme alanı.
 * Aylık tutar değişikliği Kira artışı akışında, sonlandırma ayrı düğmede kalır.
 */
export function RentalEditPanel({ rental }: { rental: RentalLite }) {
  const router = useRouter();
  const { push } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submitEdit(fd: FormData) {
    setEditError(null);
    startTransition(async () => {
      const res = await updateRental({}, fd);
      if (res.error) {
        setEditError(res.error);
        return;
      }
      push("Kira kaydı güncellendi", "ok");
      setEditOpen(false);
      router.refresh();
    });
  }

  function submitExtend(fd: FormData) {
    setExtendError(null);
    const indefinite = fd.get("indefinite") === "on";
    const date = String(fd.get("new_end_date") ?? "").trim();
    if (!indefinite && !date) {
      setExtendError("Yeni bitiş tarihi girin ya da süresiz olarak işaretleyin.");
      return;
    }
    startTransition(async () => {
      const res = await extendRental(rental.id, indefinite ? null : date);
      if (res.error) {
        setExtendError(res.error);
        return;
      }
      push("Kira sözleşmesi uzatıldı", "ok");
      setExtendOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <InlineTabbedPanel
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Kira sözleşmesini düzenle"
        description="Aylık tutar için Kira artışı akışını kullanın."
        icon={<Pencil />}
        onSubmit={submitEdit}
        pending={pending}
        error={editError}
        hiddenFields={<input type="hidden" name="rental_id" value={rental.id} />}
        fieldLabels={{ due_day: "Vade günü", end_date: "Bitiş tarihi", deposit: "Depozito (₺)", notes: "Not" }}
        trigger={({ onClick, ...aria }) => (
          <button type="button" onClick={onClick} {...aria} className={triggerClass}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Düzenle
          </button>
        )}
        tabs={[
          { id: "sozlesme", label: "Sözleşme", icon: Wallet, fields: ["due_day", "end_date", "deposit"] },
          { id: "not", label: "Not", icon: FileText, fields: ["notes"] },
        ]}
        panels={{
          sozlesme: (
            <>
              <label className="text-xs font-semibold text-text-muted">
                Vade günü (1-28)
                <input name="due_day" type="number" min={1} max={28} required defaultValue={rental.due_day} className={`mt-1 ${fieldClass}`} />
              </label>
              <label className="text-xs font-semibold text-text-muted">
                Bitiş tarihi (boş = süresiz)
                <input name="end_date" type="date" min={rental.start_date} defaultValue={rental.end_date ?? ""} className={`mt-1 ${fieldClass}`} />
              </label>
              <label className="text-xs font-semibold text-text-muted sm:col-span-2">
                Depozito (₺)
                <input name="deposit" inputMode="decimal" defaultValue={rental.deposit ?? ""} className={`mt-1 ${fieldClass}`} />
              </label>
            </>
          ),
          not: (
            <label className="text-xs font-semibold text-text-muted sm:col-span-2">
              Not
              <textarea name="notes" rows={4} defaultValue={rental.notes ?? ""} className={`mt-1 ${fieldClass}`} />
            </label>
          ),
        }}
      />
      <InlineTabbedPanel
        open={extendOpen}
        onOpenChange={setExtendOpen}
        title="Kira sözleşmesini uzat"
        description="Bitiş tarihi uzatılınca aylık tahakkuk kaldığı yerden devam eder."
        icon={<CalendarPlus />}
        onSubmit={submitExtend}
        pending={pending}
        error={extendError}
        fieldLabels={{ new_end_date: "Yeni bitiş tarihi", indefinite: "Süresiz" }}
        trigger={({ onClick, ...aria }) => (
          <button type="button" onClick={onClick} {...aria} className={triggerClass}>
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" /> Uzat
          </button>
        )}
        tabs={[{ id: "sure", label: "Süre", icon: CalendarPlus, fields: ["new_end_date", "indefinite"] }]}
        panels={{
          sure: (
            <>
              <label className="text-xs font-semibold text-text-muted">
                Yeni bitiş tarihi
                <input name="new_end_date" type="date" min={rental.end_date ?? rental.start_date} className={`mt-1 ${fieldClass}`} />
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-text-muted sm:mt-6">
                <input name="indefinite" type="checkbox" className="h-4 w-4 rounded border-line" />
                Süresiz yap
              </label>
            </>
          ),
        }}
      />
    </>
  );
}
