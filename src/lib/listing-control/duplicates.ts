import { scoreMatch, type MatchProbe, type MatchSignal, type SimilarityProvider } from "./matching";
import type { DesiredAnomaly } from "./anomaly-rules";

/**
 * KOPYA PORTFÖY KURALI (SAF, testli). Aynı ofiste aynı gayrimenkulün iki kez girilmesini `scoreMatch` ile bulur
 * (ada/parsel, adres, konum, m², oda, fiyat yakınlığı, başlık; fotoğraf benzerliği sağlayıcı verilirse). Ölçek: aday
 * çiftler ilçe + tür + işlem türüne göre bloklanır ve fiyatı %10'dan fazla farklı olan çift karşılaştırılmaz
 * (5000+ portföylü ofiste n² karşılaştırma yapılmaz). Yanlış pozitif koruması:
 *   - Kat bilgisi iki tarafta da var ve farklıysa çift ATILIR (aynı binada aynı tip daireler kopya değildir).
 *   - Kimlik sinyali (ada/parsel, adres ≥ %80 ya da konum ≤ 30 m) yoksa skor ne olursa olsun kopya sayılmaz.
 * Anomali YENİ girilen (daha geç oluşturulan) portföyde açılır; anahtar çift kimliğinden üretilir (aynı çift tek uyarı).
 * SLA yükseltmesi yoktur (temizlik işidir); yönetim "yanlış alarm" diye kapatabilir, kapatılan çift yeniden açılmaz.
 */

export type DupProperty = {
  id: string;
  code: string | null;
  createdAt: string | null;
  districtId: string | null;
  propertyType: string | null;
  transactionType: string | null;
  title: string | null;
  address: string | null;
  price: number | null;
  sqm: number | null;
  rooms: string | null;
  floor: string | null;
  block: string | null;
  lot: string | null;
  lat: number | null;
  lng: number | null;
};

export type DuplicatePair = { newerId: string; olderId: string; olderCode: string | null; score: number; signals: MatchSignal[] };

/** Tek blokta en fazla bu kadar portföy karşılaştırılır (kalanı sonraki tura kalmaz; blok büyükse fiyat penceresi daraltır). */
const MAX_BLOCK = 2_000;
const PRICE_WINDOW = 0.1;

function probe(p: DupProperty): MatchProbe {
  return {
    title: p.title,
    address: p.address,
    price: p.price,
    sqm: p.sqm,
    rooms: p.rooms,
    block: p.block,
    lot: p.lot,
    lat: p.lat,
    lng: p.lng,
    districtKey: p.districtId,
  };
}

function hasIdentitySignal(signals: readonly MatchSignal[]): boolean {
  return signals.some(
    (s) =>
      (s.key === "parcel" && s.points >= s.max) ||
      (s.key === "address" && s.points >= s.max * 0.8) ||
      (s.key === "geo" && s.points >= s.max),
  );
}

function floorsDiffer(a: DupProperty, b: DupProperty): boolean {
  const fa = (a.floor ?? "").trim().toLocaleLowerCase("tr-TR");
  const fb = (b.floor ?? "").trim().toLocaleLowerCase("tr-TR");
  return fa !== "" && fb !== "" && fa !== fb;
}

function newerFirst(a: DupProperty, b: DupProperty): [DupProperty, DupProperty] {
  const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
  const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
  if (ta !== tb) return ta > tb ? [a, b] : [b, a];
  return a.id > b.id ? [a, b] : [b, a];
}

export function findDuplicatePairs(props: readonly DupProperty[], thresholdPercent: number, extra?: SimilarityProvider): DuplicatePair[] {
  const blocks = new Map<string, DupProperty[]>();
  for (const p of props) {
    if (!p.districtId || !p.propertyType || !p.transactionType) continue;
    const key = `${p.districtId}|${p.propertyType}|${p.transactionType}`;
    const list = blocks.get(key);
    if (list) list.push(p);
    else blocks.set(key, [p]);
  }
  const out: DuplicatePair[] = [];
  for (const list of blocks.values()) {
    const sorted = [...list].sort((x, y) => (x.price ?? 0) - (y.price ?? 0)).slice(0, MAX_BLOCK);
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length; j += 1) {
        const b = sorted[j];
        if (a.price && b.price && (b.price - a.price) / b.price > PRICE_WINDOW) break; // fiyat sıralı: sonrakiler daha uzak
        if (floorsDiffer(a, b)) continue;
        const m = scoreMatch(probe(a), probe(b), extra);
        if (m.score < thresholdPercent || !hasIdentitySignal(m.signals)) continue;
        const [newer, older] = newerFirst(a, b);
        out.push({ newerId: newer.id, olderId: older.id, olderCode: older.code, score: m.score, signals: m.signals });
      }
    }
  }
  return out;
}

export function duplicateDedupeKey(a: string, b: string): string {
  return a < b ? `duplicate:${a}:${b}` : `duplicate:${b}:${a}`;
}

/** Çiftleri portföy bazlı istenen anomali kümesine çevirir (yeni portföyde; en fazla 5 eş). */
export function duplicateAnomalies(pairs: readonly DuplicatePair[]): Map<string, DesiredAnomaly[]> {
  const byProp = new Map<string, DesiredAnomaly[]>();
  const sorted = [...pairs].sort((x, y) => y.score - x.score);
  for (const p of sorted) {
    const list = byProp.get(p.newerId) ?? [];
    if (list.length >= 5) continue;
    list.push({
      type: "duplicate",
      severity: p.score >= 97 ? "high" : "medium",
      dedupeKey: duplicateDedupeKey(p.newerId, p.olderId),
      portalListingId: null,
      details: {
        otherPropertyId: p.olderId,
        otherCode: p.olderCode,
        score: p.score,
        label: `%${p.score} aynı gayrimenkul`,
        signals: p.signals.filter((s) => s.points > 0).map((s) => s.label),
      },
      slaDueAt: null,
    });
    byProp.set(p.newerId, list);
  }
  return byProp;
}

/** `properties.features` jsonb'den m² / oda / kat (kanonik + eski anahtarlar). */
export function featureFacts(features: Record<string, unknown> | null | undefined): { sqm: number | null; rooms: string | null; floor: string | null } {
  const f = features ?? {};
  let sqm: number | null = null;
  for (const key of ["sqm", "net_sqm", "gross_sqm", "brut_m2", "net_m2"]) {
    const n = Number(f[key]);
    if (Number.isFinite(n) && n > 0) {
      sqm = n;
      break;
    }
  }
  const roomsRaw = f.rooms ?? f.room_count;
  const floorRaw = f.floor;
  return {
    sqm,
    rooms: typeof roomsRaw === "string" || typeof roomsRaw === "number" ? String(roomsRaw).trim() || null : null,
    floor: typeof floorRaw === "string" || typeof floorRaw === "number" ? String(floorRaw).trim() || null : null,
  };
}
