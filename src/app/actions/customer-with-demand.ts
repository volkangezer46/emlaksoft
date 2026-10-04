"use server";

import { requirePermission } from "@/lib/require-permission";
import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { normalizeEmail } from "@/lib/email";
import {
  demandValuesFromFormData,
  hasDemandContent,
  isOwnerSideCustomerType,
  parseDemandValues,
} from "@/lib/demand-criteria";
import { createCustomer } from "@/app/actions/customers";
import { createDemand } from "@/app/actions/demands";
import { linkRecordToCustomer } from "@/app/actions/communications";
import { findCustomerDuplicates } from "@/lib/duplicate-finders";

export type CustomerWithDemandResult = {
  error?: string;
  ok?: boolean;
  /** Oluşan müşteri (talep başarısız olsa da dolu olabilir). */
  id?: string;
  demandId?: string;
  /** Müşteri kaydedildi ama talep kaydedilemedi: kullanıcıya net uyarı + devam bağlantısı. */
  demandError?: string;
};

/** Çift gönderim koruma penceresi. */
const DUPLICATE_SUBMIT_WINDOW_MS = 30_000;

async function findRecentDuplicateCustomer(formData: FormData): Promise<string | null> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return null; // asıl hata createCustomer'da döner
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const parsedPhone = phoneRaw ? parsePhoneStrict(phoneRaw) : null;
  const phone = parsedPhone && parsedPhone.ok ? parsedPhone.stored : "";
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!fullName) return null;

  const supabase = await createClient();
  let q = supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", gate.tenantId)
    .eq("created_by", gate.userId)
    .is("deleted_at", null)
    .gte("created_at", new Date(now() - DUPLICATE_SUBMIT_WINDOW_MS).toISOString())
    .limit(1);
  // Kimlik: telefon varsa telefon, yoksa e-posta, ikisi de yoksa ad (tam eşleşme).
  if (phone) q = q.eq("phone", phone);
  else if (email) q = q.eq("email", email);
  else q = q.eq("full_name", fullName);
  const { data } = await q;
  return data?.[0]?.id ?? null;
}

/**
 * Yeni müşteri + (varsa) talep — kullanıcı için tek işlem.
 *
 * Faz 1: atomik RPC yok (Faz 2'de `create_customer_with_demand`). İki ardışık insert:
 * 1. Talep, müşteri OLUŞMADAN önce doğrulanır (kullanıcı hatası yarım kayıt bırakmaz).
 * 2. Müşteri oluşur; sonra talep. Talep DB hatasıyla düşerse müşteri kalır ve sonuç
 *    `demandError` + `id` taşır — form müşteriyi tekrar kaydettirmez, talebe devam bağlantısı verir.
 * Mülk sahibi/satıcı türünde talep açılmaz; talep alanları gerçek kriter içermiyorsa talep açılmaz.
 */
export async function createCustomerWithDemand(
  _prev: CustomerWithDemandResult,
  formData: FormData,
): Promise<CustomerWithDemandResult> {
  const type = String(formData.get("type") ?? "").trim();
  const values = demandValuesFromFormData(formData);
  const wantsDemand = !isOwnerSideCustomerType(type) && hasDemandContent(values);

  if (wantsDemand) {
    const gate = await requirePermission("demands", "create");
    if (!gate.ok) return { error: `Talep kaydı için yetkiniz yok: ${gate.error}` };
    const parsed = parseDemandValues(values);
    if (!parsed.ok) return { error: parsed.error };
  }

  // B13: çift gönderim (çift tık / yeniden deneme) — aynı kullanıcının kısa pencerede aynı kimlikle
  // oluşturduğu müşteri varsa yenisi açılmaz, mevcut kayıt döndürülür (idempotent).
  const recent = await findRecentDuplicateCustomer(formData);
  if (recent) return { ok: true, id: recent };

  // Giriş anı mükerrer kontrolü: aynı telefon/e-posta ofiste varsa kasıtlı onay (allow_duplicate=1) olmadan kaydedilmez.
  if (String(formData.get("allow_duplicate") ?? "") !== "1") {
    const gate = await requirePermission("customers", "create");
    if (gate.ok) {
      const dups = await findCustomerDuplicates(
        await createClient(),
        {
          tenantId: gate.tenantId,
          phone: String(formData.get("phone") ?? ""),
          email: String(formData.get("email") ?? ""),
        },
        { userId: gate.userId, officeWide: false },
      );
      if (dups.length > 0) {
        return {
          error:
            "Bu telefon/e-posta ile ofiste kayıt var. Formdaki uyarıyı inceleyin; yine de yeni kayıt açmak için \"Yine de yeni kayıt\" seçin.",
        };
      }
    }
  }

  const customer = await createCustomer({}, formData);
  if (!customer.ok || !customer.id) return { error: customer.error ?? "Müşteri eklenemedi." };
  // Gelen kutusu / çağrı kaydından açıldıysa kaynak kayıt yeni müşteriye bağlanır (hata müşteri kaydını bozmaz).
  const linkRef = String(formData.get("link_ref") ?? "").trim();
  const linkMatch = /^([ac])-([0-9a-f-]{36})$/i.exec(linkRef);
  if (linkMatch) {
    await linkRecordToCustomer(linkMatch[1].toLowerCase() === "a" ? "call" : "comm", linkMatch[2], customer.id);
  }
  if (!wantsDemand) return { ok: true, id: customer.id };

  const demandForm = new FormData();
  demandForm.set("customer_id", customer.id);
  for (const [k, v] of Object.entries(values)) demandForm.set(k, v);
  const demand = await createDemand({}, demandForm);
  if (!demand.ok) {
    const reason = demand.error ?? "Talep kaydedilemedi.";
    return {
      id: customer.id,
      demandError: reason,
      error: `Müşteri kaydedildi ancak talep kaydedilemedi: ${reason}`,
    };
  }
  return { ok: true, id: customer.id, demandId: demand.id };
}
