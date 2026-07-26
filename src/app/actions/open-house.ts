"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { normalizeTurkishPhone } from "@/lib/phone";

export type OpenHouseActionResult = { ok?: boolean; error?: string; id?: string };

const OPEN_HOUSE_STATUSES = ["planned", "active", "completed", "cancelled"] as const;

/** Açık ev etkinliğinin durumunu değiştirir (planned → active → completed / cancelled). */
export async function updateOpenHouseStatus(
  openHouseId: string,
  status: string,
): Promise<OpenHouseActionResult> {
  const gate = await requirePermission("appointments", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!(OPEN_HOUSE_STATUSES as readonly string[]).includes(status)) {
    return { error: "Geçersiz durum." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("open_houses")
    .update({ status })
    .eq("id", openHouseId)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: "Durum güncellenemedi." };

  revalidatePath("/app/acik-ev");
  revalidatePath(`/app/acik-ev/${openHouseId}`);
  return { ok: true };
}

/**
 * Açık ev ziyaretçisini müşteri kaydına dönüştürür.
 * Aynı telefon zaten kayıtlıysa yeni kayıt açmaz, mevcut müşteriye bağlar
 * (lead-intake'teki mükerrer önleme davranışıyla aynı).
 */
export async function convertVisitorToCustomer(
  visitorId: string,
  openHouseId: string,
): Promise<OpenHouseActionResult> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data: visitor } = await supabase
    .from("open_house_visitors")
    .select("id, full_name, phone, email, notes, created_customer_id")
    .eq("id", visitorId)
    .maybeSingle();
  if (!visitor) return { error: "Ziyaretçi bulunamadı." };
  if (visitor.created_customer_id) return { error: "Bu ziyaretçi zaten müşteriye dönüştürülmüş." };

  const phone = visitor.phone ? normalizeTurkishPhone(visitor.phone) : "";
  let customerId: string | null = null;

  if (phone) {
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", gate.tenantId)
      .eq("phone", phone)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    customerId = existing?.id ?? null;
  }

  if (!customerId) {
    const { data: created, error } = await supabase
      .from("customers")
      .insert({
        tenant_id: gate.tenantId,
        full_name: visitor.full_name,
        phone: phone || null,
        email: visitor.email || null,
        customer_types: ["Alıcı"],
        notes: visitor.notes ? `Açık ev notu: ${visitor.notes}` : null,
        lead_source: "open_house",
        assigned_to: gate.userId,
        created_by: gate.userId,
      })
      .select("id")
      .single();
    if (error || !created) {
      console.error("convertVisitorToCustomer", error);
      return { error: "Müşteri oluşturulamadı." };
    }
    customerId = created.id;

    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "customer.create",
      entityType: "customer",
      entityId: customerId,
      newValue: { full_name: visitor.full_name, source: "open_house" },
    });
  }

  const { error: linkError } = await supabase
    .from("open_house_visitors")
    .update({ created_customer_id: customerId })
    .eq("id", visitorId);
  if (linkError) return { error: "Müşteri oluşturuldu ama ziyaretçiye bağlanamadı." };

  revalidatePath(`/app/acik-ev/${openHouseId}`);
  revalidatePath("/app/musteriler");
  return { ok: true, id: customerId ?? undefined };
}
