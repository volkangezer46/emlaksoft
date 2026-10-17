import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deniedPageHref, requireModulePage } from "@/lib/require-module-page";
import { loadCustomFieldInputDefs } from "@/lib/custom-fields/save";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { CustomerForm } from "./customer-form";
import { provinceOptionsResult } from "@/lib/geo/reader";
import { canAssignCustomerToOthers } from "@/lib/customer-assignee";
import { loadCustomerAssigneeOptions } from "@/lib/customer-assignee-server";

export const metadata = { title: "Yeni müşteri" };

/** `?bagla=a-<çağrı id>` / `c-<iletişim id>`: kayıt müşteri oluşunca bağlanır (gelen kutusu / çağrı kaydı). */
const LINK_REF = /^[ac]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const phoneRaw = one(sp.phone).trim();
  const initialPhone = (() => {
    const p = phoneRaw ? parsePhoneStrict(phoneRaw) : null;
    return p && p.ok ? p.stored : "";
  })();
  const linkRaw = one(sp.bagla).trim();
  const linkRef = LINK_REF.test(linkRaw) ? linkRaw : "";
  const { perms, userId, tenantId, role } = await requireModulePage("customers");
  // Ekleme yetkisi yoksa açıklamalı yetki kartı (sessizce listeye dönmek yerine; SK10 / B168).
  if (!(perms.customers ?? []).includes("create")) redirect(deniedPageHref("customers"));

  const supabase = await createClient();
  // Yönetici (ofis geneli + customers:edit) müşteriyi başka danışmana açabilir: ekip + yük (öneri) yalnız onlar için okunur.
  const canAssign = canAssignCustomerToOthers(role, perms);
  const [{ data: provinces }, { data: branches }, typeDefs, txDefs, propDefs, urgDefs, sourceDefs, assigneeOptions] = await Promise.all([
    provinceOptionsResult(),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    getDefinitionsOrDefault("customer_type"),
    getDefinitionsOrDefault("transaction_type"),
    getDefinitionsOrDefault("property_type"),
    getDefinitionsOrDefault("demand_urgency"),
    getDefinitionsOrDefault("customer_source"),
    canAssign && tenantId ? loadCustomerAssigneeOptions(supabase, tenantId) : Promise.resolve(null),
  ]);

  return (
    <CustomerForm
      customFields={await loadCustomFieldInputDefs(supabase, tenantId, "customer")}
      provinces={provinces ?? []}
      branches={branches ?? []}
      types={typeDefs.map((t) => t.value)}
      userId={userId}
      initialPhone={initialPhone}
      linkRef={linkRef}
      canCreateDemand={(perms.demands ?? []).includes("create")}
      transactionTypes={txDefs.map((d) => d.value)}
      propertyTypes={propDefs.map((d) => d.value)}
      urgencyOptions={urgDefs.map((d) => ({ value: d.value, label: d.label }))}
      sources={sourceDefs.map((d) => ({ value: d.value, label: d.label }))}
      assignees={assigneeOptions?.members ?? null}
      suggestion={assigneeOptions?.suggestion ?? null}
    />
  );
}
