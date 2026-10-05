/**
 * EmlakFiyati TEK DURUM KAYNAĞI (SAF karar; sunucu/istemci güvenli, DB yok).
 * Public vitrin, /fiyatlar, /kayit, ofis kontör satın alma kapısı ve admin aynı kararı kullanır; para alan yol yalnız
 * `purchasable` (= "live") iken açılır. Önbellekli okuyucu `public-state.ts` içindedir.
 *
 * live        : anahtar var + ortak bayrağı AÇIK + son ortak yoklaması TAZE + cüzdan SQL'i hazır.
 * soon        : anahtar veya bayrak yok (özellik henüz açılmadı).
 * stale       : bayrak+anahtar var ama son başarılı yoklama eşikten eski (günlük sağlık cron'u çalışmıyor/başarısız).
 * maintenance : bayrak+anahtar var ama yoklama damgası yok/geçersiz (yoklama başarısız, silindi) veya cüzdan hazır değil.
 */
export type EfPublicState = "live" | "soon" | "stale" | "maintenance";

export type EfPublicStatus = {
  state: EfPublicState;
  /** state === "live". Kontör satışı, "kontör ile ek sorgu satın alınabilir" cümlesi ve sayıların "planlanan" etiketsiz gösterimi buna bağlıdır. */
  live: boolean;
  /** Kontör paketi için para alınabilir mi (şimdilik live ile aynı; ayrı alan, ileride ayrışabilsin diye). */
  purchasable: boolean;
};

/** Son başarılı yoklama bu süreden eskiyse "stale" (gün). Günlük cron + 6 gün tolerans. */
export const EF_PROBE_FRESH_DAYS = 7;
export const EF_PROBE_FRESH_MS = EF_PROBE_FRESH_DAYS * 86_400_000;
/** Gelecekteki damga (saat kayması) bu kadar toleranslıdır; fazlası geçersiz sayılır. */
const FUTURE_SKEW_MS = 5 * 60_000;

export type EfPublicStateInput = {
  /** EmlakFiyati API anahtarı var mı. */
  key: boolean;
  /** `emlakfiyati_ortak_enabled` ham değeri ("on"/"1"/"true" = açık). */
  flag: string | null | undefined;
  /** `emlakfiyati_ortak_probe_ok_at` ISO değeri. */
  probeAt: string | null | undefined;
  /** Epoch ms (clock.ts now()). */
  now: number;
  /** `ef_credit_ready()` sonucu. */
  walletReady: boolean;
};

function flagOn(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "on" || v === "true" || v === "1";
}

export function decideEfPublicState(input: EfPublicStateInput): EfPublicState {
  if (!input.key || !flagOn(input.flag)) return "soon";
  const raw = typeof input.probeAt === "string" ? input.probeAt.trim() : "";
  const at = raw ? new Date(raw).getTime() : Number.NaN;
  if (Number.isNaN(at) || at - input.now > FUTURE_SKEW_MS) return "maintenance";
  if (input.now - at > EF_PROBE_FRESH_MS) return "stale";
  if (!input.walletReady) return "maintenance";
  return "live";
}

export function efPublicStatusOf(state: EfPublicState): EfPublicStatus {
  const live = state === "live";
  return { state, live, purchasable: live };
}

/** Kapalı kontör satırına eklenen etiket (sayı plan kataloğundan gelir; durum live değilse "planlanan"). */
export const EF_PLANNED_SUFFIX = "(planlanan)";

export function efPlannedLine(line: string | null, live: boolean): string | null {
  if (!line) return null;
  return live ? line : `${line} ${EF_PLANNED_SUFFIX}`;
}

/** Satın alma kapısı hata/bilgi metni (sunucu action'ı ve ofis ekranı AYNI metni kullanır). */
export const EF_PURCHASE_CLOSED_MESSAGE = "Kontör satın alma, EmlakFiyati değerleme etkinleşince açılır.";
