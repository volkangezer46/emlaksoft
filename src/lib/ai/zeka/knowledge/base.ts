import type { AppModule } from "@/lib/permissions";
import type { ZekaSurface } from "../types";
import { buildBm25, cosine, hybridScores, searchBm25, type Bm25Index } from "./bm25";
import { knowledgeVersion, type KnowledgeChunk } from "./chunks";

/**
 * Bilgi tabanı (SAF): parçalar + BM25 dizini + (varsa) gömme vektörleri. Yüzey ve yetki süzgeci aramadan ÖNCE
 * uygulanır: kullanıcının göremediği modülün parçası hiçbir motorun bağlamına girmez.
 */

export type ChunkFilter = {
  surface: ZekaSurface;
  /** Okunabilir modüller (yoksa modül şartı olan parça elenir). */
  canView?: (mod: AppModule) => boolean;
  /** Oluşturulabilir modüller. */
  canCreate?: (mod: AppModule) => boolean;
  /** Pakete/ofise kapalı yol (gezinme hedefi önerilmez). */
  hrefBlocked?: (href: string) => boolean;
};

export type KnowledgeHit = { chunk: KnowledgeChunk; score: number };

export class KnowledgeBase {
  readonly version: string;
  private readonly byId: Map<string, KnowledgeChunk>;
  private readonly index: Bm25Index;

  constructor(
    readonly chunks: readonly KnowledgeChunk[],
    /** Parça kimliği → gömme vektörü (anahtar eklenip dizin kurulduysa). */
    private readonly vectors: ReadonlyMap<string, readonly number[]> = new Map(),
  ) {
    this.version = knowledgeVersion(chunks);
    this.byId = new Map(chunks.map((c) => [c.id, c]));
    this.index = buildBm25(chunks.map((c) => ({ id: c.id, text: `${c.body} ${(c.keywords ?? []).join(" ")}`, boost: `${c.title} ${(c.keywords ?? []).join(" ")}` })));
  }

  get hasVectors(): boolean {
    return this.vectors.size > 0;
  }

  allowed(c: KnowledgeChunk, f: ChunkFilter): boolean {
    if (!c.surfaces.includes(f.surface)) return false;
    if (c.modules.length > 0) {
      if (!f.canView || !c.modules.every((m) => f.canView!(m))) return false;
      if (c.needsCreate && (!f.canCreate || !c.modules.every((m) => f.canCreate!(m)))) return false;
    }
    if (c.href && f.hrefBlocked?.(c.href)) return false;
    return true;
  }

  /** Süzgeçten geçen parçalar (başlık eşleşmesi gibi sözcüksel olmayan sıralamalar için). */
  allowedChunks(f: ChunkFilter, sources?: readonly KnowledgeChunk["source"][]): KnowledgeChunk[] {
    return this.chunks.filter((c) => this.allowed(c, f) && (!sources || sources.includes(c.source)));
  }

  /** Melez arama (gömme vektörü + sorgu vektörü verilmişse), aksi halde BM25. */
  search(query: string, f: ChunkFilter, opts: { limit?: number; sources?: readonly KnowledgeChunk["source"][]; queryVector?: readonly number[] | null } = {}): KnowledgeHit[] {
    const limit = opts.limit ?? 5;
    const ok = (id: string) => {
      const c = this.byId.get(id);
      return Boolean(c && this.allowed(c, f) && (!opts.sources || opts.sources.includes(c.source)));
    };
    const lexical = searchBm25(this.index, query, 60).filter((h) => ok(h.id));
    let semantic: { id: string; score: number }[] | null = null;
    if (opts.queryVector && this.vectors.size > 0) {
      semantic = [];
      for (const [id, vec] of this.vectors) if (ok(id)) semantic.push({ id, score: cosine(opts.queryVector, vec) });
      semantic.sort((a, b) => b.score - a.score);
      semantic = semantic.slice(0, 30).filter((s) => s.score > 0.25);
    }
    return hybridScores(lexical, semantic, limit).map((h) => ({ chunk: this.byId.get(h.id)!, score: h.score }));
  }
}
