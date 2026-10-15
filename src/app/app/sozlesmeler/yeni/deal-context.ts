import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEAL_CONTRACT_KINDS,
  buildDealContractBody,
  dealContractTitle,
  type DealContractData,
  type DealContractKind,
} from "@/lib/sale-contract/build";
import { OFFER_PAYMENT_LABELS, readOfferTerms } from "@/lib/offer-terms";
import { now, trDayKey } from "@/lib/clock";

/**
 * Anlaşmadan / kabul edilen tekliften sözleşme ön dolgusu (SP3). Salt-okunur, oturumlu istemci (RLS), service_role yok.
 * Kayıt okunamazsa null: form normal boş sözleşme akışına düşer (çıkmaz yok). Teklif ve anlaşma farklı portföye aitse
 * anlaşma yok sayılır (yanlış bağ kurulmaz).
 */
export type DealContractContext = {
  kind: DealContractKind;
  dealId: string | null;
  offerId: string | null;
  customerId: string | null;
  propertyId: string | null;
  contractType: string;
  title: string;
  expiresAt: string | null;
  data: DealContractData;
  defaultBody: string;
  /** Kaynak açıklaması ("Kabul edilen teklif · ₺5.000.000"). */
  sourceLabel: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tl = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);

export async function loadDealContractContext(
  supabase: SupabaseClient,
  input: { dealId?: string | null; offerId?: string | null; kind: DealContractKind; tenantId: string | null },
): Promise<DealContractContext | null> {
  const offerId = input.offerId && UUID_RE.test(input.offerId) ? input.offerId : null;
  let dealId = input.dealId && UUID_RE.test(input.dealId) ? input.dealId : null;
  if (!offerId && !dealId) return null;

  const [offerRes, offerTermsRes] = await Promise.all([
    offerId
      ? supabase
          .from("offers")
          .select("id, amount, counter_amount, status, valid_until, property_id, customer_id, deal_id")
          .eq("id", offerId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    offerId
      ? supabase.from("offers").select("payment_method, deposit_amount, proposed_deed_date, credit_contingency, swap_note").eq("id", offerId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const offer = offerRes.error
    ? null
    : (offerRes.data as {
        id: string;
        amount: number | string;
        counter_amount: number | string | null;
        status: string;
        valid_until: string | null;
        property_id: string;
        customer_id: string | null;
        deal_id?: string | null;
      } | null);
  if (offerId && !offer) return null;
  if (!dealId && offer?.deal_id) dealId = offer.deal_id;

  const dealRes = dealId
    ? await supabase.from("deals").select("id, deal_type, deal_value, property_id, customer_id").eq("id", dealId).maybeSingle()
    : { data: null, error: null };
  let deal = dealRes.error
    ? null
    : (dealRes.data as { id: string; deal_type: "sale" | "rent"; deal_value: number | string | null; property_id: string | null; customer_id: string | null } | null);
  if (deal && offer && deal.property_id && deal.property_id !== offer.property_id) deal = null;
  if (!offer && !deal) return null;

  const propertyId = offer?.property_id ?? deal?.property_id ?? null;
  const customerId = offer?.customer_id ?? deal?.customer_id ?? null;

  const [propRes, buyerRes, ownerRes, tenantRes] = await Promise.all([
    propertyId
      ? supabase.from("properties").select("id, title, property_code, address_line, transaction_type").eq("id", propertyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    customerId ? supabase.from("customers").select("full_name").eq("id", customerId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    propertyId
      ? supabase.from("property_owner_info").select("customer_id").eq("property_id", propertyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    input.tenantId ? supabase.from("tenants").select("name").eq("id", input.tenantId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const property = propRes.error
    ? null
    : (propRes.data as { id: string; title: string | null; property_code: string | null; address_line: string | null; transaction_type: string | null } | null);
  const buyerName = buyerRes.error ? null : ((buyerRes.data as { full_name?: string | null } | null)?.full_name ?? null);
  // Satıcı / kiraya veren: ilan sahibi kaydındaki müşteri (yoksa boş bırakılır; uydurulmaz).
  const ownerCustomerId = ownerRes.error ? null : ((ownerRes.data as { customer_id?: string | null } | null)?.customer_id ?? null);
  let sellerName: string | null = null;
  if (ownerCustomerId) {
    const c = await supabase.from("customers").select("full_name").eq("id", ownerCustomerId).maybeSingle();
    sellerName = c.error ? null : ((c.data as { full_name?: string | null } | null)?.full_name ?? null);
  }
  const officeName = tenantRes.error ? null : ((tenantRes.data as { name?: string | null } | null)?.name ?? null);

  const terms = readOfferTerms(offerTermsRes.error ? null : (offerTermsRes.data as Record<string, unknown> | null));
  const dealType: "sale" | "rent" =
    deal?.deal_type ?? (/kiral/i.test(property?.transaction_type ?? "") ? "rent" : "sale");
  // Fiyat: anlaşma değeri esas; yoksa kabul edilen teklifte son karşı teklif (kabul edilen odur), o da yoksa teklif tutarı.
  const offerPrice = offer ? Number(offer.counter_amount ?? offer.amount) : null;
  const price = deal?.deal_value != null && Number(deal.deal_value) > 0 ? Number(deal.deal_value) : offerPrice;

  const today = trDayKey(now());
  const validUntil = offer?.valid_until && offer.valid_until.slice(0, 10) >= today ? offer.valid_until.slice(0, 10) : null;
  const data: DealContractData = {
    dealType,
    buyerName,
    sellerName,
    propertyTitle: property?.title ?? null,
    propertyCode: property?.property_code ?? null,
    propertyAddress: property?.address_line ?? null,
    price: price != null && Number.isFinite(price) && price > 0 ? price : null,
    depositAmount: terms.deposit_amount,
    paymentMethodLabel: terms.payment_method ? OFFER_PAYMENT_LABELS[terms.payment_method] : null,
    deedDate: terms.proposed_deed_date,
    officeName,
    validUntil,
    creditContingency: terms.credit_contingency,
  };
  const kindDef = DEAL_CONTRACT_KINDS.find((k) => k.value === input.kind) ?? DEAL_CONTRACT_KINDS[0];
  const sourceLabel = [
    offer ? (offer.status === "accepted" ? "Kabul edilen teklif" : "Teklif") : "Anlaşma",
    data.price != null ? tl(data.price) : null,
    property?.title ?? property?.property_code ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    kind: kindDef.value,
    dealId: deal?.id ?? null,
    offerId: offer?.id ?? null,
    customerId,
    propertyId,
    contractType: kindDef.contractType,
    title: dealContractTitle(kindDef.value, data),
    expiresAt: validUntil,
    data,
    defaultBody: buildDealContractBody(kindDef.value, data),
    sourceLabel,
  };
}
