"use client";

import { useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import { updateExpense, type ExpenseResult } from "@/app/actions/expenses";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";

type Category = { value: string; label: string };
export type Expense = {
  id: string;
  title: string;
  amount: number;
  category: string;
  expense_date: string;
  notes: string | null;
};

export function ExpenseEditDialog({
  expense,
  categories,
  open: openProp,
  onOpenChange,
}: {
  expense: Expense;
  categories: readonly Category[];
  /** Kontrollü mod (satır tıklaması ile açma): open + onOpenChange verilirse
   *  tetikleyici buton render edilmez, açık/kapalı durum dışarıdan yönetilir. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (controlled) onOpenChange?.(v);
    else setInternalOpen(v);
  };
  // Başarıda kapatma efekt içinde değil, action akışında yapılıyor: efekt
  // gövdesinde senkron setState fazladan bir render turu doğuruyordu.
  const [state, action, pending] = useActionState<ExpenseResult, FormData>(
    async (prev, formData) => {
      const result = await updateExpense(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    {},
  );
  const fieldClass =
    "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300";
  const lbl = "mb-1.5 block text-xs font-semibold text-text-muted";
  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Gideri düzenle"
      description={expense.title}
      icon={<Pencil />}
      action={action}
      pending={pending}
      error={state.error}
      summary
      hiddenFields={<input type="hidden" name="id" value={expense.id} />}
      fieldLabels={{ title: "Başlık", amount: "Tutar (TRY)", expense_date: "Tarih", category: "Kategori", notes: "Not" }}
      trigger={
        !controlled
          ? ({ onClick, ...aria }) => (
              <button
                type="button"
                onClick={onClick}
                {...aria}
                className="focus-ring press grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[var(--radius-control)] text-text-faint transition hover:bg-brand-50 hover:text-accent-text"
                aria-label="Gideri düzenle"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )
          : undefined
      }
      tabs={[{ id: "gider", label: "Gider", fields: ["title", "amount", "expense_date", "category", "notes"] }]}
      panels={{
        gider: (
          <>
            <div className="sm:col-span-2">
              <label htmlFor={`expense-title-${expense.id}`} className={lbl}>Gider başlığı</label>
              <input id={`expense-title-${expense.id}`} name="title" required maxLength={160} defaultValue={expense.title} placeholder="Başlık" className={fieldClass} />
            </div>
            <div>
              <label htmlFor={`expense-amount-${expense.id}`} className={lbl}>Tutar (TRY)</label>
              <input id={`expense-amount-${expense.id}`} name="amount" type="number" min="0.01" max="9999999999.99" step="0.01" required defaultValue={expense.amount} className={fieldClass} />
            </div>
            <div>
              <label htmlFor={`expense-date-${expense.id}`} className={lbl}>Gider tarihi</label>
              <input id={`expense-date-${expense.id}`} name="expense_date" type="date" min="1900-01-01" max="2100-12-31" defaultValue={expense.expense_date?.slice(0, 10)} className={fieldClass} />
            </div>
            <div>
              <label htmlFor={`expense-category-${expense.id}`} className={lbl}>Gider kategorisi</label>
              <select id={`expense-category-${expense.id}`} name="category" defaultValue={expense.category} className={fieldClass}>
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`expense-notes-${expense.id}`} className={lbl}>Not (opsiyonel)</label>
              <input id={`expense-notes-${expense.id}`} name="notes" maxLength={2000} defaultValue={expense.notes ?? ""} placeholder="Not (opsiyonel)" className={fieldClass} />
            </div>
          </>
        ),
      }}
    />
  );
}
