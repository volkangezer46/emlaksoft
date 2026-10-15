import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitions } from "@/lib/definitions";
import { listContractTemplates } from "@/app/actions/contracts";
import { createClient } from "@/lib/supabase/server";
import { readPrefillIds } from "@/lib/prefill-params";
import { NewContractForm } from "./new-contract-form";
import { loadRentalContractContext } from "./rental-context";
import { loadDealContractContext } from "./deal-context";
import { parseDealContractKind } from "@/lib/sale-contract/build";

export const metadata = { title: "Yeni sözleşme" };

export default async function NewContractPage({
  searchParams,
}: {
  searchParams?: Promise<{
    customer?: string;
    property?: string;
    musteri?: string;
    portfoy?: string;
    tur?: string;
    kira?: string;
    /** SP3: anlaşmadan / kabul edilen tekliften (?anlasma=&teklif=&sablon=kapora|aracilik). */
    anlasma?: string;
    teklif?: string;
    sablon?: string;
  }>;
}) {
  const { perms, userId, tenantId } = await requireModulePage("contracts", "/app/sozlesmeler");
  if (!(perms.contracts?.includes("create") ?? false)) redirect("/app/sozlesmeler");

  const params = (await searchParams) ?? {};
  // ?customer=&property= (eş adlar ?musteri=&portfoy= de geçerli).
  const prefill = readPrefillIds(params);
  // Kiralamadan oluşturma (?kira=<id>): kira kaydı salt-okunur okunur; kiralama modülünü göremeyen kullanıcıda ön dolgu yok.
  const canReadRentals = perms.rentals?.includes("view") ?? false;
  const supabase = await createClient();
  const wantsDeal = Boolean(!params.kira && (params.anlasma || params.teklif));
  const [contractTypeDefs, templates, rentalContext, dealContext] = await Promise.all([
    getDefinitions("contract_type"),
    // "Şablondan başla" galerisi — global hazır şablonlar + ofis şablonları
    listContractTemplates(),
    params.kira && canReadRentals ? loadRentalContractContext(supabase, params.kira, tenantId) : Promise.resolve(null),
    wantsDeal
      ? loadDealContractContext(supabase, {
          dealId: params.anlasma ?? null,
          offerId: params.teklif ?? null,
          kind: parseDealContractKind(params.sablon),
          tenantId,
        })
      : Promise.resolve(null),
  ]);
  const contractTypes = contractTypeDefs.length
    ? contractTypeDefs.map((d) => ({ value: d.value, label: d.label }))
    : undefined;

  return (
    <NewContractForm
      userId={userId}
      contractTypes={contractTypes}
      templates={templates}
      prefillCustomer={rentalContext?.customerId ?? dealContext?.customerId ?? prefill.customerId ?? ""}
      prefillProperty={rentalContext?.propertyId ?? dealContext?.propertyId ?? prefill.propertyId ?? ""}
      prefillTur={rentalContext ? "kira" : dealContext ? dealContext.contractType : (params.tur ?? "")}
      rentalContext={rentalContext}
      dealContext={dealContext}
      canSaveTemplate={perms.settings?.includes("edit") ?? false}
    />
  );
}
