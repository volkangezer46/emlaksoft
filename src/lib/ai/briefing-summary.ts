import "server-only";
import { getOpenAiKey } from "@/lib/ai-advisor";
import type { BriefingItem } from "@/lib/briefing";
import { externalErrorMetadata } from "@/lib/external-fetch";
import { getOpenAiChatModel, openAiChat, type OpenAiAudit } from "@/lib/ai/openai-client";
import { canAutoCallAi } from "@/lib/ai/auto-call-gate";
import { acceptNarrative } from "@/lib/ai/narrative-guard";
import { now, trDayKey } from "@/lib/clock";

const OPENAI_TIMEOUT_MS = 30_000;
const OPENAI_MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_WORDS = 30;
const HIT_TTL_MS = 24 * 3_600_000;
const MISS_TTL_MS = 10 * 60_000;

/**
 * Kullanıcı + gün + madde içeriği başına önbellek ve tek uçuş (aynı anda iki render tek çağrı yapar).
 * Süreç içi (sunucusuz örnek başına) önbelleğdir: tam garanti değil, ama "her render'da çağrı"yı bitirir.
 * Kalıcı çözüm cron'da üretilen `digest` içgörüsüdür (bkz. lib/ai/insight-narrative.ts).
 */
const resultCache = new Map<string, { value: string | null; at: number }>();
const inflight = new Map<string, Promise<string | null>>();

function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function resetBriefingSummaryCache(): void {
  resultCache.clear();
  inflight.clear();
}

/**
 * Opsiyonel AI cilası — brifing maddelerinden tek cümlelik motive edici özet.
 *
 * Anahtar okuma deseni `lib/ai-advisor.getOpenAiKey` ile aynı: önce DB ayarı
 * (admin → Sistem), yoksa `OPENAI_API_KEY` ortam değişkeni. Anahtar yoksa veya
 * çağrı başarısız olursa `null` döner — UI'da satır hiç görünmez (yedek metin
 * yazılmaz; kural tabanlı maddeler zaten kartta durur).
 *
 * `audit` ZORUNLUDUR (derleme zamanı): her çağrı kredi defterine ve `ai.openai_call` denetim izine yazılır
 * (bkz. briefing-audit-contract.test.ts). Otomatik çağrı olduğu için KOTA KAPISI vardır: kota doluysa LLM
 * çağrılmaz (null). Çıktıdaki her sayı girdide geçmek zorundadır; geçmiyorsa çıktı reddedilir.
 *
 * Sayfayı yavaşlatmamak için bu fonksiyon Suspense'li ayrı bir server
 * component içinden çağrılır (bkz. `src/app/app/page.tsx`).
 */
export async function generateBriefingSummary(items: BriefingItem[], audit: OpenAiAudit): Promise<string | null> {
  if (items.length === 0) return null;
  if (!audit.tenantId) return null;

  const input = items.map((i) => `- ${i.text}`).join("\n");
  const key = `${audit.tenantId}:${audit.actorId ?? "-"}:${trDayKey(now())}:${hashText(input)}`;
  const t = now();
  const hit = resultCache.get(key);
  if (hit && t - hit.at < (hit.value ? HIT_TTL_MS : MISS_TTL_MS)) return hit.value;
  const running = inflight.get(key);
  if (running) return running;

  const job = (async () => {
    const value = await callModel(input, audit);
    resultCache.set(key, { value, at: now() });
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function callModel(input: string, audit: OpenAiAudit): Promise<string | null> {
  if (!(await canAutoCallAi(audit.tenantId))) return null;
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
            content: `Bugünün brifing maddeleri:\n${input}`,
          },
        ],
      },
    });
    return acceptNarrative(content, input, { maxWords: MAX_WORDS });
  } catch (e) {
    console.error("generateBriefingSummary", externalErrorMetadata(e));
    return null;
  }
}
