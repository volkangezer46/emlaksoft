import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deniedPageHref, requireModulePage } from "@/lib/require-module-page";
import { loadCustomFieldInputDefs } from "@/lib/custom-fields/save";
import { SatisSihirbazi } from "./satis-sihirbazi";
import { getSetting } from "@/lib/settings/read";
import { trDayKey } from "@/lib/clock";
import { defaultSplits } from "@/lib/sihirbaz/hesap";
import { getStageLabels } from "@/lib/definitions";
import { stageLabelMap } from "@/lib/deal-stage-labels";
import { readPrefillContext, type PrefillSearchParams } from "@/lib/prefill-params";
import { customerInWriteScope, OUT_OF_SCOPE_RECORD } from "@/lib/permission-data-scope";
import { loadCustomerPropertyContext } from "@/lib/customer-property-suggestions";
import { EmptyState } from "@/components/ui/empty-state";
import { Handshake } from "lucide-react";

export const metadata = { title: "Satış sihirbazı" };

export default async function NewDealPage({ searchParams }: { searchParams?: Promise<PrefillSearchParams> }) {
  const { perms, userId, tenantId, role } = await requireModulePage("commissions", "/app/anlasmalar/yeni");
  if (!(perms.commissions ?? []).includes("create")) redirect(deniedPageHref("commissions", "/app/anlasmalar/yeni"));
  const supabase = await createClient();
  // Bağlamdan açılış (müşteri 360 / portföy / talep "Anlaşma başlat"): ?customer=&property=&demand= (eş adlar da geçerli).
  // Talep verilip müşteri verilmediyse talebin müşterisi seçilir. Seçiciler yine değiştirilebilir.
  const ctx = readPrefillContext(await searchParams);
  const demandRow = ctx.demandId && !ctx.customerId
    ? (await supabase.from("demands").select("customer_id").eq("id", ctx.demandId).maybeSingle()).data
    : null;
  const customerId = ctx.customerId ?? ((demandRow?.customer_id as string | null | undefined) ?? null);

  // WP2: danışman/takım lideri yalnız KENDİ müşterisiyle anlaşma açar (eylem de aynı kuralı uygular).
  if (customerId && !(await customerInWriteScope(supabase, { userId, tenantId, role }, customerId))) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-4 py-6">
        <EmptyState icon={Handshake} title="Bu müşteriyle anlaşma açamazsınız" description={OUT_OF_SCOPE_RECORD} action={{ href: "/app/anlasmalar", label: "Anlaşmalarım" }} tone="amber" />
      </div>
    );
  }
  // Müşteri bağlamı: açık anlaşma uyarısı (mükerrer önlemi) + "Önerilen" portföyler; tek anlaşma/teklif portföyü seçili gelir.
  const custCtx = customerId ? await loadCustomerPropertyContext(supabase, tenantId, customerId) : null;
  const propertyPrefillId = ctx.propertyId ?? custCtx?.autoPropertyId ?? null;

  // Aşama etiketleri, portföy/müşteri listeleri ve özel alanlar bağımsız: TEK turda.
  const [stageLabels, { data: properties }, { data: customers }, customFields, advisorShare] = await Promise.all([
    getStageLabels(),
    supabase
      .from("properties")
      .select("id, property_code, title, list_price, transaction_type, commission_rate")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("customers")
      .select("id, full_name")
      .is("deleted_at", null)
      .order("full_name")
      .limit(20),
    loadCustomFieldInputDefs(supabase, tenantId, "deal"),
    // Ofis Tanımları Merkezi: danışman payı (komisyon paylaşım önizlemesi; ayar yoksa 50).
    tenantId ? getSetting<number>("office.commission.split_advisor_share", { tenantId }) : Promise.resolve(50),
  ]);
  // Ön seçili kayıtlar "son 20" havuzu dışında kalsa da seçicide adıyla görünmeli (tek kayıt, RLS süzgeçli).
  const [{ data: pickedProperty }, { data: pickedCustomer }] = await Promise.all([
    propertyPrefillId && !(properties ?? []).some((p) => p.id === propertyPrefillId)
      ? supabase.from("properties").select("id, property_code, title, list_price, transaction_type, commission_rate").eq("id", propertyPrefillId).is("deleted_at", null).maybeSingle()
      : Promise.resolve({ data: null }),
    customerId && !(customers ?? []).some((c) => c.id === customerId)
      ? supabase.from("customers").select("id, full_name").eq("id", customerId).is("deleted_at", null).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const basePropertyOptions = pickedProperty ? [pickedProperty, ...(properties ?? [])] : (properties ?? []);
  // Önerilenler listenin başına (ilk 20'de yoksa yalnız adıyla; fiyat/tür seçimde tamamlanır).
  const suggested = custCtx?.suggestions ?? [];
  const suggestedIds = new Set(suggested.map((x) => x.propertyId));
  const propertyOptions = [
    ...suggested.map((x) => {
      const known = basePropertyOptions.find((p) => p.id === x.propertyId);
      return {
        id: x.propertyId,
        property_code: known?.property_code ?? "",
        title: known?.title ?? x.label,
        list_price: known?.list_price ?? null,
        transaction_type: known?.transaction_type ?? "",
        commission_rate: known?.commission_rate ?? null,
        hint: `Önerilen · ${x.reason}`,
      };
    }),
    ...basePropertyOptions.filter((p) => !suggestedIds.has(p.id)),
  ];
  const customerOptions = pickedCustomer ? [pickedCustomer, ...(customers ?? [])] : (customers ?? []);
  const defaultPropertyId = propertyPrefillId && propertyOptions.some((p) => p.id === propertyPrefillId) ? propertyPrefillId : undefined;
  const defaultCustomerId = customerId && customerOptions.some((c) => c.id === customerId) ? customerId : undefined;
  const stageNames = stageLabelMap(stageLabels);
  return (
    <SatisSihirbazi
      properties={propertyOptions.map((p) => ({
        ...p,
        list_price: p.list_price != null ? Number(p.list_price) : null,
        commission_rate: p.commission_rate != null ? Number(p.commission_rate) : null,
      }))}
      customers={customerOptions}
      defaultPropertyId={defaultPropertyId}
      defaultCustomerId={defaultCustomerId}
      userId={userId}
      stageNames={stageNames}
      customFields={customFields}
      openDeals={defaultCustomerId ? (custCtx?.openDeals ?? []) : []}
      splits={defaultSplits(advisorShare)}
      canOffer={(perms.offers ?? []).includes("create")}
      canSetRate={(perms.properties ?? []).includes("edit")}
      today={trDayKey()}
    />
  );
}
