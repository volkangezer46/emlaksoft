import { NextResponse } from "next/server";
import { getOpenAiKey, OPENAI_MODEL } from "@/lib/ai-advisor";
import {
  sseResponse,
  streamOpenAIChatEvents,
  type OpenAiChatMessage,
  type OpenAiToolCall,
  type OpenAiToolDef,
} from "@/lib/ai/streaming";
import {
  prepareTenantAdvisorTurn,
  saveTenantAdvisorTurn,
  type AdvisorAction,
  type AdvisorHotCustomer,
  type TenantAdvisorMessage,
} from "@/app/actions/ai-tenant-advisor";

// ---------------------------------------------------------------------------
// Ofis (tenant) AI asistanı — akan (streaming) sohbet ucu.
// Yetki + bağlam + kaydetme mantığı actions/ai-tenant-advisor'dan import edilir
// (server action stream edemediği için route handler gerekir).
// SSE protokolü için bkz. lib/ai/streaming.ts.
//
// ONAYLI EYLEMLER: model araç çağırdığında AI hiçbir şey YAZMAZ — çağrı
// sunucuda doğrulanır, istemciye `data: {action:{type,params}}` kartı gider,
// modele "önerildi, kullanıcı onayı bekleniyor" sonucu verilip yanıt
// tamamlatılır. Gerçek yazma, kullanıcı karttaki butonu onaylayınca mevcut
// kapılı action'larla olur (confirmSuggestedTask / SmsDialog).
// ---------------------------------------------------------------------------

const TOOL_GUIDANCE = `

EYLEM ARAÇLARI: Kullanıcının talebi somut bir eylem gerektiriyorsa uygun aracı çağır:
- suggest_task: bir takip/arama görevi önermek için (başlık Türkçe, kısa; termin 1-90 gün).
- draft_sms: bir müşteriye gönderilecek SMS taslağı önermek için (yalnızca bağlamdaki gerçek müşteri adlarını kullan).
- list_hot_customers: öncelikli aranacak sıcak müşteri listesini yapılandırılmış göstermek için.
Araçlar hiçbir şeyi doğrudan YAPMAZ: yalnızca kullanıcıya bir öneri kartı gösterir, kullanıcı butonla onaylar.
Araç sonucu "önerildi, kullanıcı onayı bekleniyor" döndüğünde yanıtını buna göre tamamla: öneriyi bir cümleyle özetle ve onay için karttaki butona işaret et. Uydurma müşteri adı kullanma.`;

const ADVISOR_TOOLS: OpenAiToolDef[] = [
  {
    type: "function",
    function: {
      name: "suggest_task",
      description:
        "Kullanıcıya onaylı bir görev önerisi kartı gösterir (görevi oluşturmaz; kullanıcı butonla onaylar).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Görev başlığı (Türkçe, kısa ve eylem odaklı)" },
          due_in_days: {
            type: "integer",
            minimum: 1,
            maximum: 90,
            description: "Bugünden itibaren kaç gün içinde yapılmalı (1-90)",
          },
          customer_name: {
            type: "string",
            description: "İlgili müşterinin bağlamdaki tam adı (opsiyonel)",
          },
        },
        required: ["title", "due_in_days"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_hot_customers",
      description:
        "Öncelikli aranacak sıcak müşterileri yapılandırılmış (tıklanabilir) liste kartı olarak gösterir.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_sms",
      description:
        "Bir müşteriye SMS taslağı önerisi kartı gösterir (göndermez; kullanıcı İYS kapılı dialogda onaylar).",
      parameters: {
        type: "object",
        properties: {
          customer_name: { type: "string", description: "Müşterinin bağlamdaki tam adı" },
          message: { type: "string", description: "SMS metni taslağı (Türkçe, en fazla 460 karakter)" },
        },
        required: ["customer_name", "message"],
      },
    },
  },
];

const TASK_TITLE_MAX = 120;
const CUSTOMER_NAME_MAX = 100;
const SMS_MAX = 460;

/**
 * Araç çağrısı parametrelerini SUNUCUDA doğrular; geçerliyse istemci kartı
 * (action) + modele dönecek araç sonucu üretir. Geçersizse null.
 */
function validateToolCall(
  call: OpenAiToolCall,
  hotCustomers: AdvisorHotCustomer[],
): { action: AdvisorAction; result: string } | null {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
  } catch {
    return null;
  }

  switch (call.function.name) {
    case "suggest_task": {
      const title = String(args.title ?? "").trim().slice(0, TASK_TITLE_MAX);
      const days = Math.round(Number(args.due_in_days));
      if (!title || !Number.isFinite(days) || days < 1 || days > 90) return null;
      const customerName =
        typeof args.customer_name === "string" && args.customer_name.trim()
          ? args.customer_name.trim().slice(0, CUSTOMER_NAME_MAX)
          : undefined;
      return {
        action: {
          type: "suggest_task",
          params: {
            title,
            due_in_days: days,
            ...(customerName ? { customer_name: customerName } : {}),
          },
        },
        result: JSON.stringify({
          durum: "onerildi",
          detay: "Görev önerisi kartı kullanıcıya gösterildi; kullanıcı onayı bekleniyor.",
        }),
      };
    }
    case "draft_sms": {
      const customerName = String(args.customer_name ?? "").trim().slice(0, CUSTOMER_NAME_MAX);
      const message = String(args.message ?? "").trim().slice(0, SMS_MAX);
      if (!customerName || !message) return null;
      return {
        action: { type: "draft_sms", params: { customer_name: customerName, message } },
        result: JSON.stringify({
          durum: "onerildi",
          detay:
            "SMS taslağı kartı kullanıcıya gösterildi; gönderim İYS onayı kontrol edilerek kullanıcı onayı bekliyor.",
        }),
      };
    }
    case "list_hot_customers": {
      // Parametre yok; liste SUNUCUDAKİ gerçek bağlamdan doldurulur
      return {
        action: { type: "list_hot_customers", params: { customers: hotCustomers } },
        result: JSON.stringify({
          durum: "listelendi",
          musteriler: hotCustomers.map((c) => ({ ad: c.name, skor: c.score })),
          detay: "Liste kullanıcıya tıklanabilir kart olarak gösterildi.",
        }),
      };
    }
    default:
      return null;
  }
}

export async function POST(req: Request) {
  let body: { messages?: TenantAdvisorMessage[]; sessionId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  // Yetki + hız sınırı + mesaj temizliği + ofis bağlamı (action içinde; hız
  // sınırı orada — 'use server' export'u doğrudan çağrılsa da limit uygulanır)
  const prep = await prepareTenantAdvisorTurn(body.messages ?? []);
  if (!prep.ok) {
    return NextResponse.json({ error: prep.error }, { status: prep.rateLimited ? 429 : 403 });
  }

  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null;
  const apiKey = await getOpenAiKey();

  return sseResponse(async (send) => {
    let reply = "";
    let usedAI = false;
    // O turda istemciye gönderilen eylem kartları — yanıtla birlikte DB'ye
    // kaydedilir; geçmiş oturum açılınca kartlar yeniden render edilir.
    const sentActions: AdvisorAction[] = [];

    if (apiKey) {
      try {
        const convo: OpenAiChatMessage[] = [
          { role: "system", content: prep.systemPrompt + TOOL_GUIDANCE },
          { role: "system", content: prep.contextText },
          ...prep.clean.map((m) => ({ role: m.role, content: m.content })),
        ];

        // En fazla 1 araç turu: çağrılar kart olarak gönderilir, sonuçlar
        // modele verilir ve ikinci (araçsız) turda yanıt tamamlatılır.
        let allowTools = true;
        for (;;) {
          let toolCalls: OpenAiToolCall[] = [];
          for await (const evt of streamOpenAIChatEvents(
            apiKey,
            {
              model: OPENAI_MODEL,
              temperature: 0.4,
              max_tokens: 700,
              messages: convo,
              ...(allowTools ? { tools: ADVISOR_TOOLS, tool_choice: "auto" as const } : {}),
            },
            req.signal,
          )) {
            if (evt.type === "delta") {
              reply += evt.text;
              send({ delta: evt.text });
            } else {
              toolCalls = evt.calls;
            }
          }

          if (!allowTools || toolCalls.length === 0) break;
          allowTools = false;

          // Araç turunun asistan mesajı (o ana dek gelen metin + çağrılar)
          convo.push({ role: "assistant", content: reply || null, tool_calls: toolCalls });

          for (const call of toolCalls) {
            const validated = validateToolCall(call, prep.hotCustomers);
            if (validated) {
              send({ action: validated.action });
              sentActions.push(validated.action);
              convo.push({ role: "tool", tool_call_id: call.id, content: validated.result });
            } else {
              convo.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify({
                  durum: "reddedildi",
                  detay: "Araç parametreleri doğrulanamadı; kart gösterilmedi.",
                }),
              });
            }
          }

          // İki turun metni tek asistan mesajında birleşir — görsel ayraç
          if (reply) {
            reply += "\n\n";
            send({ delta: "\n\n" });
          }
        }

        usedAI = reply.length > 0;
      } catch (e) {
        // İstemci iptal ettiyse elde kalan kısmı kaydet; başka hata varsa yedeğe düş
        if ((e as Error)?.name !== "AbortError") {
          console.error("tenant-chat:openai", e);
        }
      }
    }

    // İstemci hiç içerik gelmeden iptal ettiyse kaydetmeden çık
    if (req.signal.aborted && !reply) return;

    // Anahtar yok / OpenAI hata verdi ve içerik gelmedi → kural tabanlı yedek
    // (tek event) + AI'lı akışla aynı biçimde eylem kartları
    if (!reply) {
      reply = prep.fallbackReply;
      usedAI = false;
      send({ delta: reply });
      for (const action of prep.fallbackActions) {
        send({ action });
        sentActions.push(action);
      }
    }

    // Mevcut kaydetme mantığı (oturum + mesajlar + eylem kartları); tamamlanınca meta gönder
    const sid = await saveTenantAdvisorTurn(prep.clean, reply, usedAI, sessionId, sentActions);
    send({ done: true, sessionId: sid, usedAI });
  });
}
