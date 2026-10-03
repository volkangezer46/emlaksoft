import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { NewProjectForm } from "./new-project-form";

export default async function YeniProjePage() {
  // Paket kilidi sayfa bazlı: kilit yolu liste sayfasıyla aynı.
  const { perms, userId } = await requireModulePage("projects", "/app/projeler");
  if (!(perms.projects ?? []).includes("create")) redirect("/app/projeler");
  return <NewProjectForm userId={userId} />;
}
