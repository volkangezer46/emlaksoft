/**
 * EmlakFiyati ANALİZ BAKİYESİ yapılandırması (tarife + paket kataloğu) — SAF dosya (sunucu/istemci güvenli, DB yok).
 * Tek merkez: admin düzenler, değerler `platform_settings` içinde saklanır; kodda SABİT FİYAT YOK (yalnız tarife
 * VARSAYILANI var; paket kataloğu varsayılan BOŞTUR: fiyatlar sahibin kararıdır).
 *
 * Analiz bakiyesi mantığı Emlaksoft'ta, EmlakFiyati yalnız sayar (docs/integrations/EMLAKFIYATI_ORTAK_API_TASLAK.md, v1 kılavuzu §7).
 * Cüzdan: `account_credit_ledger` birim `ef` (rezerve → kesinleştir/iade; ayrıntı RPC sözleşmesi aşağıda).
 */
import { z } from "zod";
import { EF_DEFAULT_PACKS, type EfPack } from "@/lib/ef-credits/pack-core";
export * from "@/lib/ef-credits/pack-core";

export const EF_TARIFF_SETTING_KEY = "ef.tariff";
export const EF_PACKS_SETTING_KEY = "ef.packs";
/** Ortak uçlar bayrağı (admin): "1" = açık. Yalnız son ortak yoklaması başarılıysa açılabilir. */
export const EF_ORTAK_FLAG_SETTING_KEY = "emlakfiyati_ortak_enabled";
/** Son başarılı ortak yoklaması (ISO) — bayrağı açmanın ön koşulu. */
export const EF_ORTAK_PROBE_OK_SETTING_KEY = "emlakfiyati_ortak_probe_ok_at";

export const EF_UNIT = "ef" as const;

/**
 * Yeni ofise TEK SEFER verilen hoş geldin analiz bakiyesi; 0 = kapalı. 1 birim = 1 TL (2026-10-08 fiyat kararı): 100 TL;
 * değerleme raporu (700+) için plan hakkı/paket gerekir. Analiz bakiyesi YALNIZ değerleme için harcanır (2026-10-10 kararı).
 * SÜRELİDİR: hoş geldin analiz bakiyesi `EF_WELCOME_VALID_DAYS` gün sonra yanar (SQL `ef_credit_grant` aynı sabiti kullanır).
 */
export const EF_WELCOME_SETTING_KEY = "ef.welcome_units";
export const EF_WELCOME_DEFAULT_UNITS = 100;
/** Hoş geldin analiz bakiyesinin geçerlilik süresi (gün; deneme süresiyle uyumlu). SQL `ef_credit_grant` bonus dalı ile AYNI. */
export const EF_WELCOME_VALID_DAYS = 30;

/**
 * Hoş geldin analiz bakiyesinin başlangıç anı (ISO; migration 20260826001200 uygulama zamanı yazar): yalnız `tenants.created_at`
 * bu andan SONRA/eşit olan ofisler alır, mevcut ofislere GERİYE DÖNÜK dağıtım yok. Ayar yok/geçersizse null = kimse almaz.
 */
export const EF_WELCOME_SINCE_SETTING_KEY = "ef.welcome_since";

export function parseEfWelcomeSince(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

export function parseEfWelcomeUnits(raw: string | null | undefined): number {
  if (raw == null || raw === "") return EF_WELCOME_DEFAULT_UNITS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : EF_WELCOME_DEFAULT_UNITS;
}

// ---------------------------------------------------------------------------
// Tarife: hangi işlem kaç TL (admin düzenler)
// ---------------------------------------------------------------------------
/** Tek işlem üst sınırı: 10.000 TL (1 birim = 1 TL). */
const EF_TARIFF_MAX = 10_000;
const tariffUnits = (fallback: number) => z.number().int().min(0).max(EF_TARIFF_MAX).default(fallback);

/**
 * Tarife: ANALİZ BAKİYESİ YALNIZ DEĞERLEME İÇİN harcanır (sahip kararı 2026-10-10). İlan analizi, PDF, rapor detayı vb. bakiye harcamaz;
 * eski kayıtlardaki `pdfFirst`/`reportDetail`/`listingAnalysis` alanları okunurken yok sayılır (zod fazlalığı atar).
 */
export const efTariffSchema = z.object({
  /** Ada/parsel ARSA değerlemesi (başarılı ve ücretlendirilen sonuç). */
  valuationArsa: z.number().int().min(0).max(EF_TARIFF_MAX),
  /** Ada/parsel KONUT değerlemesi. */
  valuationKonut: z.number().int().min(0).max(EF_TARIFF_MAX),
  /** TİCARİ değerleme bedeli. Eski kayıtta alan yoksa varsayılan (1.050) uygulanır. */
  valuationTicari: tariffUnits(1050),
});
export type EfTariff = z.infer<typeof efTariffSchema>;

/**
 * Varsayılan tarife (2026-10-08 fiyat kararı; 1 birim = 1 TL; admin /admin/analiz-tarifesi'dan değiştirir).
 * Konut raporu 700, arsa 850, ticari 1.050 TL. Başka hiçbir özellik bakiye düşmez.
 */
export const EF_DEFAULT_TARIFF: EfTariff = {
  valuationArsa: 850,
  valuationKonut: 700,
  valuationTicari: 1050,
};

/** Analiz bakiyesi düşen (ücretlendirilen) kalemler: yalnız değerleme. */
export type EfBillableItem = "valuation_arsa" | "valuation_konut" | "valuation_ticari";
/** Geçmiş kayıtlarda görülebilen tüm kalemler (eski `listing_analysis`/`pdf_first`/`report_detail` artık ücretlendirilmez). */
export type EfItem = EfBillableItem | "listing_analysis" | "pdf_first" | "report_detail";

export function efUnitsFor(item: EfBillableItem, tariff: EfTariff = EF_DEFAULT_TARIFF): number {
  switch (item) {
    case "valuation_arsa":
      return tariff.valuationArsa;
    case "valuation_konut":
      return tariff.valuationKonut;
    case "valuation_ticari":
      return tariff.valuationTicari;
  }
}

export function parseEfTariff(raw: string | null | undefined): EfTariff {
  if (!raw) return EF_DEFAULT_TARIFF;
  try {
    const parsed = efTariffSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EF_DEFAULT_TARIFF;
  } catch {
    return EF_DEFAULT_TARIFF;
  }
}

export function serializeEfTariff(tariff: EfTariff): string {
  return JSON.stringify(efTariffSchema.parse(tariff));
}

// ---------------------------------------------------------------------------
// Analiz paketleri (satış kataloğu; admin düzenler; varsayılan BOŞ)
// ---------------------------------------------------------------------------
const packMonthsSchema = z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]);

export const efPackSchema = z.object({
  /** Kararlı kimlik (a-z0-9-), faturada `meta.packId` olarak gider. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,31}$/),
  name: z.string().trim().min(2).max(60),
  /** Satın alınınca eklenen TOPLAM analiz bakiyesi (aylık hak x süre; bonus dahil). Süre sonunda kullanılmayan kısmı yanar. */
  units: z.number().int().min(1).max(100000),
  /** Geçerlilik süresi (ay): 1 | 3 | 6 | 12. Eski kayıtta alan yoksa 12 (süresiz satış kalmasın). */
  months: packMonthsSchema.default(12),
  /** KDV HARİÇ net tutar (TRY). Fatura toplamı = net × (1 + KDV); mevcut ödeme akışındaki KDV kuralı geçerlidir. */
  priceNetTry: z.number().min(1).max(10_000_000),
  active: z.boolean(),
  popular: z.boolean().optional(),
  order: z.number().int().min(0).max(1000),
});
// Tür pack-core.ts'te (zod'suz); şema ile uyumu derleme zamanında doğrulanır.
export const _efPackSchemaMatchesType: z.ZodType<EfPack, unknown> = efPackSchema;

export const efPacksSchema = z.array(efPackSchema).max(12);

export function parseEfPacks(raw: string | null | undefined): EfPack[] {
  if (!raw || raw.trim() === "") return EF_DEFAULT_PACKS.map((p) => ({ ...p }));
  try {
    const parsed = efPacksSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    const ids = new Set<string>();
    const out: EfPack[] = [];
    for (const p of parsed.data) {
      if (ids.has(p.id)) continue; // yinelenen kimlik yok sayılır
      ids.add(p.id);
      out.push(p);
    }
    return out.sort((a, b) => a.order - b.order || a.units - b.units);
  } catch {
    return [];
  }
}

export function serializeEfPacks(packs: EfPack[]): string {
  return JSON.stringify(efPacksSchema.parse(packs));
}
