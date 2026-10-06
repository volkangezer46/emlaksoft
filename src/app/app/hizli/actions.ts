"use server";

import { createCustomer, type CustomerResult } from "@/app/actions/customers";
import { createCall, type CallResult } from "@/app/actions/calls";
import { createAppointment, type AppointmentResult } from "@/app/actions/appointments";
import { createProperty, type PropertyResult } from "@/app/actions/properties";
import { getSetting } from "@/lib/settings/read";
import { DEFAULT_COMMISSION_RATE } from "@/lib/commission";
import { requirePermission } from "@/lib/require-permission";
import { createClient } from "@/lib/supabase/server";
import { parseTrLocalDateTime, toTrLocalInput } from "@/lib/clock";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { QUICK_INTENT_TYPES, buildQuickPropertyTitle, type QuickIntent } from "./quick-intents";

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

/**
 * Sahadan hızlı portföy: tür, işlem, fiyat, oda, m², konum (isteğe bağlı) → TASLAK portföy (createProperty zaten `draft`
 * açar; mükerrer freni, havuz yönlendirmesi, fiyat sağlığı, eşleşme bildirimi orada). Başlık otomatik, komisyon oranı ofis
 * varsayılanı (`office.commission.default_rate`); ikisi de tam formda değiştirilir. Fotoğraf, dönen kimlikle aynı ekranda
 * mevcut medya yükleyicisiyle (filigran + küçültme + belge türü) eklenir.
 */
export async function quickCreateProperty(formData: FormData): Promise<PropertyResult> {
  const gate = await requirePermission("properties", "create");
  if (!gate.ok) return { error: gate.error };
  const transactionType = String(formData.get("transaction_type") ?? "").trim();
  const propertyType = String(formData.get("property_type") ?? "").trim();
  if (!transactionType || !propertyType) return { error: "İşlem ve portföy türü seçin." };
  const rooms = String(formData.get("rooms") ?? "").trim().slice(0, 20);
  const sqmRaw = String(formData.get("sqm") ?? "").trim().replace(",", ".");
  const sqm = sqmRaw ? Number(sqmRaw) : null;
  if (sqm !== null && (!Number.isFinite(sqm) || sqm <= 0 || sqm > 1_000_000)) return { error: "Geçerli bir m² girin." };

  const rate = Number(await getSetting<number>("office.commission.default_rate", { tenantId: gate.tenantId }).catch(() => DEFAULT_COMMISSION_RATE));
  const out = new FormData();
  out.set("title", buildQuickPropertyTitle({ rooms, propertyType, transactionType, sqm }));
  out.set("transaction_type", transactionType);
  out.set("property_type", propertyType);
  out.set("list_price", String(formData.get("list_price") ?? ""));
  out.set("commission_rate", String(Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_COMMISSION_RATE));
  out.set("rooms", rooms);
  if (sqm !== null) out.set("sqm", String(sqm));
  for (const k of ["lat", "lng", "address_line"]) out.set(k, String(formData.get(k) ?? "").slice(0, 200));
  if (formData.get("allow_duplicate") === "1") out.set("allow_duplicate", "1");
  return createProperty(out);
}
