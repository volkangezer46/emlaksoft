import "server-only";
import { getOpenAiKey } from "@/lib/ai-advisor";
import { externalErrorMetadata } from "@/lib/external-fetch";
import { getOpenAiChatModel, openAiChat, type OpenAiAudit } from "@/lib/ai/openai-client";
import { acceptNarrative } from "@/lib/ai/narrative-guard";
import { now, trDayKey } from "@/lib/clock";

/**
 * İlan Kontrol yönetici/danışman AI özeti. KULLANICI TIKLAMASIYLA çalışır (otomatik çağrı yok), ofis/kullanıcı/gün/girdi
 * başına önbelleklenir. Girdi YALNIZ `report-facts.ts` olgularıdır (sayılar + sabit etiketler; kişisel veri yok) ve
 * `openai-client.ts` içinde yine Redactor'dan geçer. Çıktıdaki her sayı girdide geçmek zorundadır (`acceptNarrative`);
 * geçmeyen/boş/uzun çıktı REDDEDİLİR ve çağıran kural tabanlı özete döner. Anahtar yoksa ya da çağrı başarısızsa null.
 * `audit` ZORUNLUDUR: kredi defteri + `ai.openai_call` denetim izi.
 */

const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_WORDS = 70;
const TTL_MS = 6 * 3_600_000;

const cache = new Map<string, { value: string | null; at: number }>();

export function resetListingControlSummaryCache(): void {
  cache.clear();
}

function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function generateListingControlSummary(input: string, audience: "manager" | "advisor", audit: OpenAiAudit): Promise<string | null> {
  if (!audit.tenantId || !input.trim()) return null;
  const key = `${audit.tenantId}:${audit.actorId ?? "-"}:${trDayKey(now())}:${audience}:${hashText(input)}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < TTL_MS) return hit.value;
  const value = await callModel(input, audience, audit);
  cache.set(key, { value, at: now() });
  return value;
}

async function callModel(input: string, audience: "manager" | "advisor", audit: OpenAiAudit): Promise<string | null> {
  const apiKey = await getOpenAiKey();
  if (!apiKey) return null;
  const who = audience === "manager" ? "ofis yöneticisi için" : "danışman için";
  try {
    const { content } = await openAiChat({
      apiKey,
      purpose: "listing_control_summary",
      audit,
      timeoutMs: TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      body: {
        model: getOpenAiChatModel(),
        temperature: 0.3,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content:
              `Sen bir emlak ofisinin portföy ilan kontrol asistanısın. Sana bir dönemin ilan kontrol sayıları verilecek. ` +
              `Bundan ${who} en fazla 4 cümlelik, sade, eyleme dönük bir Türkçe özet yaz: önce en acil konu, sonra yapılacak. ` +
              "Kimseyi suçlama, emoji ve madde işareti kullanma. YALNIZCA verilen sayıları kullan; yeni sayı, yüzde, tarih, ilan veya kişi adı UYDURMA.",
          },
          { role: "user", content: input },
        ],
      },
    });
    return acceptNarrative(content, input, { maxWords: MAX_WORDS });
  } catch (e) {
    console.error("generateListingControlSummary", externalErrorMetadata(e));
    return null;
  }
}
