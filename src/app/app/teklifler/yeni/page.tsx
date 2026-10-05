import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { NewOfferForm } from "./new-offer-form";

export const metadata = { title: "Yeni teklif" };

export default async function NewOfferPage({
  searchParams,
}: {
  searchParams?: Promise<{ musteri?: string; portfoy?: string }>;
}) {
  const { perms, userId } = await requireModulePage("offers", "/app/teklifler");
  const canCreate = perms.offers?.includes("create") ?? perms.commissions?.includes("create") ?? false;
  if (!canCreate) redirect("/app/teklifler");

  const params = (await searchParams) ?? {};
  // ?musteri=&portfoy= — eşleştirme ekranındaki "Teklif al" kısayolunun ön dolgusu.
  const prefillCustomerId = (params.musteri ?? "").trim() || null;
  const prefillPropertyId = (params.portfoy ?? "").trim() || null;

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
