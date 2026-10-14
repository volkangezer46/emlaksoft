"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { setFinanceBudget } from "@/app/actions/expense-budgets";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FilterChip } from "@/components/ui/filter-chip";
import { FormError, FormField, FormInput } from "@/components/ui/form-controls";

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
      <div role="group" aria-label="Bütçe türü" className="flex flex-wrap gap-2">
        {(["out", "in"] as const).map((d) => (
          <FilterChip
            key={d}
            active={direction === d}
            onClick={() => {
              setDirection(d);
              setCategory((d === "in" ? inOptions : outOptions)[0]?.value ?? "");
            }}
          >
            {d === "out" ? "Gider bütçesi" : "Gelir hedefi"}
          </FilterChip>
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
