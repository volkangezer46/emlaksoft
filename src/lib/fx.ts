/**
 * Döviz gösterimi — ₺ tutarların USD/EUR karşılığı.
 *
 * Neden ayrı modül (src/lib/tcmb.ts varken): tcmb.ts `import "server-only"`
 * taşıyor ve TCMB'nin kendisiyle konuşuyor. Bu modül SAF — ağ yok, `Date.now()`
 * yok, `server-only` yok. Tek işi: DB'ye yazılmış kurları okumak (client dışarıdan
 * verilir) ve sayıyı ekrana yazılacak biçime çevirmek. Böylece hem vitrin
 * (admin client), hem panel (RLS'li server client) aynı kodu kullanır ve
 * vitest'te ağ/DB olmadan test edilir.
 *
 * KAYNAK TABLO: `tcmb_rates` (rate_date date PK, usd_buying/usd_selling/
 * eur_buying/eur_selling numeric, source, fetched_at). Cron:
 * `/api/cron/tcmb-kur`, backfill: `scripts/tcmb-backfill.ts`.
 *
 * SATIŞ kuru kullanılıyor (buying değil): yabancı alıcı ₺ ödemek için döviz
 * bozdurur, karşılaştığı kur satış tarafıdır. Değerleme motoru da satışı
 * kullanıyor — iki yerde farklı kur göstermemek için aynısı seçildi.
 *
 * KUR YOKSA null: uydurma/eski varsayılan kur ASLA üretilmez. Çağıran satırı
 * sessizce gizler — yanlış döviz göstermektense hiç göstermemek doğrudur.
 */

/** Ekranda gösterilebilen para birimleri. */
export type FxCurrency = "TRY" | "USD" | "EUR";

/** DB'den okunan en güncel kur seti. */
export type FxRates = {
  /** Kurun geçerli olduğu gün (TCMB yayın tarihi), YYYY-MM-DD. */
  rateDate: string;
  /** USD satış kuru — okunamadıysa null. */
  usd: number | null;
  /** EUR satış kuru — okunamadıysa null. */
  eur: number | null;
};

/** `tcmb_rates` satırının bu modülün ihtiyacı olan kısmı. */
type FxRateRow = {
  rate_date: string;
  usd_selling: number | string | null;
  eur_selling: number | string | null;
};

/**
 * Supabase client'ın yalnızca kullandığımız kadarı.
 *
 * Neden `SupabaseClient` tipi import edilmiyor: bu modülün saf kalması ve
 * testte sahte bir client verilebilmesi için. Yapısal tip, hem server hem
 * admin client tarafından karşılanır.
 */
export type FxClient = {
  from(table: string): {
    select(columns: string): {
      order(
        column: string,
        options: { ascending: boolean },
      ): {
        limit(count: number): PromiseLike<{ data: FxRateRow[] | null; error: unknown }>;
      };
    };
  };
};

/** numeric kolonlar supabase-js'te string gelebilir — güvenli sayıya çevir. */
function toRate(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * En güncel USD/EUR satış kurunu döndürür.
 *
 * Hafta sonu/tatilde yeni yayın olmaz; en son kayıtlı gün kullanılır ve
 * yaşı `fxAgeLabel` ile kullanıcıya söylenir (sessizce eski kur göstermeyiz).
 *
 * Hiç kayıt yoksa, sorgu hata verirse ya da iki kur da okunamıyorsa `null` —
 * çağıran döviz satırını hiç basmaz.
 */
export async function fetchLatestRates(client: FxClient): Promise<FxRates | null> {
  let result: { data: FxRateRow[] | null; error: unknown };
  try {
    result = await client
      .from("tcmb_rates")
      .select("rate_date, usd_selling, eur_selling")
      .order("rate_date", { ascending: false })
      .limit(1);
  } catch {
    return null;
  }

  if (result.error) return null;
  const row = result.data?.[0];
  if (!row?.rate_date) return null;

  const usd = toRate(row.usd_selling);
  const eur = toRate(row.eur_selling);
  if (usd === null && eur === null) return null;

  return { rateDate: String(row.rate_date).slice(0, 10), usd, eur };
}

/**
 * ₺ tutarı verilen kurla çevirir; 2 basamağa yuvarlar.
 *
 * Kur yok/sıfır/negatifse null (uydurma yapmaz). Tutarın kendisi 0 ya da
 * negatif olabilir — indirim/fark hesapları da bu fonksiyondan geçiyor.
 */
export function convertTry(
  amountTry: number | null | undefined,
  rate: number | null | undefined,
): number | null {
  if (amountTry === null || amountTry === undefined) return null;
  if (!Number.isFinite(amountTry)) return null;
  if (rate === null || rate === undefined || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round((amountTry / rate) * 100) / 100;
}

const SYMBOLS: Record<FxCurrency, string> = { TRY: "₺", USD: "$", EUR: "€" };

/**
 * Tutarı tr-TR ayraçlarıyla biçimler: `1.234.567 ₺` · `$1.234.567` · `€980.000`.
 *
 * Simge yerleşimi bilinçli: ₺ Türkçe yazımda sona, $ ve € başa gelir.
 * Kuruş gösterilmez — emlak fiyatlarında gürültüden başka bir şey değil.
 * `null`/geçersiz girdi `null` döner ki çağıran satırı gizleyebilsin.
 */
export function formatFx(amount: number | null | undefined, currency: FxCurrency): string | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;
  const body = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(amount);
  return currency === "TRY" ? `${body} ${SYMBOLS.TRY}` : `${SYMBOLS[currency]}${body}`;
}

const DAY_MS = 86_400_000;

/** YYYY-MM-DD → UTC gün başlangıcı (ms). Geçersizse NaN. */
function utcDayStart(dateIso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Kurun yaşını Türkçe etikete çevirir — fiyatın altındaki `title` ipucu için.
 *
 * `nowMs` DIŞARIDAN verilir (src/lib/clock.ts `now()`); bu modül saat okumaz.
 * Gün farkı UTC gün başlangıçları üzerinden hesaplanır: TCMB tarihleri zaten
 * takvim günü, saat bileşeni yok. Gelecek tarihli kur (saat dilimi kayması)
 * "bugünün kuru" sayılır — kullanıcıya "-1 gün önce" demek anlamsız olurdu.
 */
export function fxAgeLabel(dateIso: string | null | undefined, nowMs: number): string | null {
  if (!dateIso) return null;
  const day = utcDayStart(dateIso);
  if (Number.isNaN(day)) return null;

  const today = utcDayStart(new Date(nowMs).toISOString().slice(0, 10));
  const diff = Math.round((today - day) / DAY_MS);

  if (diff <= 0) return "bugünün kuru";
  if (diff === 1) return "dünkü kur";
  return `${diff} gün önceki kur`;
}

/**
 * Fiyatın altına basılan tek satır: `≈ $28.000 · €25.500`.
 *
 * Kur yoksa ya da tutar geçersizse `null` → çağıran hiçbir şey basmaz.
 * Tek kur varsa tek karşılık basılır (TCMB bazen bir para birimini boş yayınlar).
 */
export function fxApproxLine(amountTry: number | null | undefined, rates: FxRates | null): string | null {
  if (!rates) return null;
  if (amountTry === null || amountTry === undefined || !Number.isFinite(amountTry) || amountTry <= 0) return null;

  const parts = [
    formatFx(convertTry(amountTry, rates.usd), "USD"),
    formatFx(convertTry(amountTry, rates.eur), "EUR"),
  ].filter((p): p is string => p !== null);

  return parts.length > 0 ? `≈ ${parts.join(" · ")}` : null;
}
