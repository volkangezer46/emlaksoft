/**
 * Eşleştirme kriter ağırlıkları (tenants.matching_weights) — TEK KAYNAK; `matching.ts` buradan yeniden dışa aktarır.
 *
 * NEDEN AYRI DOSYA: `matching.ts` skor motoru için `demand-criteria` (modül düzeyinde zod şemaları) içe aktarır;
 * /app/ayarlar ağırlık formu yalnız bu sabitler için onu içe aktarınca tüm zod paketi (~280 KB ham) tarayıcıya
 * iniyordu. Bu dosya bağımlılıksızdır; buraya zod/sunucu içe aktarması EKLEME (`src/lib/client-bundle-contract.test.ts`).
 */

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

/** Görüntüleme için yüzdeye normalize eder (toplam ~100, yuvarlanmış). */
export function matchingWeightsPercent(weights?: MatchingWeights | null): Record<keyof MatchingWeights, number> {
  const w = sanitizeMatchingWeights(weights ?? DEFAULT_MATCHING_WEIGHTS);
  const sum = MATCHING_WEIGHT_KEYS.reduce((s, k) => s + w[k], 0);
  return Object.fromEntries(
    MATCHING_WEIGHT_KEYS.map((k) => [k, Math.round((w[k] / sum) * 100)]),
  ) as Record<keyof MatchingWeights, number>;
}
