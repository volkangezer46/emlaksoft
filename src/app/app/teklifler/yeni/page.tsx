import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deniedPageHref, requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { readPrefillContext, type PrefillSearchParams } from "@/lib/prefill-params";
import { NewOfferForm } from "./new-offer-form";
import { customerInWriteScope, OUT_OF_SCOPE_RECORD } from "@/lib/permission-data-scope";
import { loadCustomerPropertyContext } from "@/lib/customer-property-suggestions";
import { EmptyState } from "@/components/ui/empty-state";
import { Tag } from "lucide-react";

export const metadata = { title: "Yeni teklif" };

export default async function NewOfferPage({
  searchParams,
}: {
  searchParams?: Promise<PrefillSearchParams>;
}) {
  const { perms, userId, tenantId, role } = await requireModulePage("offers", "/app/teklifler");
  const canCreate = perms.offers?.includes("create") ?? perms.commissions?.includes("create") ?? false;
  if (!canCreate) redirect(deniedPageHref("offers"));

  // ?customer=&property= (eş adlar ?musteri=&portfoy= de geçerli) — "Teklif al" / "Teklif gir" kısayollarının ön dolgusu.
  // ?deal= (anlaşma detayı) eksik tarafı anlaşmanın müşteri/portföyünden, ?demand= (talep) müşteriyi talepten tamamlar.
  const ctx = readPrefillContext(await searchParams);

  // Seçiciler sunucu taraflı aranır (searchOfferProperties / searchCustomers): ofis kaç
  // kayıt tutarsa tutsun seçilebilir. Sayfa yalnız ön dolgudaki tek kaydı (.eq('id')) getirir.
  const supabase = await createClient();
  let prefillCustomerId = ctx.customerId;
  let prefillPropertyId = ctx.propertyId;
  if (ctx.dealId && (!prefillCustomerId || !prefillPropertyId)) {
    const { data: deal } = await supabase.from("deals").select("customer_id, property_id").eq("id", ctx.dealId).maybeSingle();
    prefillCustomerId ??= (deal?.customer_id as string | null | undefined) ?? null;
    prefillPropertyId ??= (deal?.property_id as string | null | undefined) ?? null;
  }
  if (ctx.demandId && !prefillCustomerId) {
    const { data: demand } = await supabase.from("demands").select("customer_id").eq("id", ctx.demandId).maybeSingle();
    prefillCustomerId = (demand?.customer_id as string | null | undefined) ?? null;
  }
  // WP2: danışman/takım lideri yalnız KENDİ müşterisi için teklif girer (eylem de aynı kuralı uygular).
  if (prefillCustomerId && !(await customerInWriteScope(supabase, { userId, tenantId, role }, prefillCustomerId))) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-4 py-6">
        <EmptyState icon={Tag} title="Bu müşteri için teklif giremezsiniz" description={OUT_OF_SCOPE_RECORD} action={{ href: "/app/teklifler", label: "Tekliflerim" }} tone="amber" />
      </div>
    );
  }
  // Portföy verilmediyse müşterinin TEK açık anlaşma/teklif portföyü ön seçilir.
  if (prefillCustomerId && !prefillPropertyId) {
    const custCtx = await loadCustomerPropertyContext(supabase, tenantId, prefillCustomerId, { withMatches: false });
    prefillPropertyId = custCtx.autoPropertyId;
  }
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
