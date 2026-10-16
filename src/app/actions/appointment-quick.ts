"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { canAssignOthers } from "@/lib/workflow-rules";
import { now } from "@/lib/clock";
import { officeDayWindow } from "@/lib/time/office-tz";
import { isOnLeave, type LeaveLike } from "@/lib/leave-utils";
import { busyFromAppointments, freeAppointmentSlots, officeSlotMs } from "@/lib/appointment-slots";
import { appointmentTypeLabel } from "@/lib/appointment-labels";
import { appointmentConfirmUrl, appointmentCustomerText, appointmentWhatsAppHref } from "@/lib/appointment-messages";
import { sendAppointmentConfirmation, type ConfirmSendOutcome } from "@/lib/appointment-customer-messages";
import { getBaseUrl } from "@/lib/base-url";
import { logActivity } from "@/lib/activity";

/**
 * Kolay randevu akışının yardımcı uçları (yeni randevu formu):
 *  - `appointmentPropertyContext`: seçilen portföyün adresi ve sorumlu danışmanı (gösterimde konum/danışman ön dolgusu),
 *  - `suggestAppointmentSlots`: danışmanın o gün boş saatleri + izin bilgisi (akıllı saat çipleri),
 *  - `appointmentConfirmKit`: kayıttan sonra "Müşteriye teyit gönder" (WhatsApp taslağı) ve "Takvime ekle" verisi,
 *  - `sendAppointmentConfirmSms`: tek dokunuşla teyit SMS'i (işlem amaçlı kanal, `sendAppointmentConfirmation` kapıları).
 * Hepsi oturumlu istemciyle (RLS kiracı süzgeci) çalışır; yazma yapan tek uç SMS gönderimidir.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Rel<T> = T | T[] | null | undefined;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export type AppointmentPropertyContext = { location: string | null; advisorId: string | null };

export async function appointmentPropertyContext(propertyId: string): Promise<AppointmentPropertyContext | null> {
  const gate = await requirePermission("appointments", "create");
  if (!gate.ok || !UUID_RE.test(propertyId)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("properties")
    .select("address_line, assigned_to, district:geo_districts(name), province:geo_provinces(name)")
    .eq("id", propertyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  const district = one(data.district as Rel<{ name: string | null }>)?.name ?? null;
  const province = one(data.province as Rel<{ name: string | null }>)?.name ?? null;
  const parts = [data.address_line as string | null, [district, province].filter(Boolean).join(", ") || null].filter(
    (p): p is string => Boolean(p && p.trim()),
  );
  return { location: parts.length ? parts.join(", ").slice(0, 300) : null, advisorId: (data.assigned_to as string | null) ?? null };
}

export type AppointmentSlotSuggestion = { slots: string[]; onLeave: boolean; busyCount: number };

export async function suggestAppointmentSlots(input: {
  date: string;
  advisorId?: string | null;
  durationMin?: number | null;
}): Promise<AppointmentSlotSuggestion | null> {
  const gate = await requirePermission("appointments", "view");
  if (!gate.ok || !DATE_RE.test(input.date)) return null;
  // Başkasının takvimi yalnız atama yetkisi olan (yönetim katmanı) için; diğerleri kendi boş saatini görür.
  const advisorId =
    input.advisorId && UUID_RE.test(input.advisorId) && canAssignOthers(gate.role) ? input.advisorId : gate.userId;
  const anchor = officeSlotMs(input.date, "12:00");
  if (anchor == null) return null;
  const { start, end } = officeDayWindow(anchor, 0);
  const supabase = await createClient();
  const [{ data: rows }, { data: leaves }] = await Promise.all([
    supabase
      .from("appointments")
      .select("scheduled_at, duration_min")
      .eq("tenant_id", gate.tenantId)
      .eq("assigned_to", advisorId)
      .neq("status", "cancelled")
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())
      .limit(100),
    supabase
      .from("staff_leaves")
      .select("staff_id, starts_on, ends_on, status")
      .eq("staff_id", advisorId)
      .eq("status", "onayli")
      .lte("starts_on", input.date)
      .gte("ends_on", input.date)
      .limit(5),
  ]);
  const busy = busyFromAppointments((rows ?? []) as { scheduled_at: string; duration_min: number | null }[]);
  return {
    slots: freeAppointmentSlots({ date: input.date, busy, nowMs: now(), durationMin: input.durationMin }),
    onLeave: isOnLeave((leaves ?? []) as LeaveLike[], advisorId, input.date),
    busyCount: busy.length,
  };
}

export type AppointmentConfirmKit = {
  id: string;
  customerName: string | null;
  /** Danışmanın kendi WhatsApp'ından göndereceği hazır teyit taslağı (numara yoksa null). */
  waHref: string | null;
  /** Müşterinin kayıtlı numarası var mı (SMS düğmesi için). */
  hasPhone: boolean;
  calendar: { uid: string; title: string; startIso: string; endIso: string; location: string | null; description: string | null };
};

type KitRow = {
  id: string;
  appointment_type: string | null;
  scheduled_at: string;
  duration_min: number | null;
  location: string | null;
  notes: string | null;
  confirm_token: string | null;
  customer: Rel<{ full_name: string | null; phone: string | null }>;
  property: Rel<{ title: string | null; property_code: string | null }>;
};

export async function appointmentConfirmKit(appointmentId: string): Promise<AppointmentConfirmKit | null> {
  const gate = await requirePermission("appointments", "view");
  if (!gate.ok || !UUID_RE.test(appointmentId)) return null;
  const supabase = await createClient();
  const [{ data }, { data: tenant }] = await Promise.all([
    supabase
      .from("appointments")
      .select(
        "id, appointment_type, scheduled_at, duration_min, location, notes, confirm_token, customer:customers!appointments_customer_id_fkey(full_name, phone), property:properties!appointments_property_id_fkey(title, property_code)",
      )
      .eq("tenant_id", gate.tenantId)
      .eq("id", appointmentId)
      .maybeSingle(),
    supabase.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle(),
  ]);
  const row = data as KitRow | null;
  if (!row) return null;
  const customer = one(row.customer);
  const property = one(row.property);
  const typeLabel = appointmentTypeLabel(row.appointment_type ?? "");
  const startMs = Date.parse(row.scheduled_at);
  const text = appointmentCustomerText({
    kind: "confirm",
    customerName: customer?.full_name ?? null,
    officeName: (tenant as { name?: string | null } | null)?.name ?? null,
    appointmentType: row.appointment_type,
    scheduledAt: row.scheduled_at,
    confirmUrl: appointmentConfirmUrl(getBaseUrl(), row.confirm_token),
  });
  return {
    id: row.id,
    customerName: customer?.full_name ?? null,
    waHref: appointmentWhatsAppHref(customer?.phone ?? null, text),
    hasPhone: Boolean(customer?.phone),
    calendar: {
      uid: row.id,
      title: [typeLabel, customer?.full_name, property?.title ?? property?.property_code].filter(Boolean).join(" · ") || "Randevu",
      startIso: row.scheduled_at,
      endIso: new Date(startMs + (row.duration_min && row.duration_min > 0 ? row.duration_min : 60) * 60_000).toISOString(),
      location: row.location,
      description: row.notes,
    },
  };
}

export async function sendAppointmentConfirmSms(appointmentId: string): Promise<{ outcome: ConfirmSendOutcome; error?: string }> {
  const gate = await requirePermission("appointments", "create");
  if (!gate.ok) return { outcome: "off", error: gate.error };
  if (!UUID_RE.test(appointmentId)) return { outcome: "off", error: "Randevu bulunamadı." };
  const supabase = await createClient();
  const outcome = await sendAppointmentConfirmation(supabase, {
    tenantId: gate.tenantId,
    appointmentId,
    appUrl: getBaseUrl(),
    manual: true,
  });
  if (outcome === "sms_sent") {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "appointment.confirm_sms",
      entityType: "appointment",
      newValue: { appointment_id: appointmentId },
    });
  }
  return { outcome };
}
