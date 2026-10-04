"use server";

import { createCustomer, type CustomerResult } from "@/app/actions/customers";
import { createCall, type CallResult } from "@/app/actions/calls";
import { createAppointment, type AppointmentResult } from "@/app/actions/appointments";
import { requirePermission } from "@/lib/require-permission";
import { createClient } from "@/lib/supabase/server";
import { parseTrLocalDateTime, toTrLocalInput } from "@/lib/clock";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { QUICK_INTENT_TYPES, type QuickIntent } from "./quick-intents";

/**
 * Hızlı kayıt sarmalayıcıları: doğrulama, yetki, otomasyon ve çakışma freni mevcut
 * server action'larda KALIR (createCustomer / createCall / createAppointment);
 * burada yalnız hızlı formun alanları o action'ların FormData sözleşmesine çevrilir.
 */

export async function quickCreateCustomer(formData: FormData): Promise<CustomerResult> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!fullName) return { error: "Ad soyad zorunlu." };
  if (!phone) return { error: "Telefon zorunlu." };

  const intent = String(formData.get("intent") ?? "") as QuickIntent;
  const type = QUICK_INTENT_TYPES[intent];
  const out = new FormData();
  out.set("full_name", fullName);
  out.set("phone", phone);
  if (type) out.set("type", type);
  out.set("notes", String(formData.get("notes") ?? ""));
  return createCustomer({}, out);
}

export async function quickLogCall(formData: FormData): Promise<CallResult> {
  const customerId = String(formData.get("customer_id") ?? "").trim();
  let phone = String(formData.get("phone") ?? "").trim();

  if (!customerId && !phone) return { error: "Müşteri seçin ya da telefon girin." };
  if (phone) {
    const parsed = parsePhoneStrict(phone);
    if (!parsed.ok) return { error: parsed.error ?? PHONE_ERROR_MESSAGE };
  } else {
    // Telefon girilmediyse seçilen müşterinin kayıtlı numarası kullanılır (RLS + müşteri görüntüleme izni).
    const gate = await requirePermission("customers", "view");
    if (!gate.ok) return { error: gate.error };
    const supabase = await createClient();
    const { data } = await supabase
      .from("customers")
      .select("phone")
      .eq("id", customerId)
      .is("deleted_at", null)
      .maybeSingle();
    phone = data?.phone ?? "";
    if (!phone) return { error: "Bu müşterinin kayıtlı telefonu yok. Telefon numarasını girin." };
  }

  const out = new FormData();
  out.set("customer_id", customerId);
  out.set("phone", phone);
  out.set("direction", String(formData.get("direction") ?? "outbound"));
  out.set("disposition", String(formData.get("disposition") ?? ""));
  out.set("notes", String(formData.get("notes") ?? ""));
  return createCall(out);
}

export async function quickCreateAppointment(formData: FormData): Promise<AppointmentResult> {
  const when = parseTrLocalDateTime(String(formData.get("when") ?? ""));
  if (!when) return { error: "Geçerli bir tarih ve saat girin." };
  const [date, time] = toTrLocalInput(when).split("T");

  const out = new FormData();
  out.set("customer_id", String(formData.get("customer_id") ?? ""));
  out.set("property_id", String(formData.get("property_id") ?? ""));
  out.set("appointment_type", String(formData.get("appointment_type") ?? ""));
  out.set("date", date);
  out.set("time", time);
  if (formData.get("confirm_conflict") === "1") out.set("confirm_conflict", "1");
  return createAppointment(out);
}
