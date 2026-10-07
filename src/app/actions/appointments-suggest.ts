"use server";

import { revalidatePath } from "next/cache";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionErrorMessage } from "@/lib/action-errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SuggestResult = { ok?: boolean; error?: string };

/** "YYYY-MM-DDTHH:mm" (datetime-local) → Türkiye saati (+03:00) olarak epoch ms; geçersizse null. */
function parseTrLocal(v: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const t = new Date(`${v}:00+03:00`).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * "Başka zaman öner": müşteri 1-3 alternatif zaman önerir. Yeni sütun/RPC YOK —
 * öneri randevu notuna (kalıcı kayıt) eklenir ve atanan danışmana uygulama içi
 * bildirim düşer. Randevu durumu DEĞİŞMEZ; danışman onaylayıp yeniden planlar.
 */
export async function suggestAlternativeTimesByToken(fd: FormData): Promise<SuggestResult> {
  const token = String(fd.get("token") ?? "").trim();
  if (!UUID_RE.test(token)) return { error: "Geçersiz bağlantı." };

  const nowMs = Date.now();
  const times = [fd.get("t1"), fd.get("t2"), fd.get("t3")]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .map((v) => ({ raw: v, ms: parseTrLocal(v) }));
  if (times.length === 0) return { error: "En az bir zaman seçin." };
  if (times.some((t) => t.ms == null || t.ms < nowMs || t.ms > nowMs + 90 * 86_400_000)) {
    return { error: "Önerilen zamanlar gelecekte (en fazla 90 gün sonra) olmalı." };
  }
  const note = String(fd.get("note") ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`randevu-oner:${ip}`, {
    limit: 5,
    windowSec: 300,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: appt } = await admin
    .from("appointments")
    .select("id, tenant_id, assigned_to, notes, status, scheduled_at, customer:customers!appointments_customer_id_fkey(full_name)")
    .eq("confirm_token", token)
    .maybeSingle();
  if (!appt) return { error: "Bağlantı geçersiz veya randevu bulunamadı." };
  if (appt.status === "cancelled" || appt.status === "completed" || new Date(appt.scheduled_at).getTime() < nowMs) {
    return { error: "Bu randevu artık yeni zaman önerisi kabul etmiyor." };
  }

  const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
  const list = times.map((t) => fmt.format(new Date(t.ms as number))).join(" / ");
  const line = `[Müşteri alternatif zaman önerdi: ${list}${note ? ` — "${note}"` : ""}]`;
  const merged = [appt.notes, line].filter(Boolean).join("\n").slice(-4000);

  const { error: upErr } = await admin
    .from("appointments")
    .update({ notes: merged })
    .eq("id", appt.id)
    .eq("tenant_id", appt.tenant_id);
  if (upErr) {
    console.error("suggestAlternativeTimesByToken update", { code: upErr.code });
    return { error: actionErrorMessage(upErr, "Öneri kaydedilemedi. Lütfen tekrar deneyin.") };
  }

  const cust = Array.isArray(appt.customer) ? appt.customer[0] : appt.customer;
  await admin.from("notifications").insert({
    tenant_id: appt.tenant_id,
    user_id: appt.assigned_to ?? null,
    title: "Müşteri başka zaman önerdi",
    body: `${(cust as { full_name?: string } | null)?.full_name ?? "Müşteri"}: ${list}`,
    href: "/app/randevular",
    kind: "warning",
    meta: { appointment_id: appt.id, workflow: "appointment_alt_time" },
  });

  revalidatePath("/app/randevular");
  return { ok: true };
}
