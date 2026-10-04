"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins, FileText, Pencil } from "lucide-react";
import { updateDue } from "@/app/actions/dues";
import { useToast } from "@/components/app/toast-provider";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";

export type EditableDue = {
  id: string;
  title: string;
  amount: number;
  period: string;
  due_date: string | null;
  notes: string | null;
};

const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300";

/** Aidat düzenleme — popup yok, sayfa içi panel. Mobilde de erişilir. */
export function DueEditPanel({ due }: { due: EditableDue }) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await updateDue({}, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      push("Aidat güncellendi", "ok");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Aidatı düzenle"
      description={due.title}
      icon={<Coins />}
      onSubmit={submit}
      pending={pending}
      error={error}
      hiddenFields={<input type="hidden" name="id" value={due.id} />}
      fieldLabels={{ title: "Başlık", amount: "Tutar (₺)", period: "İlgili ay", due_date: "Son ödeme tarihi", notes: "Not" }}
      trigger={({ onClick, ...aria }) => (
        <button
          type="button"
          onClick={onClick}
          {...aria}
          aria-label={`${due.title} aidatını düzenle`}
          className="focus-ring press grid h-9 w-9 place-items-center rounded-[var(--radius-control)] text-text-faint transition hover:bg-brand-50 hover:text-brand-600"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      tabs={[
        { id: "aidat", label: "Aidat", icon: Coins, fields: ["title", "amount", "period", "due_date"] },
        { id: "not", label: "Not", icon: FileText, fields: ["notes"] },
      ]}
      panels={{
        aidat: (
          <>
            <label className="text-xs font-semibold text-text-muted sm:col-span-2">
              Başlık
              <input name="title" required maxLength={160} defaultValue={due.title} className={`mt-1 ${fieldClass}`} />
            </label>
            <label className="text-xs font-semibold text-text-muted">
              Tutar (₺)
              <input name="amount" type="number" min="0.01" max="9999999999.99" step="0.01" required defaultValue={due.amount} className={`mt-1 ${fieldClass}`} />
            </label>
            <label className="text-xs font-semibold text-text-muted">
              İlgili ay
              <input name="period" type="date" required defaultValue={due.period.slice(0, 10)} className={`mt-1 ${fieldClass}`} />
            </label>
            <label className="text-xs font-semibold text-text-muted">
              Son ödeme tarihi
              <input name="due_date" type="date" defaultValue={due.due_date ? due.due_date.slice(0, 10) : ""} className={`mt-1 ${fieldClass}`} />
            </label>
          </>
        ),
        not: (
          <label className="text-xs font-semibold text-text-muted sm:col-span-2">
            Not
            <textarea name="notes" rows={4} maxLength={4000} defaultValue={due.notes ?? ""} className={`mt-1 ${fieldClass}`} />
          </label>
        ),
      }}
    />
  );
}
