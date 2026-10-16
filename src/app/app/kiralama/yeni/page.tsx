import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deniedPageHref, requireModulePage } from "@/lib/require-module-page";
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
  if (!(perms.rentals ?? []).includes("create")) redirect(deniedPageHref("rentals"));

  // Kazanılan kira anlaşması köprüsü: ?property=&customer=&tutar= ön dolgusu (eş adlar ?portfoy=&musteri= de geçerli).
  // SP4: ?anlasma=<id> verilirse eksik alanlar anlaşmadan (portföy, müşteri, anlaşma değeri) tamamlanır.
  const sp = (await searchParams) ?? {};
  const ids = readPrefillIds(sp);
  const rentParsed = Number(typeof sp.tutar === "string" ? sp.tutar : "");
  let prefillRent = Number.isFinite(rentParsed) && rentParsed > 0 ? Math.round(rentParsed) : null;

  const supabase = await createClient();
  // SP5: onaylı kiracı başvurusundan gelindiyse (?basvuru=<id>) başvuru kira kaydına bağlanır, kefil taşınır.
  const applicationParam = typeof sp.basvuru === "string" && /^[0-9a-f-]{36}$/i.test(sp.basvuru) ? sp.basvuru : null;
  const dealParam = typeof sp.anlasma === "string" && /^[0-9a-f-]{36}$/i.test(sp.anlasma) ? sp.anlasma : null;
  let prefillPropertyId = ids.propertyId;
  let prefillCustomerId = ids.customerId;
  let dealLabel: string | null = null;
  if (dealParam) {
    const { data: deal } = await supabase
      .from("deals")
      .select("id, deal_type, deal_value, property_id, customer_id")
      .eq("id", dealParam)
      .maybeSingle();
    if (deal && (deal as { deal_type?: string }).deal_type === "rent") {
      const d = deal as { deal_value: number | string | null; property_id: string | null; customer_id: string | null };
      prefillPropertyId ??= d.property_id;
      prefillCustomerId ??= d.customer_id;
      if (prefillRent == null && d.deal_value != null && Number(d.deal_value) > 0) prefillRent = Math.round(Number(d.deal_value));
      dealLabel = "Kiralık anlaşmadan gelindi — portföy, kiracı ve aylık kira dolduruldu; kayıt açılınca anlaşma kazanıldı olarak kapanır.";
    }
  }
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
      sourceNote={applicationParam && !dealLabel ? "Onaylı kiracı başvurusundan gelindi — portföy, kiracı ve kira dolduruldu; kefil bilgisi kayıt açılınca kira kaydına taşınır." : dealLabel}
      applicationId={applicationParam}
      userId={userId}
    />
  );
}
