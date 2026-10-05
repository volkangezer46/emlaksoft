import { yearlyOfferLabel, type BillingCycle, type PlanDef, type PlanId } from "@/lib/billing/plans";
import { defaultTeamSizeForPlan, type RegistrationTeamSize } from "@/lib/billing/registration-plan";
import {
  findCrossoverSeat,
  maxTotalSeats,
  quoteSeats,
  recommendPlanForSeats,
  resolveSeatTiers,
  type SeatBreakdownRow,
  type SeatQuote,
} from "@/lib/billing/seat-pricing";

/**
 * "Kaç kişilik ekibiniz var?" hesaplayıcısının SAF modeli (sunucu/istemci bağımsız, I/O yok).
 *
 * Fiyat mantığı burada ÇOĞALTILMAZ: tüm tutarlar `seat-pricing.ts` motorundan gelir (quoteSeats,
 * recommendPlanForSeats, findCrossoverSeat). Bu dosya yalnız (1) kampanya etkin fiyatını motora
 * "etkin taban" olarak besler, (2) sonucu arayüzün göstereceği biçime çevirir, (3) plan kartı için
 * kademe metnini üretir. Kodda sabit fiyat/eşik yoktur; her sayı `PlanDef` (admin kataloğu) ve
 * sunucudan gelen `offers` verisinden okunur. Tutarlar KDV hariç, TRY.
 */

/** Sunucudan gelen etkin teklif (`PublicOffer` ile aynı biçim; istemciye sunucu modülü girmesin diye yerel tür). */
export type SeatCalcOffer = { monthlyTry: number; listMonthlyTry: number; campaign: boolean };
export type SeatCalcOffers = Record<string, SeatCalcOffer | { monthlyTry: number }>;

const tl = (n: number) => `${Math.round(n).toLocaleString("tr-TR")} ₺`;

function sellablePlans(plans: readonly PlanDef[]): PlanDef[] {
  return plans.filter((p) => !p.hidden);
}

/** Etkin (kampanya dahil) taban fiyatlarla plan listesi; motor kampanyayı bilmez, etkin fiyat taban olarak verilir. */
export function applyOffers(plans: readonly PlanDef[], offers?: SeatCalcOffers): PlanDef[] {
  return plans.map((p) => {
    const eff = offers?.[p.id]?.monthlyTry;
    return eff && eff > 0 && eff !== p.monthlyTry ? { ...p, monthlyTry: eff } : p;
  });
}

// ---------------------------------------------------------------------------
// Sınırlar
// ---------------------------------------------------------------------------

export type SeatBounds = { min: number; sliderMax: number; inputMax: number };

/**
 * Kaydırıcı ve sayı girişi üst sınırı: herkese açık planlardan en çok kullanıcı taşıyanın kapasitesi
 * (ör. Kurumsal 500); bu sınırın üstü satılmaz, hesaplayıcı oraya sıkıştırır. Sınırsız kapasite varsa
 * en büyük dahil kullanıcının 2 katı (en az 50) kaydırıcıda, sayı girişinde 999.
 */
export function seatBounds(plans: readonly PlanDef[]): SeatBounds {
  const list = sellablePlans(plans);
  let finiteCap = 0;
  let unlimited = false;
  let maxIncluded = 1;
  for (const p of list) {
    maxIncluded = Math.max(maxIncluded, p.limits.seats);
    const cap = maxTotalSeats(p);
    if (Number.isFinite(cap)) finiteCap = Math.max(finiteCap, cap);
    else unlimited = true;
  }
  if (unlimited || finiteCap === 0) {
    const raw = Math.max(50, maxIncluded * 2);
    return { min: 1, sliderMax: Math.min(raw, 200), inputMax: 999 };
  }
  return { min: 1, sliderMax: finiteCap, inputMax: finiteCap };
}

export function clampSeats(value: number, bounds: SeatBounds): number {
  if (!Number.isFinite(value)) return bounds.min;
  return Math.min(bounds.inputMax, Math.max(bounds.min, Math.floor(value)));
}

// ---------------------------------------------------------------------------
// Hesaplayıcı sonucu
// ---------------------------------------------------------------------------

export type SeatCalcAlternative = {
  planId: string;
  name: string;
  totalMonthlyTry: number;
  totalForCycleTry: number;
  /** Önerilen pakete göre aylık fark (pozitif = daha pahalı). */
  diffMonthlyTry: number;
};

export type SeatCalcResult = {
  status: "ok" | "over_max";
  seats: number;
  cycle: BillingCycle;
  planId: PlanId;
  planName: string;
  /** Etkin (kampanya dahil) teklif; "over_max" durumunda tutar gösterilmez. */
  quote: SeatQuote;
  /** Aylık eşdeğer toplam (yıllıkta yıllık tutarın 12'ye bölünmüşü). */
  monthlyEquivalentTry: number;
  /** Dönem toplamı: aylıkta aylık, yıllıkta yıllık. */
  cycleTotalTry: number;
  /** Kullanıcı başı aylık etkin fiyat (yıllık ödemede yıllık/12 üzerinden). */
  perSeatMonthlyTry: number;
  campaign: boolean;
  /** Kampanya varsa aynı koltuk sayısında LİSTE fiyatlı aylık eşdeğer toplam. */
  listMonthlyEquivalentTry: number | null;
  /** Yıllık ödemede 12 aylık ödemeye göre tasarruf (aylık seçiliyse de bilgi için hesaplanır). */
  yearlySavingTry: number;
  /** "10 öde 12 kullan". */
  yearlyLabel: string;
  /** Taban + ek kullanıcı kırılımı. */
  breakdown: { base: { label: string; amountTry: number }; rows: SeatBreakdownRow[] };
  alternatives: SeatCalcAlternative[];
  /** "N ve üzeri kullanıcıda Profesyonel daha ucuz" / zorunlu geçiş açıklaması; yoksa null. */
  crossoverNote: string | null;
  /** status === "over_max": maksimum koltuk aşıldı. */
  limitNote: string | null;
};

function monthlyEquivalent(q: SeatQuote): number {
  return q.cycle === "yearly" ? Math.round(q.totalForCycleTry / 12) : q.totalMonthlyTry;
}

function crossoverNote(effective: readonly PlanDef[], planId: string, seats: number): string | null {
  const list = sellablePlans(effective);
  const idx = list.findIndex((p) => p.id === planId);
  const next = idx >= 0 ? list[idx + 1] : undefined;
  if (!next) return null;
  const cross = findCrossoverSeat(effective, planId, next.id);
  if (cross === null || cross <= seats) return null;
  const forced = quoteSeats(effective as PlanDef[], planId, cross, "monthly").maxSeatsExceeded;
  return forced
    ? `${cross} ve üzeri kullanıcıda ${next.name} paketine geçmeniz gerekir.`
    : `${cross} ve üzeri kullanıcıda ${next.name} paketi daha ucuz olur.`;
}

/**
 * `seats` kullanıcı için motorun önerisi + gösterim verisi. `plans`: sunucudan gelen herkese açık planlar;
 * `offers`: etkin (kampanya dahil) aylık fiyatlar. Hiç plan taşıyamazsa status "over_max" olur.
 */
export function computeSeatCalc(
  plans: readonly PlanDef[],
  offers: SeatCalcOffers | undefined,
  seatsRaw: number,
  cycle: BillingCycle,
): SeatCalcResult {
  const seats = Math.max(1, Math.floor(Number.isFinite(seatsRaw) ? seatsRaw : 1));
  const effective = applyOffers(plans, offers);
  const rec = recommendPlanForSeats(effective, seats, cycle);
  const q = rec.quote;
  const def = effective.find((p) => p.id === rec.planId);
  const listDef = plans.find((p) => p.id === rec.planId);
  const exceeded = q.maxSeatsExceeded;
  const campaign = Boolean(def && listDef && def.monthlyTry < listDef.monthlyTry) && !exceeded;
  const monthlyEq = monthlyEquivalent(q);

  let listMonthlyEq: number | null = null;
  if (campaign) {
    const listQuote = quoteSeats([...plans], rec.planId, seats, cycle);
    listMonthlyEq = monthlyEquivalent(listQuote);
  }

  const monthlyQuote = cycle === "monthly" ? q : quoteSeats(effective, rec.planId, seats, "monthly");
  const yearlyQuote = cycle === "yearly" ? q : quoteSeats(effective, rec.planId, seats, "yearly");
  const planName = def?.name ?? rec.planId;

  return {
    status: exceeded ? "over_max" : "ok",
    seats,
    cycle,
    planId: rec.planId as PlanId,
    planName,
    quote: q,
    monthlyEquivalentTry: monthlyEq,
    cycleTotalTry: q.totalForCycleTry,
    perSeatMonthlyTry: Math.round((monthlyEq / seats) * 100) / 100,
    campaign,
    listMonthlyEquivalentTry: listMonthlyEq,
    yearlySavingTry: Math.max(0, monthlyQuote.totalMonthlyTry * 12 - yearlyQuote.totalForCycleTry),
    yearlyLabel: def ? yearlyOfferLabel(def) : "",
    breakdown: {
      base: { label: `${planName} paketi · ${q.includedSeats} kullanıcı dahil`, amountTry: q.baseMonthlyTry },
      rows: q.breakdown,
    },
    alternatives: exceeded
      ? []
      : rec.alternatives.map((a) => ({
          planId: a.planId,
          name: effective.find((p) => p.id === a.planId)?.name ?? a.planId,
          totalMonthlyTry: monthlyEquivalent(a),
          totalForCycleTry: a.totalForCycleTry,
          diffMonthlyTry: monthlyEquivalent(a) - monthlyEq,
        })),
    crossoverNote: exceeded ? null : crossoverNote(effective, rec.planId, seats),
    limitNote: exceeded
      ? `Bir ofis hesabında en fazla ${formatSeatCap(plans)} kullanıcı tanımlanabilir; ${seats} kullanıcı bu sınırı aşıyor.`
      : null,
  };
}

function formatSeatCap(plans: readonly PlanDef[]): string {
  const cap = seatBounds(plans).inputMax;
  return cap.toLocaleString("tr-TR");
}

/** Sonucu ekran okuyucu için tek cümleye çevirir (aria-live bölgesi). */
export function seatCalcAnnouncement(r: SeatCalcResult): string {
  if (r.status === "over_max") return r.limitNote ?? "";
  const unit = r.cycle === "yearly" ? "yıl" : "ay";
  return `${r.seats} kullanıcı için ${r.planName} paketi önerilir. ${tl(r.cycleTotalTry)} / ${unit}, KDV hariç.`;
}

// ---------------------------------------------------------------------------
// Plan kartı: ek kullanıcı kademe metni
// ---------------------------------------------------------------------------

export type ExtraSeatSummary = {
  /** "15 kullanıcı dahil" */
  included: string;
  /** "ilk 5 ek kullanıcı 349 ₺", "sonraki 10 ek kullanıcı 299 ₺", "sonrası 249 ₺" */
  tiers: string[];
  /** "En fazla 40 kullanıcı" ya da null. */
  max: string | null;
};

/** Planın admin kademelerinden üretilen ek kullanıcı metni; ek kullanıcı satılmıyorsa null. */
export function extraSeatSummary(def: PlanDef): ExtraSeatSummary | null {
  const tiers = resolveSeatTiers(def);
  if (tiers.length === 0) return null;
  const lines = tiers.map((t, i) => {
    if (t.toSeat === null) {
      return tiers.length === 1 ? `her ek kullanıcı ${tl(t.monthlyTry)}` : `sonrası ${tl(t.monthlyTry)}`;
    }
    const count = t.toSeat - t.fromSeat + 1;
    return `${i === 0 ? "ilk" : "sonraki"} ${count} ek kullanıcı ${tl(t.monthlyTry)}`;
  });
  const cap = maxTotalSeats(def, tiers);
  return {
    included: `${def.limits.seats} kullanıcı dahil`,
    tiers: lines,
    max: Number.isFinite(cap) ? `En fazla ${cap} kullanıcı` : null,
  };
}

/** Plan kimliğine göre kademe metinleri (sunucu bileşeni üretir, istemci kartına props geçer). */
export function extraSeatTexts(plans: readonly PlanDef[]): Record<string, ExtraSeatSummary | null> {
  return Object.fromEntries(plans.map((p) => [p.id, extraSeatSummary(p)]));
}

// ---------------------------------------------------------------------------
// Kayıt: ekip büyüklüğü -> paket (tek kaynak: aynı öneri fonksiyonu)
// ---------------------------------------------------------------------------

export type RegistrationSelection = {
  planId: PlanId;
  /** Sunucu eylemi (`agents` alanı) için kova: önerilen planın minimum kovası, böylece sunucu planı yükseltmez/düşürmez. */
  teamSize: RegistrationTeamSize;
  calc: SeatCalcResult;
};

/**
 * Kayıtta seçilen kullanıcı sayısı için paket. Öneri `computeSeatCalc` ile aynıdır (sabit eşik yok).
 * `honorPlanId`: kullanıcı sayıyı henüz değiştirmediyse fiyat sayfasından gelen bilinçli plan seçimi korunur
 * (öneriden aynı ya da daha üst kademedeyse); aksi halde öneri kullanılır.
 */
export function registrationSelection(
  plans: readonly PlanDef[],
  offers: SeatCalcOffers | undefined,
  seats: number,
  cycle: BillingCycle,
  honorPlanId?: string | null,
): RegistrationSelection {
  const calc = computeSeatCalc(plans, offers, seats, cycle);
  let planId: PlanId = calc.planId;
  if (honorPlanId && honorPlanId !== planId) {
    const order: string[] = plans.map((p) => p.id);
    const honorIdx = order.indexOf(honorPlanId);
    const recIdx = order.indexOf(planId);
    if (honorIdx >= 0 && recIdx >= 0 && honorIdx > recIdx) planId = honorPlanId as PlanId;
  }
  return {
    planId,
    teamSize: defaultTeamSizeForPlan(planId),
    calc,
  };
}

/** Seçilen plan için etkin teklif (kayıt özeti): öneriyle aynıysa calc.quote, değilse o planın teklifi. */
export function registrationQuote(
  plans: readonly PlanDef[],
  offers: SeatCalcOffers | undefined,
  planId: string,
  seats: number,
  cycle: BillingCycle,
): SeatQuote | null {
  const effective = applyOffers(plans, offers);
  if (!effective.some((p) => p.id === planId)) return null;
  return quoteSeats(effective, planId, seats, cycle);
}
