"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";

export type AppointmentResult = { error?: string; ok?: boolean };

const TYPES = ["showing", "office", "valuation", "contract"];
const STATUSES = ["pending", "confirmed", "signature", "completed", "cancelled"];

export async function createAppointment(formData: FormData): Promise<AppointmentResult> {
  const gate = await requirePermission("appointments", "create");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const propertyId = String(formData.get("property_id") ?? "").trim();
  const appointmentType = String(formData.get("appointment_type") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const time = String(formData.get("time") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const durationValue = Number(String(formData.get("duration_min") ?? "").trim());

  if (!appointmentType || !TYPES.includes(appointmentType)) {
    return { error: "Geçerli bir randevu türü seçin." };
  }
  if (!date || !time) {
    return { error: "Tarih ve saat zorunlu." };
  }

  const scheduledAt = new Date(`${date}T${time}`);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { error: "Geçerli bir tarih/saat girin." };
  }

  const { error } = await supabase.from("appointments").insert({
    tenant_id: gate.tenantId,
    customer_id: customerId || null,
    property_id: propertyId || null,
    appointment_type: appointmentType,
    scheduled_at: scheduledAt.toISOString(),
    duration_min: Number.isFinite(durationValue) && durationValue > 0 ? Math.round(durationValue) : null,
    location: location || null,
    notes: notes || null,
    status: "pending",
    assigned_to: gate.userId,
    created_by: gate.userId,
  });

  if (error) {
    console.error("createAppointment", error);
    return { error: "Randevu oluşturulamadı. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "appointment.create",
    entityType: "appointment",
    newValue: { appointment_type: appointmentType, scheduled_at: scheduledAt.toISOString() },
  });

  revalidatePath("/app/randevular");
  revalidatePath("/app");
  return { ok: true };
}

export async function updateAppointmentStatus(formData: FormData): Promise<AppointmentResult> {
  const gate = await requirePermission("appointments", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id || !STATUSES.includes(status)) return { error: "Geçersiz durum." };

  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "signature" || status === "completed") {
    patch.signed_at = new Date().toISOString();
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("appointments")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("updateAppointmentStatus", error);
    return { error: "Durum güncellenemedi." };
  }

  revalidatePath("/app/randevular");
  return { ok: true };
}

export async function setAppointmentStatus(formData: FormData): Promise<void> {
  await updateAppointmentStatus(formData);
}
