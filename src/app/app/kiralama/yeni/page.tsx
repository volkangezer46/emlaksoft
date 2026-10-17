import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deniedPageHref, requireModulePage } from "@/lib/require-module-page";
import { trDayKey } from "@/lib/clock";
import { readPrefillIds, type PrefillSearchParams } from "@/lib/prefill-params";
import { KiraSihirbazi, type RentApplication } from "./kira-sihirbazi";

export const metadata = { title: "Kiralama sihirbazı" };

export default async function NewRentalPage({
  searchParams,
}: {
  searchParams?: Promise<PrefillSearchParams>;
}) {
  // Paket kilidi kilitli kök yol üzerinden uygulanır (/app/kiralama → page-gates).
  const { perms, userId, tenantId } = await requireModulePage("rentals", "/app/kiralama");
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
  const [{ data: propData }, { data: custData }, { data: appData }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, property_code, title, list_price, commission_rate")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("customers")
      .select("id, full_name, phone")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
    // SP5: onaylı ve henüz kiraya bağlanmamış başvurular (müşteri kaydı açılmış olanlar) — "Onaylı başvurudan" seçimi.
    supabase
      .from("rental_applications")
      .select("id, full_name, customer_id, property_id, property:properties!rental_applications_property_id_fkey(title, property_code, list_price), link:rental_application_links!rental_applications_link_id_fkey(asking_rent)")
      .eq("tenant_id", tenantId ?? "")
      .eq("status", "approved")
      .is("rental_id", null)
      .not("customer_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(10),
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
      .select("id, property_code, title, list_price, commission_rate")
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

  const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));
  const applications: RentApplication[] = ((appData ?? []) as Array<{
    id: string;
    full_name: string | null;
    customer_id: string | null;
    property_id: string;
    property: { title: string | null; property_code: string | null; list_price: number | string | null } | { title: string | null; property_code: string | null; list_price: number | string | null }[] | null;
    link: { asking_rent: number | string | null } | { asking_rent: number | string | null }[] | null;
  }>).flatMap((a) => {
    if (!a.customer_id) return [];
    const prop = one(a.property);
    const asking = one(a.link)?.asking_rent ?? prop?.list_price ?? null;
    return [{
      id: a.id,
      customerId: a.customer_id,
      customerName: a.full_name ?? "Başvuru sahibi",
      propertyId: a.property_id,
      propertyLabel: prop?.title ?? prop?.property_code ?? "Portföy",
      rent: asking != null && Number(asking) > 0 ? Math.round(Number(asking)) : null,
    }];
  });
  const canCreateCommission = (perms.commissions ?? []).includes("create");

  return (
    <KiraSihirbazi
      userId={userId}
      properties={properties.map((p) => ({
        id: p.id as string,
        property_code: p.property_code as string,
        title: (p.title as string | null) ?? null,
        list_price: p.list_price != null ? Number(p.list_price) : null,
        commission_rate: p.commission_rate != null ? Number(p.commission_rate) : null,
      }))}
      customers={customers}
      applications={applications}
      defaultPropertyId={validProperty}
      defaultCustomerId={validCustomer}
      defaultMonthlyRent={prefillRent}
      defaultStartDate={trDayKey()}
      sourceNote={applicationParam && !dealLabel ? "Onaylı kiracı başvurusundan gelindi — portföy, kiracı ve kira dolduruldu; kefil bilgisi kayıt açılınca kira kaydına taşınır." : dealLabel}
      applicationId={applicationParam}
      options={{
        canSetRate: (perms.properties ?? []).includes("edit"),
        canCreateCustomer: (perms.customers ?? []).includes("create"),
        canHandover: (perms.rentals ?? []).includes("edit"),
      }}
      submitBlocked={canCreateCommission ? null : "Kira kaydı kiralık anlaşmayı ve komisyonu birlikte açar; komisyon oluşturma yetkiniz yok."}
    />
  );
}
