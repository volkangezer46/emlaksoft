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
  // Müşteri ön dolgusu yalnız müşteri görebilenlere; göremeyene kayıt sızmasın.
  const canSeeCustomers = (perms.customers ?? []).includes("view");
  const params = (await searchParams) ?? {};
  // Portföy detayı / eşleştirme ekranı ?portfoy=&musteri= ile gelir → ön seçili açılır.
  const preselectedId = (params.portfoy ?? "").trim() || null;
  const preselectedCustomerId = (params.musteri ?? "").trim() || null;

  // Portföy ve müşteri seçimi sunucu taraflı aranır (lookup.ts); burada yalnız
  // ön dolgudaki tek kayıtlar .eq('id') ile getirilir (RLS kiracı süzgeci).
  const supabase = await createClient();
  const [{ data: preProp }, { data: preCust }] = await Promise.all([
    preselectedId
      ? supabase
          .from("properties")
          .select("id, property_code, title, list_price, transaction_type, district:geo_districts(name)")
          .eq("id", preselectedId)
          // Seçim havuzu: yalnız yayındaki portföyler (action da aynı kuralı zorlar).
          .in("status", ["live", "Yayında"])
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    canSeeCustomers && preselectedCustomerId
      ? supabase
          .from("customers")
          .select("id, full_name, phone")
          .eq("id", preselectedCustomerId)
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const customers: SelectableCustomer[] = preCust
    ? [
        {
          id: preCust.id as string,
          name: preCust.full_name as string,
          phone: (preCust.phone as string | null) ?? null,
        },
      ]
    : [];
  const properties: SelectableProperty[] = preProp
    ? (() => {
        const rel = preProp.district as { name?: string } | { name?: string }[] | null;
        return [
          {
            id: preProp.id as string,
            code: preProp.property_code as string,
            title: (preProp.title as string | null) ?? null,
            price: preProp.list_price != null ? Number(preProp.list_price) : null,
            tx: preProp.transaction_type as string,
            district: (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? null,
          },
        ];
      })()
    : [];

  return (
    <PresentationForm
      properties={properties}
      customers={customers}
      preselectedId={preselectedId}
      preselectedCustomerId={preselectedCustomerId}
    />
  );
}
