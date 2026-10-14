/**
 * TABAN (sözleşmeli) paket kimlikleri: modül/sayfa kilidi kademeleri (page-gates PLAN_ORDER) ve SQL yedek fiyatları bunlara bağlıdır.
 * Adminden eklenen paketlerin kimliği serbesttir (`CatalogPlanId`); her biri `tier` ile bir taban kademeye bağlanır
 * (dahil modüller o kademeden gelir; modül-plan eşlemesinin tek kaynağı `PLAN_GATES`).
 */
export type PlanId = "advisor" | "office" | "professional" | "business" | "enterprise";

/** Katalogdaki her paketin kimliği: taban kimlikler + adminden eklenenler (`billing_plans` tablosu, slug). */
export type CatalogPlanId = string;

/** Kod varsayılanı KDV oranı (%20): ayar defterinde `billing.vat_rate` yokken/bozukken kullanılır. */
export const DEFAULT_BILLING_VAT_RATE = 0.2;

/**
 * İstemci ön izleme sabiti (varsayılan oran). Kesilen faturanın oranı ayar defterindeki geçerlilik tarihli
 * `billing.vat_rate` kaydından okunur: sunucuda `getBillingVatRate()` (src/lib/billing/vat-rate.ts) → `vatRateAt`.
 */
export const BILLING_VAT_RATE = DEFAULT_BILLING_VAT_RATE;

/** Geçerlilik tarihli KDV kaydı: `from` TR takvim günü (YYYY-AA-GG, o gün 00:00 TR'den itibaren), `rate` 0..<1. */
export type VatRateEntry = { from: string; rate: number };

/** Ayar defteri varsayılanı (tek kayıt: tarih öncesi her şey %20). */
export const DEFAULT_VAT_SCHEDULE = "2000-01-01=20";

const VAT_ENTRY_RE = /^(\d{4})-(\d{2})-(\d{2})\s*=\s*(\d{1,2}(?:[.,]\d{1,2})?)$/;

/**
 * "2000-01-01=20; 2027-01-01=18" biçimini çözer (satır sonu ya da ; ile ayrılır; oran YÜZDE). Geçersiz kayıt,
 * yinelenen tarih ya da boş liste = null (okuyucu varsayılana düşer, yazım reddedilir). Sonuç tarihe göre artan sıradadır.
 */
export function parseVatSchedule(raw: string | null | undefined): VatRateEntry[] | null {
  const parts = String(raw ?? "")
    .split(/[;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 24) return null;
  const out: VatRateEntry[] = [];
  for (const p of parts) {
    const m = VAT_ENTRY_RE.exec(p);
    if (!m) return null;
    const [, y, mo, d, pct] = m;
    const day = `${y}-${mo}-${d}`;
    const probe = new Date(`${day}T00:00:00Z`);
    if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== day) return null;
    const rate = Math.round(Number(pct.replace(",", ".")) * 100) / 10000;
    if (!Number.isFinite(rate) || rate < 0 || rate >= 1) return null;
    if (out.some((e) => e.from === day)) return null;
    out.push({ from: day, rate });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

/** Kayıtları ayar metnine çevirir (yüzde; artan tarih). */
export function formatVatSchedule(entries: readonly VatRateEntry[]): string {
  return [...entries]
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((e) => `${e.from}=${String(Math.round(e.rate * 10000) / 100).replace(".", ",")}`)
    .join("; ");
}

/**
 * Verilen TR gün anahtarında (YYYY-AA-GG) geçerli oran: başlangıcı bu güne eşit/önce olan EN SON kayıt.
 * Hiç kayıt geçerli değilse (tüm kayıtlar gelecekte) `fallback`. Eski fatura kendi satırındaki oranı taşır;
 * oran değişince yalnız YENİ kesilen faturalar etkilenir.
 */
export function vatRateAt(schedule: readonly VatRateEntry[] | null, trDay: string, fallback = DEFAULT_BILLING_VAT_RATE): number {
  let rate: number | null = null;
  for (const e of schedule ?? []) if (e.from <= trDay) rate = e.rate;
  return rate ?? fallback;
}

/** Yıllık ödemede ödenen ay sayısı varsayılanı ("10 öde 12 kullan"); plan başına panelden değişir. */
export const DEFAULT_YEARLY_PAID_MONTHS = 10;
export type BillingCycle = "monthly" | "yearly";

export type PlanLimits = {
  seats: number;
  customers: number | null;
  activeProperties: number | null;
  branches: number | null;
};

/** Ek kullanıcı kademesi; sıra "ek kullanıcı" sırasıdır (1 = ilk ek kullanıcı). toSeat null = sınırsız (son kademe). */
export type SeatTier = { fromSeat: number; toSeat: number | null; monthlyTry: number };

/** Ek kullanıcı birim fiyatı yuvarlama düzeni: x9 (…9 ile biter), x0 (onluk) ya da yok. */
export type SeatRounding = "none" | "x9" | "x0";

export type PlanDef = {
  id: CatalogPlanId;
  /**
   * Modül kademesi: paketin hangi taban kademenin sayfa/modül kilitlerini açtığı (page-gates). Taban paketlerde
   * yoktur (= kendi kimliği); adminden eklenen pakette zorunludur. Okuma her zaman `planTierOf` ile yapılır.
   */
  tier?: PlanId;
  /** true: adminden eklenmiş paket (kod varsayılanı yok; tanımın tamamı katalog kaydındadır). */
  custom?: boolean;
  /** true: arşivlenmiş (yalnız adminden eklenen paket): satışa kapalı, listelerde yok; mevcut aboneler aynen yenilenir. */
  archived?: boolean;
  name: string;
  monthlyTry: number;
  blurb: string;
  eyebrow: string;
  popular?: boolean;
  features: string[];
  limits: PlanLimits;
  /** Yıllık ödemede ödenen ay sayısı (varsayılan 10). Yıllık tutar = aylık x bu sayı. */
  yearlyPaidMonths?: number;
  /** Ek kullanıcı aylık fiyatı (KDV hariç); yoksa ek kullanıcı satılmaz. */
  extraSeatMonthlyTry?: number | null;
  /** Kademeli (marjinal) ek kullanıcı fiyatı; doluysa extraSeatMonthlyTry'yi ezer. Bkz. seat-pricing.ts. */
  extraSeatTiers?: SeatTier[] | null;
  /** Bu pakette satılabilecek en yüksek TOPLAM kullanıcı; aşımı için zorunlu yükseltme/Kurumsal. */
  maxSeats?: number | null;
  /** Ek kullanıcı birim fiyatı yuvarlama düzeni (doğrulayıcı kontrol eder). */
  seatRounding?: SeatRounding | null;
  /** Aylık AI kredi kotası (yalnız alan; ölçüm altyapısı ayrı paketle gelir). */
  aiCreditsMonthly?: number | null;
  /** Aylık profesyonel değerleme raporu kotası (yalnız alan). */
  valuationReportsMonthly?: number | null;
  /**
   * Aylık dahil EmlakFiyati analiz bakiyesi (null/0 = hak yok). Cron `ef-kontor-hak` her ay `plan_monthly` hibesi verir;
   * analiz tarifesi `src/lib/ef-credits/config.ts`te, "yaklaşık N değerleme" ondan hesaplanır.
   */
  efCreditsMonthly?: number | null;
  /** Satın alınan HER EK kullanıcı başına aylık ek EmlakFiyati analiz bakiyesi (ek kullanıcı sayısı x bu değer, plan hakkına eklenir). */
  efCreditsPerExtraSeat?: number | null;
  /** true: kayıt/fiyat sayfası ve yeni ödemede gizli; mevcut aboneler etkilenmez. */
  hidden?: boolean;
  /** Listeleme sırası (küçük önce). */
  order?: number;
  /** Kampanya (Founders) indirimli aylık fiyatı; kampanya aktif değilse yok sayılır. */
  campaignMonthlyTry?: number | null;
};

/**
 * Paket, fiyat, satış metni ve kullanım sınırları için kod tarafı varsayılanı (ham katalog).
 * Sahibin onayladığı katalog (2026-10-08, rakiplerin %25-30 altı; ek kullanıcı dahil tüm özellikler her pakette):
 * Danışman 749 (ek kullanıcı 559), Ofis 2.790 (5 dahil; ek kullanıcı kademeli 499/449/399),
 * Profesyonel 5.490 (15 dahil; ek 449/399), Business 8.990 (gizli), Kurumsal 14.900 (50 dahil; ek 289/249/199, 500'e kadar).
 * Aylık EmlakFiyati analiz bakiyesi (1 birim = 1 TL): 100 / 700 / 2.100 / 7.000; ek kullanıcı başı 50.
 * `RECOMMENDED_CATALOG_OVERRIDES` (plan-overrides.ts) ile AYNI değerleri taşır; ikisinin
 * uyumu plan-default-catalog.test.ts ile korunur. Fiyat değişikliği yalnız yeni satışları etkiler.
 * Yalnızca bugün çalışan özellikler burada listelenir; yol haritasındaki
 * API/softphone/white-label özellikleri ürün gerçekten hazır olmadan eklenmez.
 */
export const PLANS: readonly PlanDef[] = [
  {
    id: "advisor",
    name: "Danışman",
    monthlyTry: 749,
    blurb: "Bağımsız danışman",
    eyebrow: "BAŞLANGIÇ",
    features: [
      "1 kullanıcı dahil · en fazla 3 kullanıcı · 1 şube",
      "1.000 müşteri · 150 aktif portföy",
      "Talep ve portföy eşleştirme",
      "Randevu, görev ve gelen kutusu",
      "Komisyon takibi ve emsal bazlı değerleme",
    ],
    limits: { seats: 1, customers: 1_000, activeProperties: 150, branches: 1 },
    // Ek kullanıcı: 5 kullanıcıda 749 + 4 x 559 = 2.985 TL > Ofis 2.790 TL: Ofis 5. kullanıcıdan itibaren hem ucuz hem kapsamlı (4 kullanıcıda 2.426 TL, Danışman daha ucuz). 559 > Ofis kişi başı 558: doğrulayıcı teşvik uyarısı çıkmaz.
    extraSeatMonthlyTry: 559,
    maxSeats: 3,
    seatRounding: "x9",
    efCreditsMonthly: 100,
    efCreditsPerExtraSeat: 50,
  },
  {
    id: "office",
    name: "Ofis",
    monthlyTry: 2790,
    blurb: "Küçük ve orta ölçekli ofis",
    eyebrow: "EN ÇOK TERCİH",
    popular: true,
    features: [
      "5 kullanıcı dahil · en fazla 15 kullanıcı · 3 şube",
      "Sınırsız müşteri ve portföy",
      "Ekip yönetimi ve komisyon paylaşımı",
      "Teklif, sözleşme ve SMS onaylı dijital imza",
      "Mülk yönetimi, açık ev ve portal teyit",
      "Kampanya, gider ve raporlar",
    ],
    limits: { seats: 5, customers: null, activeProperties: null, branches: 3 },
    extraSeatMonthlyTry: 499,
    extraSeatTiers: [
      { fromSeat: 1, toSeat: 5, monthlyTry: 499 },
      { fromSeat: 6, toSeat: 15, monthlyTry: 449 },
      { fromSeat: 16, toSeat: null, monthlyTry: 399 },
    ],
    maxSeats: 15,
    seatRounding: "x9",
    efCreditsMonthly: 700,
    efCreditsPerExtraSeat: 50,
  },
  {
    id: "professional",
    name: "Profesyonel",
    monthlyTry: 5490,
    blurb: "Büyük ofis ve çok şube",
    eyebrow: "ÖLÇEKLENEN EKİP",
    features: [
      "15 kullanıcı dahil · en fazla 50 kullanıcı · 10 şube",
      "Kayıp-kaçak komisyon motoru",
      "Danışman KPI, lig ve hedefler",
      "Otomasyon, iş akışı ve onay akışları",
      "KVKK uyum ve ofisler arası ağ",
    ],
    limits: { seats: 15, customers: null, activeProperties: null, branches: 10 },
    extraSeatMonthlyTry: 449,
    extraSeatTiers: [
      { fromSeat: 1, toSeat: 10, monthlyTry: 449 },
      { fromSeat: 11, toSeat: null, monthlyTry: 399 },
    ],
    maxSeats: 50,
    seatRounding: "x9",
    efCreditsMonthly: 2100,
    efCreditsPerExtraSeat: 50,
  },
  {
    id: "enterprise",
    name: "Kurumsal",
    monthlyTry: 14900,
    blurb: "Franchise ve proje satış ekipleri",
    eyebrow: "KURUMSAL OPERASYON",
    features: [
      "50 kullanıcı dahil · en fazla 500 kullanıcı",
      "Sınırsız şube",
      "Proje satışı ve franchise BI",
      "Merkezi rol ve denetim yönetimi",
    ],
    limits: { seats: 50, customers: null, activeProperties: null, branches: null },
    // Hacim indirimi: Profesyonel'in son kademesi 399 TL; Kurumsal bunun altından başlar (289; dahil kişi başı 14.900/50 = 298 TL'nin de altı, hacim indirimi ilk ek kullanıcıdan itibaren işler) ve ölçekle düşer.
    extraSeatMonthlyTry: 289,
    extraSeatTiers: [
      { fromSeat: 1, toSeat: 50, monthlyTry: 289 },
      { fromSeat: 51, toSeat: 200, monthlyTry: 249 },
      { fromSeat: 201, toSeat: null, monthlyTry: 199 },
    ],
    maxSeats: 500,
    seatRounding: "x9",
    efCreditsMonthly: 7000,
    efCreditsPerExtraSeat: 50,
  },
] as const;

/**
 * PAKET KULLANICI TAVANI (ürün sahibi kararı, 2026-10-10): paket dahil kullanıcı + satın alınan ek kullanıcı
 * toplamı bu sayıyı aşamaz. Tek kaynak burasıdır; admin panelindeki kayıt (`maxSeats`) bunu YÜKSELTEMEZ
 * (applyPlanOverrides sınırlar). Daha fazlası için bir üst pakete geçilir.
 */
export const PLAN_USER_CAPS: Readonly<Record<PlanId, number>> = {
  advisor: 3,
  office: 15,
  professional: 50,
  business: 100,
  enterprise: 500,
};

/** Taban kimlikler (DB `billing_plans` seed'i ve page-gates kademeleri ile aynı küme). */
export const BASE_PLAN_IDS: readonly PlanId[] = ["advisor", "office", "professional", "business", "enterprise"];

const PLAN_IDS = new Set<string>(BASE_PLAN_IDS);

export function isPlanId(value: string): value is PlanId {
  return PLAN_IDS.has(value as PlanId);
}

export function normalizePlanId(value: string | null | undefined, fallback: PlanId = "office"): PlanId {
  return value && isPlanId(value) ? value : fallback;
}

export function normalizeBillingCycle(value: string | null | undefined): BillingCycle {
  return value === "yearly" ? "yearly" : "monthly";
}

/** Paketin modül kademesi (taban pakette kendi kimliği; eklenen pakette `tier`, yoksa Ofis). */
export function planTierOf(def: Pick<PlanDef, "id" | "tier">): PlanId {
  if (def.tier && isPlanId(def.tier)) return def.tier;
  return isPlanId(def.id) ? def.id : "office";
}

export function getPlan(id: string): PlanDef {
  return PLANS.find((plan) => plan.id === id) ?? PLANS[1]!;
}

/** Yıllık tutar = aylık x yıllık ödenen ay sayısı (varsayılan 10). */
export function planAmountTry(planId: string, cycle: BillingCycle): number {
  return planAmountOf(getPlan(planId), cycle);
}

/** Verilen tanım için dönem tutarı (panelden düzenlenmiş tanımlar dahil). */
export function planAmountOf(
  def: Pick<PlanDef, "monthlyTry" | "yearlyPaidMonths">,
  cycle: BillingCycle,
): number {
  const months = def.yearlyPaidMonths ?? DEFAULT_YEARLY_PAID_MONTHS;
  return cycle === "yearly" ? Math.round(def.monthlyTry * months) : def.monthlyTry;
}

/** Yıllık ödemede aylığa göre indirim yüzdesi (yuvarlanmış). */
export function yearlyDiscountPercentOf(def: Pick<PlanDef, "yearlyPaidMonths">): number {
  const months = def.yearlyPaidMonths ?? DEFAULT_YEARLY_PAID_MONTHS;
  return Math.max(0, Math.round((1 - months / 12) * 100));
}

/** "10 öde 12 kullan" biçiminde kısa etiket. */
export function yearlyOfferLabel(def: Pick<PlanDef, "yearlyPaidMonths">): string {
  const months = def.yearlyPaidMonths ?? DEFAULT_YEARLY_PAID_MONTHS;
  return `${months} öde 12 kullan`;
}

/** Kayıt/fiyat sayfası ve yeni ödemede gösterilecek (gizli ve arşivli olmayan) tanımlar, sıraya göre. */
export function visiblePlans<T extends Pick<PlanDef, "hidden" | "order" | "archived">>(defs: readonly T[]): T[] {
  return defs
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => !d.hidden && !d.archived)
    .sort((a, b) => (a.d.order ?? a.i) - (b.d.order ?? b.i))
    .map(({ d }) => d);
}

/**
 * Platform yönetiminde (Yeni ofis formu, Ofis 360 paket seçimi, ofis listesi satır içi seçim) ATANABİLİR paketler:
 * katalogdaki tüm paketler (adminden eklenenler dahil) — arşivli olanlar ve gizli Business şablonu hariç. Ofisin
 * kendi paketi (arşivli olsa da) her zaman listede kalır. Herkese açık satış listesi değildir (`visiblePlans`):
 * fiyat sayfasında gizlenen paket admin tarafından yine atanabilir.
 */
export function adminAssignablePlans<T extends Pick<PlanDef, "id" | "hidden" | "archived">>(
  defs: readonly T[],
  current?: string | null,
): T[] {
  return defs.filter((p) => p.id === current || (!p.archived && !(p.id === "business" && p.hidden)));
}

export function planLabel(id: string): string {
  return isPlanId(id) ? getPlan(id).name : id;
}

/**
 * Limit/ad okuması için paket tanımı: TABAN kimlikte kod tanımı (`getPlan`; davranış değişmez), adminden eklenen
 * pakette katalog kaydı (`getPlanDefinitions()` listesi). Katalog verilmemişse/kayıt yoksa eski davranışla Ofis.
 * `getPlan` eklenen paketi tanımaz (Ofis'e düşer); eklenen paketin kullanım kartı/limit satırları buradan okunmalı.
 */
export function resolvePlanDef(id: string | null | undefined, catalog?: readonly PlanDef[] | null): PlanDef {
  const key = id ?? "office";
  if (isPlanId(key)) return getPlan(key);
  return catalog?.find((p) => p.id === key) ?? getPlan(key);
}

/** Müşteriye görünen paket adı: taban kimlikte `planLabel`, eklenen pakette katalogdaki ad; bulunamazsa kimlik. */
export function planLabelIn(id: string, catalog?: readonly PlanDef[] | null): string {
  if (isPlanId(id)) return planLabel(id);
  return catalog?.find((p) => p.id === id)?.name ?? id;
}

export function planLimit(planId: string, key: keyof PlanLimits): number | null {
  return getPlan(planId).limits[key];
}

/**
 * "Business" paketi şablonu. PLANS (veritabanı sözleşmeli kimlikler) içinde DEĞİLDİR:
 * `plan` CHECK kısıtı ve plan_entitlements satırı forward-only migration
 * (20260817000210_plan_business_and_pricing_support.sql) uygulanana kadar satılamaz.
 * Yalnız okuyucu ve panel düzenleyicisi bunu "gizli" başlangıç tanımı olarak bilir.
 */
export const BUSINESS_PLAN_TEMPLATE: PlanDef = {
  id: "business",
  name: "Business",
  monthlyTry: 8990,
  blurb: "Çok şubeli büyük ofis",
  eyebrow: "BÜYÜME",
  features: ["40 kullanıcı dahil · en fazla 100 kullanıcı", "Profesyonel paketin tüm özellikleri"],
  limits: { seats: 40, customers: null, activeProperties: null, branches: 20 },
  maxSeats: 100,
  hidden: true,
  order: 35,
  efCreditsMonthly: 3500,
};
