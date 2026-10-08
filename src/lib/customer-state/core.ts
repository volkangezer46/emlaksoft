/**
 * Müşteri durumu okuyucusu — TEK KAPI. Müşteri listesi rozetleri, müşteri 360, Akıllı Listeler,
 * ana ekran "bugün ara", AI danışman ve içgörü kuralları aynı müşteri için AYNI sıcaklık/riski bu
 * fonksiyondan okur. Yeni skor icat etmez: iç parçalar mevcut modellerdir
 * (`heat.ts`, `lead.ts`, `churn.ts`, `seller.ts`; anlaşma puanı `deal.ts`), eşikler `thresholds.ts`.
 *
 * TEK KURAL (eskiden ekrana göre değişen noktalar):
 *  - Sıcaklık YALNIZ ısı skorundan gelir (`heat.ts`): sıcak >= 70, ılık >= 40, aşağısı soğuk (uykuda dâhil).
 *    Aday skoru (`lead.ts`) sıcaklık BELİRLEMEZ; "ne kadar değerli" ağırlığıdır (churn girdisi, sıralama).
 *  - Risk YALNIZ churn modelinden gelir (`churn.ts`); girdisi olan "temas" tek tanımdır:
 *    son temas = çağrı/randevu/iletişim kaydının en yenisi (ısı RPC'si; yoksa lead RPC'sinin aynı alanı).
 *  - Teklif/anlaşma niyeti ısı RPC'sinden okunur (açık teklif sayısı + süren anlaşma): lead ve ısı aynı girdiyi görür.
 *
 * SAF: "şimdi" dışarıdan gelir (`Date.now()` yok). Veri yoksa `risk: null` (uydurma risk yok).
 */
import { DAY_MS } from "@/lib/clock";
import { computeChurnRisk, type ChurnRisk } from "@/lib/customer-state/churn";
import { HEAT_SEGMENTS, scoreCustomerHeat, type CustomerHeat, type HeatSegment } from "@/lib/customer-state/heat";
import { computeLeadScore, type LeadScore } from "@/lib/customer-state/lead";
import { isOwnerCustomer, scoreSellerLikelihood, type SellerPrediction } from "@/lib/customer-state/seller";
import { CALL_ELEVATED_QUIET_DAYS, CALL_MIN_QUIET_DAYS } from "@/lib/customer-state/thresholds";

/** `customer_heat_signals` RPC satırı (müşteri başına). */
export type HeatRpcSignals = {
  last_contact: string | null;
  open_demands: number;
  urgent_demands: number;
  portal_likes_30d: number;
  open_offers: number;
  open_deals: number;
};

/** `customer_lead_signals` RPC satırı (müşteri başına). */
export type LeadRpcSignals = {
  active_demands: number;
  comms: number;
  appts: number;
  calls: number;
  last_activity: string | null;
};

export type CustomerStateInput = {
  customerId: string;
  createdAt: string;
  blacklist: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  source: string | null;
  types: readonly string[];
  leadSignals: LeadRpcSignals | null;
  heatSignals: HeatRpcSignals | null;
  /** Gelecekte bekleyen/onaylı randevu var mı. */
  hasUpcomingAppointment: boolean;
  /** Kazanılmış anlaşma sayısı (satıcı-tahmini girdisi); bilinmiyorsa 0. */
  wonDeals?: number;
  /** Açık satış/listeleme talebi var mı (satıcı-tahmini girdisi); bilinmiyorsa false. */
  hasListingIntentDemand?: boolean;
};

export type Temperature = "sicak" | "ilik" | "soguk";
export type RiskLevel = "yuksek" | "orta" | "dusuk";

export type CustomerStage = "kara_liste" | "anlasma" | "teklif" | "randevulu" | "talep" | "yeni" | "uykuda" | "kayit";

export const STAGE_LABELS: Record<CustomerStage, string> = {
  kara_liste: "Kara liste",
  anlasma: "Anlaşma sürecinde",
  teklif: "Teklif aşamasında",
  randevulu: "Randevulu",
  talep: "Aktif talep",
  yeni: "Yeni kayıt",
  uykuda: "Uykuda",
  kayit: "Kayıtlı müşteri",
};

export const TEMPERATURE_LABELS: Record<Temperature, string> = { sicak: "Sıcak", ilik: "Ilık", soguk: "Soğuk" };
export const RISK_LABELS: Record<RiskLevel, string> = { yuksek: "Yüksek risk", orta: "Orta risk", dusuk: "Düşük risk" };

export type StateReason = { label: string; evidence: string; href: string };

export type NextBestAction = { key: "kurtar" | "randevu" | "portfoy_iste" | "teyit" | "dokun" | "rutin"; text: string; href: string };

export type CustomerState = {
  customerId: string;
  temperature: Temperature;
  /** null = hesaplanamaz (kara liste ya da hiç sinyal verisi yok). */
  risk: RiskLevel | null;
  stage: CustomerStage;
  stageLabel: string;
  nextBestAction: NextBestAction | null;
  reasons: StateReason[];
  /** Son temastan (yoksa kayıttan) bu yana gün; tarih bozuksa null. */
  daysSinceContact: number | null;
  upcomingAppointment: boolean;
  openDemands: number;
  scores: {
    heat: CustomerHeat;
    lead: LeadScore;
    churn: ChurnRisk;
    /** Yalnız malik-tipi müşteride. */
    seller: SellerPrediction | null;
  };
};

export function temperatureOf(segment: HeatSegment): Temperature {
  return segment === "sicak" ? "sicak" : segment === "ilgili" ? "ilik" : "soguk";
}

function riskOf(tier: ChurnRisk["tier"]): RiskLevel | null {
  return tier === "high" ? "yuksek" : tier === "medium" ? "orta" : tier === "low" ? "dusuk" : null;
}

function daysBetween(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / DAY_MS));
}

/** Isı girdisi: tek tanım — hem tam okuyucu hem havuz sayımları (liste segmentleri) bunu kullanır. */
export function heatInputsOf(
  c: { createdAt: string; blacklist: boolean },
  heatSignals: HeatRpcSignals | null,
  leadSignals: LeadRpcSignals | null,
) {
  const s = heatSignals;
  return {
    lastContactAt: s ? s.last_contact : (leadSignals?.last_activity ?? null),
    openDemands: s ? s.open_demands : (leadSignals?.active_demands ?? 0),
    urgentDemands: s?.urgent_demands ?? 0,
    portalLikes30d: s?.portal_likes_30d ?? 0,
    hasOpenOfferOrDeal: s ? s.open_offers > 0 || s.open_deals > 0 : false,
    createdAt: c.createdAt,
    blacklist: c.blacklist,
  };
}

/** Yalnız ısı (liste havuzu sayımı): `buildCustomerState(...).scores.heat` ile BİREBİR aynı sonuç. */
export function computeCustomerHeat(
  c: { createdAt: string; blacklist: boolean },
  heatSignals: HeatRpcSignals | null,
  nowMs: number,
  opts: { dormantDays?: number } = {},
  leadSignals: LeadRpcSignals | null = null,
): CustomerHeat {
  return scoreCustomerHeat(heatInputsOf(c, heatSignals, leadSignals), nowMs, opts);
}

export function buildCustomerState(input: CustomerStateInput, nowMs: number, opts: { dormantDays?: number } = {}): CustomerState {
  const id = input.customerId;
  const hi = heatInputsOf(input, input.heatSignals, input.leadSignals);
  const heat = scoreCustomerHeat(hi, nowMs, opts);
  const temperature = temperatureOf(heat.segment);
  const hasAnySignal = input.heatSignals !== null || input.leadSignals !== null;

  const openOffers = input.heatSignals?.open_offers ?? 0;
  const openDeals = input.heatSignals?.open_deals ?? 0;
  const lead = computeLeadScore({
    hasPhone: input.hasPhone,
    hasEmail: input.hasEmail,
    source: input.source,
    activeDemands: hi.openDemands,
    communications: input.leadSignals?.comms ?? 0,
    appointments: input.leadSignals?.appts ?? 0,
    calls: input.leadSignals?.calls ?? 0,
    lastActivityAt: hi.lastContactAt,
    createdAt: input.createdAt,
    blacklist: input.blacklist,
    offers: openOffers,
    hasActiveDeal: openDeals > 0,
  });

  const contactDays = daysBetween(hi.lastContactAt, nowMs);
  const churn = computeChurnRisk({
    daysSinceContact: contactDays,
    engagementScore: lead.score,
    openDemands: hi.openDemands,
    hasUpcomingAppointment: input.hasUpcomingAppointment,
    blacklist: input.blacklist,
  });
  const risk = hasAnySignal ? riskOf(churn.tier) : null;

  const seller = isOwnerCustomer(input.types as string[])
    ? scoreSellerLikelihood({
        isOwnerType: true,
        daysSinceContact: contactDays,
        tenureDays: daysBetween(input.createdAt, nowMs) ?? 0,
        pastWonDeals: input.wonDeals ?? 0,
        hasListingIntentDemand: input.hasListingIntentDemand ?? false,
      })
    : null;

  let stage: CustomerStage;
  if (input.blacklist) stage = "kara_liste";
  else if (openDeals > 0) stage = "anlasma";
  else if (openOffers > 0) stage = "teklif";
  else if (input.hasUpcomingAppointment) stage = "randevulu";
  else if (hi.openDemands > 0) stage = "talep";
  else if (heat.segment === "uykuda") stage = "uykuda";
  else if (contactDays === null && (daysBetween(input.createdAt, nowMs) ?? 999) <= 14) stage = "yeni";
  else stage = "kayit";

  const me = `/app/musteriler/${id}`;
  const reasons: StateReason[] = [];
  if (!input.blacklist) {
    if (risk === "yuksek" || risk === "orta") {
      reasons.push({
        label: risk === "yuksek" ? "Yüksek kayıp riski" : "Orta kayıp riski",
        evidence: contactDays === null ? "Hiç temas kaydı yok" : `${contactDays} gündür temas yok · aday skoru ${lead.score}`,
        href: `/app/gelen-kutusu?customer=${id}`,
      });
    }
    const HEAT_HREF: Record<string, string> = {
      "Açık talep": `/app/talepler?customer=${id}`,
      "Acil talep": `/app/talepler?customer=${id}`,
      "Açık teklif/anlaşma": `/app/teklifler?musteri=${id}`,
      "Son temas": `/app/gelen-kutusu?customer=${id}`,
    };
    for (const f of [...heat.factors].filter((x) => x.points > 0).sort((a, b) => b.points - a.points)) {
      reasons.push({ label: f.label, evidence: `+${f.points} ısı puanı`, href: HEAT_HREF[f.label] ?? me });
    }
    if (input.hasUpcomingAppointment) reasons.push({ label: "Planlı randevu var", evidence: "Sonraki temas noktası belli", href: me });
    if (seller && seller.tier !== "low") reasons.push({ label: "Portföy verme olasılığı", evidence: seller.reasons[0] ?? seller.label, href: me });
  }

  let nextBestAction: NextBestAction | null = null;
  if (!input.blacklist && hasAnySignal) {
    if (risk === "yuksek") nextBestAction = { key: "kurtar", text: churn.action, href: me };
    else if (temperature === "sicak" && !input.hasUpcomingAppointment)
      nextBestAction = { key: "randevu", text: "Gösterim randevusu planla, momentumu kaybetme.", href: me };
    else if (seller && seller.tier !== "low")
      nextBestAction = { key: "portfoy_iste", text: seller.reasons[0] ?? "Portföy iste.", href: me };
    else if (input.hasUpcomingAppointment) nextBestAction = { key: "teyit", text: churn.action, href: me };
    else if (risk === "orta") nextBestAction = { key: "dokun", text: churn.action, href: me };
    else nextBestAction = { key: "rutin", text: churn.action, href: me };
  }

  return {
    customerId: id,
    temperature,
    risk,
    stage,
    stageLabel: STAGE_LABELS[stage],
    nextBestAction,
    reasons,
    daysSinceContact: contactDays,
    upcomingAppointment: input.hasUpcomingAppointment,
    openDemands: hi.openDemands,
    scores: { heat, lead, churn, seller },
  };
}

/** Rozet etiketi (liste/360 ortak): "Sıcak", "Ilık", "Soğuk" — uykuda ise ısı segmentinin etiketi korunur. */
export function temperatureBadgeLabel(state: CustomerState): string {
  const seg = HEAT_SEGMENTS[state.scores.heat.segment];
  return state.scores.heat.segment === "uykuda" && state.scores.heat.daysSinceContact !== null
    ? `${seg.label} · ${state.scores.heat.daysSinceContact} gün`
    : seg.label;
}

/**
 * "Bugün ara" içgörüsü uygunluğu: ofis tanımlı sessizlik eşiği + en az 1 açık talep (veri RPC'den gelir).
 * Döner: "orta" (30+ gün ya da 2+ talep) | "bilgi" | null (uygun değil).
 */
export function callPriorityLevel(
  f: { activeDemands: number; quietDays: number },
  minQuietDays: number = CALL_MIN_QUIET_DAYS,
): "orta" | "bilgi" | null {
  if (f.activeDemands < 1 || f.quietDays < minQuietDays) return null;
  return f.quietDays >= CALL_ELEVATED_QUIET_DAYS || f.activeDemands >= 2 ? "orta" : "bilgi";
}

