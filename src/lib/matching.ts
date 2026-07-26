import type { SupabaseClient } from "@supabase/supabase-js";

export type MatchDemand = {
  id: string;
  transaction_type: string;
  property_type: string | null;
  province_id: string | null;
  district_id: string | null;
  budget_min: number | null;
  budget_max: number | null;
  rooms: string | null;
  min_sqm: number | null;
  urgency: string | null;
  status: string;
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
  features: { rooms?: string | null; sqm?: number | null } | null;
};

export type MatchReason = { label: string; ok: boolean; weight: number };

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
export function scoreDemandProperty(
  demand: MatchDemand,
  property: MatchProperty,
  weights?: Partial<MatchingWeights> | null,
): MatchResult {
  const f = weightFactors(weights);
  const w = (key: keyof MatchingWeights, pts: number) => pts * f[key];
  const rw = (key: keyof MatchingWeights, pts: number) => Math.round(pts * f[key]);

  const reasons: MatchReason[] = [];
  let score = 0;

  const txOk = txCompatible(demand.transaction_type, property.transaction_type);
  reasons.push({ label: "İşlem türü", ok: txOk, weight: 25 });
  if (txOk) score += 25;

  const typeOk = typeCompatible(demand.property_type, property.property_type);
  reasons.push({ label: "Portföy türü", ok: typeOk, weight: rw("type", 15) });
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
        reasons.push({ label: "Bütçe (±%10)", ok: true, weight: rw("budget", 20) });
      } else {
        reasons.push({ label: "Bütçe", ok: false, weight: rw("budget", 20) });
      }
    } else if (budgetOk) {
      score += w("budget", 20);
      reasons.push({ label: "Bütçe", ok: true, weight: rw("budget", 20) });
    } else {
      reasons.push({ label: "Bütçe", ok: false, weight: rw("budget", 20) });
    }
  } else {
    score += w("budget", 10);
    reasons.push({ label: "Bütçe (belirsiz)", ok: true, weight: rw("budget", 10) });
  }

  // Location
  if (demand.province_id && property.province_id) {
    const provOk = demand.province_id === property.province_id;
    reasons.push({ label: "İl", ok: provOk, weight: rw("location", 15) });
    if (provOk) score += w("location", 15);
  } else {
    score += w("location", 6);
    reasons.push({ label: "İl (belirsiz)", ok: true, weight: rw("location", 6) });
  }

  if (demand.district_id && property.district_id) {
    const distOk = demand.district_id === property.district_id;
    reasons.push({ label: "İlçe", ok: distOk, weight: rw("location", 10) });
    if (distOk) score += w("location", 10);
  }

  // Rooms
  const propRooms = property.features?.rooms ?? null;
  const roomMatch = roomsClose(demand.rooms, propRooms);
  if (roomMatch === true) {
    score += w("rooms", 10);
    reasons.push({ label: "Oda", ok: true, weight: rw("rooms", 10) });
  } else if (roomMatch === false) {
    reasons.push({ label: "Oda", ok: false, weight: rw("rooms", 10) });
  } else {
    score += w("rooms", 4);
    reasons.push({ label: "Oda (belirsiz)", ok: true, weight: rw("rooms", 4) });
  }

  // Sqm
  const propSqm = property.features?.sqm != null ? Number(property.features.sqm) : null;
  if (demand.min_sqm != null && propSqm != null) {
    const sqmOk = propSqm >= Number(demand.min_sqm);
    reasons.push({ label: "m²", ok: sqmOk, weight: rw("sqm", 5) });
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
