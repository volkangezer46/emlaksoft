"use server";

import { revalidatePath } from "next/cache";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { PHONE_ERROR_MESSAGE, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionErrorMessage } from "@/lib/action-errors";

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

/**
 * Public rezervasyonun müsaitlik, kayıt, audit ve bildirim niyeti tek RPC
 * transaction'ında sonuçlanır. Aksiyon yalnız girdi/rate-limit kapısıdır;
 * ön okuma yapmaz, böylece tekrar istekleri idempotent kuyruğu onarabilir.
 */
export async function createPublicBooking(fd: FormData): Promise<PublicBookingResult> {
  const token = String(fd.get("token") ?? "").trim();
  const startIso = String(fd.get("slot") ?? "").trim();
  const fullName = String(fd.get("full_name") ?? "").trim();
  const phoneRaw = String(fd.get("phone") ?? "").trim();
  const email = normalizeEmail(String(fd.get("email") ?? ""));
  const note = String(fd.get("note") ?? "").trim();
  const kvkk = String(fd.get("kvkk") ?? "") === "on";

  // Honeypot — botlar gizli alanı doldurur; sessizce başarılı davran.
  if (String(fd.get("website") ?? "").trim()) {
    return { ok: true, startIso, durationMin: 60 };
  }

  if (!UUID_RE.test(token)) return { error: "Geçersiz bağlantı." };
  if (!fullName) return { error: "Ad soyad zorunludur." };
  if (fullName.length > 160) return { error: "Ad soyad en fazla 160 karakter olabilir." };
  const phoneParsed = parsePhoneStrict(phoneRaw);
  if (!phoneParsed.ok) return { error: phoneParsed.error ?? PHONE_ERROR_MESSAGE };
  // create_public_booking_atomic RPC'si şu an yalnız TR cep (05XXXXXXXXX) kabul eder.
  if (phoneParsed.country !== "TR" || phoneParsed.kind !== "mobile") return { error: TR_MOBILE_ERROR_MESSAGE };
  if (email && !isValidEmail(email)) return { error: EMAIL_ERROR_MESSAGE };
  if (email.length > 320) return { error: "E-posta adresi çok uzun." };
  if (note.length > 1000) return { error: "Not en fazla 1000 karakter olabilir." };
  if (!kvkk) return { error: "Devam etmek için KVKK onayı gereklidir." };

  const startMs = new Date(startIso).getTime();
  if (!startIso || Number.isNaN(startMs)) return { error: "Lütfen bir saat seçin." };

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`randevu-al:${ip}`, {
    limit: 8,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: bookingData, error: bookingError } = await admin.rpc(
    "create_public_booking_atomic",
    {
      p_public_token: token,
      p_start_at: new Date(startMs).toISOString(),
      p_full_name: fullName,
      p_phone: phoneParsed.stored,
      p_email: email || null,
      p_note: note || null,
    },
  );
  if (bookingError) {
    console.error("createPublicBooking atomic reservation", { code: bookingError.code });
    return { error: actionErrorMessage(bookingError, "Randevu oluşturulamadı. Lütfen tekrar deneyin.") };
  }

  const booking = bookingData && typeof bookingData === "object" && !Array.isArray(bookingData)
    ? bookingData as Record<string, unknown>
    : null;
  const outcome = typeof booking?.outcome === "string" ? booking.outcome : "invalid_result";
  if (outcome === "staff_unavailable") {
    return { error: "Danışmanımız o tarihte müsait değil, başka gün seçin.", slotTaken: true };
  }
  if (outcome === "slot_unavailable") {
    return { error: "Bu saat az önce doldu, başka saat seçin.", slotTaken: true };
  }
  if (outcome === "invalid_link") {
    return { error: "Bağlantı geçersiz veya süresi dolmuş." };
  }
  if (outcome !== "created" && outcome !== "replay") {
    return { error: actionErrorMessage(null, "Randevu oluşturulamadı. Lütfen tekrar deneyin.") };
  }

  const appointmentId = typeof booking?.appointment_id === "string" ? booking.appointment_id : "";
  const customerId = typeof booking?.customer_id === "string" ? booking.customer_id : "";
  const tenantId = typeof booking?.tenant_id === "string" ? booking.tenant_id : "";
  const staffId = typeof booking?.staff_id === "string" ? booking.staff_id : "";
  const confirmedStartIso = typeof booking?.scheduled_at === "string" ? booking.scheduled_at : "";
  const confirmedDuration = Number(booking?.duration_min);
  if (
    !UUID_RE.test(appointmentId)
    || !UUID_RE.test(customerId)
    || !UUID_RE.test(tenantId)
    || !UUID_RE.test(staffId)
    || !Number.isFinite(new Date(confirmedStartIso).getTime())
    || !Number.isInteger(confirmedDuration)
    || confirmedDuration < 10
    || confirmedDuration > 480
  ) {
    console.error("createPublicBooking invalid atomic result");
    return { error: "Randevu oluşturuldu ancak sonuç doğrulanamadı. Lütfen ofisle iletişime geçin." };
  }

  revalidatePath("/app/randevular");
  revalidatePath("/app");
  return { ok: true, startIso: confirmedStartIso, durationMin: confirmedDuration };
}
