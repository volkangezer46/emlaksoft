import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CRITERIA_LABELS,
  parseDemandCriteria,
  type CriteriaKey,
  type DemandCriteria,
} from "@/lib/demand-criteria";

export type MatchDemand = {
  id: string;
  transaction_type: string;
  property_type: string | null;
  province_id: string | null;
  district_id: string | null;
  /** Yapılandırılmış talepte mahalle; eski seçimlerde yok (undefined). */
  neighborhood_id?: string | null;
  budget_min: number | null;
  budget_max: number | null;
  rooms: string | null;
  min_sqm: number | null;
  urgency: string | null;
  status: string;
  /** `customer_demands.criteria` jsonb (ham); parseDemandCriteria ile okunur. Yoksa eski davranış. */
  criteria?: unknown;
};

export type MatchProperty = {
  id: string;
  property_code: string;
  title: string | null;
  transaction_type: string;
  property_type: string;
  status: string;
  list_price: number | null;
  province_id: string | null;
  district_id: string | null;
  neighborhood_id?: string | null;
  features: {
    rooms?: string | null;
    sqm?: number | null;
    floor?: number | null;
    heating?: string | null;
    facade?: string | null;
    building_age?: number | null;
    /** Portföy özellik etiketleri (bugün formda yok; varsa "özellikler" kriteri değerlendirilir). */
    tags?: string[] | null;
  } | null;
};

export type MatchReason = {
  label: string;
  ok: boolean;
  weight: number;
  /** Hangi talep kriterine ait (olmazsa olmaz süzgeci ve açıklama için). */
  field?: CriteriaKey | "tx";
  /** Kriter "olmazsa olmaz" işaretliydi. */
  required?: boolean;
  /** Portföyde bu bilgi yoktu; değerlendirilemedi (elemez). */
  unknown?: boolean;
  /** Kısa gerekçe: "talep 3+1, portföy 2+1". */
  detail?: string;
};

/** Ofise özel kriter ağırlıkları (tenants.matching_weights). */
export type MatchingWeights = {
  budget: number;
  location: number;
  rooms: number;
  type: number;
  sqm: number;
};

/**
 * VARSAYILAN ağırlık seti = bugüne kadarki sabit puanlar.
 * İşlem türü (25 puan) ağırlıklandırılmaz — sabit ön koşuldur (uyumsuzsa skor
 * zaten 20'ye sabitlenir). Kalan 75 puanlık havuz bu 5 kritere dağılır;
 * ağırlıklar hangi toplamla verilirse verilsin havuza normalize edilir.
 * Parametresiz çağrıda davranış eski sürümle BİREBİR aynıdır.
 */
export const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
  budget: 20,
  location: 25,
  rooms: 10,
  type: 15,
  sqm: 5,
};

/** İşlem türü dışındaki kriterlere dağıtılan puan havuzu (100 - 25). */
const WEIGHT_POOL = 75;

export const MATCHING_WEIGHT_KEYS = ["budget", "location", "rooms", "type", "sqm"] as const;

export const MATCHING_WEIGHT_LABELS: Record<keyof MatchingWeights, string> = {
  budget: "Bütçe",
  location: "Konum",
  rooms: "Oda",
  type: "Tür",
  sqm: "m²",
};

/** DB'den gelen jsonb'yi güvenli ağırlık setine çevirir (geçersiz → varsayılan). */
export function sanitizeMatchingWeights(input: unknown): MatchingWeights {
  const out: MatchingWeights = { ...DEFAULT_MATCHING_WEIGHTS };
  if (input && typeof input === "object") {
    for (const key of MATCHING_WEIGHT_KEYS) {
      const v = (input as Record<string, unknown>)[key];
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      if (Number.isFinite(n) && n >= 0) out[key] = n;
    }
  }
  const sum = MATCHING_WEIGHT_KEYS.reduce((s, k) => s + out[k], 0);
  return sum > 0 ? out : { ...DEFAULT_MATCHING_WEIGHTS };
}

/**
 * Ofisin özel kriter ağırlıklarını okur (tenants.matching_weights) — TEK doğruluk
 * kaynağı: tüm skor tüketicileri (eşleştirme sayfası, portföy/fiyat bildirimleri,
 * müşteri portalı, müşteri 360 önerileri) ağırlığı buradan alır.
 *
 * Ağırlık tanımlanmamışsa (kolon null) `undefined` döner; `scoreDemandProperty`
 * parametresiz çağrıyla BİREBİR aynı (varsayılan) davranır. Hata da best-effort
 * `undefined` — ağırlık okunamadı diye skor/bildirim asla kırılmaz.
 *
 * `tenantId`: admin (service_role) client'ta ŞART (RLS yok, satır hedeflenmeli);
 * RLS'li server client'ta verilmeyebilir (politika zaten tek tenant'a daraltır).
 */
export async function fetchTenantMatchingWeights(
  client: SupabaseClient,
  tenantId?: string,
): Promise<MatchingWeights | undefined> {
  try {
    let query = client.from("tenants").select("matching_weights");
    if (tenantId) query = query.eq("id", tenantId);
    const { data } = await query.limit(1).maybeSingle();
    const raw = (data as { matching_weights?: unknown } | null)?.matching_weights;
    return raw ? sanitizeMatchingWeights(raw) : undefined;
  } catch (e) {
    console.error("fetchTenantMatchingWeights", e);
    return undefined;
  }
}

/** Görüntüleme için yüzdeye normalize eder (toplam ~100, yuvarlanmış). */
export function matchingWeightsPercent(weights?: MatchingWeights | null): Record<keyof MatchingWeights, number> {
  const w = sanitizeMatchingWeights(weights ?? DEFAULT_MATCHING_WEIGHTS);
  const sum = MATCHING_WEIGHT_KEYS.reduce((s, k) => s + w[k], 0);
  return Object.fromEntries(
    MATCHING_WEIGHT_KEYS.map((k) => [k, Math.round((w[k] / sum) * 100)]),
  ) as Record<keyof MatchingWeights, number>;
}

/** Her kriter için ölçek katsayısı: varsayılan ağırlıkta tam 1 (eski davranış). */
function weightFactors(weights?: Partial<MatchingWeights> | null): Record<keyof MatchingWeights, number> {
  const w = sanitizeMatchingWeights(weights);
  const sum = MATCHING_WEIGHT_KEYS.reduce((s, k) => s + w[k], 0);
  return Object.fromEntries(
    MATCHING_WEIGHT_KEYS.map((k) => [k, (WEIGHT_POOL * w[k]) / sum / DEFAULT_MATCHING_WEIGHTS[k]]),
  ) as Record<keyof MatchingWeights, number>;
}

/** Skora göre kademe — geri bildirim bonusu sonrası yeniden hesaplamada da kullanılır. */
export function tierOf(score: number): MatchResult["tier"] {
  return score >= 75 ? "strong" : score >= 55 ? "good" : score >= 35 ? "weak" : "none";
}

export type MatchResult = {
  score: number;
  reasons: MatchReason[];
  tier: "strong" | "good" | "weak" | "none";
  /** "Olmazsa olmaz" bir kriter tutmadı: eşleşme elendi (skor en çok 20). */
  eliminated: boolean;
  /** Elenme nedeni etiketleri. */
  eliminatedBy: string[];
};

function norm(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("tr-TR");
}

function roomsClose(a: string | null, b: string | null) {
  if (!a || !b) return null;
  const na = norm(a).replace(/\s+/g, "");
  const nb = norm(b).replace(/\s+/g, "");
  if (na === nb) return true;
  // 3+1 vs 3+1 daire
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

function txCompatible(demandTx: string, propertyTx: string) {
  const d = norm(demandTx);
  const p = norm(propertyTx);
  if (!d || !p) return true;
  if (d === p) return true;
  const sale = ["satılık", "satilik", "sale", "satış", "satis"];
  const rent = ["kiralık", "kiralik", "rent", "kira"];
  if (sale.some((x) => d.includes(x)) && sale.some((x) => p.includes(x))) return true;
  if (rent.some((x) => d.includes(x)) && rent.some((x) => p.includes(x))) return true;
  return false;
}

function typeCompatible(demandType: string | null, propertyType: string) {
  if (!demandType) return true;
  const d = norm(demandType);
  const p = norm(propertyType);
  if (d === p) return true;
  if (d.includes(p) || p.includes(d)) return true;
  return false;
}

/**
 * 0–100 skor: işlem, tür, bütçe, konum, oda, m².
 * `weights` verilmezse DEFAULT_MATCHING_WEIGHTS kullanılır ve sonuç eski
 * sürümle birebir aynıdır (tüm katsayılar 1). Ağırlıklar toplamına göre
 * 75 puanlık havuza normalize edilir; işlem türü 25 puan ile sabittir.
 */
function scoreBase(
  demand: MatchDemand,
  property: MatchProperty,
  weights?: Partial<MatchingWeights> | null,
): Omit<MatchResult, "eliminated" | "eliminatedBy"> {
  const f = weightFactors(weights);
  const w = (key: keyof MatchingWeights, pts: number) => pts * f[key];
  const rw = (key: keyof MatchingWeights, pts: number) => Math.round(pts * f[key]);

  const reasons: MatchReason[] = [];
  let score = 0;

  const txOk = txCompatible(demand.transaction_type, property.transaction_type);
  reasons.push({ label: "İşlem türü", ok: txOk, weight: 25, field: "tx" });
  if (txOk) score += 25;

  const typeOk = typeCompatible(demand.property_type, property.property_type);
  reasons.push({ label: "Portföy türü", ok: typeOk, weight: rw("type", 15), field: "property_type" });
  if (typeOk) score += w("type", 15);
  else if (!demand.property_type) score += w("type", 8);

  // Budget
  const price = property.list_price != null ? Number(property.list_price) : null;
  let budgetOk = true;
  if (price != null && (demand.budget_min != null || demand.budget_max != null)) {
    const min = demand.budget_min != null ? Number(demand.budget_min) : 0;
    const max = demand.budget_max != null ? Number(demand.budget_max) : Number.POSITIVE_INFINITY;
    budgetOk = price >= min && price <= max;
    // soft miss: within 10%
    if (!budgetOk && max < Number.POSITIVE_INFINITY) {
      const soft = price <= max * 1.1 && price >= min * 0.9;
      if (soft) {
        budgetOk = true;
        score += w("budget", 12);
        reasons.push({ label: "Bütçe (±%10)", ok: true, weight: rw("budget", 20), field: "budget" });
      } else {
        reasons.push({ label: "Bütçe", ok: false, weight: rw("budget", 20), field: "budget" });
      }
    } else if (budgetOk) {
      score += w("budget", 20);
      reasons.push({ label: "Bütçe", ok: true, weight: rw("budget", 20), field: "budget" });
    } else {
      reasons.push({ label: "Bütçe", ok: false, weight: rw("budget", 20), field: "budget" });
    }
  } else {
    score += w("budget", 10);
    reasons.push({ label: "Bütçe (belirsiz)", ok: true, weight: rw("budget", 10), field: "budget" });
  }

  // Location
  if (demand.province_id && property.province_id) {
    const provOk = demand.province_id === property.province_id;
    reasons.push({ label: "İl", ok: provOk, weight: rw("location", 15), field: "location" });
    if (provOk) score += w("location", 15);
  } else {
    score += w("location", 6);
    reasons.push({ label: "İl (belirsiz)", ok: true, weight: rw("location", 6), field: "location" });
  }

  if (demand.district_id && property.district_id) {
    const distOk = demand.district_id === property.district_id;
    reasons.push({ label: "İlçe", ok: distOk, weight: rw("location", 10), field: "location" });
    if (distOk) score += w("location", 10);
  }

  // Rooms
  const propRooms = property.features?.rooms ?? null;
  const roomMatch = roomsClose(demand.rooms, propRooms);
  if (roomMatch === true) {
    score += w("rooms", 10);
    reasons.push({ label: "Oda", ok: true, weight: rw("rooms", 10), field: "rooms" });
  } else if (roomMatch === false) {
    reasons.push({ label: "Oda", ok: false, weight: rw("rooms", 10), field: "rooms" });
  } else {
    score += w("rooms", 4);
    reasons.push({ label: "Oda (belirsiz)", ok: true, weight: rw("rooms", 4), field: "rooms" });
  }

  // Sqm
  const propSqm = property.features?.sqm != null ? Number(property.features.sqm) : null;
  if (demand.min_sqm != null && propSqm != null) {
    const sqmOk = propSqm >= Number(demand.min_sqm);
    reasons.push({ label: "m²", ok: sqmOk, weight: rw("sqm", 5), field: "sqm" });
    if (sqmOk) score += w("sqm", 5);
  } else {
    score += w("sqm", 2);
  }

  // Status penalty
  if (property.status === "draft" || property.status === "archived") {
    score = Math.max(0, score - 15);
    reasons.push({ label: "Portföy durumu", ok: false, weight: 15 });
  } else if (property.status === "live" || property.status === "Yayında") {
    score = Math.min(100, score + 5);
  }

  // Hard fail if transaction incompatible
  if (!txOk) score = Math.min(score, 20);

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const tier = tierOf(clamped);

  return { score: clamped, reasons, tier };
}

type LocationVariant = { province_id: string | null; district_id: string | null; neighborhood_id: string | null };

export function locationVariants(demand: MatchDemand, criteria: DemandCriteria): LocationVariant[] {
  const primary: LocationVariant = {
    province_id: demand.province_id ?? null,
    district_id: demand.district_id ?? null,
    neighborhood_id: demand.neighborhood_id ?? null,
  };
  const hasPrimary = Boolean(primary.province_id || primary.district_id || primary.neighborhood_id);
  const extras = criteria.extra_locations.map((l) => ({
    province_id: l.province_id,
    district_id: l.district_id,
    neighborhood_id: l.neighborhood_id,
  }));
  return hasPrimary ? [primary, ...extras] : extras.length > 0 ? extras : [primary];
}

/** Bölge eşleşmesi: tanımlı her düzeyde (il, ilçe, mahalle) portföy verisi varsa eşit olmalı; veri yoksa elemez. */
function locationMatches(v: LocationVariant, p: MatchProperty): boolean {
  const pairs: Array<[string | null, string | null | undefined]> = [
    [v.province_id, p.province_id],
    [v.district_id, p.district_id],
    [v.neighborhood_id, p.neighborhood_id],
  ];
  return pairs.every(([d, pv]) => !d || !pv || d === pv);
}

function demandHasLocation(variants: LocationVariant[]): boolean {
  return variants.some((v) => v.province_id || v.district_id || v.neighborhood_id);
}

const shortNum = (n: number) => new Intl.NumberFormat("tr-TR").format(n);

/**
 * 0–100 skor: işlem, tür, bütçe, konum, oda, m² (+ yapılandırılmış talep kriterleri).
 *
 * - `weights` verilmezse DEFAULT_MATCHING_WEIGHTS kullanılır; talepte `criteria` yoksa/boşsa
 *   sonuç eski sürümle birebir aynıdır (yalnız `eliminated: false` alanı eklenir).
 * - Çoklu bölge: skor, portföye en uygun bölge üzerinden hesaplanır.
 * - Ek kriterler (kat, ısınma, cephe, özellik, max m², mahalle) skoru DEĞİŞTİRMEZ; gerekçe
 *   (`reasons`, ağırlık 0) olarak görünür. Etki yalnız "olmazsa olmaz" işaretliyse: tutmayan
 *   kriter eşleşmeyi eler (`eliminated`, skor en çok 20). Portföyde verisi olmayan alan
 *   değerlendirilemez ("belirsiz") ve elemez.
 */
export function scoreDemandProperty(
  demand: MatchDemand,
  property: MatchProperty,
  weights?: Partial<MatchingWeights> | null,
): MatchResult {
  const criteria = parseDemandCriteria(demand.criteria);
  const variants = locationVariants(demand, criteria);

  let base = scoreBase(demand, property, weights);
  if (criteria.extra_locations.length > 0) {
    for (const v of variants.slice(1)) {
      const cand = scoreBase({ ...demand, ...v }, property, weights);
      if (cand.score > base.score) base = cand;
    }
  }

  const required = new Set<CriteriaKey>(criteria.required);
  const reasons: MatchReason[] = base.reasons.map((r) => ({
    ...r,
    ...(r.field && r.field !== "tx" && required.has(r.field) ? { required: true } : {}),
  }));
  const failed: string[] = [];
  const fail = (field: CriteriaKey) => {
    const label = CRITERIA_LABELS[field];
    if (!failed.includes(label)) failed.push(label);
  };
  const extra = (field: CriteriaKey, label: string, ok: boolean, detail: string, unknown = false) => {
    const isReq = required.has(field);
    reasons.push({
      label: unknown ? `${label} (belirsiz)` : label,
      ok: unknown ? true : ok,
      weight: 0,
      field,
      ...(isReq ? { required: true } : {}),
      ...(unknown ? { unknown: true } : {}),
      detail,
    });
    if (isReq && !ok && !unknown) fail(field);
  };

  // Mevcut kriterlerin olmazsa olmaz denetimi (zaten reasons içinde).
  for (const r of reasons) {
    if (!r.required || r.ok) continue;
    if (r.field === "property_type" || r.field === "rooms" || r.field === "sqm") fail(r.field);
  }

  // Bütçe: olmazsa olmaz ise ±%10 esnekliği yok (aralık kesin).
  if (required.has("budget") && property.list_price != null && (demand.budget_min != null || demand.budget_max != null)) {
    const price = Number(property.list_price);
    const min = demand.budget_min != null ? Number(demand.budget_min) : 0;
    const max = demand.budget_max != null ? Number(demand.budget_max) : Number.POSITIVE_INFINITY;
    if (price < min || price > max) {
      fail("budget");
      for (const r of reasons) {
        if (r.field === "budget") {
          r.ok = false;
          r.detail = `fiyat ${shortNum(price)} ₺, bütçe dışında`;
        }
      }
    }
  }

  // Konum: tanımlı bölgelerden en az biri portföye uymalı.
  if (demandHasLocation(variants)) {
    const anyLoc = variants.some((v) => locationMatches(v, property));
    if (!anyLoc) {
      if (required.has("location")) fail("location");
      if (!reasons.some((r) => r.field === "location" && !r.ok)) {
        reasons.push({
          label: "Bölge",
          ok: false,
          weight: 0,
          field: "location",
          ...(required.has("location") ? { required: true } : {}),
        });
      }
    }
    if (variants.some((v) => v.neighborhood_id) && property.neighborhood_id) {
      const nOk = variants.some((v) => v.neighborhood_id === property.neighborhood_id);
      reasons.push({
        label: "Mahalle",
        ok: nOk,
        weight: 0,
        field: "location",
        ...(required.has("location") ? { required: true } : {}),
      });
    }
  }

  // m² üst sınırı
  if (criteria.max_sqm != null) {
    const propSqm = property.features?.sqm != null ? Number(property.features.sqm) : null;
    if (propSqm == null) extra("sqm", "m² üst sınır", true, "portföyde m² yok", true);
    else {
      const ok = propSqm <= criteria.max_sqm;
      extra("sqm", "m² üst sınır", ok, `talep ≤ ${shortNum(criteria.max_sqm)}, portföy ${shortNum(propSqm)}`);
    }
  }

  // Kat aralığı
  if (criteria.floor_min != null || criteria.floor_max != null) {
    const floor = property.features?.floor != null ? Number(property.features.floor) : null;
    if (floor == null || !Number.isFinite(floor)) extra("floor", "Kat", true, "portföyde kat yok", true);
    else {
      const ok =
        (criteria.floor_min == null || floor >= criteria.floor_min) &&
        (criteria.floor_max == null || floor <= criteria.floor_max);
      extra("floor", "Kat", ok, `talep ${criteria.floor_min ?? "…"}–${criteria.floor_max ?? "…"}, portföy ${floor}`);
    }
  }

  // Isınma / cephe
  const pairs: Array<["heating" | "facade", string, string | null, string | null | undefined]> = [
    ["heating", "Isınma", criteria.heating, property.features?.heating],
    ["facade", "Cephe", criteria.facade, property.features?.facade],
  ];
  for (const [field, label, want, have] of pairs) {
    if (!want) continue;
    if (!have) extra(field, label, true, `portföyde ${label.toLocaleLowerCase("tr-TR")} yok`, true);
    else extra(field, label, norm(want) === norm(have), `talep ${want}, portföy ${have}`);
  }

  // Özellik etiketleri
  if (criteria.features.length > 0) {
    const tags = property.features?.tags;
    if (!Array.isArray(tags) || tags.length === 0) {
      extra("features", "Özellikler", true, "portföyde özellik etiketi yok", true);
    } else {
      const have = new Set(tags.map((t) => norm(t)));
      const missing = criteria.features.filter((t) => !have.has(norm(t)));
      extra(
        "features",
        "Özellikler",
        missing.length === 0,
        missing.length === 0 ? "tümü var" : `eksik: ${missing.join(", ")}`,
      );
    }
  }

  if (failed.length > 0) {
    const score = Math.min(base.score, 20);
    return { score, reasons, tier: tierOf(score), eliminated: true, eliminatedBy: failed };
  }
  return { score: base.score, reasons, tier: base.tier, eliminated: false, eliminatedBy: [] };
}

export type MatchExplanation = {
  /** Uyuşan kriter etiketleri. */
  matched: string[];
  /** Uyuşmayan kriterler (olmazsa olmaz ise `required`). */
  missed: { label: string; required: boolean; detail?: string }[];
  /** Portföyde verisi olmadığı için değerlendirilemeyenler. */
  unknown: string[];
  eliminated: boolean;
  /** Tek satırlık döküm: "Elendi: … · Uyuşan: … · Uyuşmayan: …". */
  summary: string;
};

const stripUnknown = (label: string) => label.replace(/\s*\(belirsiz\)\s*$/u, "");

/** "Neden eşleşti / neden eşleşmedi" — alan bazlı, arayüz için tek kaynak. */
export function explainMatch(result: Pick<MatchResult, "reasons" | "eliminated" | "eliminatedBy">): MatchExplanation {
  const matched: string[] = [];
  const missed: MatchExplanation["missed"] = [];
  const unknown: string[] = [];
  for (const r of result.reasons) {
    if (r.unknown || /\(belirsiz\)\s*$/u.test(r.label)) {
      const l = stripUnknown(r.label);
      if (!unknown.includes(l)) unknown.push(l);
    } else if (r.ok) {
      const l = r.label.replace(/\s*\(±%10\)\s*$/u, "");
      if (!matched.includes(l)) matched.push(l);
    } else {
      missed.push({ label: r.label, required: r.required === true, ...(r.detail ? { detail: r.detail } : {}) });
    }
  }
  const parts: string[] = [];
  if (result.eliminated) parts.push(`Elendi (olmazsa olmaz): ${result.eliminatedBy.join(", ")}`);
  if (matched.length) parts.push(`Uyuşan: ${matched.join(", ")}`);
  if (missed.length) {
    parts.push(`Uyuşmayan: ${missed.map((m) => (m.required ? `${m.label} (olmazsa olmaz)` : m.label)).join(", ")}`);
  }
  if (unknown.length) parts.push(`Belirsiz: ${unknown.join(", ")}`);
  return { matched, missed, unknown, eliminated: result.eliminated, summary: parts.join(" · ") };
}

export function tierLabel(tier: MatchResult["tier"]) {
  switch (tier) {
    case "strong":
      return "Güçlü eşleşme";
    case "good":
      return "İyi eşleşme";
    case "weak":
      return "Zayıf";
    default:
      return "Uygun değil";
  }
}

export function tierCls(tier: MatchResult["tier"]) {
  switch (tier) {
    case "strong":
      return "bg-mint-500/12 text-mint-600";
    case "good":
      return "bg-brand-600/10 text-brand-600";
    case "weak":
      return "bg-amber-400/15 text-amber-600";
    default:
      return "bg-ink-950/8 text-text-muted";
  }
}
