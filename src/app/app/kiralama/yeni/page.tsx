import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { trDayKey } from "@/lib/clock";
import { readPrefillIds, type PrefillSearchParams } from "@/lib/prefill-params";
import { RentalForm } from "./rental-form";

export const metadata = { title: "Yeni kira kaydı" };

export default async function NewRentalPage({
  searchParams,
}: {
  searchParams?: Promise<PrefillSearchParams>;
}) {
  // Paket kilidi kilitli kök yol üzerinden uygulanır (/app/kiralama → page-gates).
  const { perms, userId } = await requireModulePage("rentals", "/app/kiralama");
  if (!(perms.rentals ?? []).includes("create")) redirect("/app/kiralama");

  // Kazanılan kira anlaşması köprüsü: ?property=&customer=&tutar= ön dolgusu (eş adlar ?portfoy=&musteri= de geçerli).
  const params = (await searchParams) ?? {};
  const { propertyId: prefillPropertyId, customerId: prefillCustomerId } = readPrefillIds(params);
  const rentParsed = Number(typeof params.tutar === "string" ? params.tutar : "");
  const prefillRent = Number.isFinite(rentParsed) && rentParsed > 0 ? Math.round(rentParsed) : null;

  const supabase = await createClient();
  const [{ data: propData }, { data: custData }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, property_code, title")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("customers")
      .select("id, full_name, phone")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  /*
   * Seçici havuzları "son eklenen 20" kısayolu. Ön dolgu havuz dışında
   * kalırsa sessizce düşerdi — eksik kayıtlar tek sorguyla listeye eklenir.
   */
  const properties = [...(propData ?? [])];
  const customers = [...(custData ?? [])];
  if (prefillPropertyId && !properties.some((p) => p.id === prefillPropertyId)) {
    const { data: extra } = await supabase
      .from("properties")
      .select("id, property_code, title")
      .eq("id", prefillPropertyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (extra) properties.unshift(extra);
  }
  if (prefillCustomerId && !customers.some((c) => c.id === prefillCustomerId)) {
    const { data: extra } = await supabase
      .from("customers")
      .select("id, full_name, phone")
      .eq("id", prefillCustomerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (extra) customers.unshift(extra);
  }
  const validProperty = prefillPropertyId && properties.some((p) => p.id === prefillPropertyId) ? prefillPropertyId : null;
  const validCustomer = prefillCustomerId && customers.some((c) => c.id === prefillCustomerId) ? prefillCustomerId : null;

  return (
    <RentalForm
      properties={properties}
      customers={customers}
      defaultPropertyId={validProperty}
      defaultCustomerId={validCustomer}
      defaultMonthlyRent={prefillRent}
      defaultStartDate={trDayKey()}
      userId={userId}
    />
  );
}
