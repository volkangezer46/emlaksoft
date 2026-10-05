import { DEFAULT_YEARLY_PAID_MONTHS, type PlanDef, type SeatRounding, type SeatTier } from "@/lib/billing/plans";
import { TR_OFFSET_MS, trParts } from "@/lib/clock";

/**
 * EK KULLANICI FİYATLAMA MOTORU (saf fonksiyonlar; sunucu/istemci bağımsız, I/O yok).
 *
 * Değer metriği = aktif kullanıcı (danışman). Plan = dahil kullanıcı + taban fiyat; ek kullanıcı
 * KADEMELİ ve MARJİNAL fiyatlanır (bir kademedeki koltuk o kademenin birim fiyatıyla), bu yüzden toplam
 * fiyat koltuk sayısıyla monoton artar, ani düşüş/uçurum olmaz. Kodda sabit fiyat yoktur: her sayı
 * `PlanDef`'ten (admin panelinden düzenlenen katalog) gelir.
 *
 * Kampanya / kilitli fiyat: motor kampanya mantığını bilmez; çağıran etkin taban fiyatı
 * `opts.lockedBaseMonthlyTry` (kampanya veya Founders kilidi) ve mevcut abonenin kayıtlı kademelerini
 * `opts.lockedTiers` olarak geçirir. Böylece quotePlan/Founders/kupon akışı bozulmaz.
 *
 * Tutarlar KDV hariç, TRY, tam sayıdır (yıllık = aylık x yıllık ödenen ay, yuvarlanır).
 */

export type { SeatTier, SeatRounding };

export type SeatBreakdownRow = { fromSeat: number; toSeat: number; count: number; unitTry: number; subtotalTry: number };

export type SeatQuote = {
  planId: string;
  totalSeats: number;
  includedSeats: number;
  extraSeats: number;
  cycle: "monthly" | "yearly";
  baseMonthlyTry: number;
  extraMonthlyTry: number;
  totalMonthlyTry: number;
  totalForCycleTry: number;
  perSeatEffectiveTry: number;
  breakdown: SeatBreakdownRow[];
  maxSeatsExceeded: boolean;
  recommendation: { planId: string; totalMonthlyTry: number; savingsMonthlyTry: number; reason: string } | null;
};

type Cycle = "monthly" | "yearly";

const SCAN_LIMIT = 1000;
const tl = (n: number) => `${Math.round(n).toLocaleString("tr-TR")} ₺`;

function planName(plans: readonly PlanDef[], id: string): string {
  return plans.find((p) => p.id === id)?.name ?? id;
}

function cleanSeats(n: number): number {
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
}

// ---------------------------------------------------------------------------
// Kademe çözümleme
// ---------------------------------------------------------------------------

/** Etkin kademeler: extraSeatTiers doluysa o, değilse tek kademeli extraSeatMonthlyTry, yoksa [] (ek kullanıcı satılmaz). */
export function resolveSeatTiers(def: PlanDef): SeatTier[] {
  if (def.extraSeatTiers && def.extraSeatTiers.length > 0) {
    return [...def.extraSeatTiers].sort((a, b) => a.fromSeat - b.fromSeat);
  }
  if (def.extraSeatMonthlyTry && def.extraSeatMonthlyTry > 0) {
    return [{ fromSeat: 1, toSeat: null, monthlyTry: def.extraSeatMonthlyTry }];
  }
  return [];
}

/** Bu pakette satılabilecek en yüksek TOPLAM kullanıcı sayısı (Infinity = sınırsız). */
export function maxTotalSeats(def: PlanDef, tiers: readonly SeatTier[] = resolveSeatTiers(def)): number {
  const included = def.limits.seats;
  if (tiers.length === 0) return included;
  let cap = def.maxSeats && def.maxSeats > 0 ? def.maxSeats : Number.POSITIVE_INFINITY;
  const last = tiers[tiers.length - 1]!;
  if (last.toSeat !== null) cap = Math.min(cap, included + last.toSeat);
  return Math.max(included, cap);
}

/** Yuvarlama düzenine göre en yakın birim fiyat. */
export function roundSeatPrice(value: number, mode: SeatRounding | null | undefined): number {
  const v = Math.max(1, value);
  if (mode === "x9") return Math.max(9, Math.round((v - 9) / 10) * 10 + 9);
  if (mode === "x0") return Math.max(10, Math.round(v / 10) * 10);
  return Math.max(1, Math.round(v));
}

// ---------------------------------------------------------------------------
// Fiyat hesabı
// ---------------------------------------------------------------------------

type QuoteOpts = { lockedBaseMonthlyTry?: number; lockedTiers?: SeatTier[] };

function computeQuote(def: PlanDef, totalSeatsRaw: number, cycle: Cycle, opts?: QuoteOpts): SeatQuote {
  const totalSeats = cleanSeats(totalSeatsRaw);
  const included = def.limits.seats;
  const extraSeats = Math.max(0, totalSeats - included);
  const tiers =
    opts?.lockedTiers && opts.lockedTiers.length > 0
      ? [...opts.lockedTiers].sort((a, b) => a.fromSeat - b.fromSeat)
      : resolveSeatTiers(def);
  const base = opts?.lockedBaseMonthlyTry && opts.lockedBaseMonthlyTry > 0 ? opts.lockedBaseMonthlyTry : def.monthlyTry;

  const breakdown: SeatBreakdownRow[] = [];
  let covered = 0;
  for (const tier of tiers) {
    if (covered >= extraSeats) break;
    const upper = tier.toSeat === null ? extraSeats : Math.min(tier.toSeat, extraSeats);
    const count = upper - Math.max(tier.fromSeat, covered + 1) + 1;
    if (count <= 0) continue;
    const from = Math.max(tier.fromSeat, covered + 1);
    breakdown.push({ fromSeat: from, toSeat: from + count - 1, count, unitTry: tier.monthlyTry, subtotalTry: count * tier.monthlyTry });
    covered += count;
  }
  // Kademelerin ötesi (kapalı son kademe): son birim fiyatla uzatılır; ama maxSeatsExceeded işaretlenir.
  if (covered < extraSeats && breakdown.length > 0) {
    const last = breakdown[breakdown.length - 1]!;
    const rest = extraSeats - covered;
    last.count += rest;
    last.toSeat += rest;
    last.subtotalTry = last.count * last.unitTry;
    covered = extraSeats;
  }

  const extraMonthly = breakdown.reduce((sum, r) => sum + r.subtotalTry, 0);
  const totalMonthly = Math.round(base + extraMonthly);
  const months = def.yearlyPaidMonths ?? DEFAULT_YEARLY_PAID_MONTHS;
  const maxSeatsExceeded = totalSeats > maxTotalSeats(def, tiers);
  return {
    planId: def.id,
    totalSeats,
    includedSeats: included,
    extraSeats,
    cycle,
    baseMonthlyTry: base,
    extraMonthlyTry: extraMonthly,
    totalMonthlyTry: totalMonthly,
    totalForCycleTry: cycle === "yearly" ? Math.round(totalMonthly * months) : totalMonthly,
    perSeatEffectiveTry: Math.round((totalMonthly / totalSeats) * 100) / 100,
    breakdown,
    maxSeatsExceeded,
    recommendation: null,
  };
}

function sellable(plans: readonly PlanDef[]): PlanDef[] {
  return plans.filter((p) => !p.hidden && !p.customPricing);
}

/**
 * `totalSeats` kullanıcı için planın fiyat teklifi. `recommendation`: bu plandan YUKARI (taban fiyatı büyük)
 * bir plan o koltuk sayısında daha ucuzsa (çapraz nokta geçildi) ya da bu plan o kadar kullanıcıyı
 * taşıyamıyorsa (zorunlu yükseltme) dolar; yoksa null. Alt plana düşürme ÖNERİLMEZ (özellik kaybı olur).
 */
export function quoteSeats(
  plans: PlanDef[],
  planId: string,
  totalSeats: number,
  cycle: "monthly" | "yearly",
  opts?: { lockedBaseMonthlyTry?: number; lockedTiers?: SeatTier[] },
): SeatQuote {
  const def = plans.find((p) => p.id === planId);
  if (!def) throw new Error(`Bilinmeyen paket: ${planId}`);
  const quote = computeQuote(def, totalSeats, cycle, opts);

  const uppers = sellable(plans).filter((p) => p.id !== planId && p.monthlyTry > def.monthlyTry);
  const fits = uppers
    .map((p) => computeQuote(p, totalSeats, cycle))
    .filter((q) => !q.maxSeatsExceeded)
    .sort((a, b) => a.totalMonthlyTry - b.totalMonthlyTry || a.baseMonthlyTry - b.baseMonthlyTry);
  const best = fits[0];
  if (!best) return quote;

  const savings = quote.totalMonthlyTry - best.totalMonthlyTry;
  const bestName = planName(plans, best.planId);
  if (quote.maxSeatsExceeded) {
    const cap = maxTotalSeats(def, opts?.lockedTiers && opts.lockedTiers.length > 0 ? opts.lockedTiers : resolveSeatTiers(def));
    quote.recommendation = {
      planId: best.planId,
      totalMonthlyTry: best.totalMonthlyTry,
      savingsMonthlyTry: 0,
      reason: `${def.name} paketinde en fazla ${Number.isFinite(cap) ? cap : "?"} kullanıcı olur; ${quote.totalSeats} kullanıcı için ${bestName} paketine geçmeniz gerekir (aylık ${tl(best.totalMonthlyTry)}).`,
    };
  } else if (savings > 0) {
    quote.recommendation = {
      planId: best.planId,
      totalMonthlyTry: best.totalMonthlyTry,
      savingsMonthlyTry: savings,
      reason: `${quote.totalSeats} kullanıcı için ${bestName} paketi aylık ${tl(best.totalMonthlyTry)}; ${def.name} paketinde ${tl(quote.totalMonthlyTry)} öderdiniz (aylık ${tl(savings)} tasarruf).`,
    };
  }
  return quote;
}

/**
 * `totalSeats` kullanıcı için EN UCUZ uygun plan (herkese açık, özel fiyatsız) + alternatifler (artan fiyat).
 * Hiç plan taşıyamıyorsa özel fiyatlı (Kurumsal) paket döner ve quote.maxSeatsExceeded = true olur ("bize ulaşın").
 */
export function recommendPlanForSeats(
  plans: PlanDef[],
  totalSeats: number,
  cycle: "monthly" | "yearly",
): { planId: string; quote: SeatQuote; alternatives: SeatQuote[] } {
  const quotes = sellable(plans).map((p) => computeQuote(p, totalSeats, cycle));
  const fits = quotes
    .filter((q) => !q.maxSeatsExceeded)
    .sort((a, b) => a.totalMonthlyTry - b.totalMonthlyTry || a.baseMonthlyTry - b.baseMonthlyTry);
  if (fits.length > 0) {
    const [best, ...alternatives] = fits as [SeatQuote, ...SeatQuote[]];
    return { planId: best.planId, quote: best, alternatives };
  }
  const custom = plans.find((p) => p.customPricing) ?? [...plans].sort((a, b) => b.limits.seats - a.limits.seats)[0];
  if (!custom) throw new Error("Paket listesi boş.");
  const q = computeQuote(custom, totalSeats, cycle);
  if (custom.customPricing) q.maxSeatsExceeded = true;
  q.recommendation = null;
  return { planId: custom.id, quote: q, alternatives: [] };
}

// ---------------------------------------------------------------------------
// Çapraz nokta (kanibalizasyon koruması)
// ---------------------------------------------------------------------------

export type SeatCrossover = {
  fromPlanId: string;
  toPlanId: string;
  /** Üst planın alt plandan ucuz (ya da alt planın taşıyamadığı) olduğu İLK toplam kullanıcı sayısı; yoksa null. */
  seat: number | null;
};

/** `fromId` planından `toId` planına geçişin mantıklı olduğu ilk koltuk sayısı (aylık fiyat karşılaştırması). */
export function findCrossoverSeat(plans: readonly PlanDef[], fromId: string, toId: string): number | null {
  const lo = plans.find((p) => p.id === fromId);
  const hi = plans.find((p) => p.id === toId);
  if (!lo || !hi) return null;
  const hiCap = maxTotalSeats(hi);
  const start = Math.max(1, lo.limits.seats);
  const end = Math.min(SCAN_LIMIT, Number.isFinite(hiCap) ? hiCap : SCAN_LIMIT);
  for (let s = start; s <= end; s++) {
    const a = computeQuote(lo, s, "monthly");
    const b = computeQuote(hi, s, "monthly");
    if (a.maxSeatsExceeded || b.totalMonthlyTry < a.totalMonthlyTry) return s;
  }
  return null;
}

/** Ardışık (katalog sırasıyla) herkese açık planlar arasındaki çapraz noktalar. */
export function findSeatCrossovers(plans: readonly PlanDef[]): SeatCrossover[] {
  const list = sellable(plans);
  const out: SeatCrossover[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    out.push({ fromPlanId: list[i]!.id, toPlanId: list[i + 1]!.id, seat: findCrossoverSeat(plans, list[i]!.id, list[i + 1]!.id) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Oransal (proration) hesap
// ---------------------------------------------------------------------------

/** İçinde bulunulan TR takvim ayının [başlangıç, bitiş) epoch ms değeri (ay sınırları Türkiye saatiyle). */
export function trBillingMonthPeriod(nowMs: number): { startMs: number; endMs: number } {
  const p = trParts(nowMs);
  return {
    startMs: Date.UTC(p.year, p.month, 1) - TR_OFFSET_MS,
    endMs: Date.UTC(p.year, p.month + 1, 1) - TR_OFFSET_MS,
  };
}

/**
 * Dönem ortasında koltuk/plan değişimi.
 *  - Artış (dönem tutarı yükselir): kalan süre oranında fark ANINDA faturalanır; dönem sonu değişmez.
 *  - Azalış: dönem sonunda geçerli olur; iade ve kredi YOK (anlık tutar 0).
 *  - Dönem bitmiş/başlamamış ise oran 0..1 aralığına sıkıştırılır.
 * Karşılaştırma dönem tutarı (totalForCycleTry) üzerindendir; ek kullanıcı da aynı oranı kullanır.
 */
export function prorateSeatChange(args: {
  fromQuote: SeatQuote;
  toQuote: SeatQuote;
  periodStartMs: number;
  periodEndMs: number;
  nowMs: number;
}): { immediateChargeTry: number; effectiveAtPeriodEnd: boolean; note: string } {
  const { fromQuote, toQuote, periodStartMs, periodEndMs, nowMs } = args;
  const total = periodEndMs - periodStartMs;
  const ratio = total > 0 ? Math.min(1, Math.max(0, (periodEndMs - nowMs) / total)) : 0;
  const delta = toQuote.totalForCycleTry - fromQuote.totalForCycleTry;
  if (delta > 0) {
    const charge = Math.round(delta * ratio * 100) / 100;
    const pct = Math.round(ratio * 100);
    return {
      immediateChargeTry: charge,
      effectiveAtPeriodEnd: false,
      note:
        charge > 0
          ? `Değişiklik hemen geçerli olur. Dönemin kalan %${pct}'lik bölümü için fark (${tl(delta)} x %${pct}) şimdi faturalanır; sonraki yenilemede yeni tutar alınır.`
          : "Dönem bitmek üzere olduğundan şimdi ek tutar çıkmaz; sonraki yenilemede yeni tutar alınır.",
    };
  }
  if (delta < 0) {
    return {
      immediateChargeTry: 0,
      effectiveAtPeriodEnd: true,
      note: "Azaltma dönem sonunda geçerli olur. İade ve kredi yoktur; mevcut dönemin sonuna kadar şu anki kullanıcı sayınızı kullanmaya devam edersiniz.",
    };
  }
  return { immediateChargeTry: 0, effectiveAtPeriodEnd: false, note: "Tutar değişmiyor." };
}

// ---------------------------------------------------------------------------
// Doğrulama
// ---------------------------------------------------------------------------

/** Tek planın ek kullanıcı ayarlarını doğrular; boş dizi = geçerli. */
export function validateSeatTiers(def: PlanDef): string[] {
  const errors: string[] = [];
  const tiers = def.extraSeatTiers && def.extraSeatTiers.length > 0 ? def.extraSeatTiers : null;
  const included = def.limits.seats;

  if (def.maxSeats !== null && def.maxSeats !== undefined) {
    if (!Number.isInteger(def.maxSeats) || def.maxSeats < included) {
      errors.push(`Azami kullanıcı (${def.maxSeats}) dahil kullanıcıdan (${included}) küçük olamaz.`);
    }
  }
  if (!tiers) return errors;

  const rounding = def.seatRounding ?? "none";
  tiers.forEach((t, i) => {
    const n = i + 1;
    if (!Number.isInteger(t.fromSeat) || t.fromSeat < 1) errors.push(`Kademe ${n}: başlangıç 1 veya daha büyük tam sayı olmalı.`);
    if (!Number.isInteger(t.monthlyTry) || t.monthlyTry <= 0) errors.push(`Kademe ${n}: aylık fiyat pozitif tam sayı olmalı.`);
    if (t.toSeat !== null && (!Number.isInteger(t.toSeat) || t.toSeat < t.fromSeat)) {
      errors.push(`Kademe ${n}: bitiş (${t.toSeat}) başlangıçtan (${t.fromSeat}) küçük olamaz.`);
    }
    if (rounding === "x9" && Number.isInteger(t.monthlyTry) && t.monthlyTry % 10 !== 9) {
      errors.push(`Kademe ${n}: ${t.monthlyTry} ₺ yuvarlama düzenine (x9) uymuyor; ör. ${roundSeatPrice(t.monthlyTry, "x9")} ₺.`);
    }
    if (rounding === "x0" && Number.isInteger(t.monthlyTry) && t.monthlyTry % 10 !== 0) {
      errors.push(`Kademe ${n}: ${t.monthlyTry} ₺ yuvarlama düzenine (onluk) uymuyor; ör. ${roundSeatPrice(t.monthlyTry, "x0")} ₺.`);
    }
  });
  if (errors.length > 0) return errors;

  const sorted = [...tiers].sort((a, b) => a.fromSeat - b.fromSeat);
  if (sorted[0]!.fromSeat !== 1) errors.push("İlk kademe 1. ek kullanıcıdan başlamalı.");
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const next = sorted[i + 1];
    if (cur.toSeat === null && next) errors.push(`Kademe ${i + 1}: sınırsız (bitişi boş) kademe en sonda olmalı.`);
    if (next && cur.toSeat !== null) {
      if (next.fromSeat <= cur.toSeat) errors.push(`Kademe ${i + 1} ve ${i + 2} çakışıyor (${cur.toSeat}. ve ${next.fromSeat}. koltuk).`);
      else if (next.fromSeat > cur.toSeat + 1) errors.push(`Kademe ${i + 1} ile ${i + 2} arasında boşluk var (${cur.toSeat + 1}-${next.fromSeat - 1}. ek kullanıcı fiyatsız).`);
    }
    if (next && next.monthlyTry > cur.monthlyTry) {
      errors.push(`Kademe ${i + 2}: birim fiyat (${next.monthlyTry} ₺) bir önceki kademeden (${cur.monthlyTry} ₺) yüksek olamaz (hacim indirimi).`);
    }
  }
  const last = sorted[sorted.length - 1]!;
  if (last.toSeat !== null) {
    if (def.maxSeats === null || def.maxSeats === undefined) {
      // Son kademe kapalı: azami kullanıcı örtük olarak dahil + son sınır; sorun değil.
    } else if (def.maxSeats > included + last.toSeat) {
      errors.push(`Azami kullanıcı (${def.maxSeats}) son kademenin ötesine (${included + last.toSeat}) geçiyor; son kademeyi sınırsız yapın veya azami kullanıcıyı düşürün.`);
    }
  }
  return errors;
}

export type SeatCatalogReport = { errors: string[]; warnings: string[] };

/**
 * Katalog düzeyi doğrulama: her planın kademeleri + planlar arası kanibalizasyon kuralları.
 * Hatalar kaydı engellemelidir; uyarılar bilgi amaçlıdır (özellik farkı bilinçli tercih olabilir).
 */
export function validateSeatCatalog(plans: readonly PlanDef[]): SeatCatalogReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const p of plans) for (const e of validateSeatTiers(p)) errors.push(`${p.name}: ${e}`);

  const list = sellable(plans);
  for (let i = 0; i + 1 < list.length; i++) {
    const lo = list[i]!;
    const hi = list[i + 1]!;
    if (hi.monthlyTry < lo.monthlyTry) {
      errors.push(`${hi.name} taban fiyatı (${tl(hi.monthlyTry)}) bir alt paket ${lo.name}'dan (${tl(lo.monthlyTry)}) düşük olamaz.`);
    }
    if (hi.limits.seats < lo.limits.seats) {
      errors.push(`${hi.name} dahil kullanıcısı (${hi.limits.seats}) ${lo.name}'dan (${lo.limits.seats}) az olamaz.`);
    }
    const cross = findCrossoverSeat(plans, lo.id, hi.id);
    if (cross === null) {
      warnings.push(`${lo.name} paketinde ek kullanıcı eklemek hiçbir noktada ${hi.name} paketine geçmekten pahalı olmuyor; yükseltme önerisi hiç tetiklenmez (kanibalizasyon).`);
    } else {
      const loCap = maxTotalSeats(lo);
      const hiCap = maxTotalSeats(hi);
      const end = Math.min(SCAN_LIMIT, loCap, hiCap);
      for (let s = cross; s <= end; s++) {
        if (computeQuote(hi, s, "monthly").totalMonthlyTry > computeQuote(lo, s, "monthly").totalMonthlyTry) {
          warnings.push(`${hi.name} paketi ${s} kullanıcıda yeniden ${lo.name}'dan pahalı oluyor; üst paket her koltuk sayısında alt paketten pahalı olmamalı.`);
          break;
        }
      }
    }
    const loUnit = resolveSeatTiers(lo)[0]?.monthlyTry;
    const hiPerSeat = hi.limits.seats > 0 ? hi.monthlyTry / hi.limits.seats : null;
    if (loUnit !== undefined && hiPerSeat !== null && loUnit < hiPerSeat) {
      warnings.push(`${lo.name} ek kullanıcı fiyatı (${tl(loUnit)}) ${hi.name} paketinin kişi başı fiyatından (${tl(hiPerSeat)}) düşük; yükseltmek için ekonomik teşvik zayıf.`);
    }
  }
  return { errors, warnings };
}

/**
 * Önerilen kademe şeması: ilk kademe birim fiyatı (mevcut ilk kademe, tek fiyat ya da dahil koltuk başı
 * fiyatın %80'i) ve %12,5 / %25 hacim indirimiyle iki kademe daha; yuvarlama planın düzenine (varsayılan x9).
 * Yalnız deterministik bir başlangıç noktasıdır; admin sonuçları doğrulayıcıdan görür ve düzenler.
 */
export function suggestSeatTiers(def: PlanDef): SeatTier[] {
  const included = Math.max(1, def.limits.seats);
  const rounding: SeatRounding = def.seatRounding && def.seatRounding !== "none" ? def.seatRounding : "x9";
  const existing = resolveSeatTiers(def)[0]?.monthlyTry;
  const unit1 = existing ?? roundSeatPrice((def.monthlyTry / included) * 0.8, rounding);
  const first = Math.max(3, Math.min(included, 10));
  const second = first + Math.max(5, Math.min(included, 10));
  return [
    { fromSeat: 1, toSeat: first, monthlyTry: roundSeatPrice(unit1, rounding) },
    { fromSeat: first + 1, toSeat: second, monthlyTry: roundSeatPrice(unit1 * 0.875, rounding) },
    { fromSeat: second + 1, toSeat: null, monthlyTry: roundSeatPrice(unit1 * 0.75, rounding) },
  ];
}

// ---------------------------------------------------------------------------
// Doluluk
// ---------------------------------------------------------------------------

/**
 * Koltuk doluluğu = kullanılan / (dahil + ek). `warnRatio` admin ayarıdır (varsayılan 0,8).
 * Kapasite 0 ve kullanım > 0 ise dolu sayılır.
 */
export function seatUtilization(
  used: number,
  included: number,
  extra: number,
  warnRatio = 0.8,
): { ratio: number; level: "ok" | "warn80" | "full" } {
  const capacity = Math.max(0, included) + Math.max(0, extra);
  const u = Math.max(0, used);
  const ratio = capacity > 0 ? u / capacity : u > 0 ? 1 : 0;
  const level = ratio >= 1 ? "full" : ratio >= warnRatio ? "warn80" : "ok";
  return { ratio, level };
}
