"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { portalRequestMessage } from "@/lib/customer-portal/portal-model";

export type PortalRequestResult = { ok: boolean; message: string };

const KINDS = new Set(["offer", "reschedule", "cancel", "maintenance"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Müşteri portalı yazma isteği (teklif, randevu erteleme/iptal talebi, kiracı bakım talebi). service_role YOK: oturumsuz
 * (anon) istemciyle `portal_customer_request` RPC'si çağrılır; token, sahiplik (yalnız bu kişinin randevusu/kira kaydı),
 * örnek veri ve frenler SQL içinde doğrulanır (20261007000620). Burada yalnız biçim + IP hız sınırı.
 */
export async function submitPortalRequest(fd: FormData): Promise<PortalRequestResult> {
  const token = String(fd.get("token") ?? "").trim();
  const kind = String(fd.get("kind") ?? "").trim();
  const refId = String(fd.get("ref_id") ?? "").trim();
  if (!/^[0-9a-f]{32,128}$/.test(token) || !KINDS.has(kind) || !UUID.test(refId)) {
    return { ok: false, message: "Geçersiz istek." };
  }

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`portalrequest:${ip}`, { limit: 10, windowSec: 60, failurePolicy: "deny" });
  if (!allowed) return { ok: false, message: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const text = (k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max);
  const payload: Record<string, unknown> = { note: text("note", 500) };
  if (kind === "offer") {
    payload.property_id = refId;
    // "4.500.000" / "4500000" / "4 500 000" → sayı (yalnız rakam; kuruş alınmaz).
    payload.amount = Number(text("amount", 20).replace(/\D/g, "")) || null;
  } else if (kind === "maintenance") {
    payload.rental_id = refId;
    payload.title = text("title", 120);
    payload.description = text("description", 2000);
  } else {
    payload.appointment_id = refId;
    payload.preferred = text("preferred", 120);
  }

  const db = await createClient();
  const { data, error } = await db.rpc("portal_customer_request", { p_token: token, p_kind: kind, p_payload: payload });
  if (error) {
    console.error("submitPortalRequest", { code: error.code });
    return { ok: false, message: portalRequestMessage("error").text };
  }
  const code = (data as { code?: string } | null)?.code ?? "error";
  const m = portalRequestMessage(code);
  return { ok: m.ok, message: m.text };
}
