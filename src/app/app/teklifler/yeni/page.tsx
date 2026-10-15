import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { readPrefillIds, type PrefillSearchParams } from "@/lib/prefill-params";
import { NewOfferForm } from "./new-offer-form";

export const metadata = { title: "Yeni teklif" };

export default async function NewOfferPage({
  searchParams,
}: {
  searchParams?: Promise<PrefillSearchParams>;
}) {
  const { perms, userId } = await requireModulePage("offers", "/app/teklifler");
  const canCreate = perms.offers?.includes("create") ?? perms.commissions?.includes("create") ?? false;
  if (!canCreate) redirect("/app/teklifler");

  // ?customer=&property= (eş adlar ?musteri=&portfoy= de geçerli) — "Teklif al" / "Teklif gir" kısayollarının ön dolgusu.
  const { customerId: prefillCustomerId, propertyId: prefillPropertyId } = readPrefillIds(await searchParams);

  // Seçiciler sunucu taraflı aranır (searchOfferProperties / searchCustomers): ofis kaç
  // kayıt tutarsa tutsun seçilebilir. Sayfa yalnız ön dolgudaki tek kaydı (.eq('id')) getirir.
  const supabase = await createClient();
  const [{ data: preProp }, { data: preCust }] = await Promise.all([
    prefillPropertyId
      ? supabase
          .from("properties")
          .select("id, property_code, title, list_price")
          .eq("id", prefillPropertyId)
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    prefillCustomerId
      ? supabase
          .from("customers")
          .select("id, full_name")
          .eq("id", prefillCustomerId)
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const prefillProperty = preProp
    ? {
        id: preProp.id as string,
        property_code: preProp.property_code as string,
        title: preProp.title as string | null,
        list_price: preProp.list_price as number | null,
      }
    : null;
  const prefillCustomer = preCust
    ? { id: preCust.id as string, full_name: preCust.full_name as string }
    : null;

  return (
    <NewOfferForm
      userId={userId}
      prefillProperty={prefillProperty}
      prefillCustomer={prefillCustomer}
      todayIso={new Date(now()).toISOString().slice(0, 10)}
    />
  );
}
