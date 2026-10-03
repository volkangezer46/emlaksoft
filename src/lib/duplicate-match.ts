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
