"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Anket teşekkür ekranındaki "Google'da yorum bırakın" tıklaması (COM-12). Auth YOK: anket bağlantısının token'ı
 * yeterli (submitSurveyByToken deseni). Yalnız CEVAPLANMIŞ anketin İLK tıklaması yazılır (idempotent); sonuç
 * kullanıcıya hiçbir şey göstermez, bağlantı her durumda açılır. Sütun yoksa (migration öncesi) sessizce geçer.
 */
export async function recordSurveyReviewClick(token: string): Promise<{ ok: boolean }> {
  const t = String(token ?? "").trim();
  if (!UUID_RE.test(t)) return { ok: false };
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`anket-yorum:${ip}`, { limit: 10, windowSec: 60, failurePolicy: "deny" });
  if (!allowed) return { ok: false };
  const admin = createAdminClient();
  const { data: survey } = await admin
    .from("surveys")
    .select("id, tenant_id, status")
    .eq("public_token", t)
    .maybeSingle();
  if (!survey || survey.status !== "answered") return { ok: false };
  const { error } = await admin
    .from("surveys")
    .update({ review_clicked_at: new Date().toISOString() })
    .eq("id", survey.id)
    .eq("tenant_id", survey.tenant_id)
    .is("review_clicked_at", null);
  return { ok: !error };
}
