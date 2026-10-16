import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { readPrefillIds, type PrefillSearchParams } from "@/lib/prefill-params";
import { OpenHouseForm } from "./open-house-form";

export const metadata = { title: "Yeni açık ev günü" };

export default async function NewOpenHousePage({ searchParams }: { searchParams?: Promise<PrefillSearchParams> }) {
  // Paket kilidi için ikinci argüman kilitli yol (/app/acik-ev) olmalı.
  const { perms, userId } = await requireModulePage("open_house", "/app/acik-ev");
  if (!(perms.open_house ?? []).includes("create")) redirect("/app/acik-ev");
  // ?property= (eş ad ?portfoy=) — portföy detayından gelindiyse o portföy ön seçili (tek kayıt, RLS süzgeçli).
  const { propertyId } = readPrefillIds(await searchParams);
  const picked = propertyId
    ? (await (await createClient()).from("properties").select("id, title, property_code").eq("id", propertyId).is("deleted_at", null).maybeSingle()).data
    : null;
  return (
    <OpenHouseForm
      userId={userId}
      prefillProperty={picked ? { value: picked.id as string, label: (picked.title as string | null) ?? "Başlıksız", hint: picked.property_code as string } : null}
    />
  );
}
