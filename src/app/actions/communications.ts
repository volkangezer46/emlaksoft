"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

export type CommResult = { ok?: boolean; error?: string; id?: string };

// ---------------------------------------------------------------------------
// İletişim kaydı oluştur
// ---------------------------------------------------------------------------

export async function createCommunication(
  _prev: CommResult,
  fd: FormData,
): Promise<CommResult> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };

  const customerId  = String(fd.get("customer_id")  ?? "").trim() || null;
  const propertyId  = String(fd.get("property_id")  ?? "").trim() || null;
  const channel     = String(fd.get("channel")      ?? "note").trim();
  const direction   = String(fd.get("direction")    ?? "outbound").trim();
  const subject     = String(fd.get("subject")      ?? "").trim() || null;
  const body        = String(fd.get("body")         ?? "").trim() || null;
  const outcome     = String(fd.get("outcome")      ?? "").trim() || null;
  const durationSec = parseInt(String(fd.get("duration_sec") ?? "0")) || null;
  const scheduledAt = String(fd.get("scheduled_at") ?? "").trim() || null;

  if (!customerId && !propertyId) return { error: "Müşteri veya portföy bağlantısı gerekli." };
  if (!body && !subject)          return { error: "Mesaj içeriği veya konu boş olamaz." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communications")
    .insert({
      tenant_id:    gate.tenantId,
      customer_id:  customerId,
      property_id:  propertyId,
      created_by:   gate.userId,
      channel,
      direction,
      subject,
      body,
      outcome,
      duration_sec: durationSec,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "İletişim kaydı oluşturulamadı." };

  if (customerId) revalidatePath(`/app/musteriler/${customerId}`);
  if (propertyId) revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Müşterinin iletişim geçmişini getir
// ---------------------------------------------------------------------------

export async function listCustomerCommunications(customerId: string) {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("communications")
    .select("id, channel, direction, subject, body, outcome, duration_sec, scheduled_at, created_at, created_by:profiles(full_name)")
    .eq("customer_id", customerId)
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(100);

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Portföyün iletişim geçmişini getir
// ---------------------------------------------------------------------------

export async function listPropertyCommunications(propertyId: string) {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("communications")
    .select("id, channel, direction, subject, body, outcome, duration_sec, scheduled_at, created_at, created_by:profiles(full_name), customer:customers(full_name)")
    .eq("property_id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  return data ?? [];
}

// ---------------------------------------------------------------------------
// İletişim kaydı sil
// ---------------------------------------------------------------------------

export async function deleteCommunication(id: string, customerId?: string): Promise<CommResult> {
  const gate = await requirePermission("customers", "delete");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  await supabase
    .from("communications")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (customerId) revalidatePath(`/app/musteriler/${customerId}`);
  return { ok: true };
}
