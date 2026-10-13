"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Trash2 } from "lucide-react";
import { copyFinanceBudgets, saveExpenseBudget, setFinanceBudget, type ExpenseBudgetResult } from "@/app/actions/expense-budgets";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormError, FormField, FormInput } from "@/components/ui/form-controls";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

type Category = { value: string; label: string };

/** Kategori için aylık bütçe belirle/güncelle. Tutar boş bırakılırsa mevcut bütçe kaldırılır. */
export function BudgetForm({ categories, budgets }: { categories: readonly Category[]; budgets: Readonly<Record<string, number>> }) {
  const router = useRouter();
  const { push } = useToast();
  const [category, setCategory] = useState(categories[0]?.value ?? "");
  const [state, action, pending] = useActionState<ExpenseBudgetResult, FormData>(async (prev, formData) => {
    const result = await saveExpenseBudget(prev, formData);
    if (result.ok) {
      push("Bütçe kaydedildi", "ok");
      router.refresh();
    }
    return result;
  }, {});

  return (
    <form action={action} aria-busy={pending} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <div>
        <label htmlFor="budget-category" className="mb-1.5 block text-xs font-semibold text-text-muted">Kategori</label>
        <Select name="category" value={category} onValueChange={setCategory}>
          <SelectTrigger id="budget-category" aria-label="Bütçe kategorisi" placeholder="Kategori seçin" />
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label htmlFor="budget-amount" className="mb-1.5 block text-xs font-semibold text-text-muted">Aylık bütçe (TL)</label>
        <Input
          key={category}
          id="budget-amount"
          name="monthly_amount"
          inputMode="decimal"
          placeholder={budgets[category] ? "Boş bırakırsanız bütçe kalkar" : "Örn. 25000"}
          defaultValue={budgets[category] ? String(budgets[category]) : ""}
          maxLength={16}
        />
      </div>
      <Button type="submit" loading={pending}>Kaydet</Button>
      {state.error ? (
        <p className="text-sm font-semibold text-danger-600 sm:col-span-3" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/* ================================================================================================
 * Muhasebe v2 (FN6) bütçe formu: ay + yön (gelir hedefi / gider bütçesi) + kategori + tutar -> finance_budget_set.
 * ============================================================================================== */

export type BudgetCategoryOption = { value: string; label: string; hint?: string };

export function FinanceBudgetForm({
  month,
  inOptions,
  outOptions,
  existing,
}: {
  month: string;
  inOptions: readonly BudgetCategoryOption[];
  outOptions: readonly BudgetCategoryOption[];
  /** "in:kategori" / "out:kategori" -> mevcut tutar. */
  existing: Readonly<Record<string, number>>;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [direction, setDirection] = useState<"in" | "out">("out");
  const options = direction === "in" ? inOptions : outOptions;
  const [category, setCategory] = useState(outOptions[0]?.value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const current = existing[`${direction}:${category}`];

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const amount = String(new FormData(e.currentTarget).get("amount") ?? "");
    setError(null);
    start(async () => {
      const res = await setFinanceBudget({ month, direction, category, amount });
      if (!res.ok) return setError(res.error);
      push(amount.trim() ? (direction === "in" ? "Gelir hedefi kaydedildi" : "Bütçe kaydedildi") : "Bütçe kaldırıldı", "ok");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} aria-busy={pending} className="grid gap-3">
      <div role="radiogroup" aria-label="Bütçe türü" className="inline-flex w-fit rounded-[var(--radius-control)] border border-line bg-canvas p-0.5">
        {(["out", "in"] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={direction === d}
            onClick={() => {
              setDirection(d);
              setCategory((d === "in" ? inOptions : outOptions)[0]?.value ?? "");
            }}
            className={cn(
              "focus-ring rounded-[var(--radius-control)] px-3 py-1 text-sm font-semibold transition touch:min-h-11",
              direction === d ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]" : "text-text-muted",
            )}
          >
            {d === "out" ? "Gider bütçesi" : "Gelir hedefi"}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <FormField label="Kategori" htmlFor="fb-category" inject={false}>
          <Combobox
            id="fb-category"
            value={category}
            onValueChange={setCategory}
            clearable={false}
            options={options.map((o) => ({ value: o.value, label: o.label, hint: o.hint }))}
            placeholder="Kategori seçin"
            searchPlaceholder="Kategori ara…"
            emptyText="Eşleşen kategori yok"
          />
        </FormField>
        <FormField label={direction === "in" ? "Aylık hedef (TL)" : "Aylık bütçe (TL)"} htmlFor="fb-amount">
          <FormInput
            key={`${direction}:${category}`}
            id="fb-amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            maxLength={16}
            placeholder={current ? "Boş bırakırsanız kalkar" : "Örn. 25.000"}
            defaultValue={current ? String(current).replace(".", ",") : ""}
          />
        </FormField>
        <Button type="submit" loading={pending} disabled={!category}>
          Kaydet
        </Button>
      </div>
      <FormError error={error} nextStep={null} />
    </form>
  );
}

/** Tek satırın bütçesini/hedefini kaldırır. */
export function FinanceBudgetRemove({ month, direction, category, label }: { month: string; direction: "in" | "out"; category: string; label: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      loading={pending}
      aria-label={`${label} ${direction === "in" ? "hedefini" : "bütçesini"} kaldır`}
      icon={Trash2}
      onClick={() =>
        start(async () => {
          const res = await setFinanceBudget({ month, direction, category, amount: "" });
          if (!res.ok) push(res.error, "err");
          else {
            push(direction === "in" ? "Hedef kaldırıldı" : "Bütçe kaldırıldı", "ok");
            router.refresh();
          }
        })
      }
    >
      <span className="sr-only sm:not-sr-only">Kaldır</span>
    </Button>
  );
}

/** Önceki ayın bütçe satırlarını bu aya kopyalar (bu ayda olan kategoriye dokunmaz). */
export function CopyBudgetsButton({ fromMonth, toMonth, fromLabel, count }: { fromMonth: string; toMonth: string; fromLabel: string; count: number }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      icon={Copy}
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await copyFinanceBudgets(fromMonth, toMonth);
          if (!res.ok) push(res.error, "err");
          else {
            push(`${res.count ?? count} bütçe satırı kopyalandı`, "ok");
            router.refresh();
          }
        })
      }
    >
      {fromLabel} bütçesini kopyala ({count})
    </Button>
  );
}

/** Tek kategorinin bütçesini kaldırır (boş tutarla kaydeder). */
export function BudgetRemoveButton({ category, label }: { category: string; label: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      loading={pending}
      aria-label={`${label} bütçesini kaldır`}
      icon={Trash2}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("category", category);
          fd.set("monthly_amount", "");
          const result = await saveExpenseBudget({}, fd);
          if (result.error) push(result.error, "err");
          else {
            push("Bütçe kaldırıldı", "ok");
            router.refresh();
          }
        })
      }
    >
      Kaldır
    </Button>
  );
}
