import { getAdapter } from "@/lib/listing-control/adapters";
import { isPlausibleExternalId, rankUnregistered, type InventoryRow, type PropertyForMatch } from "@/lib/listing-control/inventory-import";
import { MATCH_BANDS, normalizeExternalId } from "@/lib/listing-control/matching";
import { fold, type TransferPortal } from "./rules";

/**
 * PORTALDAN İÇE AKTARMA PLANI (SAF, testli; DB/ağ yok). Eklentinin İlanlarım sayfasından okuduğu ve kullanıcının SEÇTİĞİ
 * ilanlar için karar verir:
 *   already_bound  → bu ilan numarası zaten bu ofiste canlı bir portföye bağlı (atlanır)
 *   possible_match → mevcut eşleştirme motoru (portal profili) ≥ 60 güvenle bir portföy buldu: YENİ portföy AÇILMAZ,
 *                    aday eşleşme kuyruğuna yazılır (kullanıcı onaylar; çift kayıt oluşmaz)
 *   new            → taslak portföy (status='draft', is_sample=false) açılır ve ilan numarasıyla bağlanır
 * Mükerrer kontrolü iki katmanlıdır: kesin = portal ilan numarası (DB tekil indeksi de korur), bulanık = `matching.ts`.
 * Kişisel veri alınmaz: telefon/kişi adı yoktur (liste kartında okunmaz); ham telefon DB'ye gitmez.
 */

export const IMPORT_LIMITS = { maxItems: 100 } as const;

export type ImportItem = {
  externalId: string;
  url: string | null;
  title: string | null;
  price: number | null;
  sqm: number | null;
  rooms: string | null;
  location: string | null;
  status: "active" | "passive";
};

const num = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);

/** İstemciden gelen ham listeyi doğrular: portal adaptörüyle ilan no/URL normalize edilir, tekrarlar atılır. */
export function sanitizeImportItems(portal: TransferPortal, raw: unknown): ImportItem[] {
  const adapter = getAdapter(portal);
  if (!adapter || !Array.isArray(raw)) return [];
  const out: ImportItem[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, IMPORT_LIMITS.maxItems * 2)) {
    const it = (r ?? {}) as Record<string, unknown>;
    const id = typeof it.externalId === "string" ? it.externalId.trim() : "";
    const url = typeof it.url === "string" && it.url ? it.url.slice(0, 2048) : null;
    const n = adapter.normalize({ url, externalId: id });
    if (!n || !isPlausibleExternalId(portal, n.externalId) || seen.has(n.externalId)) continue;
    seen.add(n.externalId);
    out.push({
      externalId: n.externalId,
      url: n.url,
      title: typeof it.title === "string" && it.title.trim() ? it.title.trim().slice(0, 300) : null,
      price: num(it.price, 1, 1e12),
      sqm: num(it.sqm, 10, 20_000),
      rooms: typeof it.rooms === "string" && /^\d{1,2}\+\d{1,2}$/.test(it.rooms) ? it.rooms : null,
      location: typeof it.location === "string" && it.location.trim() ? it.location.trim().slice(0, 160) : null,
      status: it.status === "passive" ? "passive" : "active",
    });
    if (out.length >= IMPORT_LIMITS.maxItems) break;
  }
  return out;
}

export function inferTransaction(title: string | null, url: string | null): "Satılık" | "Kiralık" {
  const f = fold(`${title ?? ""} ${url ?? ""}`);
  return /\bkiralik\b/.test(f) ? "Kiralık" : "Satılık";
}

/** Başlık/URL'den portföy türü tahmini (tahmindir; kullanıcı taslakta düzeltir). Varsayılan: Daire. */
export function inferPropertyType(title: string | null, url: string | null): string {
  const f = fold(`${title ?? ""} ${url ?? ""}`);
  if (/\bvilla\b/.test(f)) return "Villa";
  if (/\bmustakil\b/.test(f)) return "Müstakil ev";
  if (/\b(arsa|tarla|arazi)\b/.test(f)) return "Arsa";
  if (/\b(dukkan|magaza)\b/.test(f)) return "Dükkan";
  if (/\b(ofis|buro)\b/.test(f)) return "Ofis";
  if (/\bdepo\b/.test(f)) return "Depo";
  if (/\bisyeri\b/.test(f)) return "İşyeri";
  return "Daire";
}

export type DraftProperty = {
  title: string;
  transaction_type: "Satılık" | "Kiralık";
  property_type: string;
  list_price: number | null;
  features: { rooms: string | null; sqm: number | null };
  location: string | null;
};

export function buildDraft(portal: TransferPortal, item: ImportItem): DraftProperty {
  const title = (item.title ?? `${portal} ilanı ${item.externalId}`).slice(0, 200);
  return {
    title,
    transaction_type: inferTransaction(item.title, item.url),
    property_type: inferPropertyType(item.title, item.url),
    list_price: item.price,
    features: { rooms: item.rooms, sqm: item.sqm },
    location: item.location,
  };
}

export type ImportDecision =
  | { kind: "already_bound"; item: ImportItem; propertyId: string; propertyCode: string | null }
  | { kind: "possible_match"; item: ImportItem; propertyId: string; propertyCode: string | null; score: number }
  | { kind: "new"; item: ImportItem; draft: DraftProperty };

export type BoundMap = ReadonlyMap<string, { propertyId: string; propertyCode: string | null }>;

/** Tek karar noktası: önce ilan no (kesin), sonra eşleştirme motoru (bulanık), kalan yeni taslak. */
export function planImport(portal: TransferPortal, items: readonly ImportItem[], bound: BoundMap, pool: readonly PropertyForMatch[]): ImportDecision[] {
  const decisions: ImportDecision[] = [];
  const rest: ImportItem[] = [];
  for (const item of items) {
    const key = normalizeExternalId(item.externalId);
    const hit = key ? bound.get(key) : undefined;
    if (hit) decisions.push({ kind: "already_bound", item, propertyId: hit.propertyId, propertyCode: hit.propertyCode });
    else rest.push(item);
  }
  const rows: InventoryRow[] = rest.map((it) => ({
    externalId: it.externalId,
    url: it.url,
    title: it.title,
    price: it.price,
    advisorName: null,
    status: it.status,
    sqm: it.sqm,
    rooms: it.rooms,
    location: it.location,
  }));
  const ranked = rows.length > 0 && pool.length > 0 ? rankUnregistered(rows, pool) : [];
  const codeById = new Map(pool.map((p) => [p.id, p.code]));
  rest.forEach((item, i) => {
    const top = ranked[i]?.candidates[0];
    if (top && top.score >= MATCH_BANDS.unsure) {
      decisions.push({ kind: "possible_match", item, propertyId: top.property_id, propertyCode: top.code ?? codeById.get(top.property_id) ?? null, score: top.score });
    } else {
      decisions.push({ kind: "new", item, draft: buildDraft(portal, item) });
    }
  });
  return decisions;
}

export type ImportSummaryCounts = { created: number; alreadyBound: number; possibleMatch: number; failed: number; total: number };

export function summarizeImport(results: readonly { kind: "created" | "already_bound" | "possible_match" | "failed" }[]): ImportSummaryCounts {
  const count = (k: string) => results.filter((r) => r.kind === k).length;
  return { created: count("created"), alreadyBound: count("already_bound"), possibleMatch: count("possible_match"), failed: count("failed"), total: results.length };
}

/** Eklenti popup özeti için tek cümle (Türkçe). */
export function importSummaryText(c: ImportSummaryCounts): string {
  const parts: string[] = [];
  if (c.created) parts.push(`${c.created} taslak portföy eklendi`);
  if (c.possibleMatch) parts.push(`${c.possibleMatch} olası eşleşme kuyruğa alındı`);
  if (c.alreadyBound) parts.push(`${c.alreadyBound} zaten bağlıydı`);
  if (c.failed) parts.push(`${c.failed} eklenemedi`);
  return parts.length ? `${parts.join(" · ")}.` : "Eklenecek ilan yok.";
}
