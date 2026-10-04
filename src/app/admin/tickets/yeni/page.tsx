import { requirePlatformModule } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { TICKET_CATEGORY_KEYS, TICKET_CATEGORY_LABEL } from "../ticket-list-model";
import { AdminTicketForm } from "./admin-ticket-form";

export const metadata = { title: "Ofis adına destek talebi" };

export default async function NewAdminTicketPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  await requirePlatformModule("tickets");
  const { tenant } = await searchParams;
  const admin = createAdminClient();
  const [{ data: recent }, selected] = await Promise.all([
    admin.from("tenants").select("id, name, slug, status").order("created_at", { ascending: false }).limit(20),
    tenant && /^[0-9a-f-]{36}$/i.test(tenant)
      ? admin.from("tenants").select("id, name, slug, status").eq("id", tenant).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const rows = [...(selected.data ? [selected.data] : []), ...(recent ?? []).filter((t) => t.id !== selected.data?.id)];
  const tenantOptions = rows.map((t) => ({ value: t.id, label: t.name, hint: `/${t.slug} · ${t.status}` }));
  const categories = TICKET_CATEGORY_KEYS.map((value) => ({ value, label: TICKET_CATEGORY_LABEL[value] }));
  return <AdminTicketForm tenantOptions={tenantOptions} categories={categories} defaultTenantId={selected.data?.id} />;
}
