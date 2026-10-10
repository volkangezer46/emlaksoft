/**
 * Fatura kaynağından (komisyon, kira yönetim ücreti) önceden doldurulmuş taslak verisi.
 * Kullanıcı oturumuyla (RLS) okunur: göremediği kayıttan fatura kesemez. Kimlik/vergi no müşteri kaydında tutulmaz;
 * kullanıcı formda girer.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_VAT_RATE, inferVatRate, round2 } from "./invoice-math";
import type { EInvoiceLine, EInvoiceSourceType } from "./types";

export type SourcePrefill = {
  sourceType: EInvoiceSourceType;
  sourceId: string;
  label: string;
  buyerName: string;
  lines: EInvoiceLine[];
  /** Kaynağın detay sayfası (liste/rozet bağlantısı). */
  href: string;
};

type Embedded<T> = T | T[] | null | undefined;
function one<T>(v: Embedded<T>): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export const SOURCE_TYPE_LABEL: Record<EInvoiceSourceType, string> = {
  commission: "Komisyon",
  deal: "Anlaşma",
  rent_management_fee: "Kira yönetim ücreti",
  free: "Serbest fatura",
};

export const SOURCE_QUERY: Record<string, EInvoiceSourceType> = {
  komisyon: "commission",
  kira_ucret: "rent_management_fee",
  serbest: "free",
};

export async function loadSourcePrefill(
  supabase: SupabaseClient,
  type: EInvoiceSourceType,
  id: string,
): Promise<SourcePrefill | null> {
  if (type === "commission") {
    const { data } = await supabase
      .from("commissions")
      .select(
        "id, gross_amount, vat_amount, deal_id, deal:deals!commissions_deal_id_fkey(id, deal_type, property:properties!deals_property_id_fkey(property_code, title), customer:customers!deals_customer_id_fkey(full_name))",
      )
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const row = data as unknown as {
      id: string;
      gross_amount: number | string;
      vat_amount: number | string | null;
      deal_id: string;
      deal: Embedded<{
        id: string;
        deal_type: string;
        property: Embedded<{ property_code: string | null; title: string | null }>;
        customer: Embedded<{ full_name: string | null }>;
      }>;
    };
    const deal = one(row.deal);
    const property = one(deal?.property);
    const customer = one(deal?.customer);
    const gross = round2(Number(row.gross_amount));
    const vatRate = inferVatRate(gross, Number(row.vat_amount ?? 0));
    const kind = deal?.deal_type === "rent" ? "Kiralama" : "Satış";
    const ref = property?.property_code ?? property?.title ?? null;
    return {
      sourceType: "commission",
      sourceId: row.id,
      label: `${kind} komisyonu${ref ? ` · ${ref}` : ""}`,
      buyerName: customer?.full_name?.trim() ?? "",
      lines: [{ description: `${kind} aracılık hizmet bedeli${ref ? ` (${ref})` : ""}`, quantity: 1, unitPrice: gross, vatRate }],
      href: `/app/anlasmalar/${row.deal_id}`,
    };
  }
  if (type === "rent_management_fee") {
    const { data } = await supabase.from("rent_payments").select("id, management_fee").eq("id", id).maybeSingle();
    if (!data) return null;
    const fee = round2(Number((data as { management_fee: number | string | null }).management_fee ?? 0));
    return {
      sourceType: "rent_management_fee",
      sourceId: id,
      label: "Kira yönetim ücreti",
      buyerName: "",
      lines: [{ description: "Kira yönetim hizmet bedeli", quantity: 1, unitPrice: fee, vatRate: DEFAULT_VAT_RATE }],
      href: "/app/kiralama",
    };
  }
  return null;
}
