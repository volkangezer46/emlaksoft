import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { trDayKey } from "@/lib/clock";
import { getDefinitions } from "@/lib/definitions";
import { DEFAULT_DEFINITIONS } from "@/lib/definition-defaults";
import { AppointmentForm } from "./appointment-form";

export const metadata = { title: "Yeni randevu" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams?: Promise<{ customer?: string; property?: string; tarih?: string; saat?: string }>;
}) {
  const gate = await requireModulePage("appointments");
  if (!(gate.perms.appointments ?? []).includes("create")) redirect("/app/randevular");

  const sp = (await searchParams) ?? {};
  const customerId = (sp.customer ?? "").trim();
  const propertyId = (sp.property ?? "").trim();
  const supabase = await createClient();

  const [{ data: customers }, { data: properties }, typeDefs, { data: pickedCustomer }, { data: pickedProperty }] =
    await Promise.all([
      supabase.from("customers").select("id, full_name").is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
      supabase.from("properties").select("id, title, property_code").is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
      getDefinitions("appointment_type"),
      customerId
        ? supabase.from("customers").select("id, full_name").eq("id", customerId).is("deleted_at", null).maybeSingle()
        : Promise.resolve({ data: null }),
      propertyId
        ? supabase.from("properties").select("id, title, property_code").eq("id", propertyId).is("deleted_at", null).maybeSingle()
        : Promise.resolve({ data: null }),
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

  // Takvimden gelen tarih/saat ön dolgusu (?tarih=YYYY-MM-DD&saat=HH:MM).
  const defaultDate = DATE_RE.test(sp.tarih ?? "") ? sp.tarih! : trDayKey();
  const defaultTime = TIME_RE.test(sp.saat ?? "") ? sp.saat! : "10:00";

  return (
    <AppointmentForm
      customers={customerOptions}
      properties={propertyOptions}
      typeOptions={typeOptions}
      defaultCustomerId={pickedCustomer?.id}
      defaultPropertyId={pickedProperty?.id}
      defaultDate={defaultDate}
      defaultTime={defaultTime}
      userId={gate.userId}
    />
  );
}
