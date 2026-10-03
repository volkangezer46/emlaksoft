import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitions } from "@/lib/definitions";
import { NewTicketForm } from "./new-ticket-form";

export default async function YeniDestekTalebiPage() {
  const { userId } = await requireModulePage("support", "/app/destek");
  const categoryDefs = await getDefinitions("ticket_category");
  const categoryOptions = categoryDefs.length
    ? categoryDefs.map((d) => ({ value: d.value, label: d.label }))
    : undefined;
  return <NewTicketForm categoryOptions={categoryOptions} userId={userId} />;
}
