"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { saveExpenseBudget, type ExpenseBudgetResult } from "@/app/actions/expense-budgets";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
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
