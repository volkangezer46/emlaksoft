"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import { updateExpense, type ExpenseResult } from "@/app/actions/expenses";

type Category = { value: string; label: string };
type Expense = {
  id: string;
  title: string;
  amount: number;
  category: string;
  expense_date: string;
  notes: string | null;
};

export function ExpenseEditDialog({ expense, categories }: { expense: Expense; categories: readonly Category[] }) {
  const [open, setOpen] = useState(false);
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
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="grid h-7 w-7 place-items-center rounded-[7px] text-text-faint transition hover:bg-brand-50 hover:text-brand-600"
        aria-label="Düzenle"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-ink-950/40 p-4 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && setOpen(false)}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Gider düzenle"
              tabIndex={-1}
              className="w-full max-w-md rounded-[20px] border border-line bg-surface p-5 shadow-xl outline-none"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display font-bold text-ink-950">Gideri Düzenle</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-[9px] text-text-faint transition hover:bg-canvas"
                  aria-label="Kapat"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form action={action} className="grid gap-3">
                <input type="hidden" name="id" value={expense.id} />
                <input
                  name="title"
                  required
                  defaultValue={expense.title}
                  placeholder="Başlık"
                  className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    name="amount"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={expense.amount}
                    placeholder="Tutar (TRY)"
                    className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                  />
                  <input
                    name="expense_date"
                    type="date"
                    defaultValue={expense.expense_date?.slice(0, 10)}
                    className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                  />
                </div>
                <select
                  name="category"
                  defaultValue={expense.category}
                  className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                >
                  {categories.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input
                  name="notes"
                  defaultValue={expense.notes ?? ""}
                  placeholder="Not (opsiyonel)"
                  className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                />
                {state.error && <p className="text-xs font-semibold text-red-600">{state.error}</p>}
                <div className="mt-1 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                  >
                    {pending ? "Kaydediliyor…" : "Kaydet"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
