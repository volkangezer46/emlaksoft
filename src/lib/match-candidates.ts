import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchTenantMatchingWeights,
  locationVariants,
  scoreDemandProperty,
  tierOf,
  type MatchDemand,
  type MatchingWeights,
  type MatchProperty,
  type MatchResult,
} from "@/lib/matching";
import { MATCH_STATE_COLUMNS, matchPairKey, type MatchStateRow } from "@/lib/match-state";
import { parseDemandCriteria } from "@/lib/demand-criteria";

/**
 * Eşleştirme aday portföyleri — Talepler > Eşleşme sekmesi ve form içi canlı önizleme AYNI sorguyu
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

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// TEK EŞLEŞME OKUYUCUSU (CRM-G3). Talep detayı, Eşleşme sekmesi, Müşteri 360 ve talep listesi AYNI kuralla
// skorlar: aynı aday sorgusu, aynı ofis ağırlıkları, aynı eşik, aynı müşteri geri bildirimi (beğenmedi gizlenir,
// beğendi +10) ve aynı eşleşme durumu (CRM-G4: "uygun değil" gizlenir). Portföy tablosunu eşleşme amacıyla
// okuyan tek yer bu dosyadır (`match-candidates.test.ts` sözleşmesi).
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Listede gösterilen en düşük skor (tüm yüzeyler). */
export const MATCH_SHOW_MIN = 35;
/** Danışmana bildirim düşen "iyi/güçlü" eşleşme eşiği. */
export const MATCH_NOTIFY_MIN = 60;
/** Müşteri portalında "beğendim" denen portföye skor bonusu. */
export const MATCH_LIKED_BONUS = 10;

export type MatchFeedbackRow = { customer_id: string; property_id: string; verdict: string };

export type ScoredMatch<D extends MatchDemand = MatchDemand> = {
  demand: D;
  property: MatchProperty;
  score: number;
  tier: MatchResult["tier"];
  reasons: MatchResult["reasons"];
  likedByCustomer: boolean;
  state: MatchStateRow | null;
  /** Yalnız `includeHidden` ile görünür: müşteri beğenmedi ya da danışman "uygun değil" dedi. */
  hiddenBy: "feedback" | "dismissed" | null;
};

export type DemandMatchSummary = { shown: number; strong: number; good: number; best: number };

export type ScoredMatches<D extends MatchDemand = MatchDemand> = {
  /** Skor sırasına dizili çiftler (gizlenenler `includeHidden` verilmedikçe yok). */
  pairs: ScoredMatch<D>[];
  /** Müşteri "beğenmedi" dediği için gizlenen (eşik üstü) çift sayısı. */
  hiddenByFeedback: number;
  /** Danışmanın "uygun değil" dediği (eşik üstü) çift sayısı. */
  hiddenDismissed: number;
  /** Talep başına özet (gizlenenler sayılmaz). */
  byDemand: Map<string, DemandMatchSummary>;
};

/**
 * SAF skorlayıcı: talepler × adaylar. Elenen (olmazsa olmaz tutmayan) ve eşik altı çiftler düşer; müşteri "beğenmedi"
 * ve danışman "uygun değil" çiftleri gizlenir (sayılır), `includeHidden` ile listeye geri döner (rozetli).
 */
export function scoreDemandMatches<D extends MatchDemand>(input: {
  demands: readonly D[];
  properties: readonly MatchProperty[];
  weights?: MatchingWeights | null;
  customerOf: (d: D) => string | null;
  feedback?: readonly MatchFeedbackRow[];
  states?: readonly MatchStateRow[];
  includeHidden?: boolean;
  minScore?: number;
}): ScoredMatches<D> {
  const min = input.minScore ?? MATCH_SHOW_MIN;
  const liked = new Set<string>();
  const disliked = new Set<string>();
  for (const fb of input.feedback ?? []) {
    const key = `${fb.customer_id}:${fb.property_id}`;
    if (fb.verdict === "liked") liked.add(key);
    else if (fb.verdict === "disliked") disliked.add(key);
  }
  const stateByPair = new Map<string, MatchStateRow>();
  for (const s of input.states ?? []) stateByPair.set(matchPairKey(s.demand_id, s.property_id), s);

  const pairs: ScoredMatch<D>[] = [];
  const byDemand = new Map<string, DemandMatchSummary>();
  let hiddenByFeedback = 0;
  let hiddenDismissed = 0;
  for (const demand of input.demands) {
    const customerId = input.customerOf(demand);
    const summary: DemandMatchSummary = { shown: 0, strong: 0, good: 0, best: 0 };
    for (const property of input.properties) {
      const result = scoreDemandProperty(demand, property, input.weights);
      if (result.eliminated) continue;
      const fbKey = customerId ? `${customerId}:${property.id}` : null;
      const isLiked = fbKey != null && liked.has(fbKey);
      const score = isLiked ? Math.min(100, result.score + MATCH_LIKED_BONUS) : result.score;
      if (score < min) continue;
      const state = stateByPair.get(matchPairKey(demand.id, property.id)) ?? null;
      const feedbackHidden = fbKey != null && disliked.has(fbKey);
      const dismissed = state?.state === "dismissed";
      if (feedbackHidden) hiddenByFeedback += 1;
      else if (dismissed) hiddenDismissed += 1;
      const hidden = feedbackHidden || dismissed;
      if (hidden && !input.includeHidden) continue;
      const tier = isLiked ? tierOf(score) : result.tier;
      pairs.push({
        demand,
        property,
        score,
        tier,
        reasons: result.reasons,
        likedByCustomer: isLiked,
        state,
        hiddenBy: feedbackHidden ? "feedback" : dismissed ? "dismissed" : null,
      });
      if (hidden) continue;
      summary.shown += 1;
      if (tier === "strong") summary.strong += 1;
      else if (tier === "good") summary.good += 1;
      if (score > summary.best) summary.best = score;
    }
    byDemand.set(demand.id, summary);
  }
  pairs.sort((a, b) => b.score - a.score);
  return { pairs, hiddenByFeedback, hiddenDismissed, byDemand };
}

const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

/** Eşleşme durumları (tablo yoksa boş küme — eski davranış). */
export async function fetchMatchStates(
  supabase: SupabaseClient,
  opts: { demandIds: string[]; tenantId?: string },
): Promise<MatchStateRow[]> {
  const ids = opts.demandIds.filter((id) => UUID_LIST_RE.test(id));
  if (ids.length === 0) return [];
  let query = supabase.from("demand_property_matches").select(MATCH_STATE_COLUMNS).in("demand_id", ids);
  if (opts.tenantId) query = query.eq("tenant_id", opts.tenantId);
  const { data, error } = await query.limit(1000);
  if (error) {
    if (!error.code || !MISSING_TABLE_CODES.has(error.code)) console.error("fetchMatchStates", { code: error.code });
    return [];
  }
  return ((data ?? []) as MatchStateRow[]).map((r) => ({ ...r, send_count: Number(r.send_count ?? 0) }));
}

/** Gönderilen paylaşım bağlantılarından AÇILANLAR (share_links.view_count > 0) — "açıldı" rozeti. */
export async function fetchOpenedShareTokens(supabase: SupabaseClient, tokens: string[]): Promise<Set<string>> {
  const list = [...new Set(tokens.filter(Boolean))].slice(0, 500);
  if (list.length === 0) return new Set();
  const { data, error } = await supabase.from("share_links").select("token, view_count").in("token", list);
  if (error) return new Set();
  return new Set(
    ((data ?? []) as { token: string; view_count: number | null }[]).filter((r) => Number(r.view_count ?? 0) > 0).map((r) => r.token),
  );
}

export async function fetchMatchFeedback(supabase: SupabaseClient, customerIds: string[]): Promise<MatchFeedbackRow[]> {
  const ids = [...new Set(customerIds.filter((id) => UUID_LIST_RE.test(id)))];
  if (ids.length === 0) return [];
  const { data } = await supabase.from("portal_match_feedback").select("customer_id, property_id, verdict").in("customer_id", ids);
  return (data ?? []) as MatchFeedbackRow[];
}

export type DemandMatchesResult<D extends MatchDemand = MatchDemand> = ScoredMatches<D> & {
  properties: MatchProperty[];
  weights: MatchingWeights | null;
  truncated: boolean;
  error: string | null;
  /** Açılmış paylaşım bağlantılarının token'ları ("açıldı" rozeti). */
  openedTokens: Set<string>;
  /** Okunan müşteri geri bildirimi ve durumlar (aynı kümeyle yeniden skor — ör. "kriteri genişlet"). */
  feedback: MatchFeedbackRow[];
  states: MatchStateRow[];
};

/**
 * TEK okuyucu: aday portföyler + ofis ağırlıkları + müşteri geri bildirimi + eşleşme durumları TEK turda, ardından
 * saf skor. Talep satırları çağırandan gelir (her yüzey kendi süzgeciyle okur) ama skor kuralı burada tektir.
 */
export async function loadDemandMatches<D extends MatchDemand>(
  supabase: SupabaseClient,
  opts: {
    demands: D[];
    customerOf: (d: D) => string | null;
    tenantId?: string;
    propertyId?: string | null;
    includeHidden?: boolean;
    /** Ağırlıklar çağıranda zaten okunduysa (aynı tur) tekrar okunmaz. */
    weights?: Promise<MatchingWeights | null | undefined> | MatchingWeights | null;
    /** Durum/geri bildirim okuması gereksizse (ör. önizleme talebi) kapatılır. */
    withState?: boolean;
  },
): Promise<DemandMatchesResult<D>> {
  const withState = opts.withState !== false;
  const demandIds = opts.demands.map((d) => d.id);
  const customerIds = opts.demands.map(opts.customerOf).filter((x): x is string => x != null);
  const statesP = withState ? fetchMatchStates(supabase, { demandIds, tenantId: opts.tenantId }) : Promise.resolve([]);
  const [candidates, weights, feedback, states] = await Promise.all([
    opts.demands.length > 0
      ? fetchMatchCandidateProperties(supabase, { demands: opts.demands, propertyId: opts.propertyId ?? null, tenantId: opts.tenantId })
      : Promise.resolve<MatchCandidateResult>({ properties: [], truncated: false, error: null }),
    opts.weights !== undefined ? Promise.resolve(opts.weights) : fetchTenantMatchingWeights(supabase, opts.tenantId),
    withState ? fetchMatchFeedback(supabase, customerIds) : Promise.resolve([]),
    statesP,
  ]);
  const scored = scoreDemandMatches({
    demands: opts.demands,
    properties: candidates.properties,
    weights: weights ?? null,
    customerOf: opts.customerOf,
    feedback,
    states,
    includeHidden: opts.includeHidden,
  });
  // "Açıldı" rozeti yalnız gönderilmiş ve listede görünen çiftler için (ek tur yalnız gönderim varsa).
  const tokens = scored.pairs.map((p) => p.state?.share_token).filter((t): t is string => Boolean(t));
  const openedTokens = tokens.length > 0 ? await fetchOpenedShareTokens(supabase, tokens) : new Set<string>();
  return {
    ...scored,
    properties: candidates.properties,
    weights: weights ?? null,
    truncated: candidates.truncated,
    error: candidates.error,
    openedTokens,
    feedback,
    states,
  };
}
