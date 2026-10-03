import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import type { ComboboxOption } from "@/components/ui/combobox";
import { NewApprovalForm } from "./new-approval-form";

export default async function YeniOnayTalebiPage() {
  const { perms, userId } = await requireModulePage("commissions", "/app/onaylar");
  const supabase = await createClient();
  // Gider havuzu yalnız gider görme yetkisi olana (komisyon yetkisi gider listesini açmaz).
  const canSeeExpenses = (perms.expenses ?? []).includes("view");

  // "İlgili kayıt" havuzu (anlaşma + gider, aramalı) — RLS tenant izolasyonunu sağlar.
  const [{ data: deals }, { data: expenses }] = await Promise.all([
    supabase
      .from("deals")
      .select("id, deal_value, stage, deal_type, property:properties!deals_property_id_fkey(property_code, title)")
      .order("created_at", { ascending: false })
      .limit(50),
    canSeeExpenses
      ? supabase.from("expenses").select("id, title, amount, expense_date").order("expense_date", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] as { id: string; title: string; amount: number; expense_date: string }[] }),
  ]);

  const entityOptions: ComboboxOption[] = [
    ...(deals ?? []).map((dl) => {
      const prop = Array.isArray(dl.property) ? dl.property[0] : dl.property;
      return {
        value: `deal:${dl.id}`,
        label: `Anlaşma · ${prop?.property_code ?? dl.id.slice(0, 8)}${prop?.title ? ` — ${prop.title}` : ""}`,
        hint: `${dl.deal_type === "rent" ? "Kiralama" : "Satış"} · ${
          dl.deal_value ? new Intl.NumberFormat("tr-TR").format(Number(dl.deal_value)) + " ₺" : "tutar yok"
        }`,
      };
    }),
    ...(expenses ?? []).map((ex) => ({
      value: `expense:${ex.id}`,
      label: `Gider · ${ex.title}`,
      hint: `${new Intl.NumberFormat("tr-TR").format(Number(ex.amount))} ₺ · ${ex.expense_date}`,
    })),
  ];

  return <NewApprovalForm entityOptions={entityOptions} userId={userId} />;
}
