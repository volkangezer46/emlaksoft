import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { loadCustomFieldInputDefs } from "@/lib/custom-fields/save";
import { createClient } from "@/lib/supabase/server";
import { getProvinceOptions } from "@/lib/geo/reader";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { isPoolEnabled } from "@/lib/pool/server";
import { parseIncomingPoolSource } from "@/lib/pool/sources";
import { PropertyForm } from "./property-form";

export const metadata = { title: "Yeni portföy" };

export default async function NewPropertyPage({ searchParams }: { searchParams: Promise<{ kaynak?: string; fsbo?: string }> }) {
  const { kaynak, fsbo: fsboParam } = await searchParams;
  const poolSource = parseIncomingPoolSource(kaynak);
  const { perms, userId, tenantId } = await requireModulePage("properties", "/app/portfoyler");
  if (!(perms.properties ?? []).includes("create")) redirect("/app/portfoyler");

  const supabase = await createClient();
  const [provinces, { data: branches }, propertyTypes, transactionTypes, poolEnabled, { data: tenantRow }] = await Promise.all([
    // İl listesi 81 satırlık sabit referans verisi — istekler arası cache'li (src/lib/geo.ts)
    getProvinceOptions(),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    getDefinitionsOrDefault("property_type"),
    getDefinitionsOrDefault("transaction_type"),
    tenantId ? isPoolEnabled(supabase, tenantId) : Promise.resolve(false),
    // Maliğe hazır EİDS mesajı: ofis adı + yetki belge numarası (RLS kiracı sınırı).
    tenantId ? supabase.from("tenants").select("name, license_no").eq("id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const office = tenantRow ? { name: String(tenantRow.name ?? ""), licenseNo: (tenantRow.license_no as string | null) ?? null } : undefined;

  // Sahibinden ilan adayından dönüşüm: yalnız aynı ofisin, henüz kapanmamış adayı önden doldurur (RLS + kiracı filtresi).
  type FsboPrefill = { id: string; title: string; transaction: string; rooms: string; sqm: string; price: string; ownerName: string; ownerPhone: string; locationText: string };
  let fsbo: FsboPrefill | undefined;
  if (fsboParam && /^[0-9a-f-]{36}$/i.test(fsboParam) && (perms.prospecting ?? []).includes("edit") && tenantId) {
    const { data: lead } = await supabase
      .from("fsbo_leads")
      .select("id, title, transaction_type, rooms, gross_m2, price, owner_name, phone, location_text, status")
      .eq("tenant_id", tenantId)
      .eq("id", fsboParam)
      .is("deleted_at", null)
      .maybeSingle();
    const row = lead as {
      id: string; title: string | null; transaction_type: string; rooms: string | null; gross_m2: number | string | null; price: number | string | null;
      owner_name: string | null; phone: string | null; location_text: string | null; status: string;
    } | null;
    if (row && row.status !== "portfoye_donustu" && row.status !== "kayip") {
      fsbo = {
        id: row.id,
        title: row.title ?? "",
        transaction: row.transaction_type === "rent" ? "Kiralık" : "Satılık",
        rooms: row.rooms ?? "",
        sqm: row.gross_m2 == null ? "" : String(row.gross_m2),
        price: row.price == null ? "" : String(row.price),
        ownerName: row.owner_name ?? "",
        ownerPhone: row.phone ?? "",
        locationText: row.location_text ?? "",
      };
    }
  }

  return (
    <PropertyForm
      fsbo={fsbo}
      customFields={await loadCustomFieldInputDefs(supabase, tenantId, "property")}
      provinces={provinces}
      branches={branches ?? []}
      propertyTypes={propertyTypes.map((d) => d.value)}
      transactionTypes={transactionTypes.map((d) => d.value)}
      userId={userId}
      poolEnabled={poolEnabled}
      office={office}
      poolSource={poolSource === "manual" ? undefined : poolSource}
    />
  );
}
