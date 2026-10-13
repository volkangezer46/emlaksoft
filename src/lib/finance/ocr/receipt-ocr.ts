import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { externalErrorMetadata } from "@/lib/external-fetch";
import { getOpenAiVisionModel, openAiChat } from "@/lib/ai/openai-client";
import { canAutoCallAi } from "@/lib/ai/auto-call-gate";
import { isReceiptOcrType, parseReceiptResponse, shouldRunReceiptOcr, type ReceiptSuggestion } from "./parse-receipt";

/**
 * FİŞ OKUMA (FN5, isteğe bağlı, VARSAYILAN KAPALI: finance_settings.ocr_enabled).
 *
 * - Ayar kapalıysa, dosya görsel değilse ya da AI kotası doluysa HİÇBİR dış çağrı yapılmaz (`shouldRunReceiptOcr`).
 * - Çağrı yalnız `src/lib/ai/openai-client.ts` (`openAiChat`) üzerinden gider; giden metin orada `Redactor`
 *   (`src/lib/ai/redact.ts`) ile maskelenir, denetim izi ve kredi ölçümü orada yazılır. Doğrudan sağlayıcı çağrısı yok.
 * - Sonuç YALNIZ ÖNERİDİR (tutar, tarih, KDV oranı, satıcı); kayıt oluşturmaz. Kullanıcı "Yeni kayıt" penceresinde
 *   onaylayıp Kaydet demeden hareket oluşmaz.
 */

const OCR_TIMEOUT_MS = 45_000;
const OCR_MAX_RESPONSE_BYTES = 64 * 1024;

const SYSTEM_PROMPT =
  "Sen Türk fiş ve fatura görsellerinden yalnız açıkça okunan bilgiyi çıkaran bir asistansın. " +
  "Okuyamadığın ya da emin olmadığın her alan için null döndür; asla tahmin etme. Yalnız geçerli JSON döndür.";

const USER_PROMPT = `Bu görsel bir fiş, fatura ya da makbuz olabilir. TAM OLARAK şu JSON ile yanıtla:
{
  "toplam": string | null,     // KDV dahil ödenecek GENEL TOPLAM, belgede yazdığı gibi (örn. "1.250,50")
  "tarih": string | null,      // Belge tarihi, belgede yazdığı gibi (örn. 12.05.2026)
  "kdv_orani": number | null,  // Tek KDV oranı varsa yüzde olarak (1, 10 ya da 20); birden fazlaysa null
  "satici": string | null      // Satıcı firma unvanı (kişi adı değil)
}
Görsel bir fiş/fatura değilse tüm alanları null yap.`;

export type ReceiptOcrOutcome =
  | { status: "skipped"; reason: "disabled" | "type" | "quota" }
  | { status: "done"; suggestion: ReceiptSuggestion }
  | { status: "failed" };

/** Ayar okuma: tablo/satır yoksa ya da hata varsa KAPALI (fail-closed). */
export async function isReceiptOcrEnabled(supabase: SupabaseClient, tenantId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("finance_settings").select("ocr_enabled").eq("tenant_id", tenantId).maybeSingle();
    if (error || !data) return false;
    return (data as { ocr_enabled?: boolean | null }).ocr_enabled === true;
  } catch {
    return false;
  }
}

export async function readReceipt(input: {
  enabled: boolean;
  tenantId: string;
  userId: string;
  fileType: string;
  bytes: Uint8Array;
  todayIso: string;
}): Promise<ReceiptOcrOutcome> {
  if (!input.enabled) return { status: "skipped", reason: "disabled" };
  if (!isReceiptOcrType(input.fileType)) return { status: "skipped", reason: "type" };
  const quotaOpen = await canAutoCallAi(input.tenantId);
  if (!shouldRunReceiptOcr({ enabled: input.enabled, fileType: input.fileType, quotaOpen })) return { status: "skipped", reason: "quota" };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: "skipped", reason: "disabled" };

  const url = `data:${input.fileType};base64,${Buffer.from(input.bytes).toString("base64")}`;
  try {
    const { content } = await openAiChat({
      apiKey,
      purpose: "finance_receipt_ocr",
      audit: { tenantId: input.tenantId, actorId: input.userId },
      timeoutMs: OCR_TIMEOUT_MS,
      maxResponseBytes: OCR_MAX_RESPONSE_BYTES,
      retries: 0,
      body: {
        model: getOpenAiVisionModel(),
        temperature: 0,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: USER_PROMPT },
              { type: "image_url", image_url: { url, detail: "high" } },
            ],
          },
        ],
      },
    });
    return { status: "done", suggestion: parseReceiptResponse(content, input.todayIso) };
  } catch (e) {
    console.error("finance readReceipt", externalErrorMetadata(e));
    return { status: "failed" };
  }
}
