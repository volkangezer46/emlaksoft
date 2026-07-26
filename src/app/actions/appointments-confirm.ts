"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { isPast } from "@/lib/clock";
import { notifyTenant } from "@/lib/notify";

export type ConfirmResponse = "coming" | "cancelled";

export type ConfirmResult = { ok?: boolean; error?: string; response?: ConfirmResponse };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Müşterinin randevu teyidi (/randevu-teyit/[token] public sayfası).
 *
 * Auth YOK — confirm_token yeterli (submitMatchFeedbackByToken deseni).
 * RLS anon'a açılmadığı için service role ile yazılır; token unique index'le
 * tek kaydı bulur. 'cancelled' yanıtı randevu durumunu da iptale çeker ve
 * danışmana bildirim düşer — danışman sabah takvimine bakmadan öğrenir.
 */
export async function respondToAppointmentByToken(fd: FormData): Promise<ConfirmResult> {
  const token = String(fd.get("token") ?? "").trim();
  const responseRaw = String(fd.get("response") ?? "").trim();

  if (!UUID_RE.test(token)) return { error: "Geçersiz bağlantı." };
  if (responseRaw !== "coming" && responseRaw !== "cancelled") {
    return { error: "Geçersiz seçim." };
  }
  const response = responseRaw as ConfirmResponse;

  // Token tahmini / spam koruması — IP başına dakikada 20 istek
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`randevu-teyit:${ip}`, { limit: 20, windowSec: 60 });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: appt } = await admin
    .from("appointments")
    .select("id, tenant_id, scheduled_at, status, customer_response, assigned_to, customer:customers(full_name)")
    .eq("confirm_token", token)
    .maybeSingle();

  if (!appt) return { error: "Bağlantı geçersiz veya randevu bulunamadı." };
  if (isPast(appt.scheduled_at)) return { error: "Bu randevunun tarihi geçmiş." };
  // Aynı yanıt tekrar gelirse sessiz başarı — çift tıklama/yeniden yükleme
  // ikinci bildirim üretmesin.
  if (appt.customer_response === response) return { ok: true, response };

  const patch: Record<string, unknown> = {
    customer_response: response,
    responded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (response === "cancelled") patch.status = "cancelled";

  const { error } = await admin.from("appointments").update(patch).eq("id", appt.id);
  if (error) {
    console.error("respondToAppointmentByToken", error);
    return { error: "Yanıt kaydedilemedi. Lütfen tekrar deneyin." };
  }

  // Danışmana bildirim — fire-and-forget değil: yanıtın ulaştığından emin olmak
  // müşteri deneyiminden önemli değil, ama hata teşekkür ekranını düşürmesin.
  const cust = appt.customer as { full_name?: string } | { full_name?: string }[] | null;
  const customerName = (Array.isArray(cust) ? cust[0]?.full_name : cust?.full_name) ?? "Müşteri";
  const saat = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(appt.scheduled_at),
  );
  try {
    await notifyTenant({
      tenantId: String(appt.tenant_id),
      userId: (appt.assigned_to as string | null) ?? null,
      title: response === "coming" ? "Randevu onaylandı" : "Randevu iptal edildi",
      body:
        response === "coming"
          ? `${customerName} randevuyu onayladı (${saat}).`
          : `${customerName} randevuyu iptal etti (${saat}).`,
      href: "/app/randevular",
      kind: response === "coming" ? "success" : "warning",
      prefKey: "appointment",
    });
  } catch (e) {
    console.error("appointment confirm notify", e);
  }

  revalidatePath("/app/randevular");
  return { ok: true, response };
}
