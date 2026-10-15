import { foldText } from "@/lib/import-rows";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { parsePhone } from "@/lib/phone";

/**
 * Giriş anı mükerrer önleme — SAF mantık (sunucu/istemci ortak, test edilebilir).
 * Yanlış pozitifi azaltma ilkeleri:
 *  - Müşteride yalnız telefon veya e-posta eşleşmesi sinyaldir; aynı ad TEK BAŞINA eşleşme değildir.
 *  - Portföyde ada/parsel (aynı mahalle/ilçede), adres benzerliği ya da başlık+mahalle+tür benzerliği gerekir.
 */

/** Telefonun DB'de görülebilecek tüm yazımları (saklama biçimi + eski/ham varyantlar). */
export function phoneLookupVariants(raw: string | null | undefined): string[] {
  const p = parsePhone(raw ?? "");
  if (!p.ok) return [];
  const out = new Set<string>([p.stored, p.e164]);
  if (p.country === "TR") {
    out.add(p.national);
    out.add(`90${p.national}`);
    out.add(`0${p.national}`);
  } else {
    out.add(p.e164.slice(1));
  }
  return [...out];
}

/** Geçerliyse küçük harfli e-posta, değilse "". */
export function emailLookupKey(raw: string | null | undefined): string {
  const e = normalizeEmail(raw ?? "");
  return e && isValidEmail(e) ? e : "";
}

function tokens(s: string | null | undefined): string[] {
  return foldText(s ?? "")
    .split(" ")
    .filter((t) => t.length > 0);
}

/** Jaccard benzerliği (0..1) — kelime kümeleri üzerinden. */
export function tokenSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export type PropertyProbe = {
  title: string;
  address: string;
  block: string;
  lot: string;
  propertyType: string;
  transactionType: string;
  districtId: string;
  neighborhoodId: string;
};

export type PropertyCandidate = {
  title: string | null;
  address_line: string | null;
  parcel_block: string | null;
  parcel_lot: string | null;
  property_type: string | null;
  transaction_type: string | null;
  district_id: string | null;
  neighborhood_id: string | null;
};

export type PropertyMatchReason = "ada-parsel" | "adres" | "baslik";

export const PROPERTY_REASON_LABEL: Record<PropertyMatchReason, string> = {
  "ada-parsel": "aynı ada/parsel",
  adres: "benzer adres",
  baslik: "benzer başlık ve mahalle",
};

const same = (a: string | null | undefined, b: string | null | undefined) =>
  foldText(a ?? "") !== "" && foldText(a ?? "") === foldText(b ?? "");

/** Aynı konum bağlamı: mahalle ikisinde de varsa mahalle eşit, yoksa ilçe eşit olmalı. */
function sameArea(probe: PropertyProbe, c: PropertyCandidate): boolean {
  if (probe.neighborhoodId && c.neighborhood_id) return probe.neighborhoodId === c.neighborhood_id;
  if (probe.districtId && c.district_id) return probe.districtId === c.district_id;
  return false;
}

export function propertyMatchReasons(probe: PropertyProbe, c: PropertyCandidate): PropertyMatchReason[] {
  const out: PropertyMatchReason[] = [];
  const area = sameArea(probe, c);
  // Ada+parsel birlikte; tek başına parsel numarası anlamsız. Aynı bölge şart (numaralar mahalle bazlı tekrar eder).
  if (area && same(probe.block, c.parcel_block) && same(probe.lot, c.parcel_lot)) out.push("ada-parsel");
  if (area && tokens(probe.address).length >= 3 && tokenSimilarity(probe.address, c.address_line) >= 0.8) out.push("adres");
  const sameType = !probe.propertyType || !c.property_type || probe.propertyType === c.property_type;
  const sameTx = !probe.transactionType || !c.transaction_type || probe.transactionType === c.transaction_type;
  if (
    probe.neighborhoodId &&
    c.neighborhood_id === probe.neighborhoodId &&
    sameType &&
    sameTx &&
    tokens(probe.title).length >= 3 &&
    tokenSimilarity(probe.title, c.title) >= 0.8
  ) {
    out.push("baslik");
  }
  return out;
}

export type DemandProbe = { transactionType: string; propertyType: string; districtId: string };
export type DemandCandidate = {
  transaction_type: string | null;
  property_type: string | null;
  district_id: string | null;
};

/** Aynı müşterinin aynı işlem türü + (varsa) aynı tür + (varsa) aynı ilçe açık talebi benzerdir. */
export function demandsSimilar(p: DemandProbe, c: DemandCandidate): boolean {
  if (!p.transactionType || p.transactionType !== c.transaction_type) return false;
  if (p.propertyType && c.property_type && p.propertyType !== c.property_type) return false;
  if (p.districtId && c.district_id && p.districtId !== c.district_id) return false;
  return true;
}

export type DuplicateHit = {
  /** Kapsam dışı kayıtlarda null (kimlik sızdırılmaz). */
  id: string | null;
  /** false: kayıt var ama bu kullanıcının kapsamı dışında. */
  visible: boolean;
  label: string | null;
  /** Danışman adı (yalnız visible). */
  advisor: string | null;
  lastContact: string | null;
  /** Portföy: kod. */
  code: string | null;
  price: number | null;
  status: string | null;
  /** Hangi sinyal: "telefon" | "e-posta" | PROPERTY_REASON_LABEL | "açık talep". */
  reasons: string[];
};

/** Satırı kullanıcının kapsamına göre maskeler. Ofis geneli roller ve kendi kayıtları açık görünür. */
export function scopeHit(
  hit: DuplicateHit,
  ownerId: string | null,
  viewer: { userId: string; officeWide: boolean },
): DuplicateHit {
  if (viewer.officeWide || (ownerId && ownerId === viewer.userId)) return { ...hit, visible: true };
  return {
    id: null,
    visible: false,
    label: null,
    advisor: null,
    lastContact: null,
    code: null,
    price: null,
    status: null,
    reasons: hit.reasons,
  };
}

// ── Portföy çift kayıt TARAMASI (/app/portfoyler/cift-kayit) ────────────────────────────────────────────────────

export type PropertyScanRow = PropertyCandidate & { id: string; created_at: string };
export type PropertyDuplicateGroup = { ids: string[]; reasons: PropertyMatchReason[] };

/** Tarama bir konum kovasında en çok bu kadar kaydı ikili karşılaştırır (en yeniler); O(n²) sınırlı kalır. */
export const PROPERTY_SCAN_BUCKET_MAX = 300;

const REASON_ORDER: Record<PropertyMatchReason, number> = { "ada-parsel": 0, adres: 1, baslik: 2 };

function probeOf(r: PropertyCandidate): PropertyProbe {
  return {
    title: r.title ?? "",
    address: r.address_line ?? "",
    block: r.parcel_block ?? "",
    lot: r.parcel_lot ?? "",
    propertyType: r.property_type ?? "",
    transactionType: r.transaction_type ?? "",
    districtId: r.district_id ?? "",
    neighborhoodId: r.neighborhood_id ?? "",
  };
}

/**
 * Ofisin portföylerini olası çift kayıt gruplarına ayırır (SAF). Giriş anı uyarısıyla AYNI kural
 * (`propertyMatchReasons`), ek olarak: aynı işlem türü şart (aynı mülkün satılık + kiralık ilanı meşrudur) ve
 * ada/parsel eşleşmesinde aynı mülk tipi şart. Karşılaştırma mahalle (yoksa ilçe) kovası içindedir; geçişli eşleşmeler
 * tek grupta toplanır. Gruplar en güçlü sinyale göre sıralanır (ada/parsel > adres > başlık), sonra kalabalığa göre.
 */
export function groupPropertyDuplicates(rows: readonly PropertyScanRow[]): PropertyDuplicateGroup[] {
  const buckets = new Map<string, PropertyScanRow[]>();
  for (const r of rows) {
    const key = r.neighborhood_id ? `n:${r.neighborhood_id}` : r.district_id ? `d:${r.district_id}` : null;
    if (!key) continue;
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    parent.set(x, p);
    return p;
  };
  const reasonsOf = new Map<string, Set<PropertyMatchReason>>();
  const pairReasons: Array<[string, string, PropertyMatchReason[]]> = [];

  for (const list of buckets.values()) {
    const sample = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, PROPERTY_SCAN_BUCKET_MAX);
    for (let i = 0; i < sample.length; i++) {
      const a = sample[i]!;
      const probe = probeOf(a);
      for (let j = i + 1; j < sample.length; j++) {
        const b = sample[j]!;
        if ((a.transaction_type ?? "") !== (b.transaction_type ?? "")) continue;
        let reasons = propertyMatchReasons(probe, b);
        if (a.property_type && b.property_type && a.property_type !== b.property_type) {
          reasons = reasons.filter((r) => r !== "ada-parsel");
        }
        if (reasons.length === 0) continue;
        pairReasons.push([a.id, b.id, reasons]);
        const ra = find(a.id);
        const rb = find(b.id);
        if (ra !== rb) parent.set(ra, rb);
      }
    }
  }

  const groups = new Map<string, Set<string>>();
  for (const [a, b, reasons] of pairReasons) {
    const root = find(a);
    const members = groups.get(root) ?? new Set<string>();
    members.add(a);
    members.add(b);
    groups.set(root, members);
    const rs = reasonsOf.get(root) ?? new Set<PropertyMatchReason>();
    for (const r of reasons) rs.add(r);
    reasonsOf.set(root, rs);
  }

  const order = new Map(rows.map((r, i) => [r.id, i]));
  return [...groups.entries()]
    .map(([root, members]) => ({
      ids: [...members].sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0)),
      reasons: [...(reasonsOf.get(root) ?? [])].sort((x, y) => REASON_ORDER[x] - REASON_ORDER[y]),
    }))
    .sort((x, y) => REASON_ORDER[x.reasons[0]!] - REASON_ORDER[y.reasons[0]!] || y.ids.length - x.ids.length);
}

/** Portföy kaydının doluluk puanı (birleştirmede "en dolu kayıt" önerisi): dolu temel alan sayısı + medya. */
export function propertyCompleteness(r: {
  title: string | null; address_line: string | null; parcel_block: string | null; lat: number | null;
  list_price: number | null; neighborhood_id: string | null; media_count?: number;
}): number {
  let n = 0;
  for (const v of [r.title, r.address_line, r.parcel_block, r.neighborhood_id]) if (v && String(v).trim()) n++;
  if (r.lat != null) n++;
  if (r.list_price != null) n++;
  return n + Math.min(r.media_count ?? 0, 10);
}
