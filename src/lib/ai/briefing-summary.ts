import "server-only";
import { getOpenAiKey } from "@/lib/ai-advisor";
import type { BriefingItem } from "@/lib/briefing";
import { externalErrorMetadata } from "@/lib/external-fetch";
import { getOpenAiChatModel, openAiChat, type OpenAiAudit } from "@/lib/ai/openai-client";

const OPENAI_TIMEOUT_MS = 30_000;
const OPENAI_MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * Opsiyonel AI cilası — brifing maddelerinden tek cümlelik motive edici özet.
 *
 * Anahtar okuma deseni `lib/ai-advisor.getOpenAiKey` ile aynı: önce DB ayarı
 * (admin → Sistem), yoksa `OPENAI_API_KEY` ortam değişkeni. Anahtar yoksa veya
 * çağrı başarısız olursa `null` döner — UI'da satır hiç görünmez (yedek metin
 * yazılmaz; kural tabanlı maddeler zaten kartta durur).
 *
 * Sayfayı yavaşlatmamak için bu fonksiyon Suspense'li ayrı bir server
 * component içinden çağrılır (bkz. `src/app/app/page.tsx`).
 */
export async function generateBriefingSummary(
  items: BriefingItem[],
  audit?: OpenAiAudit,
): Promise<string | null> {
  if (items.length === 0) return null;

  const apiKey = await getOpenAiKey();
  if (!apiKey) return null;

  try {
    const { content } = await openAiChat({
      apiKey,
      purpose: "briefing_summary",
      audit,
      timeoutMs: OPENAI_TIMEOUT_MS,
      maxResponseBytes: OPENAI_MAX_RESPONSE_BYTES,
      body: {
        model: getOpenAiChatModel(),
        temperature: 0.5,
        max_tokens: 90,
        messages: [
          {
            role: "system",
            content:
              "Sen bir emlak ofisi danışman asistanısın. Sana günün brifing maddeleri verilecek. " +
              "Bunlardan TEK cümlelik, motive edici, samimi bir Türkçe özet üret " +
              "('Bugün önceliğin ...' tarzında). En fazla 25 kelime. Emoji ve madde işareti kullanma. " +
              "Sayıları yalnızca verilen maddelerden al; uydurma.",
          },
          {
            role: "user",
            content: `Bugünün brifing maddeleri:\n${items.map((i) => `- ${i.text}`).join("\n")}`,
          },
        ],
      },
    });
    const text = content?.trim();
    return text || null;
  } catch (e) {
    console.error("generateBriefingSummary", externalErrorMetadata(e));
    return null;
  }
}
