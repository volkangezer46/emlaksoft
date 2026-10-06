import "server-only";
import { getOpenAiKey } from "@/lib/ai-advisor";
import { externalErrorMetadata } from "@/lib/external-fetch";
import { getOpenAiChatModel, openAiChat, type OpenAiAudit } from "@/lib/ai/openai-client";
import { canAutoCallAi } from "@/lib/ai/auto-call-gate";
import { acceptNarrative, buildNarrativeInput } from "@/lib/ai/narrative-guard";
import { now } from "@/lib/clock";
import type { InsightDraft } from "@/lib/insights/types";

/**
 * İçgörü LLM anlatımı (P2) — OPSİYONEL ve varsayılan KAPALI (ofis ayarı: oversight_settings.thresholds.insights
 * .narrativeEnabled; engine bu fonksiyonu yalnız ayar açıksa çağırır). Kural metni HER ZAMAN vardır; anlatım yalnız
 * günlük `digest` içgörüsünün üstüne eklenen kısa, motive edici bir paragraftır.
 *
 * GÜVENLİK/DÜRÜSTLÜK SÖZLEŞMESİ (insight-llm-boundary-contract.test.ts):
 *  - Yalnız `openai-client.ts` üzerinden gider (doğrudan api.openai.com yok); istem + kullanıcı verisi Redactor'dan geçer.
 *  - Girdi YALNIZ özet sayılar/etiketlerdir (içgörü türü adları + adetler). Kişisel veri (ad, iletişim, adres) yoktur.
 *  - Her çağrıda `audit: { tenantId, actorId }` (kredi defteri + ai.openai_call denetim izi).
 *  - Otomatik çağrı: KOTA KAPISI (kota doluysa çağrı yok) + önbellek (aynı özet iki kez çağrılmaz).
 *  - Girdide OLMAYAN sayı içeren çıktı REDDEDİLİR (kod doğrular); reddedilen/başarısız → null → kart kural metniyle görünür.
 */

const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_WORDS = 60;
const TTL_MS = 24 * 3_600_000;

const cache = new Map<string, { value: string | null; at: number }>();

export function resetInsightNarrativeCache(): void {
  cache.clear();
}

export async function generateInsightNarrative(args: { tenantId: string; userId: string; draft: InsightDraft }): Promise<string | null> {
  // Yalnız günlük özet için anlatım üretilir.
  if (args.draft.kind !== "digest") return null;
  if (!args.tenantId) return null;

  const input = buildNarrativeInput(args.draft);
  const key = `${args.tenantId}:${args.userId}:${args.draft.dedupeKey}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < TTL_MS) return hit.value;

  const value = await call(input, { tenantId: args.tenantId, actorId: args.userId });
  cache.set(key, { value, at: now() });
  return value;
}

async function call(input: string, audit: OpenAiAudit): Promise<string | null> {
  if (!(await canAutoCallAi(audit.tenantId))) return null;
  const apiKey = await getOpenAiKey();
  if (!apiKey) return null;
  try {
    const { content } = await openAiChat({
      apiKey,
      purpose: "insight_narrative",
      audit,
      timeoutMs: TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      body: {
        model: getOpenAiChatModel(),
        temperature: 0.4,
        max_tokens: 140,
        messages: [
          {
            role: "system",
            content:
              "Sen bir emlak ofisi için çalışan sakin ve saygılı bir asistansın. Sana bugünün öneri özeti verilecek. " +
              "Bundan en fazla 2 cümlelik, sade, motive edici Türkçe bir giriş yaz. Kimseyi suçlama, emoji ve madde işareti kullanma. " +
              "YALNIZCA verilen sayıları kullan; yeni sayı, tarih veya kişi adı UYDURMA.",
          },
          { role: "user", content: input },
        ],
      },
    });
    return acceptNarrative(content, input, { maxWords: MAX_WORDS });
  } catch (e) {
    console.error("generateInsightNarrative", externalErrorMetadata(e));
    return null;
  }
}
