import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { emitWebhook } from "@/lib/integrations-api/webhooks";
import { revalidateTenantData } from "@/lib/revalidate";
import { afterSafe } from "@/lib/after-safe";
import { logActivity } from "@/lib/activity";
import { dispatchAutomationEvent } from "@/lib/automation-engine";
import { triggerPlaybooks } from "@/lib/playbook-trigger";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { planLimitErrorMessage } from "@/lib/billing/plan-limit-error";
import { actionErrorMessage } from "@/lib/action-errors";
import { normalizeCustomerTypes } from "@/lib/customer-types";

/**
 * Müşteri kaydının ÇEKİRDEĞİ (SK7 / B033 + B092) — "use server" DEĞİL: istemciden çağrılamaz, yetki kapısını çağıran
 * eylem geçer. `createCustomer` (kapı + mükerrer kapısı + çekirdek) ve `createCustomerWithDemand` (kapıları paralel
 * koşup çekirdeği doğrudan çağırır; ikinci kez yetki turu yok) aynı doğrulama/insert/yan etki yolunu kullanır.
 */

export type CustomerFormValues = {
  fullName: string;
  phone: string;
  email: string;
  type: string;
  provinceId: string;
  districtId: string;
  branchId: string;
  notes: string;
  birthDate: string;
  anniversaryDate: string;
  anniversaryNote: string;
};

export type CustomerCreateResult = { error?: string; ok?: boolean; id?: string };

/** Boş ise geçerli; dolu ise ISO tarih (YYYY-MM-DD) formatını ve gerçek takvim gününü doğrular. */
function isValidOptionalDate(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Formu doğrular; telefon saklama biçimine (`parsePhoneStrict`), e-posta küçük harfe ('İ' dahil) iner. */
export function parseCustomerForm(formData: FormData): { ok: true; values: CustomerFormValues } | { ok: false; error: string } {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const fullName = get("full_name");
  const phoneRaw = get("phone");
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const birthDate = get("birth_date");
  const anniversaryDate = get("anniversary_date");

  if (!fullName) return { ok: false, error: "Ad soyad zorunlu." };
  const parsedPhone = phoneRaw ? parsePhoneStrict(phoneRaw) : null;
  if (parsedPhone && !parsedPhone.ok) return { ok: false, error: parsedPhone.error ?? PHONE_ERROR_MESSAGE };
  if (email && !isValidEmail(email)) return { ok: false, error: EMAIL_ERROR_MESSAGE };
  if (!isValidOptionalDate(birthDate)) return { ok: false, error: "Doğum tarihi geçersiz." };
  if (!isValidOptionalDate(anniversaryDate)) return { ok: false, error: "Yıldönümü tarihi geçersiz." };

  return {
    ok: true,
    values: {
      fullName,
      phone: parsedPhone?.stored ?? "",
      email,
      type: get("type"),
      provinceId: get("province_id"),
      districtId: get("district_id"),
      branchId: get("branch_id"),
      notes: get("notes"),
      birthDate,
      anniversaryDate,
      anniversaryNote: get("anniversary_note"),
    },
  };
}

/**
 * Doğrulanmış müşteriyi yazar (tek insert turu). Denetim, otomasyon, iş akışı ve webhook yanıt SONRASINA (`after`) kalır.
 * Oluşturan kişi kayda atanır (çağrı merkezi dahil; yeniden atama ayrı eylemdir).
 */
export async function insertCustomerRecord(
  supabase: SupabaseClient,
  ctx: { tenantId: string; userId: string },
  v: CustomerFormValues,
): Promise<CustomerCreateResult> {
  const { tenantId, userId } = ctx;
  const { data, error } = await supabase
    .from("customers")
    .insert({
      tenant_id: tenantId,
      full_name: v.fullName,
      phone: v.phone || null,
      email: v.email || null,
      customer_types: normalizeCustomerTypes([v.type]),
      province_id: v.provinceId || null,
      district_id: v.districtId || null,
      branch_id: v.branchId || null,
      notes: v.notes || null,
      birth_date: v.birthDate || null,
      anniversary_date: v.anniversaryDate || null,
      anniversary_note: v.anniversaryNote || null,
      assigned_to: userId,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createCustomer", error);
    return { error: planLimitErrorMessage(error) ?? actionErrorMessage(error, "Müşteri eklenemedi. Lütfen tekrar deneyin.") };
  }
  const id = String((data as { id: string }).id);

  afterSafe(() => logActivity({
    tenantId,
    actorId: userId,
    action: "customer.create",
    entityType: "customer",
    entityId: id,
    newValue: { full_name: v.fullName },
  }));

  // Otomasyon tetikle — hata ana işlemi asla bozmasın
  afterSafe(() =>
    Promise.resolve()
      .then(() => dispatchAutomationEvent(tenantId, "new_customer", {
        entityType: "customer",
        entityId: id,
        customerId: id,
        label: v.fullName,
        phone: v.phone || null,
        assignedTo: userId,
        // Koşul alanı "kaynak": panelden eklenen müşteri formdan/WhatsApp'tan geleninden ayrışsın (COM-14).
        fields: { source: "panel", channel: "panel" },
      }))
      .catch((e) => console.error("automation new_customer", e)),
  );

  // İş akışı (playbook) tetikle — çok adımlı görev paketi; hata ana işlemi bozmaz
  afterSafe(() => triggerPlaybooks({
    tenantId,
    event: "yeni_musteri",
    actorId: userId,
    entity: {
      type: "customer",
      id,
      label: v.fullName,
      ownerId: userId,
      customerId: id,
      fields: { customer_type: v.type || null },
    },
  }));

  emitWebhook("customer.created", "customer", id);
  revalidatePath("/app/musteriler");
  revalidateTenantData(tenantId);
  return { ok: true, id };
}
