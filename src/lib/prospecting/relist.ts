import { rankCandidates, type MatchProbe } from "@/lib/listing-control/matching";
import { RELIST_MIN_SCORE } from "./thresholds";

export type RelistProbe = {
  id: string;
  phoneHash?: string | null;
  districtId?: string | null;
  rooms?: string | null;
  sqm?: number | null;
  price?: number | null;
  title?: string | null;
};

export type RelistSuggestion = {
  leadId: string;
  /** phone: aynı numara (kesin); similar: ilçe + oda + m² + fiyat benzerliği (yalnız ÖNERİ, kullanıcı onaylar). */
  reason: "phone" | "similar";
  score: number;
};

function probeOf(p: RelistProbe): MatchProbe {
  return { districtKey: p.districtId ?? null, rooms: p.rooms ?? null, sqm: p.sqm ?? null, price: p.price ?? null, title: p.title ?? null };
}

/**
 * Tekrar ilan tespiti (SAF). Adaylar yalnız "kayıp/ilan kalktı" ya da yayından kalkmış kayıtlardır (çağıran süzer).
 * (a) Aynı telefon özeti → kesin. (b) Aynı ilçede mevcut eşleştirme skoru (portal profili: m² ±%3, fiyat ±%5, oda, başlık)
 * eşik üstündeyse öneri. Kopya motor yazılmaz: skor `listing-control/matching.ts`'ten gelir.
 */
export function suggestRelist(subject: RelistProbe, candidates: readonly RelistProbe[]): RelistSuggestion | null {
  const others = candidates.filter((c) => c.id !== subject.id);
  if (subject.phoneHash) {
    const hit = others.find((c) => c.phoneHash && c.phoneHash === subject.phoneHash);
    if (hit) return { leadId: hit.id, reason: "phone", score: 100 };
  }
  if (!subject.districtId) return null;
  const sameDistrict = others.filter((c) => c.districtId && c.districtId === subject.districtId);
  const ranked = rankCandidates(
    probeOf(subject),
    sameDistrict.map((c) => ({ id: c.id, probe: probeOf(c) })),
    RELIST_MIN_SCORE,
    undefined,
    1,
    "portal",
  );
  const top = ranked[0];
  return top ? { leadId: top.candidate.id, reason: "similar", score: top.match.score } : null;
}
