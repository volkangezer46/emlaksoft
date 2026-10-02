import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { PresentationForm, type SelectableCustomer, type SelectableProperty } from "./presentation-form";

export const metadata = { title: "Yeni portföy sunumu" };

export default async function NewPresentationPage({
  searchParams,
}: {
  searchParams?: Promise<{ portfoy?: string; musteri?: string }>;
}) {
  const { perms } = await requireModulePage("properties", "/app/portfoyler/sunumlar");
  // Müşteri seçici yalnız müşteri görebilenlere; göremeyene liste sızmasın.
  const canSeeCustomers = (perms.customers ?? []).includes("view");
  const params = (await searchParams) ?? {};
  // Portföy detayı / eşleştirme ekranı ?portfoy=&musteri= ile gelir → ön seçili açılır.
  const preselectedId = (params.portfoy ?? "").trim() || null;
  const preselectedCustomerId = (params.musteri ?? "").trim() || null;

  const supabase = await createClient();
  const [{ data: liveData }, { data: customerData }] = await Promise.all([
    // Seçim havuzu: yalnız yayındaki portföyler (action da aynı kuralı zorlar).
    supabase
      .from("properties")
      .select("id, property_code, title, list_price, transaction_type, district:geo_districts(name)")
      .in("status", ["live", "Yayında"])
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
    // Müşteri seçici havuzu — arama client'ta, ek gidiş-dönüş yok.
    canSeeCustomers
      ? supabase
          .from("customers")
          .select("id, full_name, phone")
          .is("deleted_at", null)
          .order("full_name", { ascending: true })
          .limit(500)
      : Promise.resolve({ data: null }),
  ]);

  const customers: SelectableCustomer[] = (customerData ?? []).map((c) => ({
    id: c.id as string,
    name: c.full_name as string,
    phone: (c.phone as string | null) ?? null,
  }));
  const properties: SelectableProperty[] = (liveData ?? []).map((p) => {
    const rel = p.district as { name?: string } | { name?: string }[] | null;
    return {
      id: p.id as string,
      code: p.property_code as string,
      title: (p.title as string | null) ?? null,
      price: p.list_price != null ? Number(p.list_price) : null,
      tx: p.transaction_type as string,
      district: (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? null,
    };
  });

  return (
    <PresentationForm
      properties={properties}
      customers={customers}
      preselectedId={preselectedId}
      preselectedCustomerId={preselectedCustomerId}
    />
  );
}
