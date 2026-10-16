import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now, trDayKey } from "@/lib/clock";
import { nextHalfHourOffice } from "@/lib/time/office-tz";
import { getDefinitions } from "@/lib/definitions";
import { DEFAULT_DEFINITIONS } from "@/lib/definition-defaults";
import { MANAGEMENT_TIER_ROLES, type TeamRole } from "@/lib/team/assignable-roles";
import { readPrefillContext, type PrefillSearchParams } from "@/lib/prefill-params";
import { AppointmentForm } from "./appointment-form";

export const metadata = { title: "Yeni randevu" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams?: Promise<PrefillSearchParams>;
}) {
  const gate = await requireModulePage("appointments");
  if (!(gate.perms.appointments ?? []).includes("create")) redirect("/app/randevular");

  const sp = (await searchParams) ?? {};
  // ?customer=&property=&deal=&demand= (eş adlar ?musteri=&portfoy=&anlasma=&talep= de geçerli). Anlaşma verilirse eksik
  // müşteri/portföy anlaşmadan, talep verilirse müşteri talepten tamamlanır. ?tur= (randevu türü) ön seçimi.
  const prefill = readPrefillContext(sp);
  const tarih = typeof sp.tarih === "string" ? sp.tarih : "";
  const saat = typeof sp.saat === "string" ? sp.saat : "";
  const tur = typeof sp.tur === "string" ? sp.tur : "";
  const supabase = await createClient();
  let customerId = prefill.customerId ?? "";
  let propertyId = prefill.propertyId ?? "";
  if (prefill.dealId && (!customerId || !propertyId)) {
    const { data: deal } = await supabase.from("deals").select("customer_id, property_id").eq("id", prefill.dealId).maybeSingle();
    customerId ||= (deal?.customer_id as string | null | undefined) ?? "";
    propertyId ||= (deal?.property_id as string | null | undefined) ?? "";
  }
  if (prefill.demandId && !customerId) {
    const { data: demand } = await supabase.from("demands").select("customer_id").eq("id", prefill.demandId).maybeSingle();
    customerId = (demand?.customer_id as string | null | undefined) ?? "";
  }

  // Danışman seçici yalnız yönetim katmanında (sunucu eylemi de aynı kuralı uygular).
  const canAssign = MANAGEMENT_TIER_ROLES.includes(gate.role as TeamRole);
  const [{ data: customers }, { data: properties }, typeDefs, { data: pickedCustomer }, { data: pickedProperty }, { data: advisorRows }] =
    await Promise.all([
      supabase.from("customers").select("id, full_name").is("deleted_at", null).order("created_at", { ascending: false }).limit(20),
      supabase.from("properties").select("id, title, property_code").is("deleted_at", null).order("created_at", { ascending: false }).limit(20),
      getDefinitions("appointment_type"),
      customerId
        ? supabase.from("customers").select("id, full_name").eq("id", customerId).is("deleted_at", null).maybeSingle()
        : Promise.resolve({ data: null }),
      propertyId
        ? supabase
            .from("properties")
            .select("id, title, property_code, address_line, assigned_to, district:geo_districts(name), province:geo_provinces(name)")
            .eq("id", propertyId)
            .is("deleted_at", null)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      canAssign
        ? supabase.from("profiles").select("id, full_name").eq("tenant_id", gate.tenantId).eq("is_active", true).order("full_name").limit(200)
        : Promise.resolve({ data: null as { id: string; full_name: string | null }[] | null }),
    ]);

  // Ön seçili kayıt "son 50" havuzu dışında kalsa da seçenekte bulunmalı.
  const customerOptions = (customers ?? []).map((c) => ({ id: c.id, label: c.full_name }));
  if (pickedCustomer && !customerOptions.some((c) => c.id === pickedCustomer.id)) {
    customerOptions.unshift({ id: pickedCustomer.id, label: pickedCustomer.full_name });
  }
  const propertyOptions = (properties ?? []).map((p) => ({ id: p.id, label: p.title || p.property_code }));
  if (pickedProperty && !propertyOptions.some((p) => p.id === pickedProperty.id)) {
    propertyOptions.unshift({ id: pickedProperty.id, label: pickedProperty.title || pickedProperty.property_code });
  }

  const typeOptions =
    typeDefs.length > 0
      ? typeDefs.map((t) => ({ value: t.value, label: t.label }))
      : [...DEFAULT_DEFINITIONS.appointment_type];
  // Tür: ?tur= geçerliyse o; yoksa yer gösterme (en sık iş); ofis listesinde yoksa ilk tür.
  const defaultType = typeOptions.some((o) => o.value === tur)
    ? tur
    : (typeOptions.find((o) => o.value === "showing")?.value ?? typeOptions[0]?.value ?? "showing");

  // Portföy bağlamı: adres konuma, portföyün sorumlu danışmanı (yönetim katmanında ve ekipte aktifse) danışmana önerilir.
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const pp = pickedProperty as
    | { address_line?: string | null; assigned_to?: string | null; district?: unknown; province?: unknown }
    | null;
  const area = [one(pp?.district as { name: string | null } | null)?.name, one(pp?.province as { name: string | null } | null)?.name]
    .filter(Boolean)
    .join(", ");
  const defaultLocation = pp ? [pp.address_line?.trim(), area].filter(Boolean).join(", ").slice(0, 300) : "";
  const propertyAdvisor = pp?.assigned_to ?? null;
  const defaultAdvisorId =
    canAssign && propertyAdvisor && (advisorRows ?? []).some((a) => a.id === propertyAdvisor) ? propertyAdvisor : gate.userId;

  // Takvimden gelen tarih/saat ön dolgusu (?tarih=YYYY-MM-DD&saat=HH:MM). Saat verilmediyse bugün için
  // şimdiden sonraki ilk yarım saat (gece yarısını geçerse yarın), ileri bir gün için 10:00 — varsayılan geçmişte olmaz.
  const today = trDayKey();
  const askedDate = DATE_RE.test(tarih) ? tarih : null;
  const askedTime = TIME_RE.test(saat) ? saat : null;
  const soon = nextHalfHourOffice(now());
  const [defaultDate, defaultTime] = askedTime
    ? [askedDate ?? today, askedTime]
    : askedDate && askedDate !== today
      ? [askedDate, "10:00"]
      : [soon.date, soon.time];

  return (
    <AppointmentForm
      customers={customerOptions}
      properties={propertyOptions}
      typeOptions={typeOptions}
      defaultCustomerId={pickedCustomer?.id}
      defaultPropertyId={pickedProperty?.id}
      defaultDate={defaultDate}
      defaultTime={defaultTime}
      defaultType={defaultType}
      defaultLocation={defaultLocation}
      defaultAdvisorId={defaultAdvisorId}
      todayKey={today}
      userId={gate.userId}
      advisors={canAssign ? (advisorRows ?? []).map((a) => ({ id: a.id, label: a.full_name ?? "İsimsiz" })) : undefined}
    />
  );
}
