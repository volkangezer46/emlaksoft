"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { afterSafe } from "@/lib/after-safe";
import { actionErrorMessage } from "@/lib/action-errors";
import { revalidateTenantData } from "@/lib/revalidate";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { isContactLabel, isMissingRelationError, MAX_EXTRA_CONTACTS, type ContactLabel } from "@/lib/customer-contacts";

export type CustomerContactResult = { ok?: boolean; error?: string; id?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING = "Ek iletişim bilgisi için veritabanı güncellemesi henüz uygulanmamış.";

function done(tenantId: string, customerId: string) {
  revalidatePath(`/app/musteriler/${customerId}`);
  revalidatePath("/app/musteriler");
  revalidateTenantData(tenantId);
}

/**
 * Ek telefon / e-posta / WhatsApp numarası ekler (CRM-G7). `customers:edit` kapısı; telefon `parsePhoneStrict` ile
 * saklama biçimine (TR 05XXXXXXXXX, yabancı +E.164) çevrilir; e-posta küçük harf. Birincil değerle ya da mevcut ek
 * değerle aynıysa reddedilir. Müşteri başına en fazla `MAX_EXTRA_CONTACTS` kayıt.
 */
export async function addCustomerContact(_prev: CustomerContactResult, formData: FormData): Promise<CustomerContactResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const customerId = String(formData.get("customer_id") ?? "").trim();
  const kind = String(formData.get("kind") ?? "phone") === "email" ? "email" : "phone";
  const rawLabel = String(formData.get("label") ?? "").trim();
  const label: ContactLabel = isContactLabel(rawLabel) ? rawLabel : kind === "email" ? "diger" : "cep";
  if (!UUID_RE.test(customerId)) return { error: "Müşteri bulunamadı." };

  let value: string;
  if (kind === "phone") {
    const raw = String(formData.get("phone") ?? "").trim();
    if (!raw) return { error: "Telefon numarası girin." };
    const parsed = parsePhoneStrict(raw);
    if (!parsed.ok) return { error: parsed.error ?? PHONE_ERROR_MESSAGE };
    value = parsed.stored;
  } else {
    const email = normalizeEmail(String(formData.get("email") ?? ""));
    if (!email) return { error: "E-posta adresi girin." };
    if (!isValidEmail(email)) return { error: EMAIL_ERROR_MESSAGE };
    value = email;
  }

  const supabase = await createClient();
  const [{ data: customer }, existingRes] = await Promise.all([
    supabase.from("customers").select("id, phone, email").eq("id", customerId).eq("tenant_id", gate.tenantId).is("deleted_at", null).maybeSingle(),
    supabase.from("customer_contacts").select("id, kind, value").eq("customer_id", customerId),
  ]);
  if (!customer) return { error: "Müşteri bulunamadı." };
  if (existingRes.error) {
    if (isMissingRelationError(existingRes.error)) return { error: PENDING };
    return { error: actionErrorMessage(existingRes.error, "İletişim bilgileri okunamadı.") };
  }
  const existing = (existingRes.data ?? []) as { id: string; kind: string; value: string }[];
  const primary = kind === "phone" ? (customer.phone ?? "") : (customer.email ?? "").toLowerCase();
  if (primary && primary === value) return { error: kind === "phone" ? "Bu numara zaten birincil telefon." : "Bu adres zaten birincil e-posta." };
  if (existing.some((c) => c.kind === kind && c.value === value)) return { error: "Bu bilgi zaten kayıtlı." };
  if (existing.length >= MAX_EXTRA_CONTACTS) return { error: `En fazla ${MAX_EXTRA_CONTACTS} ek iletişim bilgisi eklenebilir.` };

  // Birincil boşsa yeni değer doğrudan birincil olur (ek kayıt açılmaz): arama/kampanya/İYS birincile bakar.
  if (!primary) {
    const { error } = await supabase
      .from("customers")
      .update(kind === "phone" ? { phone: value } : { email: value })
      .eq("id", customerId)
      .eq("tenant_id", gate.tenantId);
    if (error) return { error: actionErrorMessage(error, "Kaydedilemedi.") };
    done(gate.tenantId, customerId);
    return { ok: true };
  }

  const { data, error } = await supabase
    .from("customer_contacts")
    .insert({ tenant_id: gate.tenantId, customer_id: customerId, kind, value, label, created_by: gate.userId })
    .select("id")
    .single();
  if (error || !data) {
    if (isMissingRelationError(error)) return { error: PENDING };
    if (error?.code === "23505") return { error: "Bu bilgi zaten kayıtlı." };
    console.error("addCustomerContact", { code: error?.code });
    return { error: actionErrorMessage(error, "Kaydedilemedi.") };
  }
  afterSafe(() => logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.contact_add",
    entityType: "customer",
    entityId: customerId,
    newValue: { kind, label },
  }));
  done(gate.tenantId, customerId);
  return { ok: true, id: data.id };
}

/** Ek iletişim bilgisini siler (`customers:edit`; RLS müşterinin görünür olmasını da şart koşar). */
export async function deleteCustomerContact(contactId: string): Promise<CustomerContactResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(contactId ?? ""))) return { error: "Kayıt bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_contacts")
    .delete()
    .eq("id", contactId)
    .eq("tenant_id", gate.tenantId)
    .select("customer_id, kind")
    .maybeSingle();
  if (error) return { error: isMissingRelationError(error) ? PENDING : actionErrorMessage(error, "Silinemedi.") };
  if (!data) return { error: "Kayıt bulunamadı." };
  afterSafe(() => logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.contact_remove",
    entityType: "customer",
    entityId: data.customer_id as string,
    oldValue: { kind: data.kind },
  }));
  done(gate.tenantId, data.customer_id as string);
  return { ok: true };
}

/**
 * Ek değeri birincil yapar: `customers.phone/email` ile yer değiştirir (tek transaction, RLS geçerli;
 * `customer_contact_make_primary`). Eski birincil ek kayıt olarak kalır — bilgi kaybolmaz.
 */
export async function makeCustomerContactPrimary(contactId: string): Promise<CustomerContactResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(contactId ?? ""))) return { error: "Kayıt bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("customer_contact_make_primary", { p_contact_id: contactId });
  if (error) {
    if (isMissingRelationError(error) || error.code === "PGRST202") return { error: PENDING };
    if (error.code === "23505") return { error: "Eski birincil değer zaten ek kayıtlarda var; önce onu silin." };
    console.error("makeCustomerContactPrimary", { code: error.code });
    return { error: actionErrorMessage(error, "Birincil yapılamadı.") };
  }
  const customerId = (data as { customer_id?: string } | null)?.customer_id;
  if (customerId) {
    afterSafe(() => logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "customer.contact_primary",
      entityType: "customer",
      entityId: customerId,
      newValue: { kind: (data as { kind?: string }).kind ?? null },
    }));
    done(gate.tenantId, customerId);
  }
  return { ok: true };
}
