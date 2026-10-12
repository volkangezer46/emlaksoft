/**
 * Analiz bakiyesi paketleri: zod'suz çekirdek (istemci editörü için). Şema `config.ts`te kalır; sunucu action'ı doğrular.
 * `config.ts` bunu yeniden dışa aktarır (mevcut içe aktarmalar değişmez).
 */

/** Admin/iade yüklemesinde ay seçilmezse geçerlilik (ay). SQL `ef_credit_grant` varsayılanı ile AYNI. */
export const EF_DEFAULT_GRANT_VALID_MONTHS = 12;

/** Paket süreleri (ay): satın alınan analiz bakiyesi bu süre sonunda yanar, devretmez. */
export const EF_PACK_MONTHS = [1, 3, 6, 12] as const;
export type EfPackMonths = (typeof EF_PACK_MONTHS)[number];
export const EF_PACK_MONTHS_LABEL: Record<EfPackMonths, string> = { 1: "1 aylık", 3: "3 aylık", 6: "6 aylık", 12: "12 aylık" };


export type EfPack = {
  /** Kararlı kimlik (a-z0-9-), faturada `meta.packId` olarak gider. */
  id: string;
  name: string;
  /** Satın alınınca eklenen TOPLAM analiz bakiyesi. */
  units: number;
  months: EfPackMonths;
  /** KDV HARİÇ net tutar (TRY). */
  priceNetTry: number;
  active: boolean;
  popular?: boolean;
  order: number;
};

/**
 * İstemci ön doğrulaması: `efPackSchema` ile AYNI kurallar (kaydı sunucu action'ı yine şemayla doğrular;
 * pack-core.test.ts iki tarafı karşılaştırır).
 */
export function isEfPackValid(p: unknown): p is EfPack {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  return (
    typeof o.id === "string" && /^[a-z0-9][a-z0-9-]{1,31}$/.test(o.id) &&
    name.length >= 2 && name.length <= 60 &&
    typeof o.units === "number" && Number.isInteger(o.units) && o.units >= 1 && o.units <= 100000 &&
    (EF_PACK_MONTHS as readonly unknown[]).includes(o.months) &&
    typeof o.priceNetTry === "number" && Number.isFinite(o.priceNetTry) && o.priceNetTry >= 1 && o.priceNetTry <= 10_000_000 &&
    typeof o.active === "boolean" &&
    (o.popular === undefined || typeof o.popular === "boolean") &&
    typeof o.order === "number" && Number.isInteger(o.order) && o.order >= 0 && o.order <= 1000
  );
}

/** Varsayılan katalog: aylık analiz bakiyesi seçenekleri (1 birim = 1 TL tabanı). */
export const EF_DEFAULT_PACK_MONTHLY_TIERS = [1000, 2500, 5000] as const;
/** Uzun süreye indirim (%), süre bazında: 1 ay yok, 3 ay %5, 6 ay %10, 12 ay %15. Admin paket fiyatını düzenleyerek değiştirir. */
export const EF_DEFAULT_PACK_DISCOUNT_PCT: Record<EfPackMonths, number> = { 1: 0, 3: 5, 6: 10, 12: 15 };

const trNum = (n: number) => n.toLocaleString("tr-TR");

/** Varsayılan paket kataloğu (2026-10-10 kararı): 3 aylık-analiz bakiyesi kademesi x 4 süre = 12 paket. SQL seed'i (20261008001000) birebir bunu yazar. */
export function buildDefaultEfPacks(): EfPack[] {
  const out: EfPack[] = [];
  EF_DEFAULT_PACK_MONTHLY_TIERS.forEach((monthly, ti) => {
    EF_PACK_MONTHS.forEach((months, mi) => {
      const units = monthly * months;
      const price = Math.round((units * (100 - EF_DEFAULT_PACK_DISCOUNT_PCT[months])) / 100);
      out.push({
        id: `ef-${monthly}-${months}a`,
        name: `${EF_PACK_MONTHS_LABEL[months]} · aylık ${trNum(monthly)} TL`,
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
 * Varsayılan analiz paketleri. Ayar (`ef.packs`) hiç yoksa/boşsa bunlar geçerlidir; admin /admin/analiz-tarifesi'dan düzenler
 * (kayıt varsa yalnız o geçerli).
 */
export const EF_DEFAULT_PACKS: readonly EfPack[] = buildDefaultEfPacks();

/** Paketin AYLIK ortalama analiz bakiyesi (toplam / süre; gösterim). */
export function efPackMonthlyUnits(pack: Pick<EfPack, "units" | "months">): number {
  return pack.months > 0 ? Math.round(pack.units / pack.months) : pack.units;
}

/**
 * Kullanıcıya görünen paket adı: units/months alanlarından üretilir (DB'deki ad alanına güvenilmez; eski seed adları tarihsel yazımlı olabilir).
 * Örn. "6 aylık · aylık 2.500 TL".
 */
export function efPackDisplayName(pack: Pick<EfPack, "units" | "months">): string {
  return `${EF_PACK_MONTHS_LABEL[pack.months]} · aylık ${trNum(efPackMonthlyUnits(pack))} TL`;
}

/** TL başına net birim fiyat (gösterim/doğrulama). */
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
      if (cur > prev) out.push(`"${same[i]!.name}" paketinin 1 TL bakiye başı fiyatı (${cur}) aynı süreli daha küçük paketten (${prev}) pahalı: büyük paket mantıksız.`);
    }
  }
  // Aynı aylık analiz bakiyeside uzun süre kısadan pahalı olmamalı.
  const byMonthly = new Map<number, EfPack[]>();
  for (const p of active) byMonthly.set(efPackMonthlyUnits(p), [...(byMonthly.get(efPackMonthlyUnits(p)) ?? []), p]);
  for (const group of byMonthly.values()) {
    const sorted = [...group].sort((a, b) => a.months - b.months);
    for (let i = 1; i < sorted.length; i++) {
      if (efPackUnitPriceTry(sorted[i]!) > efPackUnitPriceTry(sorted[i - 1]!)) {
        out.push(`"${sorted[i]!.name}" daha uzun süreli ama 1 TL bakiye başı fiyatı "${sorted[i - 1]!.name}" paketinden yüksek: uzun süre indirimli olmalı.`);
      }
    }
  }
  if (packs.length > 0 && active.length === 0) out.push("Aktif paket yok: ofisler analiz bakiyesi satın alamaz.");
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
  /** Sonraki yanma: süresi dolmamış en yakın partinin son kullanma anı (ISO) ve o anda yanacak analiz bakiyesi; yoksa null/0. */
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

/** "Yaklaşık N değerleme" paydası: en ucuz (0 olmayan) değerleme raporu bedeli (varsayılanda konut 700). 0 = hesaplanamaz. */
export function efEntryValuationUnits(tariff: { valuationArsa: number; valuationKonut: number; valuationTicari: number }): number {
  const costs = [tariff.valuationKonut, tariff.valuationArsa, tariff.valuationTicari].filter((n) => n > 0);
  return costs.length > 0 ? Math.min(...costs) : 0;
}
