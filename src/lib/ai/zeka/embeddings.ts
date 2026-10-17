import "server-only";
import { openAiEmbeddings, type OpenAiCallAudit } from "@/lib/ai/openai-client";

/**
 * Sorgu vektörü (yalnız GPT kurulumunda, dizin varken). Tek istemci `openai-client.ts` (maskeleme + denetim + kredi).
 * Hata ya da zaman aşımında null: arama sözcüksel BM25 ile sürer.
 */
export async function embedQuery(input: { apiKey: string; model: string; text: string; audit: OpenAiCallAudit; signal?: AbortSignal }): Promise<number[] | null> {
  const [vec] = await openAiEmbeddings({
    apiKey: input.apiKey,
    purpose: "zeka_embed_query",
    model: input.model,
    input: [input.text.slice(0, 500)],
    timeoutMs: 4_000,
    audit: input.audit,
    signal: input.signal,
  });
  return vec && vec.length > 0 ? vec : null;
}
