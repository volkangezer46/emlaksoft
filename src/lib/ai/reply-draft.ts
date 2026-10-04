import "server-only";
import { getOpenAiKey } from "@/lib/ai-advisor";
import { externalErrorMetadata } from "@/lib/external-fetch";
import { getOpenAiChatModel, openAiChat, type OpenAiAudit } from "@/lib/ai/openai-client";

const OPENAI_TIMEOUT_MS = 30_000;
const OPENAI_MAX_RESPONSE_BYTES = 128 * 1024;

export type ReplyDraftChannel = "whatsapp" | "sms" | "email";

/** Kanal başına taslak üst sınırı (SMS, sendCustomerSms'in 460 sınırının altında kalır). */
export const REPLY_DRAFT_MAX_CHARS: Record<ReplyDraftChannel, number> = {
  sms: 320,
  whatsapp: 700,
  email: 1200,
};

export type ReplyDraftInput = {
  /** Müşterinin gelen mesajı. Gönderimden önce `openAiChat` içinde maskelenir (telefon/TC/e-posta/IBAN/kart/ad). */
  message: string;
  channel: ReplyDraftChannel;
  customerName: string | null;
};

/**
 * Gelen müşteri mesajına cevap TASLAĞI üretir. Gönderim yapmaz; taslağı kullanıcı düzenler ve
 * kendisi gönderir. Anahtar yoksa ya da çağrı başarısızsa `null` döner (UI düğmeyi göstermez/uyarır).
 * Kişisel veri maskeleme `openai-client` içindeki Redactor ile yapılır; bilinen müşteri adı ayrıca maskelenir.
 */
export async function generateReplyDraft(
  input: ReplyDraftInput,
  audit?: OpenAiAudit,
): Promise<string | null> {
  const message = input.message.trim();
  if (!message) return null;
  const apiKey = await getOpenAiKey();
  if (!apiKey) return null;

  const max = REPLY_DRAFT_MAX_CHARS[input.channel];
  const channelHint =
    input.channel === "email"
      ? "E-posta: kısa selamlama, 2-4 kısa paragraf, nazik kapanış."
      : input.channel === "sms"
        ? `SMS: en fazla ${max} karakter, tek paragraf.`
        : `WhatsApp: samimi ama profesyonel, en fazla ${max} karakter.`;

  try {
    const { content } = await openAiChat({
      apiKey,
      purpose: "reply_draft",
      audit,
      names: input.customerName ? [input.customerName] : undefined,
      timeoutMs: OPENAI_TIMEOUT_MS,
      maxResponseBytes: OPENAI_MAX_RESPONSE_BYTES,
      body: {
        model: getOpenAiChatModel(),
        temperature: 0.4,
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              "Sen bir emlak ofisi danışmanının yazı asistanısın. Müşterinin mesajına danışman adına Türkçe bir cevap TASLAĞI yaz. " +
              "Kurallar: yalnızca mesajda geçen bilgiye dayan; fiyat, müsaitlik, tarih, adres veya komisyon uydurma ve söz verme; " +
              "bilmediğin bir şey sorulduysa bilgiyi kontrol edip döneceğini söyle; somut bir sonraki adım öner (arama, randevu); " +
              "telefon, e-posta, TC, IBAN gibi kişisel veri yazma; emoji kullanma; imza ve başlık ekleme. " +
              "Yalnızca cevap metnini döndür. " +
              channelHint,
          },
          {
            role: "user",
            content: `${input.customerName ? `Müşteri: ${input.customerName}\n` : ""}Müşterinin mesajı:\n${message.slice(0, 2000)}`,
          },
        ],
      },
    });
    const text = content?.trim();
    if (!text) return null;
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  } catch (e) {
    console.error("generateReplyDraft", externalErrorMetadata(e));
    return null;
  }
}
