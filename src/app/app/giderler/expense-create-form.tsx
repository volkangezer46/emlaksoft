"use client";

import { useActionState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { createExpense, type ExpenseResult } from "@/app/actions/expenses";
import { useToast } from "@/components/app/toast-provider";

type Category = { value: string; label: string };

const inputClass =
  "rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300";

export function ExpenseCreateForm({
  categories,
  defaultDate,
}: {
  categories: readonly Category[];
  defaultDate: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const { push } = useToast();
  const [state, action, pending] = useActionState<ExpenseResult, FormData>(
    async (previous, formData) => {
      const result = await createExpense(previous, formData);
      if (result.ok) {
        formRef.current?.reset();
        push("Gider kaydedildi", "ok");
        router.refresh();
      }
      return result;
    },
    {},
  );

  return (
    <form
      ref={formRef}
      action={action}
      aria-busy={pending}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <label htmlFor="expense-title" className="sr-only">Gider başlığı</label>
      <input id="expense-title" name="title" required maxLength={160} placeholder="Başlık" className={inputClass} />
      <label htmlFor="expense-amount" className="sr-only">Tutar (TRY)</label>
      <input id="expense-amount" name="amount" type="number" min="0.01" max="9999999999.99" step="0.01" required placeholder="Tutar (TRY)" className={inputClass} />
      <label htmlFor="expense-category" className="sr-only">Gider kategorisi</label>
      <select id="expense-category" name="category" className={inputClass}>
        {categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
      </select>
      <label htmlFor="expense-date" className="sr-only">Gider tarihi</label>
      <input id="expense-date" name="expense_date" type="date" min="1900-01-01" max="2100-12-31" defaultValue={defaultDate} className={inputClass} />
      <label htmlFor="expense-notes" className="sr-only">Not (opsiyonel)</label>
      <input id="expense-notes" name="notes" maxLength={2000} placeholder="Not (opsiyonel)" className={`sm:col-span-2 ${inputClass}`} />
      <button
        type="submit"
        disabled={pending}
        className="focus-ring press inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-wait disabled:opacity-60 sm:col-span-2"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
        {pending ? "Kaydediliyor…" : "Kaydet"}
      </button>
      {state.error ? (
        <p className="text-sm font-semibold text-danger-600 sm:col-span-2 lg:col-span-4" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
