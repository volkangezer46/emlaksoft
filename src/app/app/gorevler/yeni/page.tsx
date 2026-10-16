import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { TaskForm } from "./task-form";
import { readPrefillContext, type PrefillSearchParams } from "@/lib/prefill-params";
import { DEAL_OPTION_SELECT, dealOptionLabel, type DealOptionSource } from "@/lib/deal-option-label";

export const metadata = { title: "Yeni görev" };

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams?: Promise<PrefillSearchParams>;
}) {
  const ctx = await requireModulePage("tasks");
  if (!(ctx.perms.tasks ?? []).includes("create")) redirect("/app/gorevler");
  const sp = (await searchParams) ?? {};
  // ?customer=&deal=&demand= (eş adlar ?musteri= ?anlasma= ?talep= de geçerli). Görev formunda portföy bağı yok;
  // ?property= yok sayılır. Müşteri verilmediyse anlaşmanın / talebin müşterisi seçilir.
  const pre = readPrefillContext(sp);
  const initialDealId = pre.dealId ?? "";
  const canSeeDeals = (ctx.perms.commissions ?? []).includes("view");

  const supabase = await createClient();
  let initialCustomerId = pre.customerId ?? "";
  if (!initialCustomerId && (pre.dealId || pre.demandId)) {
    const { data: owner } = pre.dealId
      ? await supabase.from("deals").select("customer_id").eq("id", pre.dealId).eq("tenant_id", ctx.tenantId).maybeSingle()
      : await supabase.from("demands").select("customer_id").eq("id", pre.demandId!).eq("tenant_id", ctx.tenantId).maybeSingle();
    initialCustomerId = (owner?.customer_id as string | null | undefined) ?? "";
  }
  const [{ data: members }, { data: customers }, { data: dealRows }, { data: pickedCustomer }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase
      .from("customers")
      .select("id, full_name")
      .eq("tenant_id", ctx.tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
    canSeeDeals
      ? supabase
          .from("deals")
          .select(DEAL_OPTION_SELECT)
          .eq("tenant_id", ctx.tenantId)
          .not("stage", "in", "(won,lost)")
          .order("updated_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
    initialCustomerId
      ? supabase.from("customers").select("id, full_name").eq("id", initialCustomerId).eq("tenant_id", ctx.tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const deals = ((dealRows ?? []) as unknown as DealOptionSource[]).map((d) => ({ id: d.id, label: dealOptionLabel(d) }));
  if (initialDealId && canSeeDeals && !deals.some((d) => d.id === initialDealId)) {
    const { data: picked } = await supabase.from("deals").select(DEAL_OPTION_SELECT).eq("id", initialDealId).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (picked) deals.unshift({ id: (picked as unknown as DealOptionSource).id, label: dealOptionLabel(picked as unknown as DealOptionSource) });
  }
  const customerList = (customers ?? []) as { id: string; full_name: string }[];
  const picked = pickedCustomer as { id: string; full_name: string } | null;
  if (picked && !customerList.some((c) => c.id === picked.id)) customerList.unshift(picked);

  return (
    <TaskForm
      members={members ?? []}
      customers={customerList}
      deals={deals}
      userId={ctx.userId}
      initialCustomerId={picked ? picked.id : ""}
      initialDealId={deals.some((d) => d.id === initialDealId) ? initialDealId : ""}
    />
  );
}
