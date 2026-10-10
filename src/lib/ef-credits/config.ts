/**
 * EmlakFiyati KONTÖR yapılandırması (tarife + paket kataloğu) — SAF dosya (sunucu/istemci güvenli, DB yok).
 * Tek merkez: admin düzenler, değerler `platform_settings` içinde saklanır; kodda SABİT FİYAT YOK (yalnız tarife
 * VARSAYILANI var; paket kataloğu varsayılan BOŞTUR: fiyatlar sahibin kararıdır).
 *
 * Kontör mantığı Emlaksoft'ta, EmlakFiyati yalnız sayar (docs/integrations/EMLAKFIYATI_ORTAK_API_TASLAK.md, v1 kılavuzu §7).
 * Cüzdan: `account_credit_ledger` birim `ef` (rezerve → kesinleştir/iade; ayrıntı RPC sözleşmesi aşağıda).
 */
import { z } from "zod";

export const EF_TARIFF_SETTING_KEY = "ef.tariff";
export const EF_PACKS_SETTING_KEY = "ef.packs";
/** Ortak uçlar bayrağı (admin): "1" = açık. Yalnız son ortak yoklaması başarılıysa açılabilir. */
export const EF_ORTAK_FLAG_SETTING_KEY = "emlakfiyati_ortak_enabled";
/** Son başarılı ortak yoklaması (ISO) — bayrağı açmanın ön koşulu. */
export const EF_ORTAK_PROBE_OK_SETTING_KEY = "emlakfiyati_ortak_probe_ok_at";

export const EF_UNIT = "ef" as const;

/**
 * Yeni ofise TEK SEFER verilen hoş geldin kontörü; 0 = kapalı. 1 kontör = 1 TL (2026-10-08 fiyat kararı): 100 kontör;
 * değerleme raporu (700+) için plan hakkı/paket gerekir. Kontör YALNIZ değerleme için harcanır (2026-10-10 kararı).
 * SÜRELİDİR: hoş geldin kontörü `EF_WELCOME_VALID_DAYS` gün sonra yanar (SQL `ef_credit_grant` aynı sabiti kullanır).
 */
export const EF_WELCOME_SETTING_KEY = "ef.welcome_units";
export const EF_WELCOME_DEFAULT_UNITS = 100;
/** Hoş geldin kontörünün geçerlilik süresi (gün; deneme süresiyle uyumlu). SQL `ef_credit_grant` bonus dalı ile AYNI. */
export const EF_WELCOME_VALID_DAYS = 30;
/** Admin/iade yüklemesinde ay seçilmezse geçerlilik (ay). SQL `ef_credit_grant` varsayılanı ile AYNI. */
export const EF_DEFAULT_GRANT_VALID_MONTHS = 12;

/**
 * Hoş geldin kontörünün başlangıç anı (ISO; migration 20260826001200 uygulama zamanı yazar): yalnız `tenants.created_at`
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
// Tarife: hangi işlem kaç kontör (admin düzenler)
// ---------------------------------------------------------------------------
/** Tek işlem üst sınırı: 10.000 kontör (1 kontör = 1 TL). */
const EF_TARIFF_MAX = 10_000;
const tariffUnits = (fallback: number) => z.number().int().min(0).max(EF_TARIFF_MAX).default(fallback);

/**
 * Tarife: KONTÖR YALNIZ DEĞERLEME İÇİN harcanır (sahip kararı 2026-10-10). İlan analizi, PDF, rapor detayı vb. kontörsüzdür;
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
 * Varsayılan tarife (2026-10-08 fiyat kararı; 1 kontör = 1 TL; admin /admin/ef-kontor'dan değiştirir).
 * Konut raporu 700, arsa 850, ticari 1.050 kontör. Başka hiçbir özellik kontör düşmez.
 */
export const EF_DEFAULT_TARIFF: EfTariff = {
  valuationArsa: 850,
  valuationKonut: 700,
  valuationTicari: 1050,
};

/** Kontör düşen (ücretlendirilen) kalemler: yalnız değerleme. */
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

/** "Yaklaşık N değerleme" paydası: en ucuz (0 olmayan) değerleme raporu bedeli (varsayılanda konut 700). 0 = hesaplanamaz. */
export function efEntryValuationUnits(tariff: Pick<EfTariff, "valuationArsa" | "valuationKonut" | "valuationTicari">): number {
  const costs = [tariff.valuationKonut, tariff.valuationArsa, tariff.valuationTicari].filter((n) => n > 0);
  return costs.length > 0 ? Math.min(...costs) : 0;
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
// Kontör paketleri (satış kataloğu; admin düzenler; varsayılan BOŞ)
// ---------------------------------------------------------------------------
/** Paket süreleri (ay): satın alınan kontör bu süre sonunda yanar, devretmez. */
export const EF_PACK_MONTHS = [1, 3, 6, 12] as const;
export type EfPackMonths = (typeof EF_PACK_MONTHS)[number];
export const EF_PACK_MONTHS_LABEL: Record<EfPackMonths, string> = { 1: "1 aylık", 3: "3 aylık", 6: "6 aylık", 12: "12 aylık" };

const packMonthsSchema = z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]);

export const efPackSchema = z.object({
  /** Kararlı kimlik (a-z0-9-), faturada `meta.packId` olarak gider. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,31}$/),
  name: z.string().trim().min(2).max(60),
  /** Satın alınınca eklenen TOPLAM kontör (aylık hak x süre; bonus dahil). Süre sonunda kullanılmayan kısmı yanar. */
  units: z.number().int().min(1).max(100000),
  /** Geçerlilik süresi (ay): 1 | 3 | 6 | 12. Eski kayıtta alan yoksa 12 (süresiz satış kalmasın). */
  months: packMonthsSchema.default(12),
  /** KDV HARİÇ net tutar (TRY). Fatura toplamı = net × (1 + KDV); mevcut ödeme akışındaki KDV kuralı geçerlidir. */
  priceNetTry: z.number().min(1).max(10_000_000),
  active: z.boolean(),
  popular: z.boolean().optional(),
  order: z.number().int().min(0).max(1000),
});
export type EfPack = z.infer<typeof efPackSchema>;

export const efPacksSchema = z.array(efPackSchema).max(12);

/** Varsayılan katalog: aylık kontör seçenekleri (1 kontör = 1 TL tabanı). */
export const EF_DEFAULT_PACK_MONTHLY_TIERS = [1000, 2500, 5000] as const;
/** Uzun süreye indirim (%), süre bazında: 1 ay yok, 3 ay %5, 6 ay %10, 12 ay %15. Admin paket fiyatını düzenleyerek değiştirir. */
export const EF_DEFAULT_PACK_DISCOUNT_PCT: Record<EfPackMonths, number> = { 1: 0, 3: 5, 6: 10, 12: 15 };

const trNum = (n: number) => n.toLocaleString("tr-TR");

/** Varsayılan paket kataloğu (2026-10-10 kararı): 3 aylık-kontör kademesi x 4 süre = 12 paket. SQL seed'i (20261008001000) birebir bunu yazar. */
export function buildDefaultEfPacks(): EfPack[] {
  const out: EfPack[] = [];
  EF_DEFAULT_PACK_MONTHLY_TIERS.forEach((monthly, ti) => {
    EF_PACK_MONTHS.forEach((months, mi) => {
      const units = monthly * months;
      const price = Math.round((units * (100 - EF_DEFAULT_PACK_DISCOUNT_PCT[months])) / 100);
      out.push({
        id: `ef-${monthly}-${months}a`,
        name: `${EF_PACK_MONTHS_LABEL[months]} · aylık ${trNum(monthly)} kontör`,
        units,
        months,
        priceNetTry: price,
        active: true,
        ...(monthly === 2500 && months === 6 ? { popular: true } : {}),
        order: (ti * EF_PACK_MONTHS.length + mi + 1) * 10,
      });
    });
  });
  return out;
}

/**
 * Varsayılan kontör paketleri. Ayar (`ef.packs`) hiç yoksa/boşsa bunlar geçerlidir; admin /admin/ef-kontor'dan düzenler
 * (kayıt varsa yalnız o geçerli).
 */
export const EF_DEFAULT_PACKS: readonly EfPack[] = buildDefaultEfPacks();

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

/** Paketin AYLIK ortalama kontörü (toplam / süre; gösterim). */
export function efPackMonthlyUnits(pack: Pick<EfPack, "units" | "months">): number {
  return pack.months > 0 ? Math.round(pack.units / pack.months) : pack.units;
}

/** Kontör başına net birim fiyat (gösterim/doğrulama). */
export function efPackUnitPriceTry(pack: Pick<EfPack, "units" | "priceNetTry">): number {
  return pack.units > 0 ? Math.round((pack.priceNetTry / pack.units) * 100) / 100 : 0;
}

/** Katalog doğrulama uyarıları (kaydı ENGELLEMEZ; hatalar şema ile engellenir). */
export function efPackWarnings(packs: EfPack[]): string[] {
  const out: string[] = [];
  const active = packs.filter((p) => p.active);
  // Aynı sürede büyük paket küçükten pahalı olmamalı.
  for (const months of EF_PACK_MONTHS) {
    const same = active.filter((p) => p.months === months).sort((a, b) => a.units - b.units);
    for (let i = 1; i < same.length; i++) {
      const prev = efPackUnitPriceTry(same[i - 1]!);
      const cur = efPackUnitPriceTry(same[i]!);
      if (cur > prev) out.push(`"${same[i]!.name}" paketinin kontör başı fiyatı (${cur}) aynı süreli daha küçük paketten (${prev}) pahalı: büyük paket mantıksız.`);
    }
  }
  // Aynı aylık kontörde uzun süre kısadan pahalı olmamalı.
  const byMonthly = new Map<number, EfPack[]>();
  for (const p of active) byMonthly.set(efPackMonthlyUnits(p), [...(byMonthly.get(efPackMonthlyUnits(p)) ?? []), p]);
  for (const group of byMonthly.values()) {
    const sorted = [...group].sort((a, b) => a.months - b.months);
    for (let i = 1; i < sorted.length; i++) {
      if (efPackUnitPriceTry(sorted[i]!) > efPackUnitPriceTry(sorted[i - 1]!)) {
        out.push(`"${sorted[i]!.name}" daha uzun süreli ama kontör başı fiyatı "${sorted[i - 1]!.name}" paketinden yüksek: uzun süre indirimli olmalı.`);
      }
    }
  }
  if (packs.length > 0 && active.length === 0) out.push("Aktif paket yok: ofisler kontör satın alamaz.");
  return out;
}

// ---------------------------------------------------------------------------
// Cüzdan RPC sözleşmesi (SQL tarafı yazılırken ve TS çağrılarında AYNEN uyulur; hepsi service_role-only)
// ---------------------------------------------------------------------------
export type EfBalance = {
  /** Kullanılabilir = SÜRESİ DOLMAMIŞ partilerin kalanı - açık rezerv. */
  available: number;
  reserved: number;
  /** Defterde yüklenen toplam (süresi dolan dahil; geçmiş). */
  granted_total: number;
  /** Harcanan (yalnız kullanım; süre dolumu `expired_total`). */
  committed_total: number;
  /** Süresi dolup yanan toplam (partiler şeması 20261010000300 sonrası; eski şemada yok). */
  expired_total?: number;
  /** Sonraki yanma: süresi dolmamış en yakın partinin son kullanma anı (ISO) ve o anda yanacak kontör; yoksa null/0. */
  next_expiry_at?: string | null;
  next_expiry_units?: number;
};
export type EfReserveResult =
  | { ok: true; code: "ok" | "duplicate"; reservation_id: string; state: "reserved" | "committed" | "released"; available: number }
  | { ok: false; code: "insufficient"; available: number };
export type EfSettleResult = { ok: boolean; state: "reserved" | "committed" | "released" | "unknown"; already: boolean };
export type EfGrantResult = { ok: boolean; already: boolean; available: number };

/** `ef_credit_burn_expired` (20261010000300): süresi dolan partileri yakar; günlük `ef-kontor-hak` cron adımı. */
export type EfBurnResult = { ok: boolean; burned_lots: number; burned_units: number; skipped?: boolean };
/** (p_limit int default 500, p_grace interval default '1 hour') -> jsonb EfBurnResult; service_role-only. Cüzdan 000100 `EF_RPC` kümesinden AYRIDIR. */
export const EF_RPC_BURN_EXPIRED = "ef_credit_burn_expired" as const;

export const EF_GRANT_KINDS = ["purchase", "plan_monthly", "bonus", "admin", "refund"] as const;
export type EfGrantKind = (typeof EF_GRANT_KINDS)[number];

export const EF_RPC = {
  balance: "ef_credit_balance", //  (p_tenant uuid) -> jsonb EfBalance
  reserve: "ef_credit_reserve", //  (p_tenant uuid, p_user uuid, p_units int, p_idem text, p_item text) -> jsonb EfReserveResult; AYNI (tenant,p_idem) = AYNI rezerve
  commit: "ef_credit_commit", //    (p_tenant uuid, p_reservation uuid, p_ref jsonb) -> jsonb EfSettleResult; yalnız reserved->committed, idempotent
  release: "ef_credit_release", //  (p_tenant uuid, p_reservation uuid, p_reason text) -> jsonb EfSettleResult; yalnız reserved->released, idempotent
  grant: "ef_credit_grant", //      (p_tenant uuid, p_units int, p_kind text, p_idem text, p_meta jsonb) -> jsonb EfGrantResult; (tenant,p_idem) tekil
  sweep: "ef_credit_sweep", //      (p_older_than interval default '15 minutes') -> int: eski açık rezervleri serbest bırakır
} as const;

/** EmlakFiyati `Idempotency-Key`: rezerve kaydından türetilir (8-128, [A-Za-z0-9_.:-]); yeniden denemede AYNI. */
export function efIdempotencyKey(reservationId: string): string {
  return `es-${reservationId}`;
}

/** Mutabakat için gün anahtarı ve alan adları: EmlakFiyati `GET /kullanim` `toplam.degerleme` ve `toplam.pdf` ile eşleşir. */
export const EF_RECONCILE_FIELDS = { valuation: "degerleme", pdf: "pdf" } as const;
