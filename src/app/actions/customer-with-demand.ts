"use server";

import { requirePermission } from "@/lib/require-permission";
import {
  demandValuesFromFormData,
  hasDemandContent,
  isOwnerSideCustomerType,
  parseDemandValues,
} from "@/lib/demand-criteria";
import { createCustomer } from "@/app/actions/customers";
import { createDemand } from "@/app/actions/demands";

export type CustomerWithDemandResult = {
  error?: string;
  ok?: boolean;
  /** Oluşan müşteri (talep başarısız olsa da dolu olabilir). */
  id?: string;
  demandId?: string;
  /** Müşteri kaydedildi ama talep kaydedilemedi: kullanıcıya net uyarı + devam bağlantısı. */
  demandError?: string;
};

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

  const customer = await createCustomer({}, formData);
  if (!customer.ok || !customer.id) return { error: customer.error ?? "Müşteri eklenemedi." };
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
