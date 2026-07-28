"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { isAppointmentOutcome } from "@/lib/appointment-outcome";

export type AppointmentResult = {
  error?: string;
  ok?: boolean;
  /**
   * Aynı danışmanın aynı saat aralığında iptal edilmemiş randevusu var —
   * kayıt YAPILMADI. Form bu metni amber bantta gösterir ve gizli
   * `confirm_conflict` alanıyla yeniden gönderirse kayıt geçer.
   */
  conflictWarning?: string;
};

const TYPES = ["showing", "office", "valuation", "contract"];
const STATUSES = ["pending", "confirmed", "signature", "completed", "cancelled"];

type ConflictRow = {
  scheduled_at: string;
  duration_min: number | null;
  customer: { full_name?: string } | { full_name?: string }[] | null;
};

/**
 * Çakışma freni: aynı danışmanın (assigned_to) verilen saat aralığıyla örtüşen,
 * iptal edilmemiş randevusu var mı? Süresi girilmemiş randevular 60 dk varsayılır.
 * Bulursa Türkçe uyarı metni döner; kayıt engellenmez — kullanıcı ikinci
 * gönderimde (confirm_conflict) bilinçli olarak üst üste randevu alabilir.
 */
async function findConflictWarning(opts: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  tenantId: string;
  advisorId: string;
  scheduledAt: Date;
  durationMin: number | null;
  excludeId?: string;
}): Promise<string | null> {
  const { supabase, tenantId, advisorId, scheduledAt, durationMin, excludeId } = opts;
  // Gün penceresi: randevu süreleri saatlik ölçekte, ±1 gün fazlasıyla yeter.
  const dayStart = new Date(scheduledAt.getTime() - 86_400_000);
  const dayEnd = new Date(scheduledAt.getTime() + 86_400_000);

  let query = supabase
    .from("appointments")
    .select("id, scheduled_at, duration_min, customer:customers(full_name)")
    .eq("tenant_id", tenantId)
    .eq("assigned_to", advisorId)
    .neq("status", "cancelled")
    .gte("scheduled_at", dayStart.toISOString())
    .lt("scheduled_at", dayEnd.toISOString());
  if (excludeId) query = query.neq("id", excludeId);

  const { data } = await query;

  const newStart = scheduledAt.getTime();
  const newEnd = newStart + (durationMin ?? 60) * 60_000;
  const clash = ((data ?? []) as ConflictRow[]).find((a) => {
    const start = new Date(a.scheduled_at).getTime();
    const end = start + (a.duration_min ?? 60) * 60_000;
    return newStart < end && start < newEnd;
  });
  if (!clash) return null;

  const saat = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(clash.scheduled_at),
  );
  const clashCustomer = Array.isArray(clash.customer) ? clash.customer[0] : clash.customer;
  const kim = clashCustomer?.full_name ?? "başka bir randevu";
  return `Bu saatte ${kim} ile çakışıyor (${saat}). Kaydetmek için tekrar gönderin.`;
}

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

  const durationMin = Number.isFinite(durationValue) && durationValue > 0 ? Math.round(durationValue) : null;

  /*
   * Çakışma freni: aynı danışmanın örtüşen randevusu varsa ilk gönderimde
   * kayıt YAPILMAZ, conflictWarning döner (form amber bant gösterir).
   * Kullanıcı ısrar ederse form gizli confirm_conflict=1 ile yeniden
   * gönderir ve kayıt geçer (örn. bilinçli üst üste randevu).
   */
  const confirmConflict = String(formData.get("confirm_conflict") ?? "") === "1";
  if (!confirmConflict) {
    const warning = await findConflictWarning({
      supabase,
      tenantId: gate.tenantId,
      advisorId: gate.userId,
      scheduledAt,
      durationMin,
    });
    if (warning) return { conflictWarning: warning };
  }

  const { error } = await supabase.from("appointments").insert({
    tenant_id: gate.tenantId,
    customer_id: customerId || null,
    property_id: propertyId || null,
    appointment_type: appointmentType,
    scheduled_at: scheduledAt.toISOString(),
    duration_min: durationMin,
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

/**
 * Takvim aboneliği linkini yeniler — profiline yeni calendar_token yazar,
 * eski ICS linki anında ölür. Kullanıcı yalnız KENDİ token'ını yenileyebilir;
 * bu yüzden "view" izni yeter. profiles üzerinde self-update RLS'e
 * güvenmemek için service role ile, id filtresi gate.userId'ye sabit.
 */
export async function regenerateCalendarToken(): Promise<AppointmentResult> {
  const gate = await requirePermission("appointments", "view");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ calendar_token: randomUUID() })
    .eq("id", gate.userId);

  if (error) {
    console.error("regenerateCalendarToken", error);
    return { error: "Link yenilenemedi. Lütfen tekrar deneyin." };
  }

  revalidatePath("/app/randevular");
  return { ok: true };
}

/**
 * Randevu durumu güncelleme.
 *
 * "Tamamlandı" artık TEK YÖNLÜ değil: `status=confirmed` (ya da pending)
 * göndererek tamamlanan bir randevu geri alınabilir — yanlışlıkla tamamlanan
 * randevu kilitli kalmasın. Geri almada sonuç değerlendirmesi de temizlenir.
 *
 * Tamamlarken opsiyonel `outcome` (olumlu/kararsiz/olumsuz) + `outcome_note`
 * yazılır (migration 126). Bu alan eşleştirme geri bildirimiyle ilgisizdir.
 */
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

  if (status === "completed") {
    const outcomeRaw = String(formData.get("outcome") ?? "").trim();
    const noteRaw = String(formData.get("outcome_note") ?? "").trim();
    if (outcomeRaw) {
      if (!isAppointmentOutcome(outcomeRaw)) return { error: "Geçersiz randevu sonucu." };
      patch.outcome = outcomeRaw;
    }
    if (noteRaw) patch.outcome_note = noteRaw.slice(0, 500);
  } else {
    // Geri alma / iptal: değerlendirme artık geçerli değil, sıfırlanır.
    patch.outcome = null;
    patch.outcome_note = null;
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

/** Randevu erteleme / düzenleme — tarih, saat, tür, süre, yer, not. */
export async function updateAppointment(formData: FormData): Promise<AppointmentResult> {
  const gate = await requirePermission("appointments", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Randevu bulunamadı." };

  const appointmentType = String(formData.get("appointment_type") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const time = String(formData.get("time") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const durationValue = Number(String(formData.get("duration_min") ?? "").trim());

  if (!appointmentType || !TYPES.includes(appointmentType)) {
    return { error: "Geçerli bir randevu türü seçin." };
  }
  if (!date || !time) return { error: "Tarih ve saat zorunlu." };

  const scheduledAt = new Date(`${date}T${time}`);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { error: "Geçerli bir tarih/saat girin." };
  }

  const supabase = await createClient();

  // Çakışma freni (createAppointment ile aynı davranış): randevunun sahibi
  // danışman baz alınır; kaydın kendisi kontrol dışı tutulur.
  const confirmConflict = String(formData.get("confirm_conflict") ?? "") === "1";
  if (!confirmConflict) {
    const { data: current } = await supabase
      .from("appointments")
      .select("assigned_to, created_by")
      .eq("id", id)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    const advisorId = (current?.assigned_to as string | null) ?? (current?.created_by as string | null);
    if (advisorId) {
      const warning = await findConflictWarning({
        supabase,
        tenantId: gate.tenantId,
        advisorId,
        scheduledAt,
        durationMin: Number.isFinite(durationValue) && durationValue > 0 ? Math.round(durationValue) : null,
        excludeId: id,
      });
      if (warning) return { conflictWarning: warning };
    }
  }

  const { error } = await supabase
    .from("appointments")
    .update({
      appointment_type: appointmentType,
      scheduled_at: scheduledAt.toISOString(),
      duration_min: Number.isFinite(durationValue) && durationValue > 0 ? Math.round(durationValue) : null,
      location: location || null,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateAppointment", error);
    return { error: "Randevu güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "appointment.update",
    entityType: "appointment",
    entityId: id,
    newValue: { appointment_type: appointmentType, scheduled_at: scheduledAt.toISOString() },
  });

  revalidatePath("/app/randevular");
  revalidatePath("/app");
  return { ok: true };
}
