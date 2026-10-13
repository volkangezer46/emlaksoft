/**
 * EİDS bildirimi → portföy eşleştirmesi (SAF; ayrıştırıcıdan bağımsız, istemci/sunucu güvenli).
 *
 * Girdi, Bakanlık e-postasından (EP3 ayrıştırıcısı) ya da elle girişten gelen "olgular"dır: taşınmaz no, satış/kiralama,
 * yetkiyi veren malik adı, bitiş tarihi. Kurallar:
 *  (a) Taşınmaz no yalnız rakamlarına indirgenir (baştaki sıfırlar korunur) ve ofis içinde BİREBİR aranır.
 *  (b) Aynı no birden çok portföyde varsa satış/kiralama bilgisi `transaction_type` ile karşılaştırılarak ayırt edilir;
 *      yine tek portföye inmezse sonuç "belirsiz"dir (otomatik bağlama YOK).
 *  (c) Malik adı müşteri adıyla Türkçe karakter ve büyük/küçük harf duyarsız karşılaştırılır. Uyuşmazsa yalnız
 *      "malik farklı" uyarısı düşer; eşleşme BOZULMAZ (hisseli taşınmazda başka bir hissedar yetki vermiş olabilir).
 *  (d) E-postadaki bitiş tarihi `authorization_end` ile karşılaştırılır (fark uyarı olarak döner).
 * Birebir eşleşme yoksa ADAY listesi çıkar (en çok 5): puan malik adı benzerliği (pg_trgm benzeri trigram), mahalle/ilçe
 * ve portföyde EİDS no'sunun boş olmasından hesaplanır. Aday listesi HİÇBİR ZAMAN otomatik bağlanmaz.
 */
import { eidsNoMatchKey } from "./property-no";

export type EidsDealKind = "sale" | "rent";

export type EidsMatchFacts = {
  propertyNo: string | null | undefined;
  dealKind?: EidsDealKind | null;
  grantorName?: string | null;
  /** YYYY-MM-DD */
  validUntil?: string | null;
  /** Elle eşleştirmede isteğe bağlı konum ipucu. */
  districtId?: string | null;
  neighborhoodId?: string | null;
};

export type EidsMatchProperty = {
  id: string;
  eids_property_no: string | null;
  transaction_type: string | null;
  authorization_end: string | null;
  status?: string | null;
  district_id?: string | null;
  neighborhood_id?: string | null;
  /** Mal sahibi müşteri adı (owner_customer_id → customers.full_name). */
  owner_name?: string | null;
};

export type EidsMatchWarning = "owner_mismatch" | "owner_unknown" | "deal_kind_mismatch" | "end_date_mismatch" | "end_date_missing";

export const EIDS_MATCH_WARNING_LABELS: Record<EidsMatchWarning, string> = {
  owner_mismatch: "Malik farklı: yetkiyi veren kişi portföydeki mal sahibiyle aynı görünmüyor (hisseli taşınmazda olağandır; kontrol edin).",
  owner_unknown: "Portföyde mal sahibi kaydı yok; yetkiyi verenle karşılaştırılamadı.",
  deal_kind_mismatch: "Satış/kiralama türü portföydekiyle uyuşmuyor.",
  end_date_mismatch: "Bildirimdeki bitiş tarihi portföydeki yetki bitişinden farklı.",
  end_date_missing: "Portföyde yetki bitiş tarihi yok; bildirimdeki tarih yazılabilir.",
};

export type EidsExactMatch = {
  kind: "exact";
  propertyId: string;
  warnings: EidsMatchWarning[];
  /** Bildirim bitişi − portföy bitişi (gün); ikisinden biri yoksa null. */
  endDateDiffDays: number | null;
};
export type EidsMatchResult =
  | EidsExactMatch
  | { kind: "ambiguous"; propertyIds: string[] }
  | { kind: "none" }
  | { kind: "invalid"; reason: "no_property_no" };

/** Eşleştirmede gösterilen en çok aday sayısı (kabul ölçütü). */
export const MAX_EIDS_CANDIDATES = 5;

/** `transaction_type` serbest metin ("Satılık", "kiralik", "sale" ...) → satış/kiralama. Tanınmazsa null. */
export function dealKindOfTransaction(tt: string | null | undefined): EidsDealKind | null {
  const v = foldTurkish(tt ?? "");
  if (!v) return null;
  if (v.startsWith("sat") || v.startsWith("sale") || v === "sell") return "sale";
  if (v.startsWith("kira") || v.startsWith("rent") || v === "lease") return "rent";
  return null;
}

/** Türkçe katlama: küçük harf + ç/ğ/ı/İ/ö/ş/ü → ASCII, noktalama atılır, boşluk tekilleşir. */
export function foldTurkish(s: string): string {
  return String(s)
    .normalize("NFKC")
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * İki kişi adı aynı kişiyi mi gösteriyor (Türkçe/büyük-küçük duyarsız)? Tam eşitlik, sıra farkı ("YILMAZ AHMET") ya da
 * ikinci ad farkı ("Ahmet Can Yılmaz" ~ "Ahmet Yılmaz": ilk ve son ad aynı) kabul edilir.
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = foldTurkish(a ?? "");
  const y = foldTurkish(b ?? "");
  if (!x || !y) return false;
  if (x === y) return true;
  const tx = x.split(" ");
  const ty = y.split(" ");
  if ([...tx].sort().join(" ") === [...ty].sort().join(" ")) return true;
  if (tx.length >= 2 && ty.length >= 2 && tx[0] === ty[0] && tx[tx.length - 1] === ty[ty.length - 1]) return true;
  return false;
}

/** pg_trgm ile aynı yöntem: her kelime "  kelime " olarak dolgulanır, 3'lüler kümesi; Jaccard benzerliği (0..1). */
export function trigramSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = trigrams(foldTurkish(a ?? ""));
  const tb = trigrams(foldTurkish(b ?? ""));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

function trigrams(folded: string): Set<string> {
  const out = new Set<string>();
  for (const w of folded.split(" ")) {
    if (!w) continue;
    const padded = `  ${w} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) out.add(padded.slice(i, i + 3));
  }
  return out;
}

const DAY = 86_400_000;
function dayDiff(a: string, b: string): number | null {
  const x = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const y = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.round((x - y) / DAY);
}

function warningsFor(facts: EidsMatchFacts, p: EidsMatchProperty): { warnings: EidsMatchWarning[]; endDateDiffDays: number | null } {
  const warnings: EidsMatchWarning[] = [];
  const grantor = (facts.grantorName ?? "").trim();
  if (grantor) {
    if (!(p.owner_name ?? "").trim()) warnings.push("owner_unknown");
    else if (!namesMatch(grantor, p.owner_name)) warnings.push("owner_mismatch");
  }
  const pk = dealKindOfTransaction(p.transaction_type);
  if (facts.dealKind && pk && facts.dealKind !== pk) warnings.push("deal_kind_mismatch");
  let endDateDiffDays: number | null = null;
  if (facts.validUntil) {
    if (!p.authorization_end) warnings.push("end_date_missing");
    else {
      endDateDiffDays = dayDiff(facts.validUntil, p.authorization_end);
      if (endDateDiffDays !== 0) warnings.push("end_date_mismatch");
    }
  }
  return { warnings, endDateDiffDays };
}

/**
 * Birebir eşleştirme. `rows` ofisin (kiracının) portföyleridir; kiracı sınırı çağıranın sorgusundadır.
 * Tek portföy → exact. Birden çok → tür ile ayırt edilir; yine birden çoksa ambiguous. Hiç yoksa none.
 */
export function matchExact(facts: EidsMatchFacts, rows: readonly EidsMatchProperty[]): EidsMatchResult {
  const key = eidsNoMatchKey(facts.propertyNo ?? null);
  if (!key) return { kind: "invalid", reason: "no_property_no" };
  const hits = rows.filter((r) => eidsNoMatchKey(r.eids_property_no) === key);
  if (hits.length === 0) return { kind: "none" };
  let chosen: EidsMatchProperty | null = hits.length === 1 ? hits[0]! : null;
  if (!chosen && facts.dealKind) {
    const byKind = hits.filter((r) => dealKindOfTransaction(r.transaction_type) === facts.dealKind);
    if (byKind.length === 1) chosen = byKind[0]!;
  }
  if (!chosen) return { kind: "ambiguous", propertyIds: hits.map((r) => r.id) };
  return { kind: "exact", propertyId: chosen.id, ...warningsFor(facts, chosen) };
}

export type EidsCandidate = {
  propertyId: string;
  score: number;
  nameSimilarity: number;
  reasons: string[];
};

/** Aday puanı (0..100): ad benzerliği 60 + mahalle 15 (yoksa ilçe 10) + EİDS no boş 15 + tür uyumu 10. */
export function scoreCandidate(input: {
  nameSimilarity: number;
  sameNeighborhood?: boolean;
  sameDistrict?: boolean;
  eidsNoEmpty: boolean;
  dealKindMatches?: boolean | null;
}): number {
  const sim = Math.max(0, Math.min(1, input.nameSimilarity));
  let s = 60 * sim;
  if (input.sameNeighborhood) s += 15;
  else if (input.sameDistrict) s += 10;
  if (input.eidsNoEmpty) s += 15;
  if (input.dealKindMatches === true) s += 10;
  return Math.round(s);
}

/** Aday sayılmak için en düşük ad benzerliği (konum ipucu yoksa); pg_trgm varsayılan eşiğiyle aynı. */
export const CANDIDATE_MIN_SIMILARITY = 0.3;

/**
 * Birebir eşleşme yokken aday listesi (en çok 5). `nameSimilarity` verilirse (pg_trgm sonucu) o kullanılır, verilmezse
 * Türkçe katlamalı trigram benzerliği hesaplanır. Farklı bir EİDS no'su girilmiş portföy aday DEĞİLDİR (o no zaten başka
 * bir taşınmaza ait). Kapanmış portföyler çağıranın sorgusunda elenir.
 */
export function rankCandidates(
  facts: EidsMatchFacts,
  rows: readonly (EidsMatchProperty & { nameSimilarity?: number | null })[],
  limit = MAX_EIDS_CANDIDATES,
): EidsCandidate[] {
  const key = eidsNoMatchKey(facts.propertyNo ?? null);
  const out: EidsCandidate[] = [];
  for (const r of rows) {
    const rowKey = eidsNoMatchKey(r.eids_property_no);
    if (rowKey && rowKey !== key) continue;
    const sim = typeof r.nameSimilarity === "number" ? r.nameSimilarity : trigramSimilarity(facts.grantorName, r.owner_name);
    const sameNeighborhood = Boolean(facts.neighborhoodId && r.neighborhood_id && facts.neighborhoodId === r.neighborhood_id);
    const sameDistrict = Boolean(facts.districtId && r.district_id && facts.districtId === r.district_id);
    if (sim < CANDIDATE_MIN_SIMILARITY && !sameNeighborhood && !sameDistrict) continue;
    const pk = dealKindOfTransaction(r.transaction_type);
    const kindMatch = facts.dealKind && pk ? facts.dealKind === pk : null;
    const reasons: string[] = [];
    if (sim >= CANDIDATE_MIN_SIMILARITY) reasons.push(`Malik adı benzerliği %${Math.round(sim * 100)}`);
    if (sameNeighborhood) reasons.push("Aynı mahalle");
    else if (sameDistrict) reasons.push("Aynı ilçe");
    if (!rowKey) reasons.push("Taşınmaz no girilmemiş");
    if (kindMatch === true) reasons.push(facts.dealKind === "rent" ? "Kiralık" : "Satılık");
    out.push({
      propertyId: r.id,
      nameSimilarity: Math.round(sim * 100) / 100,
      score: scoreCandidate({ nameSimilarity: sim, sameNeighborhood, sameDistrict, eidsNoEmpty: !rowKey, dealKindMatches: kindMatch }),
      reasons,
    });
  }
  return out.sort((a, b) => b.score - a.score || b.nameSimilarity - a.nameSimilarity).slice(0, Math.max(0, Math.min(limit, MAX_EIDS_CANDIDATES)));
}

/** Malik adı maskeleme (ekranda açık ad gösterilmez): her kelimenin ilk iki harfi + yıldız. "Ahmet Yılmaz" → "Ah*** Yı****". */
export function maskGrantorName(name: string | null | undefined): string | null {
  const words = String(name ?? "").normalize("NFKC").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const masked = words
    .map((w) => {
      const chars = [...w];
      return chars.length <= 2 ? `${chars[0]}*` : `${chars.slice(0, 2).join("")}${"*".repeat(chars.length - 2)}`;
    })
    .join(" ");
  return masked.slice(0, 80);
}

/** Eşleştirme/hash için kararlı ad biçimi (Türkçe katlamalı, kelimeler sıralı). Hash sunucuda alınır (ledger.ts). */
export function canonicalGrantorName(name: string | null | undefined): string {
  return foldTurkish(name ?? "").split(" ").filter(Boolean).sort().join(" ");
}
