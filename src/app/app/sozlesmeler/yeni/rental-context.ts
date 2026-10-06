import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildRentalContractBody,
  rentalContractTitle,
  type RentalContractData,
} from "@/lib/rental-contract/build";
import { now, trDayKey } from "@/lib/clock";

/**
 * Kiralamadan sözleşme ön dolgusu (H6). Salt-okunur, oturumlu istemci (RLS), service_role yok.
 * Kira kaydı bulunamaz/okunamazsa null döner: form normal boş sözleşme akışına düşer (çıkmaz yok).
 */
export type RentalContractContext = {
  rentalId: string;
  customerId: string;
  propertyId: string;
  title: string;
  /** Son geçerlilik (YYYY-MM-DD): yalnız gelecekteyse; createContract geçmiş tarihi reddeder. */
  expiresAt: string | null;
  data: RentalContractData;
  defaultBody: string;
};

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function loadRentalContractContext(
  supabase: SupabaseClient,
  rentalId: string,
  tenantId: string | null,
): Promise<RentalContractContext | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rentalId)) return null;
  const { data: rental, error } = await supabase
    .from("rentals")
    .select(
      "id, monthly_rent, due_day, start_date, end_date, deposit, property:properties!rentals_property_id_fkey(id, title, property_code, address_line), renter:customers!rentals_renter_customer_id_fkey(id, full_name)",
    )
    .eq("id", rentalId)
    .maybeSingle();
  if (error || !rental) return null;

  const property = one(rental.property as Rel<{ id: string; title: string | null; property_code: string | null; address_line: string | null }>);
  const renter = one(rental.renter as Rel<{ id: string; full_name: string | null }>);
  if (!property || !renter) return null;

  // Kiraya veren: ilan sahibi kaydındaki müşteri (yoksa boş bırakılır). Hata = boş.
  let landlordName: string | null = null;
  const ownerRes = await supabase.from("property_owner_info").select("customer_id").eq("property_id", property.id).maybeSingle();
  const ownerCustomerId = ownerRes.error ? null : ((ownerRes.data as { customer_id?: string | null } | null)?.customer_id ?? null);
  if (ownerCustomerId) {
    const c = await supabase.from("customers").select("full_name").eq("id", ownerCustomerId).maybeSingle();
    landlordName = c.error ? null : ((c.data as { full_name?: string | null } | null)?.full_name ?? null);
  }
  let officeName: string | null = null;
  if (tenantId) {
    const t = await supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle();
    officeName = t.error ? null : ((t.data as { name?: string | null } | null)?.name ?? null);
  }

  const startDate = String(rental.start_date).slice(0, 10);
  const endDate = rental.end_date ? String(rental.end_date).slice(0, 10) : null;
  const today = trDayKey(now());
  const data: RentalContractData = {
    landlordName,
    tenantName: renter.full_name,
    propertyTitle: property.title ?? property.property_code,
    propertyAddress: property.address_line,
    monthlyRent: Number(rental.monthly_rent),
    deposit: rental.deposit != null ? Number(rental.deposit) : null,
    dueDay: rental.due_day,
    startDate,
    endDate,
    officeName,
    increaseBasis: "tufe",
    fixedPct: null,
  };
  return {
    rentalId: String(rental.id),
    customerId: renter.id,
    propertyId: property.id,
    title: rentalContractTitle(data),
    expiresAt: endDate && endDate > today ? endDate : null,
    data,
    defaultBody: buildRentalContractBody(data),
  };
}
