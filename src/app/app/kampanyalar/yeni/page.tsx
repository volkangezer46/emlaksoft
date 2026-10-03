import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { NewCampaignForm } from "./new-campaign-form";

export default async function YeniKampanyaPage() {
  const { perms, userId } = await requireModulePage("campaigns", "/app/kampanyalar");
  if (!(perms.campaigns ?? []).includes("create")) redirect("/app/kampanyalar");
  return <NewCampaignForm userId={userId} />;
}
