import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders, opaqueRateLimitPart } from "@/lib/public-request-security";
import { getOpenAiChatModel, openAiChat } from "@/lib/ai/openai-client";
import { canAutoCallAi } from "@/lib/ai/auto-call-gate";
import {
  VITRIN_CHAT_HANDOVER,
  VITRIN_CHAT_MAX_QUESTION,
  buildVitrinChatMessages,
  guardVitrinAnswer,
  sanitizeHistory,
  type VitrinChatFacts,
} from "@/lib/ai/vitrin-chat";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/vitrin-sohbet {slug, propertyId, question, history?}
 * Ofis ayarı kapalıysa / ilan yayında değilse 404 (bağlam RPC'si `vitrin_chat_context`, service_role YOK).
 * Kota kapısı (`canAutoCallAi`), IP + ilan hız sınırı; OpenAI yalnız `openai-client` (maskeleme + kredi ölçümü, audit tenant).
 */
export async function POST(req: NextRequest) {
  let body: { slug?: unknown; propertyId?: unknown; question?: unknown; history?: unknown };
  try {
    const text = await req.text();
    if (text.length > 8_000) return json({ error: "İstek çok büyük." }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }
  const slug = typeof body.slug === "string" ? body.slug.slice(0, 120) : "";
  const propertyId = typeof body.propertyId === "string" && /^[0-9a-f-]{36}$/i.test(body.propertyId) ? body.propertyId : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!slug || !propertyId || question.length < 2 || question.length > VITRIN_CHAT_MAX_QUESTION) return json({ error: "Sorunuzu 2-500 karakter arasında yazın." }, 400);

  const ipKey = opaqueRateLimitPart(clientIpFromHeaders(req.headers));
  const [perIp, perListing] = await Promise.all([
    checkRateLimit(`vitrin-chat:ip:${ipKey}`, { limit: 20, windowSec: 600, failurePolicy: "deny" }),
    checkRateLimit(`vitrin-chat:prop:${propertyId}`, { limit: 200, windowSec: 3600, failurePolicy: "deny" }),
  ]);
  if (!perIp.allowed || !perListing.allowed) return json({ error: "Çok fazla soru gönderildi; lütfen formdan danışmanımıza ulaşın." }, 429);

  const db = await createClient();
  const { data: ctx, error } = await db.rpc("vitrin_chat_context", { p_slug: slug, p_property_id: propertyId });
  const c = (ctx ?? {}) as { ok?: boolean; tenant_id?: string; office?: string; facts?: VitrinChatFacts };
  if (error || !c.ok || !c.tenant_id || !c.facts) return json({ error: "Asistan bu ilanda etkin değil." }, 404);

  const key = process.env.OPENAI_API_KEY;
  if (!key || !(await canAutoCallAi(c.tenant_id))) return json({ answer: `Şu an yanıt veremiyorum. ${VITRIN_CHAT_HANDOVER}`, handover: true });

  try {
    const { content } = await openAiChat({
      apiKey: key,
      purpose: "vitrin_chat",
      audit: { tenantId: c.tenant_id, actorId: null },
      timeoutMs: 20_000,
      maxResponseBytes: 32 * 1024,
      body: {
        model: getOpenAiChatModel(),
        temperature: 0.2,
        max_tokens: 300,
        messages: buildVitrinChatMessages(c.office ?? "Ofis", c.facts, question, sanitizeHistory(body.history)),
      },
    });
    const answer = guardVitrinAnswer(content);
    return json({ answer: answer ?? `Bu konuda danışmanımız size en doğru bilgiyi verir. ${VITRIN_CHAT_HANDOVER}`, handover: !answer });
  } catch {
    return json({ answer: `Şu an yanıt veremiyorum. ${VITRIN_CHAT_HANDOVER}`, handover: true });
  }
}
