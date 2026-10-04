"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { isModuleEnabled } from "@/lib/modules/state";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateReplyDraft, type ReplyDraftChannel } from "@/lib/ai/reply-draft";

export type ReplyDraftResult =
  | { ok: true; draft: string; channel: ReplyDraftChannel }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRAFT_CHANNELS: readonly string[] = ["whatsapp", "sms", "email"];

/**
 * Gelen iletişim kaydı (communications) için cevap taslağı önerir.
 *
 * GÜVENLİK: istemciden metin ALINMAZ; yalnız kayıt kimliği gelir, mesaj sunucuda tenant süzgeciyle okunur
 * (action serbest bir "LLM vekili" olamaz). Yalnız GELEN whatsapp/sms/e-posta kayıtları için çalışır.
 * Kişisel veri maskeleme `generateReplyDraft` → `openai-client` içindedir. Taslak KAYDEDİLMEZ ve
 * GÖNDERİLMEZ: kullanıcı düzenleyip mevcut SMS gönderimiyle (İYS denetimli) kendisi gönderir.
 * Kapalı `ai_assistant` modülünde çağrı yapılmaz.
 */
export async function suggestReplyDraft(communicationId: string): Promise<ReplyDraftResult> {
  const gate = await requirePermission("calls", "view");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!UUID_RE.test(String(communicationId ?? ""))) return { ok: false, error: "Geçersiz kayıt." };

  if (!(await isModuleEnabled(gate.tenantId, "ai_assistant"))) {
    return { ok: false, error: "AI Asistan modülü bu ofiste kapalı; cevap taslağı üretilemez." };
  }

  // Hız sınırı: bağlam sorgusundan ÖNCE (action doğrudan POST'lanabilir).
  const { allowed } = await checkRateLimit(`reply-draft:${gate.userId}`, {
    limit: 10,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) return { ok: false, error: "Çok fazla istek gönderildi. Lütfen bir dakika sonra tekrar deneyin." };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("communications")
    .select("id, channel, direction, body, subject, customer:customers!communications_customer_id_fkey(full_name)")
    .eq("id", communicationId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Kayıt bulunamadı." };
  if (row.direction !== "inbound" || !DRAFT_CHANNELS.includes(String(row.channel))) {
    return { ok: false, error: "Taslak yalnızca gelen WhatsApp, SMS veya e-posta mesajları için üretilir." };
  }
  const text = [row.subject, row.body].filter((s): s is string => typeof s === "string" && s.trim().length > 0).join("\n");
  if (!text.trim()) return { ok: false, error: "Mesaj metni boş; taslak üretilemez." };

  const cust = Array.isArray(row.customer) ? row.customer[0] : row.customer;
  const channel = row.channel as ReplyDraftChannel;
  const draft = await generateReplyDraft(
    { message: text, channel, customerName: (cust as { full_name?: string } | null)?.full_name ?? null },
    { tenantId: gate.tenantId, actorId: gate.userId },
  );
  if (!draft) {
    return { ok: false, error: "Taslak şu an üretilemedi (yapay zekâ yapılandırılmamış ya da geçici hata). Cevabı elle yazabilirsiniz." };
  }
  return { ok: true, draft, channel };
}
