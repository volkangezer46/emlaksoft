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

/** Yeni ofise TEK SEFER verilen hoş geldin kontörü (EmlakFiyati "ilk değerleme ücretsiz" karşılığı); 0 = kapalı. */
export const EF_WELCOME_SETTING_KEY = "ef.welcome_units";
export const EF_WELCOME_DEFAULT_UNITS = 10;

export function parseEfWelcomeUnits(raw: string | null | undefined): number {
  if (raw == null || raw === "") return EF_WELCOME_DEFAULT_UNITS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : EF_WELCOME_DEFAULT_UNITS;
}

// ---------------------------------------------------------------------------
// Tarife: hangi işlem kaç kontör (admin düzenler)
// ---------------------------------------------------------------------------
export const efTariffSchema = z.object({
  /** Ada/parsel ARSA değerlemesi (başarılı ve ücretlendirilen sonuç). */
  valuationArsa: z.number().int().min(0).max(1000),
  /** Ada/parsel KONUT değerlemesi. */
  valuationKonut: z.number().int().min(0).max(1000),
  /** Bir raporun İLK PDF indirmesi; aynı raporun tekrar indirmeleri HER ZAMAN 0 (EmlakFiyati `pdf_tekrar` 0 TL). */
  pdfFirst: z.number().int().min(0).max(1000),
  /** Rapor detayı (JSON) çağrısı; ürün kararı: varsayılan 0. */
  reportDetail: z.number().int().min(0).max(1000),
});
export type EfTariff = z.infer<typeof efTariffSchema>;

/** Varsayılan tarife (sahibin kararı olarak admin'den değiştirilir). */
export const EF_DEFAULT_TARIFF: EfTariff = { valuationArsa: 5, valuationKonut: 5, pdfFirst: 2, reportDetail: 0 };

export type EfItem = "valuation_arsa" | "valuation_konut" | "pdf_first" | "report_detail";

export function efUnitsFor(item: EfItem, tariff: EfTariff = EF_DEFAULT_TARIFF): number {
  switch (item) {
    case "valuation_arsa":
      return tariff.valuationArsa;
    case "valuation_konut":
      return tariff.valuationKonut;
    case "pdf_first":
      return tariff.pdfFirst;
    case "report_detail":
      return tariff.reportDetail;
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
// Kontör paketleri (satış kataloğu; admin düzenler; varsayılan BOŞ)
// ---------------------------------------------------------------------------
export const efPackSchema = z.object({
  /** Kararlı kimlik (a-z0-9-), faturada `meta.packId` olarak gider. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,31}$/),
  name: z.string().trim().min(2).max(60),
  /** Satın alınınca eklenen kontör (bonus dahil toplam). */
  units: z.number().int().min(1).max(100000),
  /** KDV HARİÇ net tutar (TRY). Fatura toplamı = net × (1 + KDV); mevcut ödeme akışındaki KDV kuralı geçerlidir. */
  priceNetTry: z.number().min(1).max(10_000_000),
  active: z.boolean(),
  popular: z.boolean().optional(),
  order: z.number().int().min(0).max(1000),
});
export type EfPack = z.infer<typeof efPackSchema>;

export const efPacksSchema = z.array(efPackSchema).max(12);

export function parseEfPacks(raw: string | null | undefined): EfPack[] {
  if (!raw) return [];
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

/** Kontör başına net birim fiyat (gösterim/doğrulama). */
export function efPackUnitPriceTry(pack: Pick<EfPack, "units" | "priceNetTry">): number {
  return pack.units > 0 ? Math.round((pack.priceNetTry / pack.units) * 100) / 100 : 0;
}

/** Katalog doğrulama uyarıları (kaydı ENGELLEMEZ; hatalar şema ile engellenir). */
export function efPackWarnings(packs: EfPack[]): string[] {
  const out: string[] = [];
  const active = packs.filter((p) => p.active).sort((a, b) => a.units - b.units);
  for (let i = 1; i < active.length; i++) {
    const prev = efPackUnitPriceTry(active[i - 1]!);
    const cur = efPackUnitPriceTry(active[i]!);
    if (cur > prev) out.push(`"${active[i]!.name}" paketinin kontör başı fiyatı (${cur}) daha küçük paketten (${prev}) pahalı: büyük paket mantıksız.`);
  }
  if (packs.length > 0 && active.length === 0) out.push("Aktif paket yok: ofisler kontör satın alamaz.");
  return out;
}

// ---------------------------------------------------------------------------
// Cüzdan RPC sözleşmesi (SQL tarafı yazılırken ve TS çağrılarında AYNEN uyulur; hepsi service_role-only)
// ---------------------------------------------------------------------------
export type EfBalance = {
  available: number;
  reserved: number;
  granted_total: number;
  committed_total: number;
};
export type EfReserveResult =
  | { ok: true; code: "ok" | "duplicate"; reservation_id: string; state: "reserved" | "committed" | "released"; available: number }
  | { ok: false; code: "insufficient"; available: number };
export type EfSettleResult = { ok: boolean; state: "reserved" | "committed" | "released" | "unknown"; already: boolean };
export type EfGrantResult = { ok: boolean; already: boolean; available: number };

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
