import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { parsePortfoyParam, PRESENTATION_MAX_PROPERTIES } from "@/lib/presentation-prefill";
import { PresentationForm, type SelectableCustomer, type SelectableProperty } from "./presentation-form";

export const metadata = { title: "Yeni portföy sunumu" };

export default async function NewPresentationPage({
  searchParams,
}: {
  searchParams?: Promise<{ portfoy?: string | string[]; musteri?: string }>;
}) {
  const { perms } = await requireModulePage("properties", "/app/portfoyler/sunumlar");
  // Müşteri ön dolgusu yalnız müşteri görebilenlere; göremeyene kayıt sızmasın.
  const canSeeCustomers = (perms.customers ?? []).includes("view");
  const params = (await searchParams) ?? {};
  // Portföy detayı / eşleştirme ekranı ?portfoy=a,b,c&musteri= ile gelir → ön seçili açılır.
  // Yalnız geçerli UUID'ler, tekil, en çok PRESENTATION_PREFILL_CAP (20) kimlik okunur.
  const requestedIds = parsePortfoyParam(params.portfoy);
  const preselectedCustomerId = (params.musteri ?? "").trim() || null;

  // Portföy ve müşteri seçimi sunucu taraflı aranır (lookup.ts); burada yalnız
  // ön dolgudaki kayıtlar .in('id') ile getirilir (RLS kiracı süzgeci).
  const supabase = await createClient();
  const [{ data: preProps }, { data: preCust }] = await Promise.all([
    requestedIds.length
      ? supabase
          .from("properties")
          .select("id, property_code, title, list_price, transaction_type, district:geo_districts(name)")
          .in("id", requestedIds)
          // Seçim havuzu: yalnız yayındaki portföyler (action da aynı kuralı zorlar).
          .in("status", ["live", "Yayında"])
          .is("deleted_at", null)
      : Promise.resolve({ data: [] }),
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
  // URL sırası korunur (eşleşme listesinde skor sırası).
  const byId = new Map(((preProps ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p]));
  const properties: SelectableProperty[] = requestedIds.flatMap((id) => {
    const p = byId.get(id);
    if (!p) return [];
    const rel = p.district as { name?: string } | { name?: string }[] | null;
    return [
      {
        id: p.id as string,
        code: p.property_code as string,
        title: (p.title as string | null) ?? null,
        price: p.list_price != null ? Number(p.list_price) : null,
        tx: p.transaction_type as string,
        district: (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? null,
      },
    ];
  });
  const preselectedIds = properties.slice(0, PRESENTATION_MAX_PROPERTIES).map((p) => p.id);
  const notLive = requestedIds.length - properties.length;
  const overLimit = Math.max(0, properties.length - PRESENTATION_MAX_PROPERTIES);
  const prefillNotice =
    notLive > 0 || overLimit > 0
      ? [
          notLive > 0 ? `${notLive} portföy yayında olmadığı için sunuma eklenemedi.` : null,
          overLimit > 0
            ? `Sunum en fazla ${PRESENTATION_MAX_PROPERTIES} portföy içerebilir; ilk ${PRESENTATION_MAX_PROPERTIES} portföy seçildi, ${overLimit} portföy listede seçilmemiş duruyor.`
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : null;

  return (
    <PresentationForm
      properties={properties}
      customers={customers}
      preselectedIds={preselectedIds}
      preselectedCustomerId={preselectedCustomerId}
      prefillNotice={prefillNotice}
    />
  );
}
