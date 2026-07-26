"use client";

import { useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import { updateExpense, type ExpenseResult } from "@/app/actions/expenses";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

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
  /*
   * Radix Dialog'a taşındı. Buradaki elle kurulum Esc'i ve odak vermeyi
   * halletmişti ama FOCUS TRAP ve SCROLL LOCK yoktu: Tab ile dialog dışına
   * çıkılabiliyor, arka plan kayabiliyordu. Ayrıca createPortal + useEffect
   * + dialogRef üçlüsü artık gereksiz — Radix hepsini kendisi yapıyor.
   */
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled ? (
        <DialogTrigger asChild>
          <button
            type="button"
            className="focus-ring press grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[7px] text-text-faint transition hover:bg-brand-50 hover:text-brand-600"
            aria-label="Gideri düzenle"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </DialogTrigger>
      ) : null}

      <DialogContent size="sm">
        <DialogHeader icon={<Pencil />} title="Gideri düzenle" />
        <form action={action} className="grid gap-3 p-6">
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
                {/* Palet disi red-600 -> danger-600, role="alert" eklendi */}
                {state.error && (
                  <p className="text-xs font-semibold text-danger-600" role="alert">{state.error}</p>
                )}
                <div className="hairline-t mt-1 flex justify-end gap-2 pt-4">
                  <DialogClose asChild>
                    <button
                      type="button"
                      className="focus-ring press rounded-[10px] border border-hairline px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
                    >
                      Vazgeç
                    </button>
                  </DialogClose>
                  <button
                    type="submit"
                    disabled={pending}
                    className="btn-shine focus-ring press rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                  >
                    {pending ? "Kaydediliyor…" : "Kaydet"}
                  </button>
                </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
