import { tokenSimilarity } from "@/lib/duplicate-match";
import { photoHashSimilarity } from "./photo-hash";

/**
 * Eşleştirme güveni (SAF): (a) kayıtsız portal ilanı ↔ portföy, (b) portföy ↔ portföy mükerrer (benzerlik %).
 * Sinyaller: ilan no, URL, danışman, adres, konum, fiyat, m², oda, başlık, ada/parsel; fotoğraf/açıklama benzerliği için
 * `SimilarityProvider` ARAYÜZÜ (uygulama sonra: görüntü/metin gömme). Sahte skor yok: yüzde HANGİ sinyallerden
 * oluştuğunu `signals` ile söyler; iki tarafta da bulunmayan sinyal ÖLÇÜLEMEDİ sayılır ve paydadan çıkar.
 * İlan no veya URL birebir eşleşirse kesin eşleşmedir (100).
 */

export type MatchProbe = {
  portal?: string | null;
  externalId?: string | null;
  url?: string | null;
  advisorName?: string | null;
  address?: string | null;
  title?: string | null;
  price?: number | null;
  sqm?: number | null;
  rooms?: string | null;
  block?: string | null;
  lot?: string | null;
  districtKey?: string | null;
  /** Konum (portföy haritası). İki tarafta da varsa "Konum yakın" sinyali ölçülür. */
  lat?: number | null;
  lng?: number | null;
  /** Fotoğraf dHash'leri (16 hane hex, 64 bit). İki tarafta da en az bir hash varsa "Fotoğraf benzerliği" ölçülür. */
  photoHashes?: readonly string[] | null;
};

/** İki koordinat arası yaklaşık mesafe (metre; küçük mesafelerde eşdikdörtgen yaklaşımı yeterli). */
export function approxDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = Math.PI / 180;
  const x = (b.lng - a.lng) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
  const y = (b.lat - a.lat) * toRad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

function geoCloseness(a: MatchProbe, b: MatchProbe): number | null {
  const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v !== 0;
  if (!ok(a.lat) || !ok(a.lng) || !ok(b.lat) || !ok(b.lng)) return null;
  const d = approxDistanceMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
  if (d <= 30) return 1;
  if (d >= 300) return 0;
  return 1 - (d - 30) / 270;
}

export type MatchSignal = { key: string; label: string; points: number; max: number };
export type MatchScore = { score: number; decisive: boolean; signals: MatchSignal[]; unmeasured: string[] };

/** Fotoğraf / açıklama benzerliği için takılabilir sağlayıcı (0..1 ya da null = ölçülemedi). */
export interface SimilarityProvider {
  photoSimilarity?(a: MatchProbe, b: MatchProbe): number | null;
  descriptionSimilarity?(a: MatchProbe, b: MatchProbe): number | null;
}

/** URL'yi karşılaştırılabilir hale getirir: şema/www/sorgu/parça atılır, küçük harf, sondaki / atılır. */
export function normalizeUrlKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return null;
  }
}

export function normalizeExternalId(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "" ? null : v;
}

function ratioClose(a: number | null | undefined, b: number | null | undefined, tol: number): number | null {
  if (!a || !b || a <= 0 || b <= 0) return null;
  const d = Math.abs(a - b) / Math.max(a, b);
  if (d <= tol) return 1;
  if (d >= tol * 4) return 0;
  return 1 - (d - tol) / (tol * 3);
}

/**
 * Ağırlık profilleri (ölçülemeyen sinyal paydadan çıkar). `default`: portföy↔portföy kopya taraması (değişmedi).
 * `portal`: portal ilanı ↔ portföy (tasarım 2026-10): konum ≤30 m 20 · adres 15 · m² ±%3 15 · oda 10 · fiyat ±%5 15 ·
 * fotoğraf 15 · başlık 5 · danışman 5 (+ ada/parsel 30, açıklama 5). İlan no/URL birebir her profilde 100'dür.
 */
export type MatchProfile = "default" | "portal";
const WEIGHTS: Record<MatchProfile, { parcel: number; address: number; geo: number; title: number; price: number; priceTol: number; sqm: number; rooms: number; advisor: number; photo: number }> = {
  default: { parcel: 30, address: 25, geo: 15, title: 10, price: 15, priceTol: 0.03, sqm: 10, rooms: 5, advisor: 5, photo: 15 },
  portal: { parcel: 30, address: 15, geo: 20, title: 5, price: 15, priceTol: 0.05, sqm: 15, rooms: 10, advisor: 5, photo: 15 },
};

/** Güven bantları: ≥85 "Önerilen eşleşme" (tek tık onay), 60-84 "Emin değilim", <60 gösterilmez. */
export const MATCH_BANDS = { suggested: 85, unsure: 60 } as const;
export type MatchBand = "suggested" | "unsure" | "none";

export function bandOf(score: number): MatchBand {
  return score >= MATCH_BANDS.suggested ? "suggested" : score >= MATCH_BANDS.unsure ? "unsure" : "none";
}

/**
 * Bir portal ilanının aday listesinden karar bandı. Aynı ilan birden çok portföye ≥85 verirse OTOMATİK/tek tık önerilmez:
 * `ambiguous` olur ve "hangisi?" diye sorulur (bant "unsure" sayılır).
 */
export function resolveBand(candidates: readonly { score: number }[]): { band: MatchBand; ambiguous: boolean } {
  const top = candidates.reduce((m, c) => Math.max(m, c.score), 0);
  const strong = candidates.filter((c) => c.score >= MATCH_BANDS.suggested).length;
  if (strong >= 2) return { band: "unsure", ambiguous: true };
  return { band: bandOf(top), ambiguous: false };
}

export function scoreMatch(a: MatchProbe, b: MatchProbe, extra?: SimilarityProvider, profile: MatchProfile = "default"): MatchScore {
  const aId = normalizeExternalId(a.externalId);
  const bId = normalizeExternalId(b.externalId);
  const samePortal = !a.portal || !b.portal || a.portal.toLowerCase() === b.portal.toLowerCase();
  if (aId && bId && aId === bId && samePortal) {
    return { score: 100, decisive: true, signals: [{ key: "external_id", label: "İlan numarası aynı", points: 100, max: 100 }], unmeasured: [] };
  }
  const aUrl = normalizeUrlKey(a.url);
  const bUrl = normalizeUrlKey(b.url);
  if (aUrl && bUrl && aUrl === bUrl) {
    return { score: 100, decisive: true, signals: [{ key: "url", label: "İlan bağlantısı aynı", points: 100, max: 100 }], unmeasured: [] };
  }

  const signals: MatchSignal[] = [];
  const unmeasured: string[] = [];
  const push = (key: string, label: string, max: number, value: number | null) => {
    if (value === null) {
      unmeasured.push(key);
      return;
    }
    signals.push({ key, label, max, points: Math.round(max * Math.min(1, Math.max(0, value)) * 10) / 10 });
  };

  const parcel =
    a.block && a.lot && b.block && b.lot && (!a.districtKey || !b.districtKey || a.districtKey === b.districtKey)
      ? a.block.trim() === b.block.trim() && a.lot.trim() === b.lot.trim()
        ? 1
        : 0
      : null;
  const w = WEIGHTS[profile];
  push("parcel", "Ada/parsel aynı", w.parcel, parcel);
  push("address", "Adres benzerliği", w.address, a.address && b.address ? tokenSimilarity(a.address, b.address) : null);
  push("geo", "Konum yakın", w.geo, geoCloseness(a, b));
  push("title", "Başlık benzerliği", w.title, a.title && b.title ? tokenSimilarity(a.title, b.title) : null);
  push("price", "Fiyat yakın", w.price, ratioClose(a.price, b.price, w.priceTol));
  push("sqm", "m² yakın", w.sqm, ratioClose(a.sqm, b.sqm, 0.03));
  push("rooms", "Oda sayısı aynı", w.rooms, a.rooms && b.rooms ? (a.rooms.trim() === b.rooms.trim() ? 1 : 0) : null);
  push("advisor", "Danışman adı benzer", w.advisor, a.advisorName && b.advisorName ? tokenSimilarity(a.advisorName, b.advisorName) : null);
  // Fotoğraf: önce takılı sağlayıcı, yoksa iki tarafta da dHash varsa Hamming benzerliği (ölçülemezse paydadan çıkar).
  push("photo", "Fotoğraf benzerliği", w.photo, extra?.photoSimilarity?.(a, b) ?? photoHashSimilarity(a.photoHashes, b.photoHashes));
  push("description", "Açıklama benzerliği", 5, extra?.descriptionSimilarity?.(a, b) ?? null);

  const max = signals.reduce((s, x) => s + x.max, 0);
  // En az iki ölçülmüş sinyal ve en az 40 puanlık ölçüm yoksa güvenilir skor üretilmez.
  if (signals.length < 2 || max < 40) return { score: 0, decisive: false, signals, unmeasured };
  const earned = signals.reduce((s, x) => s + x.points, 0);
  return { score: Math.round((earned / max) * 100), decisive: false, signals, unmeasured };
}

export type RankedCandidate<T> = { candidate: T; match: MatchScore };

/** Adayları skora göre sıralar; `minScore` altındakileri atar. */
export function rankCandidates<T extends { probe: MatchProbe }>(
  subject: MatchProbe,
  candidates: readonly T[],
  minScore = 50,
  extra?: SimilarityProvider,
  limit = 5,
  profile: MatchProfile = "default",
): RankedCandidate<T>[] {
  return candidates
    .map((candidate) => ({ candidate, match: scoreMatch(subject, candidate.probe, extra, profile) }))
    .filter((r) => r.match.score >= minScore)
    .sort((x, y) => y.match.score - x.match.score)
    .slice(0, limit);
}
