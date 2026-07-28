"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { isValidTurkishMobile, normalizeTurkishPhone, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";
import { isSlotAvailable, normalizeWeekdayHours, TR_OFFSET_MIN, type BusyInterval } from "@/lib/booking-slots";
import { isOnLeave, leaveRangesToBusy, type LeaveLike } from "@/lib/leave-utils";

export type PublicBookingResult = {
  ok?: boolean;
  error?: string;
  /** Teşekkür ekranı için kesinleşmiş randevu anı (ISO) ve süresi. */
  startIso?: string;
  durationMin?: number;
  /** Slot yarışta kaybedildi — form ızgarayı tazelemeli. */
  slotTaken?: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 86_400_000;

/**
 * Online randevu rezervasyonu (/randevu-al/[token] public sayfası).
 *
 * Auth YOK — booking_settings.public_token yeterli (open-house-public deseni).
 * RLS anon'a açılmadığı için tüm okuma/yazma service role ile yapılır ve her
 * sorgu ayarın kendi tenant_id/staff_id'sine sabitlenir; müşteri hiçbir
 * kimlik/kayıt seçemez.
 *
 * YARIŞ KONTROLÜ: slot müsaitliği kaydetmeden HEMEN ÖNCE, taze randevu
 * listesiyle yeniden hesaplanır. İki müşteri aynı saati aynı anda seçerse
 * ikincisi "bu saat az önce doldu" uyarısı alır.
 */
export async function createPublicBooking(fd: FormData): Promise<PublicBookingResult> {
  const token = String(fd.get("token") ?? "").trim();
  const startIso = String(fd.get("slot") ?? "").trim();
  const fullName = String(fd.get("full_name") ?? "").trim();
  const phoneRaw = String(fd.get("phone") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim();
  const note = String(fd.get("note") ?? "").trim();
  const kvkk = String(fd.get("kvkk") ?? "") === "on";
  // Honeypot — botlar gizli alanı doldurur; sessizce "başarılı" davran.
  if (String(fd.get("website") ?? "").trim()) return { ok: true, startIso, durationMin: 60 };

  if (!UUID_RE.test(token)) return { error: "Geçersiz bağlantı." };
  if (!fullName) return { error: "Ad soyad zorunludur." };
  if (!isValidTurkishMobile(phoneRaw)) return { error: TR_MOBILE_ERROR_MESSAGE };
  if (email && !EMAIL_RE.test(email)) return { error: "Geçerli bir e-posta girin veya boş bırakın." };
  if (!kvkk) return { error: "Devam etmek için KVKK onayı gereklidir." };

  const startMs = new Date(startIso).getTime();
  if (!startIso || Number.isNaN(startMs)) return { error: "Lütfen bir saat seçin." };

  // Token tahmini / spam koruması — IP başına dakikada 8 rezervasyon denemesi.
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`randevu-al:${ip}`, { limit: 8, windowSec: 60 });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: setting } = await admin
    .from("booking_settings")
    .select(
      "id, tenant_id, staff_id, is_active, weekday_hours, slot_minutes, buffer_minutes, max_days_ahead, min_hours_notice",
    )
    .eq("public_token", token)
    .maybeSingle();

  if (!setting) return { error: "Bağlantı geçersiz veya süresi dolmuş." };
  if (!setting.is_active) return { error: "Şu anda online randevu alınamıyor." };

  const tenantId = String(setting.tenant_id);
  const staffId = String(setting.staff_id);
  const slotMinutes = Number(setting.slot_minutes ?? 60);
  const maxDaysAhead = Number(setting.max_days_ahead ?? 14);

  // ---- Yarış kontrolü: müsaitlik kaydetmeden HEMEN ÖNCE tazeleniyor ----
  const nowMs = Date.now();
  const windowStart = new Date(nowMs - DAY_MS).toISOString();
  const windowEnd = new Date(nowMs + (maxDaysAhead + 1) * DAY_MS).toISOString();
  const [{ data: busyRows }, { data: leaveRows }] = await Promise.all([
    admin
      .from("appointments")
      .select("scheduled_at, duration_min")
      .eq("tenant_id", tenantId)
      .eq("assigned_to", staffId)
      .neq("status", "cancelled")
      .gte("scheduled_at", windowStart)
      .lt("scheduled_at", windowEnd),
    // İZİN KONTROLÜ: slot ızgarası üretildikten SONRA izin girilmiş olabilir
    // (müşteri sayfayı açık bıraktı, yönetici araya izin yazdı). Kaydetmeden
    // hemen önce taze okunur — randevu bloğu ve izin bloğu aynı elemeye girer.
    admin
      .from("staff_leaves")
      .select("staff_id, starts_on, ends_on, status")
      .eq("tenant_id", tenantId)
      .eq("staff_id", staffId)
      .eq("status", "onayli")
      .lte("starts_on", windowEnd.slice(0, 10))
      .gte("ends_on", windowStart.slice(0, 10)),
  ]);

  const leaves = (leaveRows ?? []) as LeaveLike[];
  // Seçilen gün izinliyse jenerik "bu saat doldu" yerine doğru sebebi söyle:
  // müşteri başka SAAT değil başka GÜN seçmeli.
  const startDayKey = new Date(startMs + TR_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
  if (isOnLeave(leaves, staffId, startDayKey)) {
    return { error: "Danışmanımız o tarihte müsait değil, başka gün seçin.", slotTaken: true };
  }

  // Süresi girilmemiş randevu 60 dk sayılır (findConflictWarning ile aynı kural).
  const busy: BusyInterval[] = (busyRows ?? []).map((r) => {
    const s = new Date(r.scheduled_at as string).getTime();
    return { start: s, end: s + ((r.duration_min as number | null) ?? 60) * 60_000 };
  });
  busy.push(...leaveRangesToBusy(leaves, TR_OFFSET_MIN, staffId));

  const available = isSlotAvailable(startIso, {
    nowMs,
    weekdayHours: normalizeWeekdayHours(setting.weekday_hours),
    slotMinutes,
    bufferMinutes: Number(setting.buffer_minutes ?? 0),
    maxDaysAhead,
    minHoursNotice: Number(setting.min_hours_notice ?? 4),
    busy,
  });
  if (!available) {
    return { error: "Bu saat az önce doldu, başka saat seçin.", slotTaken: true };
  }

  // ---- Müşteri eşleştirme: aynı kiracıda aynı telefon varsa ona bağla ----
  const phone = normalizeTurkishPhone(phoneRaw);
  const { data: existingCustomer } = await admin
    .from("customers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  let customerId = existingCustomer?.id as string | undefined;
  if (!customerId) {
    const { data: created, error: custErr } = await admin
      .from("customers")
      .insert({
        tenant_id: tenantId,
        full_name: fullName,
        phone,
        email: email || null,
        source: "online randevu",
        assigned_to: staffId,
        created_by: staffId,
        notes: "Online randevu linkinden kendisi kaydoldu",
      })
      .select("id")
      .single();
    if (custErr || !created) {
      console.error("createPublicBooking customer", custErr);
      return { error: "Randevu oluşturulamadı. Lütfen tekrar deneyin." };
    }
    customerId = created.id as string;
  }

  const { data: appt, error } = await admin
    .from("appointments")
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      // Online alınan randevunun portföyü yok; ofis görüşmesi en doğru tür.
      appointment_type: "office",
      scheduled_at: new Date(startMs).toISOString(),
      duration_min: slotMinutes,
      status: "pending",
      notes: note ? `Online randevu — ${note}` : "Online randevu (müşteri kendisi aldı)",
      assigned_to: staffId,
      created_by: staffId,
    })
    .select("id")
    .single();

  if (error || !appt) {
    console.error("createPublicBooking appointment", error);
    return { error: "Randevu oluşturulamadı. Lütfen tekrar deneyin." };
  }

  const tarihSaat = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  }).format(new Date(startMs));

  // Danışmana bildirim — hata teşekkür ekranını düşürmesin.
  try {
    await notifyTenant({
      tenantId,
      userId: staffId,
      title: `📅 Online randevu: ${fullName} — ${tarihSaat}`,
      body: `${fullName} (${phone}) online randevu linkinden ${tarihSaat} için randevu aldı.${note ? ` Not: ${note}` : ""}`,
      href: "/app/randevular",
      kind: "success",
      prefKey: "appointment",
    });
  } catch (e) {
    console.error("createPublicBooking notify", e);
  }

  await logActivity({
    tenantId,
    actorId: staffId,
    action: "booking.public.create",
    entityType: "appointment",
    entityId: appt.id as string,
    newValue: {
      scheduled_at: new Date(startMs).toISOString(),
      duration_min: slotMinutes,
      customer_id: customerId,
      source: "online randevu",
    },
  });

  revalidatePath("/app/randevular");
  revalidatePath("/app");

  return { ok: true, startIso: new Date(startMs).toISOString(), durationMin: slotMinutes };
}
