import "server-only";
import { logActivity } from "@/lib/activity";
import {
  externalErrorMetadata,
  ExternalHttpError,
  fetchExternal,
  readExternalJson,
  requireExternalSuccess,
} from "@/lib/external-fetch";
import { Redactor, type RedactCounts } from "@/lib/ai/redact";

// ---------------------------------------------------------------------------
// TEK OpenAI istemcisi. Kaynakta api.openai.com'a başka hiçbir yerden istek
// atılmaz (bkz. openai-client-contract.test.ts). Her çıkış (system/user/tool
// mesajları, bağlam, araç sonuçları, OCR istem metni) gönderilmeden önce
// `Redactor` katmanından geçer; yanıt yalnız bellekte geri çevrilir.
// ---------------------------------------------------------------------------

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
/** Giden gövde için üst sınır (base64 görsel dahil). */
export const OPENAI_MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_BASE_MS = 400;

/** Sohbet modeli: `OPENAI_MODEL` ortam değişkeni, yoksa gpt-4o-mini. */
export function getOpenAiChatModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

/** Görsel/OCR modeli: `OPENAI_VISION_MODEL` → `OPENAI_MODEL` → gpt-4o-mini. */
export function getOpenAiVisionModel(): string {
  return process.env.OPENAI_VISION_MODEL?.trim() || getOpenAiChatModel();
}

export class OpenAiRequestTooLargeError extends Error {
  constructor() {
    super("OpenAI request body exceeded the configured limit.");
    this.name = "OpenAiRequestTooLargeError";
  }
}

export type OpenAiErrorKind =
  | "auth"
  | "rate_limit"
  | "bad_request"
  | "server"
  | "timeout"
  | "aborted"
  | "request_too_large"
  | "response_too_large"
  | "invalid_response"
  | "network";

/** Hata sınıflandırma: log/telemetri için gövde içermeyen güvenli tür. */
export function classifyOpenAiError(error: unknown): OpenAiErrorKind {
  if (error instanceof OpenAiRequestTooLargeError) return "request_too_large";
  const meta = externalErrorMetadata(error);
  switch (meta.kind) {
    case "http": {
      const s = meta.status ?? 0;
      if (s === 401 || s === 403) return "auth";
      if (s === 429) return "rate_limit";
      if (s >= 500) return "server";
      return "bad_request";
    }
    case "timeout":
      return "timeout";
    case "aborted":
      return "aborted";
    case "response_too_large":
      return "response_too_large";
    case "invalid_response":
      return "invalid_response";
    default:
      return "network";
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ExternalHttpError) return error.status === 429 || error.status >= 500;
  const kind = classifyOpenAiError(error);
  // Zaman aşımı / iptal tekrar denenmez (gecikmeyi katlamaz, kullanıcı iptalini yok saymaz).
  return kind === "network";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Denetim izi bağlamı. Tenant yoksa (platform-yönetici çağrıları) kayıt yazılmaz. */
export type OpenAiAudit = { tenantId: string; actorId?: string | null };

export type OpenAiRequestOptions = {
  apiKey: string;
  /** Çağrının amacı (denetim izi; kişisel veri içermemeli): "tenant_chat", "ocr"... */
  purpose: string;
  /** chat/completions gövdesi (model dahil). */
  body: Record<string, unknown>;
  timeoutMs: number;
  /** Yanıt bayt sınırı (stream için de kullanılır). */
  maxResponseBytes: number;
  signal?: AbortSignal;
  retries?: number;
  retryBaseDelayMs?: number;
  audit?: OpenAiAudit | null;
  /** Çağıran, aynı konuşma turunda ortak Redactor paylaşmak isterse. */
  redactor?: Redactor;
  /** Bilinen ad-soyadlar — verilirse ayrıca maskelenir (varsayılan: kapalı). */
  names?: string[];
};

export type OpenAiRawResult = { response: Response; redactor: Redactor };

async function writeAudit(
  opts: OpenAiRequestOptions,
  model: unknown,
  outcome: "ok" | OpenAiErrorKind,
  counts: RedactCounts,
  attempts: number,
): Promise<void> {
  if (!opts.audit?.tenantId) return;
  // Yalnız sayaçlar/etiketler: kişisel veri, istem veya yanıt metni YOK.
  await logActivity({
    tenantId: opts.audit.tenantId,
    actorId: opts.audit.actorId ?? null,
    action: "ai.openai_call",
    entityType: "ai",
    newValue: {
      purpose: opts.purpose,
      model: typeof model === "string" ? model : null,
      outcome,
      attempts,
      redacted: counts,
    },
  });
}

/**
 * Maskeleme + hız/bayt sınırları + tekrar deneme ile çağrı yapar ve HAM yanıtı
 * (başarı doğrulanmış) döner. Stream tüketicileri için tek giriş noktası.
 */
export async function openAiChatRequest(opts: OpenAiRequestOptions): Promise<OpenAiRawResult> {
  const redactor = opts.redactor ?? new Redactor({ names: opts.names });
  const safeBody = redactor.redactDeep(opts.body);
  const payload = JSON.stringify(safeBody);
  if (Buffer.byteLength(payload, "utf8") > OPENAI_MAX_REQUEST_BYTES) {
    await writeAudit(opts, safeBody.model, "request_too_large", redactor.counts, 0);
    throw new OpenAiRequestTooLargeError();
  }

  const retries = opts.retries ?? DEFAULT_RETRIES;
  const baseDelay = opts.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_MS;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const response = await fetchExternal(
        OPENAI_CHAT_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.apiKey}`,
          },
          body: payload,
        },
        { timeoutMs: opts.timeoutMs, signal: opts.signal },
      );
      await requireExternalSuccess(response);
      await writeAudit(opts, safeBody.model, "ok", redactor.counts, attempt);
      return { response, redactor };
    } catch (error) {
      if (attempt <= retries && isRetryable(error)) {
        const delay = baseDelay * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
        await sleep(delay, opts.signal);
        continue;
      }
      await writeAudit(opts, safeBody.model, classifyOpenAiError(error), redactor.counts, attempt);
      throw error;
    }
  }
}

export type OpenAiChatResult = {
  /** Geri çevrilmiş (orijinal değerlere dönmüş) ilk mesaj içeriği; yoksa null. */
  content: string | null;
  redactor: Redactor;
};

/** Akışsız chat/completions: yanıt içeriğini geri çevrilmiş olarak döner. */
export async function openAiChat(opts: OpenAiRequestOptions): Promise<OpenAiChatResult> {
  const { response, redactor } = await openAiChatRequest(opts);
  const json = await readExternalJson<{ choices?: { message?: { content?: unknown } }[] }>(
    response,
    opts.maxResponseBytes,
  );
  const raw = json?.choices?.[0]?.message?.content;
  const content = typeof raw === "string" && raw ? redactor.restoreText(raw) : null;
  return { content, redactor };
}
