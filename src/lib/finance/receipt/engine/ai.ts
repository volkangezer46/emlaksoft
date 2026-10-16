import "server-only";
import { externalErrorMetadata } from "@/lib/external-fetch";
import { getOpenAiVisionModel, openAiChat } from "@/lib/ai/openai-client";
import { canAutoCallAi } from "@/lib/ai/auto-call-gate";
import { fitsReceiptOcrRequest } from "@/lib/finance/ocr/parse-receipt";
import { AI_SYSTEM_PROMPT, AI_USER_PROMPT, parseAiReceipt } from "../ai-parse";
import type { LayerFields } from "../types";

/**
 * YAPAY ZEKÂ KATMANI (en son çare; AYRI açık onay `finance_settings.ocr_ai_enabled` + anahtar + kota). Çağrı yalnız
 * `src/lib/ai/openai-client.ts` üzerinden gider (maskeleme, denetim izi, kredi ölçümü orada). Metin girdisi (PDF/OCR satırları)
 * varsa görsel yerine metin gönderilir (daha ucuz, kişisel veri maskelenir); yoksa görsel.
 */

const TIMEOUT_MS = 45_000;
const MAX_RESPONSE_BYTES = 96 * 1024;

export type AiOutcome = { status: "done"; fields: LayerFields } | { status: "unavailable"; reason: "no_key" | "quota" | "size" | "type" } | { status: "failed" };

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function readWithAi(input: {
  tenantId: string;
  userId: string;
  todayIso: string;
  image?: { type: string; bytes: Uint8Array } | null;
  textLines?: readonly string[] | null;
}): Promise<AiOutcome> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: "unavailable", reason: "no_key" };
  const text = input.textLines?.filter(Boolean).join("\n").slice(0, 12_000) ?? "";
  const imageOk = input.image && ["image/jpeg", "image/png", "image/webp"].includes(input.image.type);
  if (text.length < 20 && !imageOk) return { status: "unavailable", reason: "type" };
  if (text.length < 20 && input.image && !fitsReceiptOcrRequest(input.image.bytes.byteLength)) return { status: "unavailable", reason: "size" };
  if (!(await canAutoCallAi(input.tenantId))) return { status: "unavailable", reason: "quota" };

  const content: unknown[] = [{ type: "text", text: AI_USER_PROMPT }];
  if (text.length >= 20) content.push({ type: "text", text: `BELGE METNİ:\n${text}` });
  else if (input.image) content.push({ type: "image_url", image_url: { url: `data:${input.image.type};base64,${Buffer.from(input.image.bytes).toString("base64")}`, detail: "high" } });

  try {
    const { content: reply } = await openAiChat({
      apiKey,
      purpose: "finance_receipt_ocr",
      audit: { tenantId: input.tenantId, actorId: input.userId },
      timeoutMs: TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      retries: 0,
      body: {
        model: getOpenAiVisionModel(),
        temperature: 0,
        max_tokens: 1400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          { role: "user", content },
        ],
      },
    });
    return { status: "done", fields: parseAiReceipt(reply, input.todayIso) };
  } catch (e) {
    console.error("finance receipt ai", externalErrorMetadata(e));
    return { status: "failed" };
  }
}
