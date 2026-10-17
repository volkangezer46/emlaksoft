import { foldTr } from "@/lib/tr-text";
import { stemTr } from "../normalize";

/**
 * Sözcüksel (BM25) arama — SAF, bağımlılıksız. Belirteç: katlanmış sözcük → kaba Türkçe kök → ilk 6 harf
 * ("müşterilerimi" → "muster"); kısa dolgu sözcükleri atılır. Anahtar olmadan Zeka'nın bilgi tabanı bununla aranır;
 * anahtar eklenince gömme (embedding) puanı ile birleşir (`hybridScores`).
 */

const STOP = new Set([
  "ve", "ile", "bir", "bu", "su", "mi", "mu", "de", "da", "ne", "nasil", "icin", "ama", "veya", "ya", "ben", "biz", "olarak",
  "gibi", "var", "yok", "kadar", "daha", "cok", "en", "her", "hangi", "nerede", "neden", "yapabilirim", "yapilir", "edebilirim",
  "olur", "olabilir", "istiyorum", "lazim", "emlaksoft", "nedir", "mi", "musun", "misin", "the", "ki", "ise", "olan", "veya",
]);

export function bm25Tokens(text: string): string[] {
  return foldTr(text)
    .replace(/[^a-z0-9+\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t))
    .map((t) => (/^[a-z]+$/.test(t) ? stemTr(t).slice(0, 6) : t));
}

export type Bm25Doc = { id: string; text: string; /** Başlık gibi ağır alan (iki kez sayılır). */ boost?: string };

export type Bm25Index = {
  docs: { id: string; tf: Map<string, number>; len: number }[];
  df: Map<string, number>;
  avgLen: number;
};

export function buildBm25(docs: readonly Bm25Doc[]): Bm25Index {
  const df = new Map<string, number>();
  const out: Bm25Index["docs"] = [];
  let total = 0;
  for (const d of docs) {
    const toks = [...bm25Tokens(d.text), ...bm25Tokens(d.boost ?? ""), ...bm25Tokens(d.boost ?? "")];
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    out.push({ id: d.id, tf, len: toks.length });
    total += toks.length;
  }
  return { docs: out, df, avgLen: out.length ? total / out.length : 0 };
}

/** BM25 puanları (k1=1.2, b=0.75); sıfır puanlı belge dönmez. */
export function searchBm25(index: Bm25Index, query: string, limit = 5): { id: string; score: number }[] {
  const q = [...new Set(bm25Tokens(query))];
  if (q.length === 0 || index.docs.length === 0) return [];
  const N = index.docs.length;
  const k1 = 1.2;
  const b = 0.75;
  const scored: { id: string; score: number }[] = [];
  for (const d of index.docs) {
    let s = 0;
    for (const t of q) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = index.df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * d.len) / (index.avgLen || 1)));
    }
    if (s > 0) scored.push({ id: d.id, score: s });
  }
  return scored.sort((a, b2) => b2.score - a.score || a.id.localeCompare(b2.id)).slice(0, limit);
}

/** Kosinüs benzerliği (gömme vektörleri; uzunluklar farklıysa 0). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Melez sıralama: sözcüksel puan [0,1]'e ölçeklenir, gömme kosinüsüyle ağırlıklı toplanır (varsayılan %45 sözcüksel,
 * %55 anlamsal). Gömme yoksa yalnız sözcüksel sıra döner (anahtarsız kurulum aynen çalışır).
 */
export function hybridScores(
  lexical: readonly { id: string; score: number }[],
  semantic: readonly { id: string; score: number }[] | null,
  limit = 5,
  lexWeight = 0.45,
): { id: string; score: number }[] {
  if (!semantic || semantic.length === 0) return lexical.slice(0, limit);
  const maxLex = Math.max(0.0001, ...lexical.map((l) => l.score));
  const merged = new Map<string, number>();
  for (const l of lexical) merged.set(l.id, (l.score / maxLex) * lexWeight);
  for (const s of semantic) merged.set(s.id, (merged.get(s.id) ?? 0) + Math.max(0, s.score) * (1 - lexWeight));
  return [...merged.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
