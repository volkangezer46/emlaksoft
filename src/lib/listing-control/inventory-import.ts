import { tokenSimilarity } from "@/lib/duplicate-match";
import { getAdapter, parseInventoryCsv } from "./adapters";
import type { ObservedListing } from "./adapters/types";
import { compareInventory } from "./bulk-mismatch";
import { normalizeExternalId, rankCandidates, type MatchProbe, type MatchSignal } from "./matching";

/**
 * PORTAL ENVANTERİ İÇE AKTARMA (SAF; DB/ağ yok, testli). Kaynak: portal hesabından alınan dosya (CSV), yapıştırılan
 * ilan no/URL listesi ya da eklentinin okuduğu mağaza sayfası. CRM'deki canlı ilanlarla `compareInventory` üzerinden
 * karşılaştırır ve uyuşmazlığı KIRILIMLA verir:
 *   eşleşen · kaldırılmış (CRM'de canlı, listede yok/pasif) · CRM'de kayıtsız (portalda var, CRM'de yok) ·
 *   ilan no hatalı (CRM'de biçimsiz no) · kontrol edilemedi (CRM'de ilan no yok) · farklı danışman · fiyat farkı ·
 *   hiç yayınlanmamış (aktif ama ilansız portföy sayısı; çağıran verir).
 * Dürüstlük: liste TAM değilse (kullanıcı onaylamadıysa) "listede yok" GÖZLEM üretmez (eksik liste yanlış kayıp demektir).
 */

export const INVENTORY_LIMITS = {
  maxRows: 5000,
  maxPasteChars: 400_000,
  maxCandidates: 1000,
  /** Eşleşme kuyruğuna aday olarak yazılacak asgari güven. */
  candidateMinScore: 50,
  /** Bu güven ve üstünde aday portföyde "kayıtsız ilan" uyarısı açılır (SQL ile aynı eşik). */
  anomalyMinScore: 60,
  /** Fiyat farkı toleransı (oran). */
  priceTolerance: 0.01,
} as const;

export type InventoryRow = {
  externalId: string;
  url: string | null;
  title: string | null;
  price: number | null;
  advisorName: string | null;
  status: ObservedListing["status"];
};

export type CrmListing = {
  listingId: string;
  propertyId: string;
  propertyCode: string | null;
  externalId: string | null;
  url: string | null;
  listPrice: number | null;
  advisorId: string | null;
  advisorName: string | null;
};

const ID_RE = /^\d{6,12}$/;

/**
 * Yapıştırılan metin → ilan satırları. Excel'den başlıklı tablo kopyalandıysa (sekme ayraçlı ya da "İlan No" başlıklı)
 * tablo olarak okunur (fiyat/danışman/durum sütunları da gelir); değilse her parça ya portal URL'si ya da 6-12 haneli
 * ilan no olmalı.
 */
export function parsePastedList(portal: string, text: string): { rows: InventoryRow[]; invalid: string[] } {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (/\t/.test(firstLine) || /ilan\s*(no|numaras)/i.test(firstLine)) {
    const table = rowsFromObserved(parseInventoryCsv(portal, text.slice(0, INVENTORY_LIMITS.maxPasteChars), "", INVENTORY_LIMITS.maxRows));
    if (table.length > 0) return { rows: table, invalid: [] };
  }
  const adapter = getAdapter(portal);
  const rows: InventoryRow[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const parts = text.slice(0, INVENTORY_LIMITS.maxPasteChars).split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    let id: string | null = null;
    let url: string | null = null;
    if (/^https?:\/\//i.test(part)) {
      const n = adapter?.normalize({ url: part }) ?? null;
      id = n?.externalId ?? null;
      url = n?.url ?? null;
    } else if (ID_RE.test(part.replace(/^#/, ""))) {
      id = part.replace(/^#/, "");
    }
    if (!id) {
      if (invalid.length < 50) invalid.push(part.slice(0, 120));
      continue;
    }
    const key = normalizeExternalId(id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ externalId: id, url, title: null, price: null, advisorName: null, status: "active" });
    if (rows.length >= INVENTORY_LIMITS.maxRows) break;
  }
  return { rows, invalid };
}

/** CSV ayrıştırıcısının (`parseInventoryCsv`) çıktısı → tekilleştirilmiş satırlar. */
export function rowsFromObserved(observed: readonly ObservedListing[]): InventoryRow[] {
  const out: InventoryRow[] = [];
  const seen = new Set<string>();
  for (const o of observed) {
    const key = normalizeExternalId(o.externalId);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ externalId: o.externalId.trim(), url: o.url ?? null, title: o.title ?? null, price: o.price ?? null, advisorName: o.advisorName ?? null, status: o.status });
    if (out.length >= INVENTORY_LIMITS.maxRows) break;
  }
  return out;
}

export type InventoryBreakdown = {
  portal: string;
  totalRows: number;
  crmCount: number;
  matched: { crm: CrmListing; row: InventoryRow }[];
  removed: { crm: CrmListing; reason: "absent" | "passive" }[];
  unregistered: InventoryRow[];
  idInvalid: CrmListing[];
  unverifiable: CrmListing[];
  otherAdvisor: { crm: CrmListing; portalAdvisor: string }[];
  priceDiff: { crm: CrmListing; portalPrice: number; deviationPercent: number }[];
  neverPublished: number;
};

/** CRM ilan no biçimi geçerli mi. Kayıtlı portallarda (sahibinden/hepsiemlak/emlakjet) ilan no 6-12 hanedir. */
export function isPlausibleExternalId(portal: string, id: string): boolean {
  const v = id.trim();
  return getAdapter(portal) ? ID_RE.test(v) : /^[0-9A-Za-z-]{5,40}$/.test(v);
}

export function buildInventoryBreakdown(input: {
  portal: string;
  rows: readonly InventoryRow[];
  crm: readonly CrmListing[];
  neverPublished: number;
  priceTolerance?: number;
}): InventoryBreakdown {
  const tol = input.priceTolerance ?? INVENTORY_LIMITS.priceTolerance;
  const unverifiable: CrmListing[] = [];
  const idInvalid: CrmListing[] = [];
  const valid: CrmListing[] = [];
  for (const c of input.crm) {
    const id = (c.externalId ?? "").trim();
    if (!id) unverifiable.push(c);
    else if (!isPlausibleExternalId(input.portal, id)) idInvalid.push(c);
    else valid.push(c);
  }
  const cmp = compareInventory(
    input.portal,
    valid.map((c) => ({ listingId: c.listingId, propertyId: c.propertyId, externalId: c.externalId, price: c.listPrice })),
    input.rows.map((r) => ({ externalId: r.externalId, price: r.price, title: r.title, url: r.url })),
    true,
  );
  const rowByKey = new Map(input.rows.map((r) => [normalizeExternalId(r.externalId) ?? "", r]));
  const crmById = new Map(valid.map((c) => [c.listingId, c]));
  const missingIds = new Set((cmp?.missingOnPortal ?? []).map((m) => m.listingId));
  const unregisteredKeys = new Set((cmp?.unregisteredOnPortal ?? []).map((u) => normalizeExternalId(u.externalId) ?? ""));

  const matched: InventoryBreakdown["matched"] = [];
  const removed: InventoryBreakdown["removed"] = [];
  const otherAdvisor: InventoryBreakdown["otherAdvisor"] = [];
  const priceDiff: InventoryBreakdown["priceDiff"] = [];
  for (const c of valid) {
    if (missingIds.has(c.listingId)) {
      removed.push({ crm: crmById.get(c.listingId) ?? c, reason: "absent" });
      continue;
    }
    const row = rowByKey.get(normalizeExternalId(c.externalId) ?? "");
    if (!row) continue;
    if (row.status === "passive" || row.status === "removed") {
      removed.push({ crm: c, reason: "passive" });
      continue;
    }
    matched.push({ crm: c, row });
    if (row.advisorName && c.advisorName && tokenSimilarity(row.advisorName, c.advisorName) < 0.5) {
      otherAdvisor.push({ crm: c, portalAdvisor: row.advisorName });
    }
    if (row.price && c.listPrice && c.listPrice > 0) {
      const dev = Math.abs(row.price - c.listPrice) / c.listPrice;
      if (dev > tol) priceDiff.push({ crm: c, portalPrice: row.price, deviationPercent: Math.round(dev * 1000) / 10 });
    }
  }
  return {
    portal: input.portal,
    totalRows: input.rows.length,
    crmCount: input.crm.length,
    matched,
    removed,
    unregistered: input.rows.filter((r) => unregisteredKeys.has(normalizeExternalId(r.externalId) ?? "")),
    idInvalid,
    unverifiable,
    otherAdvisor,
    priceDiff,
    neverPublished: Math.max(0, Math.floor(input.neverPublished)),
  };
}

export type ObservationPayload = { listing_id: string; result: "present" | "absent"; observed: Record<string, unknown> };

/** Gözlemler: eşleşen → present (fiyat/başlık/danışman/durum); kaldırılmış → absent YALNIZ liste tamsa. */
export function toObservations(b: InventoryBreakdown, complete: boolean): ObservationPayload[] {
  const out: ObservationPayload[] = [];
  for (const m of b.matched) {
    const observed: Record<string, unknown> = {};
    if (m.row.price && m.row.price > 0) observed.price = m.row.price;
    if (m.row.title) observed.title = m.row.title.slice(0, 300);
    if (m.row.advisorName) observed.advisor_name = m.row.advisorName.slice(0, 120);
    if (m.row.status !== "unknown") observed.status = m.row.status;
    out.push({ listing_id: m.crm.listingId, result: "present", observed });
  }
  if (complete) for (const r of b.removed) out.push({ listing_id: r.crm.listingId, result: "absent", observed: {} });
  return out;
}

export type ImportSummary = {
  total_rows: number;
  matched: number;
  removed: number;
  unregistered: number;
  never_published: number;
  id_invalid: number;
  unverifiable: number;
  other_advisor: number;
  price_diff: number;
  detail: Record<string, unknown>;
};

const codes = (rows: readonly { crm: CrmListing }[] | readonly CrmListing[], max = 25): string[] =>
  rows.slice(0, max).map((r) => ("crm" in r ? r.crm : r).propertyCode ?? "-");

export function toSummary(b: InventoryBreakdown): ImportSummary {
  return {
    total_rows: b.totalRows,
    matched: b.matched.length,
    removed: b.removed.length,
    unregistered: b.unregistered.length,
    never_published: b.neverPublished,
    id_invalid: b.idInvalid.length,
    unverifiable: b.unverifiable.length,
    other_advisor: b.otherAdvisor.length,
    price_diff: b.priceDiff.length,
    detail: {
      removed: codes(b.removed),
      idInvalid: codes(b.idInvalid),
      unverifiable: codes(b.unverifiable),
      otherAdvisor: codes(b.otherAdvisor),
      priceDiff: codes(b.priceDiff),
      unregistered: b.unregistered.slice(0, 25).map((r) => r.externalId),
    },
  };
}

// ---------------------------------------------------------------- kayıtsız ilan → portföy adayları

export type PropertyForMatch = {
  id: string;
  code: string | null;
  title: string | null;
  address: string | null;
  price: number | null;
  sqm: number | null;
  rooms: string | null;
  block: string | null;
  lot: string | null;
  lat: number | null;
  lng: number | null;
  districtKey: string | null;
  advisorName: string | null;
};

/** İlan başlığından oda ("3+1") ve m² çıkarır (portal başlıkları çoğunlukla içerir). */
export function probeFromListingTitle(title: string | null): { rooms: string | null; sqm: number | null } {
  if (!title) return { rooms: null, sqm: null };
  const r = /(\d{1,2})\s*\+\s*(\d{1,2})/.exec(title);
  const s = /(\d{2,4})\s*(?:m²|m2|metrekare)/i.exec(title);
  const sqm = s ? Number(s[1]) : null;
  return { rooms: r ? `${r[1]}+${r[2]}` : null, sqm: sqm && sqm >= 10 && sqm <= 20000 ? sqm : null };
}

export type CandidatePayload = {
  external_id: string;
  url: string | null;
  title: string | null;
  price: number | null;
  candidates: { property_id: string; code: string | null; score: number; signals: MatchSignal[] }[];
  top_score: number | null;
};

/** Kayıtsız satırlar için en iyi 3 portföy adayı (güven ve sinyallerle). Aday yoksa boş liste (kuyrukta "eşleşen yok"). */
export function rankUnregistered(rows: readonly InventoryRow[], props: readonly PropertyForMatch[]): CandidatePayload[] {
  const pool = props.map((p) => ({
    id: p.id,
    code: p.code,
    probe: {
      title: p.title,
      address: p.address,
      price: p.price,
      sqm: p.sqm,
      rooms: p.rooms,
      block: p.block,
      lot: p.lot,
      lat: p.lat,
      lng: p.lng,
      districtKey: p.districtKey,
      advisorName: p.advisorName,
    } satisfies MatchProbe,
  }));
  return rows.slice(0, INVENTORY_LIMITS.maxCandidates).map((row) => {
    const t = probeFromListingTitle(row.title);
    const subject: MatchProbe = { title: row.title, price: row.price, sqm: t.sqm, rooms: t.rooms, advisorName: row.advisorName };
    const near = row.price
      ? pool.filter((p) => !p.probe.price || Math.abs(p.probe.price - (row.price as number)) / Math.max(p.probe.price, row.price as number) <= 0.25)
      : pool;
    const ranked = rankCandidates(subject, near, INVENTORY_LIMITS.candidateMinScore, undefined, 3);
    const candidates = ranked.map((r) => ({ property_id: r.candidate.id, code: r.candidate.code, score: r.match.score, signals: r.match.signals }));
    return {
      external_id: row.externalId,
      url: row.url,
      title: row.title,
      price: row.price,
      candidates,
      top_score: candidates[0]?.score ?? null,
    };
  });
}
