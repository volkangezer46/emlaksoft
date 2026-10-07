"use server";

import { revalidatePath } from "next/cache";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionErrorMessage } from "@/lib/action-errors";

export type ConfirmResponse = "coming" | "cancelled";
export type ConfirmResult = { ok?: boolean; error?: string; response?: ConfirmResponse };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Teyit yanıtı, audit ve bildirim niyeti atomik RPC içinde kalıcılaşır.
 * Exact replay aynı intent'i idempotent biçimde onarır; farklı yanıt reddedilir.
 */
export async function respondToAppointmentByToken(fd: FormData): Promise<ConfirmResult> {
  const token = String(fd.get("token") ?? "").trim();
  const responseRaw = String(fd.get("response") ?? "").trim();

  if (!UUID_RE.test(token)) return { error: "Geçersiz bağlantı." };
  if (responseRaw !== "coming" && responseRaw !== "cancelled") {
    return { error: "Geçersiz seçim." };
  }
  const response = responseRaw as ConfirmResponse;

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`randevu-teyit:${ip}`, {
    limit: 20,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: transitionData, error: transitionError } = await admin.rpc(
    "respond_appointment_confirmation_atomic",
    {
      p_confirm_token: token,
      p_response: response,
    },
  );
  if (transitionError) {
    console.error("respondToAppointmentByToken atomic transition", { code: transitionError.code });
    return { error: actionErrorMessage(transitionError, "Yanıt kaydedilemedi. Lütfen tekrar deneyin.") };
  }

  const transition = transitionData && typeof transitionData === "object" && !Array.isArray(transitionData)
    ? transitionData as Record<string, unknown>
    : null;
  const outcome = typeof transition?.outcome === "string" ? transition.outcome : "invalid_result";
  if (outcome === "already_responded") {
    return { error: "Bu randevu için daha önce farklı bir yanıt verilmiş." };
  }
  if (outcome === "appointment_past") return { error: "Bu randevunun tarihi geçmiş." };
  if (outcome === "appointment_closed") {
    return { error: "Bu randevu artık yanıt kabul etmiyor." };
  }
  if (outcome === "invalid_link") {
    return { error: "Bağlantı geçersiz veya randevu bulunamadı." };
  }
  if (outcome !== "applied" && outcome !== "replay") {
    return { error: actionErrorMessage(null, "Yanıt kaydedilemedi. Lütfen tekrar deneyin.") };
  }

  revalidatePath("/app/randevular");
  return { ok: true, response };
}
