"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { now } from "@/lib/clock";
import { sendTenantWhatsAppSessionText } from "@/lib/messaging/tenant-providers";
import { whatsappWindowState } from "@/lib/messaging/whatsapp-window";

export type WhatsAppReplyResult = { ok?: boolean; error?: string; templateRequired?: boolean };

/**
 * Gelen WhatsApp mesajına 24 saat penceresi içinde serbest metin yanıt. Pencere SUNUCUDA, aynı numaradan gelen SON
 * mesaja göre yeniden hesaplanır; kapalıysa gönderilmez (`templateRequired`). Gönderilen yanıt konuşmaya (communications,
 * outbound) kaydedilir. Kanal yalnız ofisin kendi WhatsApp entegrasyonuyla açılır.
 */
export async function replyWhatsAppInWindow(communicationId: string, text: string): Promise<WhatsAppReplyResult> {
  const gate = await requirePermission("calls", "create");
  if (!gate.ok) return { error: gate.error };
  if (!/^[0-9a-f-]{36}$/i.test(communicationId)) return { error: "Mesaj bulunamadı." };
  const body = String(text ?? "").trim();
  if (body.length < 1 || body.length > 4096) return { error: "Yanıt 1-4096 karakter olmalı." };
  const rl = await checkRateLimit(`wa-reply:${gate.userId}`, { limit: 60, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok fazla yanıt; birkaç dakika sonra tekrar deneyin." };

  const supabase = await createClient();
  const { data: msg } = await supabase
    .from("communications")
    .select("id, customer_id, contact_address, channel, direction")
    .eq("id", communicationId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!msg || msg.channel !== "whatsapp" || msg.direction !== "inbound" || !msg.contact_address) return { error: "Yanıtlanabilir WhatsApp mesajı bulunamadı." };

  const { data: last } = await supabase
    .from("communications")
    .select("created_at")
    .eq("tenant_id", gate.tenantId)
    .eq("channel", "whatsapp")
    .eq("direction", "inbound")
    .eq("contact_address", msg.contact_address)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const win = whatsappWindowState(last?.created_at ?? null, now());
  if (!win.open) return { error: "24 saat penceresi kapandı: yalnız Meta onaylı şablon gönderilebilir.", templateRequired: true };

  const sent = await sendTenantWhatsAppSessionText(gate.tenantId, String(msg.contact_address), body);
  if (!sent.ok) return { error: sent.error ?? "Gönderilemedi." };

  const { error } = await supabase.from("communications").insert({
    tenant_id: gate.tenantId,
    customer_id: msg.customer_id,
    created_by: gate.userId,
    channel: "whatsapp",
    direction: "outbound",
    subject: "WhatsApp yanıtı",
    body,
    provider: "meta",
    provider_message_id: sent.messageId,
    delivery_status: "sent",
    contact_address: msg.contact_address,
  });
  if (error) console.error("replyWhatsAppInWindow log", error.code);
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "whatsapp.session_reply", entityType: "communication", entityId: communicationId });
  revalidatePath("/app/gelen-kutusu");
  return { ok: true };
}
