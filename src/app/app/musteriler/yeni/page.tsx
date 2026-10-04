import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { parsePhone } from "@/lib/phone";
import { CustomerForm } from "./customer-form";

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
  const initialPhone = phoneRaw && parsePhone(phoneRaw).ok ? parsePhone(phoneRaw).stored : "";
  const linkRaw = one(sp.bagla).trim();
  const linkRef = LINK_REF.test(linkRaw) ? linkRaw : "";
  const { perms, userId } = await requireModulePage("customers");
  if (!(perms.customers ?? []).includes("create")) redirect("/app/musteriler");

  const supabase = await createClient();
  const [{ data: provinces }, { data: branches }, typeDefs, txDefs, propDefs, urgDefs] = await Promise.all([
    supabase.from("geo_provinces").select("id, name").order("name", { ascending: true }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    getDefinitionsOrDefault("customer_type"),
    getDefinitionsOrDefault("transaction_type"),
    getDefinitionsOrDefault("property_type"),
    getDefinitionsOrDefault("demand_urgency"),
  ]);

  return (
    <CustomerForm
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
    />
  );
}
