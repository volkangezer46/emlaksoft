import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { TaskForm } from "./task-form";
import { DEAL_OPTION_SELECT, dealOptionLabel, type DealOptionSource } from "@/lib/deal-option-label";

export const metadata = { title: "Yeni görev" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams?: Promise<{ customer?: string; deal?: string }>;
}) {
  const ctx = await requireModulePage("tasks");
  if (!(ctx.perms.tasks ?? []).includes("create")) redirect("/app/gorevler");
  const sp = (await searchParams) ?? {};
  const initialCustomerId = UUID_RE.test(sp.customer ?? "") ? sp.customer! : "";
  const initialDealId = UUID_RE.test(sp.deal ?? "") ? sp.deal! : "";
  const canSeeDeals = (ctx.perms.commissions ?? []).includes("view");

  const supabase = await createClient();
  const [{ data: members }, { data: customers }, { data: dealRows }, { data: pickedCustomer }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase
      .from("customers")
      .select("id, full_name")
      .eq("tenant_id", ctx.tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
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
