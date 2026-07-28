"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { normalizeWeekdayHours, WEEKDAY_LABELS, type WeekdayHours } from "@/lib/booking-slots";

export type BookingSettingsResult = { ok?: boolean; error?: string };

/** Sayısal alanı sınırlar içine sıkıştırır; boş/bozuk girdi varsayılana düşer. */
function clampInt(raw: FormDataEntryValue | null, fallback: number, min: number, max: number): number {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Formdaki gün satırlarını (`gun_1_acik` / `gun_1_baslangic` / `gun_1_bitis`)
 * `weekday_hours` jsonb'sine çevirir. Kapalı gün anahtarı hiç yazılmaz —
 * slot üreticisi "anahtar yoksa kapalı" kuralıyla çalışır.
 */
function readWeekdayHours(fd: FormData): WeekdayHours {
  const raw: Record<string, string[]> = {};
  for (const { key } of WEEKDAY_LABELS) {
    if (String(fd.get(`gun_${key}_acik`) ?? "") !== "on") continue;
    raw[key] = [
      String(fd.get(`gun_${key}_baslangic`) ?? "").trim(),
      String(fd.get(`gun_${key}_bitis`) ?? "").trim(),
    ];
  }
  return normalizeWeekdayHours(raw);
}

/**
 * Danışmanın online randevu ayarını kaydeder (yoksa oluşturur).
 *
 * Ayar KİŞİSELDİR: `staff_id` her zaman giriş yapan kullanıcıdır — form'dan
 * gelmez, yani kimse başkasının linkini/saatlerini değiştiremez. Kiracı
 * izolasyonu RLS (`current_tenant_id()`) tarafında; bu yüzden normal client
 * yeterli, service role gerekmez.
 */
export async function upsertBookingSettings(fd: FormData): Promise<BookingSettingsResult> {
  const gate = await requirePermission("appointments", "edit");
  if (!gate.ok) return { error: gate.error };

  const isActive = String(fd.get("is_active") ?? "") === "on";
  const weekdayHours = readWeekdayHours(fd);
  const note = String(fd.get("note") ?? "").trim();

  // Aktif ama hiç çalışma günü yoksa link boş bir sayfa gösterirdi — erken uyar.
  if (isActive && Object.keys(weekdayHours).length === 0) {
    return { error: "Linki açmadan önce en az bir çalışma günü ve geçerli saat aralığı girin." };
  }

  const payload = {
    tenant_id: gate.tenantId,
    staff_id: gate.userId,
    is_active: isActive,
    weekday_hours: weekdayHours,
    slot_minutes: clampInt(fd.get("slot_minutes"), 60, 10, 480),
    buffer_minutes: clampInt(fd.get("buffer_minutes"), 0, 0, 240),
    max_days_ahead: clampInt(fd.get("max_days_ahead"), 14, 1, 90),
    min_hours_notice: clampInt(fd.get("min_hours_notice"), 4, 0, 168),
    note: note || null,
    updated_at: new Date().toISOString(),
  };

  const supabase = await createClient();
  // (tenant_id, staff_id) unique — mevcut satır varsa üzerine yazar,
  // public_token'a DOKUNMAZ (kolon payload'da yok → eski link yaşamaya devam eder).
  const { error } = await supabase
    .from("booking_settings")
    .upsert(payload, { onConflict: "tenant_id,staff_id" });

  if (error) {
    console.error("upsertBookingSettings", error);
    return { error: "Ayar kaydedilemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "booking.settings.update",
    entityType: "booking_settings",
    newValue: { is_active: isActive, slot_minutes: payload.slot_minutes, days: Object.keys(weekdayHours) },
  });

  revalidatePath("/app/randevular");
  return { ok: true };
}

/**
 * Rezervasyon linkini yeniler — yeni public_token yazar, eski link anında ölür
 * (regenerateCalendarToken deseni). Ayar satırı yoksa kapalı halde oluşturulur
 * ki kullanıcı "yenile" dediğinde sessiz bir başarısızlık yaşamasın.
 */
export async function regenerateBookingToken(): Promise<BookingSettingsResult> {
  const gate = await requirePermission("appointments", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("booking_settings")
    .upsert(
      {
        tenant_id: gate.tenantId,
        staff_id: gate.userId,
        public_token: randomUUID(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,staff_id" },
    );

  if (error) {
    console.error("regenerateBookingToken", error);
    return { error: "Link yenilenemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "booking.token.regenerate",
    entityType: "booking_settings",
  });

  revalidatePath("/app/randevular");
  return { ok: true };
}
