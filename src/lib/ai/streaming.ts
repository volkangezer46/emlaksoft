import "server-only";

// ---------------------------------------------------------------------------
// AI sohbet akışı (streaming) yardımcıları — /api/ai/tenant-chat ve
// /api/ai/admin-chat route'ları tarafından paylaşılır.
//
// Kablo protokolü (SSE, text/event-stream):
//   data: {"delta":"..."}                          → yanıt parçası
//   data: {"action":{"type":"...","params":{...}}} → onay bekleyen eylem önerisi kartı
//   data: {"done":true,"sessionId":"...","usedAI":true} → tamamlandı (meta)
//   data: {"error":"..."}                          → Türkçe hata mesajı
//   data: [DONE]                                   → akış sonu
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/** SSE yanıt başlıkları (proxy tamponlamasını da kapatır). */
export const SSE_HEADERS: HeadersInit = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/** Tek bir SSE olayını `data: {...}\n\n` olarak kodlar. */
export function sseEncode(data: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

/** Akış sonlandırma işareti. */
export function sseDone(): Uint8Array {
  return encoder.encode("data: [DONE]\n\n");
}

export type SseSend = (data: unknown) => void;

/**
 * SSE Response üretir. `run` içinde `send` her çağrıda bir `data:` satırı yazar;
 * `run` bitince akış `data: [DONE]` ile kapanır. İstemci bağlantıyı iptal ederse
 * `send` sessizce no-op olur — `run` (ör. DB kaydı) çalışmaya devam edebilir.
 */
export function sseResponse(run: (send: SseSend) => Promise<void>): Response {
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send: SseSend = (data) => {
        if (closed) return;
        try {
          controller.enqueue(sseEncode(data));
        } catch {
          closed = true; // istemci kapattı
        }
      };

      void run(send)
        .catch((e) => {
          console.error("sseResponse:run", e);
          send({ error: "Yanıt üretilirken bir hata oluştu. Lütfen tekrar deneyin." });
        })
        .finally(() => {
          if (!closed) {
            try {
              controller.enqueue(sseDone());
              controller.close();
            } catch {
              /* akış zaten kapalı */
            }
            closed = true;
          }
        });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

// ---------------------------------------------------------------------------
// OpenAI stream çağrısı
// ---------------------------------------------------------------------------

/** Tamamlanmış (birleştirilmiş) bir OpenAI function-calling araç çağrısı. */
export type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** OpenAI function-calling araç tanımı (tools dizisi elemanı). */
export type OpenAiToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type OpenAiChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** Yalnız role:"assistant" — modelin yaptığı araç çağrıları. */
  tool_calls?: OpenAiToolCall[];
  /** Yalnız role:"tool" — hangi araç çağrısına yanıt verildiği. */
  tool_call_id?: string;
};

export type OpenAiStreamPayload = {
  model: string;
  temperature?: number;
  max_tokens?: number;
  messages: OpenAiChatMessage[];
  tools?: OpenAiToolDef[];
  tool_choice?: "auto" | "none";
};

/** Akış olayı: metin parçası veya (akış sonunda birleşmiş) araç çağrıları. */
export type OpenAiStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_calls"; calls: OpenAiToolCall[] };

// Streaming'de tool_calls parça parça gelir: her delta `index` ile hedef çağrıyı
// işaret eder; `id`/`name` ilk parçada, `arguments` JSON'u fragman fragman gelir.
type ToolCallDelta = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

/**
 * OpenAI chat/completions'ı `stream: true` ile çağırır; içerik parçalarını
 * `{type:"delta"}` olarak, araç çağrılarını ise akış bitince tek bir
 * `{type:"tool_calls"}` olayı hâlinde (fragmanları birleştirip) üretir.
 * Hata biçimi mevcut `callOpenAI` ile aynıdır: `OpenAI <status>: ...` fırlatır.
 */
export async function* streamOpenAIChatEvents(
  apiKey: string,
  payload: OpenAiStreamPayload,
  signal?: AbortSignal,
): AsyncGenerator<OpenAiStreamEvent> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...payload, stream: true }),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // index → birleştirilmekte olan araç çağrısı
  const pendingCalls = new Map<number, { id: string; name: string; args: string }>();

  try {
    outer: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Her SSE `data:` satırı kendi başına tam bir JSON'dur; son (muhtemelen
      // eksik) satır bir sonraki chunk ile birleşmek üzere buffer'da kalır.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") break outer;
        try {
          const json = JSON.parse(data) as {
            choices?: { delta?: { content?: unknown; tool_calls?: ToolCallDelta[] } }[];
          };
          const delta = json.choices?.[0]?.delta;
          if (typeof delta?.content === "string" && delta.content) {
            yield { type: "delta", text: delta.content };
          }
          for (const tc of delta?.tool_calls ?? []) {
            const idx = tc.index ?? 0;
            const entry = pendingCalls.get(idx) ?? { id: "", name: "", args: "" };
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
            if (tc.function?.arguments) entry.args += tc.function.arguments;
            pendingCalls.set(idx, entry);
          }
        } catch {
          /* bozuk/eksik parça — atla */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (pendingCalls.size > 0) {
    const calls: OpenAiToolCall[] = [...pendingCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, c]) => c)
      .filter((c) => c.id && c.name)
      .map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } }));
    if (calls.length > 0) yield { type: "tool_calls", calls };
  }
}

/**
 * Yalnız metin parçalarını üreten geriye uyumlu sarmalayıcı — admin-chat gibi
 * araç kullanmayan tüketiciler için (davranış değişmedi).
 */
export async function* streamOpenAIChat(
  apiKey: string,
  payload: OpenAiStreamPayload,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  for await (const evt of streamOpenAIChatEvents(apiKey, payload, signal)) {
    if (evt.type === "delta") yield evt.text;
  }
}
