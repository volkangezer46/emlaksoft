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
import { chargeAiUsage } from "@/lib/ai/credits/meter";
import { estimateTokensFromChars } from "@/lib/ai/credits/cost";

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
  const result = await openAiChatRequestCore(opts);
  // Akış tüketicilerinde gerçek jeton sayısı yok: gönderilen gövdeden TAHMİN (çıktı için üst sınırın yarısı).
  const maxOut = typeof opts.body.max_tokens === "number" ? opts.body.max_tokens : 600;
  await meterUsage(opts, opts.body.model, estimateTokensFromChars(JSON.stringify(opts.body).length), Math.ceil(maxOut / 2));
  return result;
}

/**
 * Kredi ölçümü: yalnız tenant bağlamı (audit.tenantId) olan çağrılar sayılır. FAIL-OPEN —
 * ölçüm hatası asla çağrıyı bozmaz. Deftere yalnız özellik adı, model ve jeton sayısı gider.
 */
async function meterUsage(opts: OpenAiRequestOptions, model: unknown, tokensIn: number, tokensOut: number): Promise<void> {
  if (!opts.audit?.tenantId) return;
  try {
    await chargeAiUsage({
      tenantId: opts.audit.tenantId,
      actorId: opts.audit.actorId ?? null,
      feature: opts.purpose,
      model: typeof model === "string" ? model : null,
      tokensIn,
      tokensOut,
    });
  } catch (e) {
    console.error("openai-client meterUsage", e instanceof Error ? e.message : "bilinmeyen hata");
  }
}

async function openAiChatRequestCore(opts: OpenAiRequestOptions): Promise<OpenAiRawResult> {
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

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRIBE_MODEL = "whisper-1";
/** Ses yükleme üst sınırı (sunucu eylemi gövde sınırı 4 MB'ın altında). */
export const OPENAI_MAX_AUDIO_BYTES = 3 * 1024 * 1024;

/**
 * Ses -> metin (TEK yer). Ses dosyası yalnız bu çağrı süresince bellekte tutulur, hiçbir yere YAZILMAZ. Ham ses maskelenemez;
 * bu yüzden çağıran yalnız ofis izni açıkken çağırır. Çıkan METİN çağıran tarafından `openAiChat` ile (maskelenerek) özetlenir.
 * Denetim kaydı (ai.openai_call) ve kredi ölçümü chat çağrılarıyla aynı defterlere yazılır; ham içerik YAZILMAZ.
 */
export async function openAiTranscribe(opts: {
  apiKey: string;
  purpose: string;
  audio: Blob;
  fileName: string;
  timeoutMs: number;
  maxResponseBytes: number;
  audit?: OpenAiAudit | null;
  signal?: AbortSignal;
}): Promise<string | null> {
  if (opts.audio.size > OPENAI_MAX_AUDIO_BYTES) throw new OpenAiRequestTooLargeError();
  const form = new FormData();
  form.append("file", opts.audio, opts.fileName);
  form.append("model", TRANSCRIBE_MODEL);
  form.append("language", "tr");
  form.append("response_format", "json");
  let outcome: "ok" | OpenAiErrorKind = "ok";
  try {
    const response = await fetchExternal(
      OPENAI_TRANSCRIBE_URL,
      { method: "POST", headers: { Authorization: `Bearer ${opts.apiKey}` }, body: form },
      { timeoutMs: opts.timeoutMs, signal: opts.signal },
    );
    await requireExternalSuccess(response);
    const json = await readExternalJson<{ text?: unknown }>(response, opts.maxResponseBytes);
    return typeof json?.text === "string" && json.text.trim() ? json.text.trim() : null;
  } catch (error) {
    outcome = classifyOpenAiError(error);
    throw error;
  } finally {
    if (opts.audit?.tenantId) {
      await logActivity({
        tenantId: opts.audit.tenantId,
        actorId: opts.audit.actorId ?? null,
        action: "ai.openai_call",
        entityType: "ai",
        newValue: { purpose: opts.purpose, model: TRANSCRIBE_MODEL, outcome, attempts: 1, audio_bytes: opts.audio.size },
      });
      if (outcome === "ok") {
        try {
          // Süre bilinmez: bayt/16000 ≈ saniye (düşük bit hızı) -> jeton eşdeğeri tahmini.
          await chargeAiUsage({
            tenantId: opts.audit.tenantId,
            actorId: opts.audit.actorId ?? null,
            feature: opts.purpose,
            model: TRANSCRIBE_MODEL,
            tokensIn: Math.max(100, Math.ceil(opts.audio.size / 16)),
            tokensOut: 0,
          });
        } catch (e) {
          console.error("openai-client transcribe meter", e instanceof Error ? e.message : "bilinmeyen hata");
        }
      }
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
  const { response, redactor } = await openAiChatRequestCore(opts);
  const json = await readExternalJson<{
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }>(response, opts.maxResponseBytes);
  const pt = json?.usage?.prompt_tokens;
  const ct = json?.usage?.completion_tokens;
  await meterUsage(
    opts,
    opts.body.model,
    typeof pt === "number" ? pt : estimateTokensFromChars(JSON.stringify(opts.body).length),
    typeof ct === "number" ? ct : 300,
  );
  const raw = json?.choices?.[0]?.message?.content;
  const content = typeof raw === "string" && raw ? redactor.restoreText(raw) : null;
  return { content, redactor };
}
