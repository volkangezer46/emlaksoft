import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { NewOfferForm } from "./new-offer-form";

export const metadata = { title: "Yeni teklif" };

export default async function NewOfferPage({
  searchParams,
}: {
  searchParams?: Promise<{ musteri?: string; portfoy?: string }>;
}) {
  const { perms, userId } = await requireModulePage("offers", "/app/teklifler");
  const canCreate = perms.offers?.includes("create") ?? perms.commissions?.includes("create") ?? false;
  if (!canCreate) redirect("/app/teklifler");

  const params = (await searchParams) ?? {};
  // ?musteri=&portfoy= — eşleştirme ekranındaki "Teklif al" kısayolunun ön dolgusu.
  const prefillCustomerId = (params.musteri ?? "").trim() || null;
  const prefillPropertyId = (params.portfoy ?? "").trim() || null;

  const supabase = await createClient();
  const [{ data: propData }, { data: custData }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, property_code, title, list_price")
      .is("deleted_at", null)
      .in("status", ["live", "draft", "reserved"])
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("customers")
      .select("id, full_name")
      .is("deleted_at", null)
      .order("full_name", { ascending: true })
      .limit(300),
  ]);

  const properties = (propData ?? []).map((p) => ({
    id: p.id as string,
    property_code: p.property_code as string,
    title: p.title as string | null,
    list_price: p.list_price as number | null,
  }));
  const customers = (custData ?? []).map((c) => ({
    id: c.id as string,
    full_name: c.full_name as string,
  }));

  // Seçici havuzları sınırlı: ön dolgu havuzun dışında kalırsa eksik kaydı ekle.
  if (prefillPropertyId && !properties.some((p) => p.id === prefillPropertyId)) {
    const { data: extra } = await supabase
      .from("properties")
      .select("id, property_code, title, list_price")
      .eq("id", prefillPropertyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (extra) {
      properties.unshift({
        id: extra.id as string,
        property_code: extra.property_code as string,
        title: extra.title as string | null,
        list_price: extra.list_price as number | null,
      });
    }
  }
  if (prefillCustomerId && !customers.some((c) => c.id === prefillCustomerId)) {
    const { data: extra } = await supabase
      .from("customers")
      .select("id, full_name")
      .eq("id", prefillCustomerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (extra) customers.unshift({ id: extra.id as string, full_name: extra.full_name as string });
  }

  return (
    <NewOfferForm
      userId={userId}
      properties={properties}
      customers={customers}
      defaultPropertyId={prefillPropertyId}
      defaultCustomerId={prefillCustomerId}
      todayIso={new Date(now()).toISOString().slice(0, 10)}
    />
  );
}
