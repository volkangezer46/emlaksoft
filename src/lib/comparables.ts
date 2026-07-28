import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computePriceHealth, type PriceHealth } from "@/lib/price-health";

/**
 * Yerli emsal (comparable) değerleme motoru — DIŞ API'YE SIFIR BAĞIMLILIK.
 *
 * Neden var: "Bu daire ne eder?" sorusuna kendi verimizle cevap. Endeksa/
 * Tapusor anahtarı olmasa da sistem çalışır; anahtar varsa sonuç zenginleşir.
 *
 * Kaynak güvenilirlik sırası:
 *   1) KAZANILMIŞ ANLAŞMA (deals.stage='won') — gerçekleşen fiyat. Liste
 *      fiyatı pazarlık payı içerir, kapanış içermez. SQL tarafında iki kez
 *      sayılarak ağırlıklandırılır.
 *   2) AKTİF PORTFÖY liste fiyatı — arz sinyali, ikincil.
 *
 * Güven skoru bilinçli olarak muhafazakâr: 3 emsalle "kesin değer" iddia
 * etmek yalancılıktır. `yetersiz` dönerse çağıran BİR DEĞER GÖSTERMEMELİ.
 */

export type ComparableSource = "won_deal" | "active_listing";

export type ComparableRow = {
  source: ComparableSource;
  property_id: string;
  title: string | null;
  price: number;
  sqm: number | null;
  price_per_sqm: number | null;
  rooms: string | null;
  happened_at: string;
};

export type ComparableConfidence = "yüksek" | "orta" | "düşük" | "yetersiz";

export type ComparableEstimate = {
  estimatedValue: number | null;
  lowValue: number | null;
  highValue: number | null;
  medianSqmPrice: number | null;
  compCount: number;
  wonCount: number;
  activeCount: number;
  confidence: ComparableConfidence;
  /** (Q3−Q1)/medyan yüzdesi — düşükse emsaller birbirine yakın */
  spreadPct: number | null;
};

export const CONFIDENCE_NOTE: Record<ComparableConfidence, string> = {
  yüksek: "Yeterli sayıda emsal ve dar fiyat aralığı — güvenilir tahmin.",
  orta: "Emsal sayısı sınırlı; aralığı geniş yorumlayın.",
  düşük: "Çok az emsal. Yalnızca kaba bir fikir verir, rapora esas alınmamalı.",
  yetersiz: "Bu kriterlerde emsal bulunamadı — tahmin üretilmedi.",
};

export type ComparableInput = {
  tenantId: string;
  districtId: string | null;
  propertyType: string | null;
  transactionType: string | null;
  sqm: number | null;
  /** Değerlenen portföyün kendisi emsal listesine girmesin */
  excludePropertyId?: string | null;
};

function usable(input: ComparableInput): boolean {
  return Boolean(
    input.tenantId &&
      input.districtId &&
      input.propertyType &&
      input.transactionType &&
      input.sqm &&
      input.sqm > 0,
  );
}

const EMPTY: ComparableEstimate = {
  estimatedValue: null,
  lowValue: null,
  highValue: null,
  medianSqmPrice: null,
  compCount: 0,
  wonCount: 0,
  activeCount: 0,
  confidence: "yetersiz",
  spreadPct: null,
};

/**
 * Emsal tabanlı tahmin. Girdi eksikse (ilçe/tip/m² yoksa) sessizce `yetersiz`
 * döner — yarım girdiyle uydurma değer üretmez.
 */
export async function estimateFromComparables(
  supabase: SupabaseClient,
  input: ComparableInput,
): Promise<ComparableEstimate> {
  if (!usable(input)) return EMPTY;

  const { data, error } = await supabase.rpc("estimate_property_value", {
    p_tenant_id: input.tenantId,
    p_district_id: input.districtId,
    p_property_type: input.propertyType,
    p_transaction_type: input.transactionType,
    p_sqm: input.sqm,
    p_exclude_property: input.excludePropertyId ?? null,
  });

  if (error) {
    console.error("estimateFromComparables", error.message);
    return EMPTY;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return EMPTY;

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  return {
    estimatedValue: num(row.estimated_value),
    lowValue: num(row.low_value),
    highValue: num(row.high_value),
    medianSqmPrice: num(row.median_sqm_price),
    compCount: Number(row.comp_count ?? 0),
    wonCount: Number(row.won_count ?? 0),
    activeCount: Number(row.active_count ?? 0),
    confidence: (row.confidence ?? "yetersiz") as ComparableConfidence,
    spreadPct: num(row.spread_pct),
  };
}

/** Emsal kayıtların kendisi — "neye dayanarak?" sorusunun cevabı. */
export async function listComparables(
  supabase: SupabaseClient,
  input: ComparableInput,
  limit = 20,
): Promise<ComparableRow[]> {
  if (!usable(input)) return [];

  const { data, error } = await supabase.rpc("find_comparables", {
    p_tenant_id: input.tenantId,
    p_district_id: input.districtId,
    p_property_type: input.propertyType,
    p_transaction_type: input.transactionType,
    p_sqm: input.sqm,
    p_exclude_property: input.excludePropertyId ?? null,
    p_limit: limit,
  });

  if (error) {
    console.error("listComparables", error.message);
    return [];
  }

  return (data ?? []).map((r: Record<string, unknown>) => ({
    source: r.source as ComparableSource,
    property_id: String(r.property_id),
    title: (r.title as string | null) ?? null,
    price: Number(r.price),
    sqm: r.sqm === null || r.sqm === undefined ? null : Number(r.sqm),
    price_per_sqm:
      r.price_per_sqm === null || r.price_per_sqm === undefined ? null : Number(r.price_per_sqm),
    rooms: (r.rooms as string | null) ?? null,
    happened_at: String(r.happened_at),
  }));
}

/** Rapor tablolarında gösterilen emsal satırı: kod + ilçe eklenmiş hâli. */
export type ComparableDetail = ComparableRow & {
  property_code: string | null;
  district_name: string | null;
};

/**
 * Değerlemede KULLANILAN emsal kümesinin dökümü — "hangi kayıtlara dayandık?"
 *
 * `estimateFromComparables` ile AYNI RPC zincirini (find_comparables) çağırır;
 * yani burada dönen satırlar tahmine giren kümenin ta kendisidir, ayrı bir
 * hesap yolu değildir. Mevcut hesap akışına dokunulmaz — bu yalnızca okuma.
 * Rapor tablosu için portföy kodu ve ilçe adı ikinci bir sorguyla eklenir.
 */
export async function listComparableDetails(
  supabase: SupabaseClient,
  input: ComparableInput,
  limit = 8,
): Promise<ComparableDetail[]> {
  const rows = await listComparables(supabase, input, limit);
  if (rows.length === 0) return [];

  const ids = Array.from(new Set(rows.map((r) => r.property_id)));
  const [{ data: props }, { data: district }] = await Promise.all([
    supabase.from("properties").select("id, property_code").in("id", ids),
    input.districtId
      ? supabase.from("geo_districts").select("name").eq("id", input.districtId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const codeById = new Map<string, string | null>(
    ((props ?? []) as Array<{ id: string; property_code: string | null }>).map((p) => [
      p.id,
      p.property_code ?? null,
    ]),
  );
  const districtName = (district as { name?: string } | null)?.name ?? null;

  return rows.map((r) => ({
    ...r,
    property_code: codeById.get(r.property_id) ?? null,
    district_name: districtName,
  }));
}

/**
 * Değerleme kaydının `sources` jsonb dizisine eklenen EMSAL ANLIK GÖRÜNTÜSÜ.
 *
 * Neden burada: `valuations` tablosuna kolon eklemek migration ister; `sources`
 * zaten jsonb ve rapor sayfaları onu diziden okuyor. Ağırlığı 0 olan, adı sabit
 * bir eleman olarak saklanır — fiyat hesabına girmez, rapor sayfaları bu adı
 * bilerek ayıklar (bilgi kaynakları listesine sızmaz).
 */
export const COMPARABLES_SOURCE_NAME = "__emsal_dokumu";

// `isInternalSource` kuralı lib/valuation-sources.ts'te (bu dosya `server-only`;
// kural saf ve test edilebilir kalsın diye ayrı tutuldu).
export { isInternalSource } from "@/lib/valuation-sources";

export type ComparablesSourceEntry = {
  name: typeof COMPARABLES_SOURCE_NAME;
  weight: 0;
  value: number;
  note: string;
  comparables: ComparableDetail[];
};

export function comparablesSourceEntry(rows: ComparableDetail[]): ComparablesSourceEntry {
  return {
    name: COMPARABLES_SOURCE_NAME,
    weight: 0,
    value: rows.length,
    note: "Değerleme anında kullanılan emsal kayıtları (rapor tablosu için).",
    comparables: rows,
  };
}

/** Kayıttaki emsal anlık görüntüsünü çıkarır; yoksa null (eski kayıtlar). */
export function extractStoredComparables(sources: unknown): ComparableDetail[] | null {
  if (!Array.isArray(sources)) return null;
  const entry = sources.find(
    (s): s is ComparablesSourceEntry =>
      typeof s === "object" &&
      s !== null &&
      (s as { name?: unknown }).name === COMPARABLES_SOURCE_NAME &&
      Array.isArray((s as { comparables?: unknown }).comparables),
  );
  return entry ? entry.comparables : null;
}

/**
 * Liste fiyatının emsal medyanına göre konumu.
 * Portföy sağlığı ve "neden satmıyor" sorusu için doğrudan sinyal.
 */
export type PricePosition = {
  /** Emsal medyanına göre yüzde sapma (+ pahalı, − uygun) */
  deviationPct: number;
  verdict: "piyasa üstü" | "piyasa seviyesinde" | "piyasa altı";
  hint: string;
};

export function pricePosition(
  listPrice: number | null,
  estimate: ComparableEstimate,
): PricePosition | null {
  if (!listPrice || listPrice <= 0) return null;
  if (estimate.confidence === "yetersiz" || !estimate.estimatedValue) return null;

  const deviationPct = Math.round(((listPrice - estimate.estimatedValue) / estimate.estimatedValue) * 1000) / 10;

  // ±%7 bandı "piyasa seviyesi" sayılıyor: emsal yayılımı zaten bu mertebede,
  // daha dar bir eşik her portföyü "yanlış fiyatlı" gösterir.
  if (deviationPct > 7) {
    return {
      deviationPct,
      verdict: "piyasa üstü",
      hint: `Emsal medyanının %${deviationPct} üzerinde. Uzun süre satılmıyorsa ilk bakılacak yer fiyat.`,
    };
  }
  if (deviationPct < -7) {
    return {
      deviationPct,
      verdict: "piyasa altı",
      hint: `Emsal medyanının %${Math.abs(deviationPct)} altında. Hızlı satış beklenir; malikle teyit edin.`,
    };
  }
  return {
    deviationPct,
    verdict: "piyasa seviyesinde",
    hint: "Fiyat emsallerle uyumlu.",
  };
}

/**
 * Emsal sapmasını fiyat sağlığı bandına çevirir — price-health.ts'teki
 * m² modeliyle AYNI eşikler (≤%10 green · ≤%20 yellow · üzeri red) ki
 * iki kaynak arasında geçiş sinyali zıplatmasın.
 */
export function healthFromDeviation(deviationPct: number): PriceHealth {
  const abs = Math.abs(deviationPct);
  if (abs > 20) return "red";
  if (abs > 10) return "yellow";
  return "green";
}

/**
 * Kalıcı `properties.price_health` değeri için TEK karar noktası.
 *
 * Sıra: önce yerli emsal motoru (gerçekleşen anlaşma + aktif arz — en
 * güvenilir sinyal); emsal `yetersiz` dönerse il/ilçe m² referans modeli
 * (computePriceHealth). Her iki yol da 'green'|'yellow'|'red'|'pending'
 * üretir — liste/detay sayfalarındaki rozetlerin beklediği değerler.
 *
 * Hem server action (fiyat güncellenince anında) hem cron (toplu tazeleme)
 * bu fonksiyonu çağırır; hesap mantığı tek yerde kalır.
 */
export async function resolvePriceHealth(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    listPrice: number | null;
    sqm: number | null;
    districtId: string | null;
    propertyType: string | null;
    transactionType: string | null;
    /** m² modeli için konum ipucu (ilçe adı, yoksa il adı) */
    districtHint: string | null;
    excludePropertyId?: string | null;
  },
): Promise<PriceHealth> {
  try {
    const estimate = await estimateFromComparables(supabase, {
      tenantId: input.tenantId,
      districtId: input.districtId,
      propertyType: input.propertyType,
      transactionType: input.transactionType,
      sqm: input.sqm,
      excludePropertyId: input.excludePropertyId ?? null,
    });
    const position = pricePosition(input.listPrice, estimate);
    if (position) return healthFromDeviation(position.deviationPct);
  } catch (e) {
    console.error("resolvePriceHealth comparables", e);
  }
  return computePriceHealth({
    listPrice: input.listPrice,
    sqm: input.sqm,
    districtHint: input.districtHint,
    transactionType: input.transactionType,
  }).health;
}
