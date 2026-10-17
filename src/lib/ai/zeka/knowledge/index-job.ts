import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { openAiEmbeddings } from "@/lib/ai/openai-client";
import { platformQuotaGateOpen } from "@/lib/ai/platform-quota";
import { readZekaConfig, zekaApiKey } from "../settings";
import { allChunksForIndex, invalidateKnowledgeCache } from "./store";
import type { ApprovedQa, KnowledgeChunk } from "./chunks";

/**
 * Zeka ANLAMSAL DİZİN işi (gece bakımı adımı; `/api/cron/olcum-bakim`). Anahtar yoksa ya da ayar kapalıysa ATLANIR
 * (anahtarsız kurulum aynen çalışır: yerel zeka BM25). Anahtar eklenince bir sonraki gece TÜM bilgi parçaları (kod +
 * yardım merkezi + paketler + onaylı soru-cevaplar) gömülür; sonraki gecelerde yalnız İÇERİĞİ DEĞİŞEN parçalar.
 * Çağrılar tek istemciden (`openai-client`: maskeleme + denetim); platform çağrısıdır, kiracı kredisinden düşmez,
 * isteğe bağlı platform kotası `zeka.index` anahtarıyla sınırlanır. service_role yalnız bu dosyada (kabul listesi).
 */

const BATCH = 64;
const MAX_PER_RUN = 640;
const MISSING = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);

export function chunkText(c: KnowledgeChunk): string {
  return `${c.title}\n${c.body}${c.keywords?.length ? `\n${c.keywords.join(", ")}` : ""}`.slice(0, 4000);
}

/** İçerik özeti (FNV-1a 32 bit, onaltılık). */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Hangi parçalar yeniden gömülmeli (SAF): yeni, içeriği değişmiş ya da model değişmiş. */
export function chunksToEmbed(chunks: readonly KnowledgeChunk[], state: ReadonlyMap<string, { hash: string; model: string }>, model: string): KnowledgeChunk[] {
  return chunks.filter((c) => {
    const s = state.get(c.id);
    return !s || s.model !== model || s.hash !== contentHash(chunkText(c));
  });
}

export type ZekaIndexReport = { status: "skipped" | "ok" | "error"; detail: string; embedded: number; total: number };

export async function runZekaIndex(): Promise<ZekaIndexReport> {
  const cfg = await readZekaConfig("app");
  if (!cfg.embeddings) return { status: "skipped", detail: "anlamsal dizin kapalı", embedded: 0, total: 0 };
  const key = await zekaApiKey();
  if (!key) return { status: "skipped", detail: "OpenAI anahtarı yok (yerel zeka sözcüksel arama kullanır)", embedded: 0, total: 0 };

  const admin = createAdminClient();
  const stateRes = await admin.rpc("zeka_knowledge_vectors_state");
  if (stateRes.error) {
    if (MISSING.has(String(stateRes.error.code ?? ""))) return { status: "skipped", detail: "dizin tablosu kurulmadı (migration bekliyor)", embedded: 0, total: 0 };
    return { status: "error", detail: "dizin durumu okunamadı", embedded: 0, total: 0 };
  }
  const state = new Map<string, { hash: string; model: string }>();
  for (const r of (stateRes.data ?? []) as { chunk_id: string; content_hash: string; model: string }[]) state.set(r.chunk_id, { hash: r.content_hash, model: r.model });

  const qaRes = await admin.from("zeka_qa").select("id, surface, question, answer, href").eq("status", "active").limit(1000);
  const qa = (qaRes.error ? [] : (qaRes.data ?? [])) as ApprovedQa[];
  const chunks = await allChunksForIndex(qa);
  const todo = chunksToEmbed(chunks, state, cfg.embeddingModel).slice(0, MAX_PER_RUN);
  if (todo.length > 0 && !(await platformQuotaGateOpen("zeka.index"))) {
    return { status: "skipped", detail: "platform AI kotası doldu", embedded: 0, total: chunks.length };
  }

  let embedded = 0;
  try {
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const texts = batch.map(chunkText);
      const vectors = await openAiEmbeddings({
        apiKey: key,
        purpose: "zeka.index",
        model: cfg.embeddingModel,
        input: texts,
        timeoutMs: 30_000,
        audit: { platform: true, purpose: "zeka.index", actorId: null },
      });
      const rows = batch
        .map((c, j) => ({ chunk_id: c.id, content_hash: contentHash(texts[j]!), model: cfg.embeddingModel, embedding: vectors[j] ?? [] }))
        .filter((r) => r.embedding.length >= 8);
      const keep = i + BATCH >= todo.length ? chunks.map((c) => c.id) : null;
      const { error } = await admin.rpc("zeka_knowledge_vectors_store", { p_rows: rows, p_keep: keep });
      if (error) return { status: "error", detail: "dizin yazılamadı", embedded, total: chunks.length };
      embedded += rows.length;
    }
    if (todo.length === 0) {
      // Silinen parçaları temizle (içerik değişmeden kaldırılan sayfa/SSS).
      await admin.rpc("zeka_knowledge_vectors_store", { p_rows: [], p_keep: chunks.map((c) => c.id) });
    }
  } catch {
    return { status: "error", detail: "gömme çağrısı başarısız", embedded, total: chunks.length };
  }
  invalidateKnowledgeCache();
  return { status: "ok", detail: `${embedded} parça gömüldü / ${chunks.length}`, embedded, total: chunks.length };
}
