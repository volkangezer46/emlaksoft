import type { SupabaseClient } from "@supabase/supabase-js";
import { locationVariants, type MatchDemand, type MatchProperty } from "@/lib/matching";
import { parseDemandCriteria } from "@/lib/demand-criteria";

/**
 * Eşleştirme aday portföyleri — `/app/eslestirme` ve form içi canlı önizleme AYNI sorguyu
 * kullanır (önizleme sayısı ile sayfa sayısı sapmasın). Portföyler taleplerin il ve işlem
 * türü kümesine göre TEK sorguda daraltılır; skor bellekte hesaplanır.
 *
 * İşlem türü serbest metin ("Satılık", "satilik", "sale"...): satış/kira gruplarının yaygın
 * varyantları açılır, tanınmayan değerler olduğu gibi eklenir. Uyumsuz işlem türü skoru zaten
 * 20'ye sabitlediği (eşik 35) için bu daraltma sonuç kaybetmez.
 */
const SALE_VARIANTS = ["Satılık", "satılık", "Satilik", "satilik", "SATILIK", "sale", "Sale", "Satış", "satış", "Satis", "satis"];
const RENT_VARIANTS = ["Kiralık", "kiralık", "Kiralik", "kiralik", "KİRALIK", "rent", "Rent", "Kira", "kira"];
const isSaleTx = (v: string) => ["satılık", "satilik", "sale", "satış", "satis"].some((x) => v.includes(x));
const isRentTx = (v: string) => ["kiralık", "kiralik", "rent", "kira"].some((x) => v.includes(x));

/** Aday portföy sorgusu için işlem türü varyantları; boş işlem türlü talep varsa süzgeç kapanır. */
export function transactionVariants(txs: string[]): { filterable: boolean; variants: string[] } {
  const variants = new Set<string>();
  let filterable = txs.length > 0;
  for (const tx of txs) {
    const raw = (tx ?? "").trim();
    const n = raw.toLocaleLowerCase("tr-TR");
    if (!n) {
      filterable = false;
      break;
    }
    if (isSaleTx(n)) SALE_VARIANTS.forEach((v) => variants.add(v));
    else if (isRentTx(n)) RENT_VARIANTS.forEach((v) => variants.add(v));
    variants.add(raw);
  }
  return { filterable: filterable && variants.size > 0, variants: [...variants] };
}

/** Taleplerin (ek bölgeler dahil) istediği il kümesi; belirsiz il varsa süzgeç uygulanamaz. */
export function demandProvinceFilter(
  demands: Pick<MatchDemand, "province_id" | "district_id" | "neighborhood_id" | "criteria">[],
): { filterable: boolean; ids: string[] } {
  const ids = new Set<string>();
  if (demands.length === 0) return { filterable: false, ids: [] };
  for (const d of demands) {
    const variants = locationVariants(d as MatchDemand, parseDemandCriteria(d.criteria));
    for (const v of variants) {
      if (!v.province_id) return { filterable: false, ids: [] };
      ids.add(v.province_id);
    }
  }
  return { filterable: ids.size > 0, ids: [...ids] };
}

export const MATCH_CANDIDATE_LIMIT = 200;

const UUID_LIST_RE = /^[0-9a-fA-F-]{8,40}$/;

export type MatchCandidateResult = {
  properties: MatchProperty[];
  /** Aday sayısı MATCH_CANDIDATE_LIMIT'i aştı: en yeni adaylar alındı, eski portföyler taranmadı. */
  truncated: boolean;
  /** Sorgu hatası (boş liste "eşleşme yok" anlamına GELMEZ). */
  error: string | null;
};

export async function fetchMatchCandidateProperties(
  supabase: SupabaseClient,
  opts: {
    demands: Pick<MatchDemand, "transaction_type" | "province_id" | "district_id" | "neighborhood_id" | "criteria">[];
    propertyId?: string | null;
    /** Verilirse açık tenant filtresi (RLS'e ek savunma). */
    tenantId?: string;
  },
): Promise<MatchCandidateResult> {
  const tx = transactionVariants(opts.demands.map((d) => d.transaction_type));
  const prov = demandProvinceFilter(opts.demands);

  let query = supabase
    .from("properties")
    .select(
      "id, property_code, title, transaction_type, property_type, status, list_price, province_id, district_id, neighborhood_id, features",
    )
    .is("deleted_at", null)
    .in("status", ["live", "draft", "reserved", "Yayında"]);
  if (opts.tenantId) query = query.eq("tenant_id", opts.tenantId);
  if (opts.propertyId) query = query.eq("id", opts.propertyId);
  if (tx.filterable) query = query.in("transaction_type", tx.variants);
  // İli null portföy "İl (belirsiz)" olarak yine skorlanır — dışarıda bırakma.
  if (prov.filterable && prov.ids.every((i) => UUID_LIST_RE.test(i))) {
    query = query.or(`province_id.is.null,province_id.in.(${prov.ids.join(",")})`);
  }

  // LIMIT+1 çekilir: fazlası varsa kırpıldığı kesin bilinir (sessiz kırpma yok).
  const { data, error } = await query.order("created_at", { ascending: false }).limit(MATCH_CANDIDATE_LIMIT + 1);
  if (error) {
    console.error("fetchMatchCandidateProperties", error);
    return { properties: [], truncated: false, error: "Portföy adayları okunamadı. Lütfen tekrar deneyin." };
  }
  const rows = data ?? [];
  const truncated = rows.length > MATCH_CANDIDATE_LIMIT;
  const properties = rows.slice(0, MATCH_CANDIDATE_LIMIT).map((p) => ({
    ...p,
    list_price: p.list_price != null ? Number(p.list_price) : null,
    features: (p.features ?? {}) as MatchProperty["features"],
  })) as MatchProperty[];
  return { properties, truncated, error: null };
}
