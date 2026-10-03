import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { OpenHouseForm } from "./open-house-form";

export const metadata = { title: "Yeni açık ev günü" };

export default async function NewOpenHousePage() {
  // Paket kilidi için ikinci argüman kilitli yol (/app/acik-ev) olmalı.
  const { perms, userId } = await requireModulePage("open_house", "/app/acik-ev");
  if (!(perms.open_house ?? []).includes("create")) redirect("/app/acik-ev");
  return <OpenHouseForm userId={userId} />;
}
