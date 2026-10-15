"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { isAppointmentOutcome } from "@/lib/appointment-outcome";
import { appointmentTypeLabel } from "@/lib/appointment-labels";
import { idsDigest, notifyAssignment } from "@/lib/assignment-notify";
import { afterSafe } from "@/lib/after-safe";
import { formatDateTr } from "@/lib/format";
import { formatTrTime, trDayKey } from "@/lib/clock";
import { validateTenantReferences } from "@/lib/tenant-references";
import { advisorAssignmentDecision, canAssignOthers } from "@/lib/workflow-rules";
import {
  isAppointmentStatus,
  isAppointmentTransitionAllowed,
  UNCLOSED_APPOINTMENT_STATUSES,
} from "@/lib/workflow-state";
import { actionErrorMessage } from "@/lib/action-errors";
import { formatOfficeTime, officeDayWindow } from "@/lib/time/office-tz";
import { missingFieldsError } from "@/lib/form-rules";
import { appointmentMissing } from "@/app/app/randevular/yeni/appointment-tabs";
import { sendAppointmentConfirmation, type ConfirmSendOutcome } from "@/lib/appointment-customer-messages";
import { getBaseUrl } from "@/lib/base-url";
import { now } from "@/lib/clock";
import {
  followUpDueIso,
  followUpTaskMarker,
  followUpTaskNotes,
  followUpTaskTitle,
} from "@/lib/appointment-follow-up";

export type AppointmentResult = {
  error?: string;
  ok?: boolean;
  /**
   * Aynı danışmanın aynı saat aralığında iptal edilmemiş randevusu var —
   * kayıt YAPILMADI. Form bu metni amber bantta gösterir ve gizli
   * `confirm_conflict` alanıyla yeniden gönderirse kayıt geçer.
   */
  conflictWarning?: string;
  /**
   * Yeni randevuda müşteriye teyit iletisinin sonucu (YD3): `sms_sent` gönderildi; `no_channel` ayar açık ama SMS
   * hesabı yok (danışman satırdaki "WhatsApp'ta teyit gönder" ile iletir); diğerleri bilgi amaçlı.
   */
  customerMessage?: ConfirmSendOutcome;
  /**
   * Tamamlanan randevunun takip zinciri: kararsız sonuçta danışmana açılan takip görevi
   * (`created` yeni açıldı, `exists` aynı randevu için zaten vardı, `skipped` müşteri yok / hata).
   */
  followUpTask?: "created" | "exists" | "skipped";
};

const TYPES = ["showing", "office", "valuation", "contract"];

/**
 * İstenen danışmanı çözer. Boşsa varsayılan döner; başkasıysa yalnız yönetim katmanı
 * atayabilir ve hedef aynı ofisin aktif üyesi olmalıdır.
 */
async function resolveAdvisor(
  gate: { tenantId: string; userId: string; role: string },
  requested: string,
  fallback: string,
): Promise<{ ok: true; advisorId: string } | { ok: false; error: string }> {
  const decision = advisorAssignmentDecision(gate.role, requested, fallback);
  if (decision.kind === "self") return { ok: true, advisorId: decision.advisorId };
  if (decision.kind === "denied") {
    return { ok: false, error: "Başka bir danışman adına randevu atama yetkiniz yok." };
  }
  const ref = await validateTenantReferences(gate.tenantId, { profileId: requested });
  if (!ref.ok) return { ok: false, error: ref.error };
  return { ok: true, advisorId: requested };
}

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
  // Gün penceresi ofis gününe göre (UTC değil): önceki günden uzayan / ertesi güne taşan randevular için ±1 gün pay.
  const { start: dayStart, end: dayEnd } = officeDayWindow(scheduledAt, 1);

  let query = supabase
    .from("appointments")
    .select("id, scheduled_at, duration_min, customer:customers!appointments_customer_id_fkey(full_name)")
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

  // Ofis saati: sunucu UTC'de çalışır; saat dilimi verilmezse 10:00 randevu uyarıda "07:00" görünürdü.
  const saat = formatOfficeTime(clash.scheduled_at);
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
  // Boş randevu açılmaz: yer göstermede müşteri + portföy, diğer türlerde en az biri (istemciyle aynı kural).
  const missing = appointmentMissing({ appointment_type: appointmentType, customer_id: customerId, property_id: propertyId });
  if (missing.length > 0) return { error: missingFieldsError(missing) };
  const advisor = await resolveAdvisor(gate, String(formData.get("assigned_to") ?? "").trim(), gate.userId);
  if (!advisor.ok) return { error: advisor.error };

  const scheduledAt = new Date(`${date}T${time}+03:00`);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { error: "Geçerli bir tarih/saat girin." };
  }

  const durationMin = Number.isFinite(durationValue) && durationValue > 0 ? Math.round(durationValue) : null;
  if (durationMin != null && (durationMin < 5 || durationMin > 1440)) {
    return { error: "Randevu süresi 5-1440 dakika arasında olmalı." };
  }

  const references = await validateTenantReferences(gate.tenantId, {
    customerId: customerId || null,
    propertyId: propertyId || null,
  });
  if (!references.ok) return { error: references.error };

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
      advisorId: advisor.advisorId,
      scheduledAt,
      durationMin,
    });
    if (warning) return { conflictWarning: warning };
  }

  const { data: created, error } = await supabase
    .from("appointments")
    .insert({
      tenant_id: gate.tenantId,
      customer_id: customerId || null,
      property_id: propertyId || null,
      appointment_type: appointmentType,
      scheduled_at: scheduledAt.toISOString(),
      duration_min: durationMin,
      location: location || null,
      notes: notes || null,
      status: "pending",
      assigned_to: advisor.advisorId,
      created_by: gate.userId,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("createAppointment", error);
    return { error: actionErrorMessage(error, "Randevu oluşturulamadı. Lütfen tekrar deneyin.") };
  }

  // Başkası adına açılan randevu: atanan danışmana bildirim (tercih "Randevu", tek seferlik anahtar).
  if (advisor.advisorId && advisor.advisorId !== gate.userId) {
    const { data: creator } = await supabase.from("profiles").select("full_name").eq("id", gate.userId).maybeSingle();
    const when = `${formatDateTr(scheduledAt.toISOString(), { day: "numeric", month: "long" })} ${formatTrTime(scheduledAt)}`;
    await notifyAssignment({
      tenantId: gate.tenantId,
      userId: advisor.advisorId,
      title: `Adınıza randevu açıldı: ${when} · ${appointmentTypeLabel(appointmentType)}`,
      body: `${(creator?.full_name as string | undefined) ?? "Bir ekip arkadaşınız"} sizin adınıza randevu oluşturdu${location ? ` (${location.slice(0, 80)})` : ""}.`,
      href: created?.id ? `/app/randevular?randevu=${created.id}` : "/app/randevular",
      dedupeKey: `appt-assigned:${created?.id ?? `${advisor.advisorId}:${scheduledAt.toISOString()}`}`,
      prefKey: "appointment",
    });
  }

  // Müşteriye teyit SMS'i (işlem amaçlı; ofis ayarı açık + SMS hesabı + cep numarası). Hata kaydı geri almaz.
  const customerMessage: ConfirmSendOutcome =
    created?.id && customerId
      ? await sendAppointmentConfirmation(supabase, { tenantId: gate.tenantId, appointmentId: String(created.id), appUrl: getBaseUrl() })
      : "off";

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "appointment.create",
    entityType: "appointment",
    newValue: { appointment_type: appointmentType, scheduled_at: scheduledAt.toISOString(), customer_message: customerMessage },
  });

  revalidatePath("/app/randevular");
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
  return { ok: true, customerMessage };
}

/**
 * Takvim aboneliği linkini yeniler — yeni token üretir (ilk kez
 * ise oluşturur), eski ICS linki anında ölür. Kullanıcı yalnız KENDİ token'ını yenileyebilir;
 * bu yüzden "view" izni yeter. Yazma `rotate_my_calendar_token()` RPC'siyle (auth.uid() sabit).
 */
export async function regenerateCalendarToken(): Promise<AppointmentResult> {
  const gate = await requirePermission("appointments", "view");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("rotate_my_calendar_token");

  if (error) {
    console.error("regenerateCalendarToken", error);
    return { error: actionErrorMessage(error, "Link yenilenemedi. Lütfen tekrar deneyin.") };
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
  if (!id || !isAppointmentStatus(status)) return { error: "Geçersiz durum." };

  const supabase = await createClient();
  const { data: current, error: currentError } = await supabase
    .from("appointments")
    .select("id, status, customer_id, property_id, assigned_to, created_by, customer:customers!appointments_customer_id_fkey(full_name)")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (currentError || !current || !isAppointmentStatus(current.status)) {
    return { error: "Randevu bulunamadı." };
  }
  if (!isAppointmentTransitionAllowed(current.status, status)) {
    return { error: "Bu randevu durum geçişi desteklenmiyor." };
  }

  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  // "signature" imza BEKLİYOR demektir; imza zamanı yalnız tamamlanınca yazılır.
  if (status === "completed") {
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

  const { data: updated, error } = await supabase
    .from("appointments")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", current.status)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("updateAppointmentStatus", error);
    return { error: actionErrorMessage(error, "Durum güncellenemedi.") };
  }
  if (!updated) return { error: "Randevu bu sırada değişti; sayfayı yenileyin." };

  // Takip zinciri: kararsız geçen randevuya danışmanın takip görevi (kayıt geri alınmaz; hata yalnız loglanır).
  let followUpTask: AppointmentResult["followUpTask"];
  if (status === "completed" && patch.outcome === "kararsiz") {
    const customer = current.customer as { full_name?: string | null } | { full_name?: string | null }[] | null;
    followUpTask = await ensureUndecidedFollowUpTask(supabase, gate, {
      appointmentId: id,
      customerId: (current.customer_id as string | null) ?? null,
      propertyId: (current.property_id as string | null) ?? null,
      advisorId: (current.assigned_to as string | null) ?? (current.created_by as string | null) ?? gate.userId,
      customerName: (Array.isArray(customer) ? customer[0]?.full_name : customer?.full_name) ?? null,
      outcomeNote: (patch.outcome_note as string | undefined) ?? null,
    });
  }

  revalidatePath("/app/randevular");
  if (followUpTask === "created") revalidatePath("/app/gorevler");
  revalidateTenantData(gate.tenantId);
  return { ok: true, ...(followUpTask ? { followUpTask } : {}) };
}

/**
 * Kararsız randevu sonrası takip görevi (2 iş günü sonra, randevunun danışmanına). İdempotent: not alanındaki
 * randevu izi (`followUpTaskMarker`) taşıyan görev — hangi durumda olursa olsun — varsa ikincisi açılmaz
 * (geri al → yeniden tamamla döngüsü). Müşterisiz randevuda görev açılmaz.
 */
async function ensureUndecidedFollowUpTask(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gate: { tenantId: string; userId: string },
  input: {
    appointmentId: string;
    customerId: string | null;
    propertyId: string | null;
    advisorId: string;
    customerName: string | null;
    outcomeNote: string | null;
  },
): Promise<"created" | "exists" | "skipped"> {
  if (!input.customerId) return "skipped";
  const marker = followUpTaskMarker(input.appointmentId);
  const { data: existing, error: existingError } = await supabase
    .from("tasks")
    .select("id")
    .eq("tenant_id", gate.tenantId)
    .eq("customer_id", input.customerId)
    .like("notes", `%${marker}%`)
    .limit(1);
  if (existingError) {
    console.error("ensureUndecidedFollowUpTask lookup", existingError);
    return "skipped";
  }
  if ((existing ?? []).length > 0) return "exists";

  const title = followUpTaskTitle(input.customerName);
  const { data: created, error } = await supabase
    .from("tasks")
    .insert({
      tenant_id: gate.tenantId,
      title,
      notes: followUpTaskNotes(input.appointmentId, input.outcomeNote),
      kind: "followup",
      priority: "normal",
      status: "open",
      due_at: followUpDueIso(now()),
      assigned_to: input.advisorId,
      customer_id: input.customerId,
      property_id: input.propertyId,
      created_by: gate.userId,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("ensureUndecidedFollowUpTask insert", error);
    return "skipped";
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "task.create",
    entityType: "task",
    entityId: created.id as string,
    newValue: { title, kind: "followup", priority: "normal", source: "appointment_undecided", appointment_id: input.appointmentId },
  });
  // Başkasının randevusunu tamamlayan yönetici: görev danışmana düştü, haber verilir (tek seferlik anahtar).
  if (input.advisorId !== gate.userId) {
    await notifyAssignment({
      tenantId: gate.tenantId,
      userId: input.advisorId,
      title: "Size takip görevi açıldı",
      body: `${title}. Termin: 2 iş günü sonra.`,
      href: "/app/gorevler",
      dedupeKey: `appt-followup:${input.appointmentId}`,
    });
  }
  return "created";
}

/**
 * Randevu durum menüsü / form eylemi. `updateAppointmentStatus` sonucunu artık YUTMAZ (SK10 / B166): `{ok}|{error}`
 * döner; menü hata alınca iyimser durumu geri alır ve bildirim gösterir.
 */
export function setAppointmentStatus(formData: FormData): Promise<AppointmentResult>;
/** Form eylemi olarak da verilebilir: React `<form action>` tipi void bekler, form sonucu yok sayar (bkz. action-outcome). */
export function setAppointmentStatus(formData: FormData): Promise<void>;
export async function setAppointmentStatus(formData: FormData): Promise<AppointmentResult | void> {
  return updateAppointmentStatus(formData);
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

  const scheduledAt = new Date(`${date}T${time}+03:00`);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { error: "Geçerli bir tarih/saat girin." };
  }
  const durationMin = Number.isFinite(durationValue) && durationValue > 0 ? Math.round(durationValue) : null;
  if (durationMin != null && (durationMin < 5 || durationMin > 1440)) {
    return { error: "Randevu süresi 5-1440 dakika arasında olmalı." };
  }

  const supabase = await createClient();

  const { data: current } = await supabase
    .from("appointments")
    .select("assigned_to, created_by")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!current) return { error: "Randevu bulunamadı." };
  const currentAdvisor = (current.assigned_to as string | null) ?? (current.created_by as string | null);

  // Danışman / müşteri / portföy değişikliği: alan formda varsa uygulanır (yoksa dokunulmaz).
  const patchExtra: Record<string, unknown> = {};
  let advisorId = currentAdvisor;
  if (formData.has("assigned_to")) {
    const advisor = await resolveAdvisor(
      gate,
      String(formData.get("assigned_to") ?? "").trim(),
      currentAdvisor ?? gate.userId,
    );
    if (!advisor.ok) return { error: advisor.error };
    advisorId = advisor.advisorId;
    if (advisorId !== (current.assigned_to as string | null)) patchExtra.assigned_to = advisorId;
  }
  const hasCustomer = formData.has("customer_id");
  const hasProperty = formData.has("property_id");
  if (hasCustomer || hasProperty) {
    const customerId = String(formData.get("customer_id") ?? "").trim();
    const propertyId = String(formData.get("property_id") ?? "").trim();
    const refs = await validateTenantReferences(gate.tenantId, {
      customerId: customerId || null,
      propertyId: propertyId || null,
    });
    if (!refs.ok) return { error: refs.error };
    if (hasCustomer) patchExtra.customer_id = customerId || null;
    if (hasProperty) patchExtra.property_id = propertyId || null;
  }

  // Çakışma freni (createAppointment ile aynı davranış): (yeni) danışman baz alınır;
  // kaydın kendisi kontrol dışı tutulur.
  const confirmConflict = String(formData.get("confirm_conflict") ?? "") === "1";
  if (!confirmConflict && advisorId) {
    const warning = await findConflictWarning({
      supabase,
      tenantId: gate.tenantId,
      advisorId,
      scheduledAt,
      durationMin,
      excludeId: id,
    });
    if (warning) return { conflictWarning: warning };
  }

  const { error } = await supabase
    .from("appointments")
    .update({
      appointment_type: appointmentType,
      scheduled_at: scheduledAt.toISOString(),
      duration_min: durationMin,
      location: location || null,
      notes: notes || null,
      ...patchExtra,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateAppointment", error);
    return { error: actionErrorMessage(error, "Randevu güncellenemedi.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "appointment.update",
    entityType: "appointment",
    entityId: id,
    newValue: { appointment_type: appointmentType, scheduled_at: scheduledAt.toISOString(), ...patchExtra },
  });

  revalidatePath("/app/randevular");
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
  return { ok: true };
}

const BULK_ASSIGN_LIMIT = 200;

export type BulkAssignAppointmentsResult = { ok?: boolean; error?: string; updatedCount?: number };

/**
 * Toplu sorumlu değiştirme (bkz. `bulkAssignCustomers` deseni): listedeki KAPANMAMIŞ randevular aynı danışmana
 * devredilir. Kapı `appointments.edit` + yönetim katmanı (tekil düzenlemedeki `resolveAdvisor` kuralı: başkası adına
 * danışman değiştirmek yalnız yönetime açık). Kimlikler ofis süzgecinden geçer; hedef bu ofisin AKTİF üyesi olmalı.
 * Çakışma freni toplu devirde uygulanmaz (danışman bildirimden takvimini kontrol eder).
 */
export async function bulkAssignAppointments(ids: string[], assignedTo: string): Promise<BulkAssignAppointmentsResult> {
  const gate = await requirePermission("appointments", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!canAssignOthers(gate.role)) return { error: "Randevu danışmanını değiştirme yetkiniz yok." };
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id).trim()).filter(Boolean))];
  if (!list.length) return { error: "Randevu seçilmedi." };
  if (list.length > BULK_ASSIGN_LIMIT) return { error: `Tek seferde en fazla ${BULK_ASSIGN_LIMIT} randevu güncellenebilir.` };
  const target = String(assignedTo ?? "").trim();
  if (!target) return { error: "Danışman seçin." };

  const supabase = await createClient();
  const [targetRes, beforeRes] = await Promise.all([
    supabase.from("profiles").select("id").eq("id", target).eq("tenant_id", gate.tenantId).eq("is_active", true).maybeSingle(),
    supabase
      .from("appointments")
      .select("id, assigned_to")
      .in("id", list)
      .eq("tenant_id", gate.tenantId)
      .in("status", [...UNCLOSED_APPOINTMENT_STATUSES]),
  ]);
  if (!targetRes.data) return { error: "Seçilen danışman bu ofiste aktif değil." };
  const previous = (beforeRes.data ?? []) as { id: string; assigned_to: string | null }[];
  const validIds = previous.map((a) => a.id);
  if (!validIds.length) return { error: "Güncellenecek açık randevu bulunamadı." };
  const movedCount = previous.filter((a) => (a.assigned_to ?? "") !== target).length;

  const { error } = await supabase
    .from("appointments")
    .update({ assigned_to: target, updated_at: new Date().toISOString() })
    .in("id", validIds)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("bulkAssignAppointments", error);
    return { error: actionErrorMessage(error, "Danışman değiştirilemedi.") };
  }
  if (target !== gate.userId && movedCount > 0) {
    await notifyAssignment({
      tenantId: gate.tenantId,
      userId: target,
      title: movedCount === 1 ? "Size 1 randevu devredildi" : `Size ${movedCount} randevu devredildi`,
      body: "Toplu atama ile randevular size devredildi. Takviminizi açıp saat çakışmalarını kontrol edin.",
      href: "/app/randevular",
      dedupeKey: `appt-bulk-assign:${target}:${idsDigest(validIds)}:${trDayKey()}`,
      prefKey: "appointment",
    });
  }
  afterSafe(() => logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "appointment.reassign",
    entityType: "appointment",
    oldValue: { previous },
    newValue: { ids: validIds, assigned_to: target, count: validIds.length, bulk: true },
  }));

  revalidatePath("/app/randevular");
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
  return { ok: true, updatedCount: validIds.length };
}
