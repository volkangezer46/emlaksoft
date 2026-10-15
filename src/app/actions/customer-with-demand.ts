"use server";

import { requirePermission } from "@/lib/require-permission";
import { createClient } from "@/lib/supabase/server";
import { afterSafe } from "@/lib/after-safe";
import {
  demandValuesFromFormData,
  hasDemandContent,
  isOwnerSideCustomerType,
  parseDemandValues,
} from "@/lib/demand-criteria";
import { createDemand } from "@/app/actions/demands";
import { linkRecordToCustomer } from "@/app/actions/communications";
import { assertCustomerNotDuplicate, CUSTOMER_DUPLICATE_ERROR, type DuplicateGate } from "@/lib/duplicate-finders";
import { actionErrorMessage } from "@/lib/action-errors";
import { prepareCustomFieldInputs, writeCustomFieldInputs } from "@/lib/custom-fields/save";
import { insertCustomerRecord, parseCustomerForm } from "@/lib/customer-create";
import { onceByRequest, readRequestId, supabaseSubmissionStore } from "@/lib/field-capture/submission-guard";

export type CustomerWithDemandResult = {
  error?: string;
  ok?: boolean;
  /** Oluşan müşteri (talep başarısız olsa da dolu olabilir). */
  id?: string;
  demandId?: string;
  /** Müşteri kaydedildi ama talep kaydedilemedi: kullanıcıya net uyarı + devam bağlantısı. */
  demandError?: string;
  /** Aynı telefon/e-posta ofiste kayıtlı: form uyarıyı gösterir, "Yine de yeni kayıt" ile allow_duplicate=1 gönderilir. */
  duplicate?: boolean;
};

type Prepared = {
  dup: DuplicateGate;
  customFields: Awaited<ReturnType<typeof prepareCustomFieldInputs>>;
};

/**
 * Yeni müşteri + (varsa) talep — kullanıcı için tek işlem.
 *
 * Çift gönderim (B091): form her açılışta yeni bir `client_request_id` taşır; `onceByRequest` (client_submissions) aynı
 * istek kimliğiyle ikinci kaydı AÇMAZ, ilk kaydın kimliğini döndürür. Eski "30 sn içinde aynı telefon" sezgisi kaldırıldı:
 * farklı kişi aynı numarayla bilerek ("Yine de yeni kayıt") kaydedilebilir ve özel alan / link_ref / webhook atlanmaz.
 *
 * Hız (B033) — sıralı DB turları: (1) yetki kapıları paralel → (2) fren kaydı ∥ mükerrer kapısı ∥ özel alan hazırlığı →
 * (3) müşteri insert → [(4) özel alan yazımı ∥ kaynak kayıt bağı ∥ talep — yalnız varsa]. Fren kapanışı, denetim,
 * otomasyon ve webhook yanıt sonrasına (`after`) kalır.
 *
 * Faz 1: atomik RPC yok. Talep, müşteri OLUŞMADAN önce doğrulanır (kullanıcı hatası yarım kayıt bırakmaz). Talep DB
 * hatasıyla düşerse müşteri kalır ve sonuç `demandError` + `id` taşır. Mülk sahibi/satıcı türünde talep açılmaz.
 */
export async function createCustomerWithDemand(
  _prev: CustomerWithDemandResult,
  formData: FormData,
): Promise<CustomerWithDemandResult> {
  const type = String(formData.get("type") ?? "").trim();
  const values = demandValuesFromFormData(formData);
  const wantsDemand = !isOwnerSideCustomerType(type) && hasDemandContent(values);

  // Ağ turu olmadan doğrulama (hata erken döner).
  const parsed = parseCustomerForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  if (wantsDemand) {
    const demandParsed = parseDemandValues(values);
    if (!demandParsed.ok) return { error: demandParsed.error };
  }

  // (1) Yetki kapıları tek turda.
  const [gate, demandGate] = await Promise.all([
    requirePermission("customers", "create"),
    wantsDemand ? requirePermission("demands", "create") : Promise.resolve(null),
  ]);
  if (!gate.ok) return { error: gate.error };
  if (demandGate && !demandGate.ok) return { error: `Talep kaydı için yetkiniz yok: ${demandGate.error}` };

  const supabase = await createClient();
  const ctx = { tenantId: gate.tenantId, userId: gate.userId };
  const allowDuplicate = String(formData.get("allow_duplicate") ?? "") === "1";

  // (2) Fren kaydıyla AYNI turda: mükerrer kapısı + özel alanların kayıttan ÖNCE doğrulanması. Telefon burada
  // parseCustomerForm'un parsePhoneStrict ile ürettiği saklama biçimidir (ham telefon DB'ye/sorguya gitmez).
  const prepare = async (): Promise<Prepared> => {
    const [dup, customFields] = await Promise.all([
      assertCustomerNotDuplicate(supabase, ctx, { phone: parsed.values.phone, email: parsed.values.email }, allowDuplicate),
      prepareCustomFieldInputs(supabase, gate.tenantId, "customer", formData),
    ]);
    return { dup, customFields };
  };

  const result = await onceByRequest<CustomerWithDemandResult, Prepared>(
    supabaseSubmissionStore(supabase),
    ctx,
    "customer",
    readRequestId(formData),
    async ({ dup, customFields }) => {
      // Giriş anı mükerrer kapısı (B092): aynı telefon/e-posta ofiste varsa kasıtlı onay olmadan kaydedilmez.
      if (dup.duplicate) return { error: CUSTOMER_DUPLICATE_ERROR, duplicate: true };
      if (!customFields.ok) return { error: customFields.error };

      // (3) Müşteri.
      const customer = await insertCustomerRecord(supabase, ctx, parsed.values);
      if (!customer.ok || !customer.id) return { error: customer.error ?? actionErrorMessage(null, "Müşteri eklenemedi.") };
      const customerId = customer.id;

      // (4) Bağımlı yazımlar paralel: özel alanlar, gelen kutusu/çağrı bağı (hata müşteri kaydını bozmaz), talep.
      const linkMatch = /^([ac])-([0-9a-f-]{36})$/i.exec(String(formData.get("link_ref") ?? "").trim());
      const demandForm = new FormData();
      if (wantsDemand) {
        demandForm.set("customer_id", customerId);
        for (const [k, v] of Object.entries(values)) demandForm.set(k, v);
        // Yeni müşterinin açık talebi olamaz: benzer talep denetimi boşa tur yapmasın.
        demandForm.set("allow_duplicate", "1");
      }
      const [, , demand] = await Promise.all([
        customFields.value.rows.length > 0
          ? writeCustomFieldInputs(supabase, { ...ctx, recordId: customerId }, customFields.value)
          : Promise.resolve(true),
        linkMatch
          ? linkRecordToCustomer(linkMatch[1].toLowerCase() === "a" ? "call" : "comm", linkMatch[2], customerId).catch((e) => {
              console.error("createCustomerWithDemand link", e instanceof Error ? e.message : "bilinmeyen hata");
              return null;
            })
          : Promise.resolve(null),
        wantsDemand ? createDemand({}, demandForm) : Promise.resolve(null),
      ]);
      if (!demand) return { ok: true, id: customerId };
      if (!demand.ok) {
        const reason = demand.error ?? actionErrorMessage(null, "Talep kaydedilemedi.");
        return {
          id: customerId,
          demandError: reason,
          error: `Müşteri kaydedildi ancak talep kaydedilemedi: ${reason}`,
        };
      }
      return { ok: true, id: customerId, demandId: demand.id };
    },
    { prepare, defer: (task) => afterSafe(task, "client_submissions kapanışı") },
  );
  return result as CustomerWithDemandResult;
}
