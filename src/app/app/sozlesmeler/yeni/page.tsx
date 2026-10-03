import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitions } from "@/lib/definitions";
import { listContractTemplates } from "@/app/actions/contracts";
import { NewContractForm } from "./new-contract-form";

export const metadata = { title: "Yeni sözleşme" };

export default async function NewContractPage({
  searchParams,
}: {
  searchParams?: Promise<{ customer?: string; property?: string; tur?: string }>;
}) {
  const { perms, userId } = await requireModulePage("contracts", "/app/sozlesmeler");
  if (!(perms.contracts?.includes("create") ?? false)) redirect("/app/sozlesmeler");

  const params = (await searchParams) ?? {};
  const [contractTypeDefs, templates] = await Promise.all([
    getDefinitions("contract_type"),
    // "Şablondan başla" galerisi — global hazır şablonlar + ofis şablonları
    listContractTemplates(),
  ]);
  const contractTypes = contractTypeDefs.length
    ? contractTypeDefs.map((d) => ({ value: d.value, label: d.label }))
    : undefined;

  return (
    <NewContractForm
      userId={userId}
      contractTypes={contractTypes}
      templates={templates}
      prefillCustomer={params.customer ?? ""}
      prefillProperty={params.property ?? ""}
      prefillTur={params.tur ?? ""}
    />
  );
}
