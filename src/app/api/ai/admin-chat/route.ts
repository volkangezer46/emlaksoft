import { NextResponse } from "next/server";
import { getPlatformStaff } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";
import {
  buildAdvisorContext,
  contextToText,
  fallbackAdvisor,
  getOpenAiKey,
  OPENAI_MODEL,
  SYSTEM_PROMPT,
  type AdvisorMessage,
} from "@/lib/ai-advisor";
import { sseResponse, streamOpenAIChat } from "@/lib/ai/streaming";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Platform (admin) yapay zeka iş danışmanı — akan (streaming) sohbet ucu.
// Bağlam toplama + kural tabanlı yedek lib/ai-advisor'dan import edilir.
// Yetki: requirePlatformModule sayfaya yönlendirdiği (redirect) için burada aynı
// kontrol JSON 401/403 olarak uygulanır (getPlatformStaff + platformCanAccess).
// SSE protokolü için bkz. lib/ai/streaming.ts.
// ---------------------------------------------------------------------------

const MAX_MESSAGES = 12;
const MAX_LEN = 2000;

function sanitizeMessages(messages: AdvisorMessage[]): AdvisorMessage[] {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_LEN) }));
}

/** Mevcut askAdvisor kaydetme mantığı — oturum + son tur mesajları (hata olursa sessizce geç). */
async function persistTurn(
  staffId: string,
  clean: AdvisorMessage[],
  reply: string,
  usedAI: boolean,
  sessionId: string | null,
): Promise<string> {
  try {
    const admin = createAdminClient();
    let sid = sessionId;

    // Service-role client RLS uygulamaz — istemciden gelen sessionId'nin bu
    // personele ait olduğu doğrulanmadan yazılırsa başka personelin oturumuna
    // mesaj enjekte edilebilir. Sahiplik tutmuyorsa yeni oturum açılır.
    if (sid) {
      const { data: owned } = await admin
        .from("advisor_sessions")
        .select("id")
        .eq("id", sid)
        .eq("staff_id", staffId)
        .maybeSingle();
      if (!owned) sid = null;
    }

    if (!sid) {
      const firstUserMsg = clean.find((m) => m.role === "user")?.content ?? "Yeni sohbet";
      const title = firstUserMsg.slice(0, 60) + (firstUserMsg.length > 60 ? "…" : "");
      const { data: session } = await admin
        .from("advisor_sessions")
        .insert({ staff_id: staffId, title })
        .select("id")
        .single();
      sid = session?.id ?? null;
    }

    if (sid) {
      const lastUser = clean[clean.length - 1]!;
      await admin.from("advisor_messages").insert([
        { session_id: sid, role: "user", content: lastUser.content, used_ai: false },
        { session_id: sid, role: "assistant", content: reply, used_ai: usedAI },
      ]);
    }

    return sid ?? "";
  } catch (e) {
    console.error("admin-chat:db", e);
    return sessionId ?? "";
  }
}

export async function POST(req: Request) {
  const staff = await getPlatformStaff();
  if (!staff) {
    return NextResponse.json({ error: "Oturum bulunamadı. Lütfen tekrar giriş yapın." }, { status: 401 });
  }
  if (!platformCanAccess(staff.role, "advisor")) {
    return NextResponse.json({ error: "Bu modüle erişim yetkiniz yok." }, { status: 403 });
  }

  let body: { messages?: AdvisorMessage[]; sessionId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const clean = sanitizeMessages(body.messages ?? []);
  if (clean.length === 0 || clean[clean.length - 1]!.role !== "user") {
    return NextResponse.json({ error: "Bir soru yazın; canlı verilerle yanıtlayayım." }, { status: 400 });
  }

  // Hız sınırı — personel başına dakikada 10 mesaj
  const { allowed } = await checkRateLimit(`ai-chat:${staff.id}`, { limit: 10, windowSec: 60 });
  if (!allowed) {
    return NextResponse.json(
      { error: "Çok fazla istek gönderildi. Lütfen bir dakika sonra tekrar deneyin." },
      { status: 429 },
    );
  }

  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null;
  const [context, apiKey] = await Promise.all([buildAdvisorContext(), getOpenAiKey()]);

  return sseResponse(async (send) => {
    let reply = "";
    let usedAI = false;

    if (apiKey) {
      try {
        for await (const delta of streamOpenAIChat(
          apiKey,
          {
            model: OPENAI_MODEL,
            temperature: 0.4,
            max_tokens: 700,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "system", content: `GÜNCEL PLATFORM VERİLERİ:\n${contextToText(context)}` },
              ...clean,
            ],
          },
          req.signal,
        )) {
          reply += delta;
          send({ delta });
        }
        usedAI = reply.length > 0;
      } catch (e) {
        // İstemci iptal ettiyse elde kalan kısmı kaydet; başka hata varsa yedeğe düş
        if ((e as Error)?.name !== "AbortError") {
          console.error("admin-chat:openai", e);
        }
      }
    }

    // İstemci hiç içerik gelmeden iptal ettiyse kaydetmeden çık
    if (req.signal.aborted && !reply) return;

    // Anahtar yok / OpenAI hata verdi ve içerik gelmedi → kural tabanlı yedek (tek event)
    if (!reply) {
      reply = fallbackAdvisor(clean, context);
      usedAI = false;
      send({ delta: reply });
    }

    // Tamamlanınca DB'ye kaydet ve meta gönder
    const sid = await persistTurn(staff.id, clean, reply, usedAI, sessionId);
    send({ done: true, sessionId: sid, usedAI });
  });
}
