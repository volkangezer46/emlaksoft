import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitions } from "@/lib/definitions";
import { listContractTemplates } from "@/app/actions/contracts";
import { createClient } from "@/lib/supabase/server";
import { NewContractForm } from "./new-contract-form";
import { loadRentalContractContext } from "./rental-context";

export const metadata = { title: "Yeni sözleşme" };

export default async function NewContractPage({
  searchParams,
}: {
  searchParams?: Promise<{ customer?: string; property?: string; tur?: string; kira?: string }>;
}) {
  const { perms, userId, tenantId } = await requireModulePage("contracts", "/app/sozlesmeler");
  if (!(perms.contracts?.includes("create") ?? false)) redirect("/app/sozlesmeler");

  const params = (await searchParams) ?? {};
  // Kiralamadan oluşturma (?kira=<id>): kira kaydı salt-okunur okunur; kiralama modülünü göremeyen kullanıcıda ön dolgu yok.
  const canReadRentals = perms.rentals?.includes("view") ?? false;
  const [contractTypeDefs, templates, rentalContext] = await Promise.all([
    getDefinitions("contract_type"),
    // "Şablondan başla" galerisi — global hazır şablonlar + ofis şablonları
    listContractTemplates(),
    params.kira && canReadRentals ? loadRentalContractContext(await createClient(), params.kira, tenantId) : Promise.resolve(null),
  ]);
  const contractTypes = contractTypeDefs.length
    ? contractTypeDefs.map((d) => ({ value: d.value, label: d.label }))
    : undefined;

  return (
    <NewContractForm
      userId={userId}
      contractTypes={contractTypes}
      templates={templates}
      prefillCustomer={rentalContext?.customerId ?? params.customer ?? ""}
      prefillProperty={rentalContext?.propertyId ?? params.property ?? ""}
      prefillTur={rentalContext ? "kira" : (params.tur ?? "")}
      rentalContext={rentalContext}
    />
  );
}
