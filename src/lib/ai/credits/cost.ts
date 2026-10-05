/**
 * AI kredi maliyet hesabı (SAF modül: sunucu/istemci/test güvenli, DB yok).
 *
 * Birim: "kredi". Maliyet tablosu model başına 1.000 jeton için giriş/çıkış kredisidir ve
 * platform ayarından (`ai.credit_cost_table`, JSON) okunur; buradaki değerler yalnız
 * VARSAYILANdır (ayar yoksa/bozuksa kullanılır, kodda sabitlenmez).
 */

export const AI_COST_TABLE_SETTING_KEY = "ai.credit_cost_table";
/** Kredi defteri `unit` değerleri (tek defter: account_credit_ledger). */
export const AI_LEDGER_UNIT = "ai";
export const VALUATION_LEDGER_UNIT = "valuation";
/** Kullanım uyarı eşiği (kotanın %80'i). */
export const AI_CREDIT_WARN_RATIO = 0.8;

export type ModelRate = { in: number; out: number };
export type CostTable = {
  /** Model adı (küçük harf, öne uyan en uzun anahtar) -> 1K jeton başına kredi. */
  models: Record<string, ModelRate>;
  /** Tabloda olmayan modeller. */
  fallback: ModelRate;
  /** Tek çağrı için en az kredi (0'dan büyük). */
  minCharge: number;
};

export const DEFAULT_COST_TABLE: CostTable = {
  models: {
    "gpt-4o-mini": { in: 0.15, out: 0.6 },
    "gpt-4o": { in: 2.5, out: 10 },
    "gpt-4.1-mini": { in: 0.4, out: 1.6 },
    "gpt-4.1": { in: 2, out: 8 },
  },
  fallback: { in: 1, out: 4 },
  minCharge: 0.01,
};

function num(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < min || v > max) return null;
  return v;
}

function cleanRate(raw: unknown): ModelRate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const i = num(r.in, 0, 100_000);
  const o = num(r.out, 0, 100_000);
  return i === null || o === null ? null : { in: i, out: o };
}

/** Ayar metnini güvenle çözer; bozuk/eksik parçalar varsayılana düşer (asla fırlatmaz). */
export function parseCostTable(raw: string | null | undefined): CostTable {
  if (!raw) return DEFAULT_COST_TABLE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_COST_TABLE;
  }
  if (!parsed || typeof parsed !== "object") return DEFAULT_COST_TABLE;
  const p = parsed as Record<string, unknown>;
  const models: Record<string, ModelRate> = { ...DEFAULT_COST_TABLE.models };
  if (p.models && typeof p.models === "object") {
    for (const [k, v] of Object.entries(p.models as Record<string, unknown>)) {
      const rate = cleanRate(v);
      const key = k.trim().toLowerCase();
      if (rate && key) models[key] = rate;
    }
  }
  return {
    models,
    fallback: cleanRate(p.fallback) ?? DEFAULT_COST_TABLE.fallback,
    minCharge: num(p.minCharge, 0.01, 1000) ?? DEFAULT_COST_TABLE.minCharge,
  };
}

export function serializeCostTable(table: CostTable): string {
  return JSON.stringify(table);
}

/** Modele uyan oran: tam eşleşme, yoksa en uzun önek (ör. "gpt-4o-mini-2024-07-18"). */
export function rateForModel(model: string | null | undefined, table: CostTable): ModelRate {
  const m = (model ?? "").trim().toLowerCase();
  if (!m) return table.fallback;
  if (table.models[m]) return table.models[m]!;
  let best: string | null = null;
  for (const key of Object.keys(table.models)) {
    if (m.startsWith(key) && (best === null || key.length > best.length)) best = key;
  }
  return best ? table.models[best]! : table.fallback;
}

/** Jeton -> kredi. Sonuç 2 ondalığa yuvarlanır (defter numeric(14,2)), en az `minCharge`. */
export function computeCredits(
  model: string | null | undefined,
  tokensIn: number,
  tokensOut: number,
  table: CostTable = DEFAULT_COST_TABLE,
): number {
  const rate = rateForModel(model, table);
  const tin = Math.max(0, Number.isFinite(tokensIn) ? tokensIn : 0);
  const tout = Math.max(0, Number.isFinite(tokensOut) ? tokensOut : 0);
  const raw = (tin / 1000) * rate.in + (tout / 1000) * rate.out;
  const rounded = Math.round(raw * 100) / 100;
  return Math.max(table.minCharge, rounded);
}

/** Yaklaşık jeton: ~3,5 karakter/jeton (Türkçe için tutucu). Gerçek kullanım yoksa tahmin. */
export function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(Math.max(0, chars) / 3.5));
}

/** Kota durumu: kullanım kotanın hangi bölümünde. Kota boşsa SINIRSIZ. */
export type QuotaState = "unlimited" | "ok" | "warn" | "over";

export function quotaState(used: number, quota: number | null | undefined): QuotaState {
  if (quota === null || quota === undefined) return "unlimited";
  if (quota <= 0) return used > 0 ? "over" : "ok";
  if (used >= quota) return "over";
  if (used >= quota * AI_CREDIT_WARN_RATIO) return "warn";
  return "ok";
}
