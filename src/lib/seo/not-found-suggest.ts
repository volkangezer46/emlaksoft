import { seoPages } from "./registry";
import { normalizeRedirectPath } from "./redirects";
import type { SeoRedirectRule } from "./schema";

/**
 * 404 yolu için yönlendirme hedefi önerisi (SAF). Yalnız ÖNERİ üretir; kural yönetici onayıyla mevcut
 * yönlendirme akışından kaydedilir. Sıra:
 *   1) Sabit takma adlar (İngilizce/alışkanlık adresleri): pricing → /fiyatlar, login → /giris ...
 *   2) Son segmentte yakın yazım (Levenshtein ≤ 2; kısa kelimede ≤ 1) ya da önek eşleşmesi.
 * Öneri yalnız aday listesindeki (gerçekten var olan) bir hedefe yapılır; yoksa null.
 */

export const NOT_FOUND_ALIASES: Readonly<Record<string, string>> = {
  pricing: "/fiyatlar",
  prices: "/fiyatlar",
  price: "/fiyatlar",
  plans: "/fiyatlar",
  about: "/hakkimizda",
  "about-us": "/hakkimizda",
  contact: "/iletisim",
  "contact-us": "/iletisim",
  login: "/giris",
  signin: "/giris",
  "sign-in": "/giris",
  register: "/kayit",
  signup: "/kayit",
  "sign-up": "/kayit",
  tools: "/araclar",
};

/** Aday hedefler: yönetilebilir sayfalar + mevcut (açık) yönlendirmelerin site içi hedefleri. */
export function notFoundCandidates(rules: readonly SeoRedirectRule[] = []): string[] {
  const out = new Set<string>(seoPages().map((p) => p.path));
  for (const r of rules) {
    if (r.enabled && r.to.startsWith("/") && !r.to.startsWith("//")) out.add(r.to.replace(/[?#].*$/, ""));
  }
  return [...out];
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

const lastSegment = (p: string) => {
  const segs = normalizeRedirectPath(p).split("/").filter(Boolean);
  return (segs[segs.length - 1] ?? "").replace(/\.(html?|php\d*|aspx?)$/, "");
};

export function suggest404Target(path: string, candidates: readonly string[]): string | null {
  const from = normalizeRedirectPath(path);
  const seg = lastSegment(from);
  if (!seg) return null;
  const valid = candidates.filter((c) => c !== "/" && normalizeRedirectPath(c) !== from);
  const has = (target: string) => valid.find((c) => normalizeRedirectPath(c) === normalizeRedirectPath(target)) ?? null;

  const alias = NOT_FOUND_ALIASES[seg];
  if (alias) {
    const hit = has(alias);
    if (hit) return hit;
  }

  let best: { target: string; score: number } | null = null;
  for (const c of valid) {
    const cseg = lastSegment(c);
    if (!cseg) continue;
    const limit = Math.min(seg.length, cseg.length) <= 4 ? 1 : 2;
    const d = levenshtein(seg, cseg);
    let score = d <= limit ? d : Number.POSITIVE_INFINITY;
    // Önek: "fiyat" -> "/fiyatlar", "kira-artis-hesaplama-2026" -> "/araclar/kira-artis-hesaplama".
    if (!Number.isFinite(score) && Math.min(seg.length, cseg.length) >= 4 && (cseg.startsWith(seg) || seg.startsWith(cseg))) score = 3;
    if (Number.isFinite(score) && (!best || score < best.score || (score === best.score && c.length < best.target.length))) {
      best = { target: c, score };
    }
  }
  return best?.target ?? null;
}
