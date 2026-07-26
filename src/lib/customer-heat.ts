/**
 * Müşteri sıcaklık skoru (0..100) + segment — akıllı listeler için.
 *
 * `lead-score.ts`ten farkı: lead skoru "bu aday ne kadar değerli" sorusuna,
 * sıcaklık skoru "bu müşteri ŞU AN ne kadar canlı" sorusuna bakar. Girdiler
 * güncel etkileşim sinyalleridir (son temas, açık talep, portal beğenisi,
 * açık teklif/anlaşma); çıktı 4 segmentli akıllı liste filtresi besler.
 *
 * SAF FONKSİYON: `nowMs` parametre olarak alınır — bileşen gövdesinde
 * `Date.now()` yasağına takılmaz, testler deterministiktir.
 */

import { DAY_MS } from "@/lib/clock";

export type CustomerHeatInputs = {
  /** En yeni temas anı: çağrı / randevu / görüşme notu (ISO). Hiç yoksa null. */
  lastContactAt: string | null;
  /** Açık talep sayısı (status: new/active/matched). */
  openDemands: number;
  /** Açık taleplerden aciliyeti yüksek olanlar (urgency: high/urgent). */
  urgentDemands: number;
  /** Son 30 günde portaldan "Beğendim" sayısı. */
  portalLikes30d: number;
  /** Açık teklif (draft/submitted/countered) veya süren anlaşma (new/qualified/negotiation) var mı. */
  hasOpenOfferOrDeal: boolean;
  /** Müşteri kaydının oluşturulma tarihi (ISO). */
  createdAt: string;
  blacklist?: boolean;
};

export type HeatSegment = "sicak" | "ilgili" | "soguk" | "uykuda";

export type CustomerHeat = {
  score: number; // 0..100
  segment: HeatSegment;
  label: string; // "Sıcak" | "İlgili" | "Soğuk" | "Uykuda"
  /** Son temastan bu yana geçen gün; hiç temas yoksa kayıt yaşı. Tarih bozuksa null. */
  daysSinceContact: number | null;
  factors: { label: string; points: number }[];
};

/** Uykuda eşiği: skor < 15 VE en az bu kadar gündür temassız. */
export const DORMANT_DAYS = 90;

export const HEAT_SEGMENTS: Record<
  HeatSegment,
  { label: string; emoji: string; badgeCls: string }
> = {
  sicak:  { label: "Sıcak",  emoji: "🔥", badgeCls: "bg-gradient-to-r from-amber-400/20 to-rose-500/15 text-rose-600 ring-rose-500/30" },
  ilgili: { label: "İlgili", emoji: "✨", badgeCls: "bg-brand-600/10 text-brand-700 ring-brand-600/25" },
  soguk:  { label: "Soğuk",  emoji: "❄️", badgeCls: "bg-slate-400/12 text-slate-500 ring-slate-400/20" },
  uykuda: { label: "Uykuda", emoji: "💤", badgeCls: "bg-slate-300/20 text-slate-400 ring-slate-300/30 opacity-80" },
};

function daysBetween(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / DAY_MS));
}

/**
 * Skor bileşenleri (toplam teorik max 102 → 100'e kırpılır):
 *  - Son temas güncelliği ......... 0..35 (≤3g:35, ≤7g:28, ≤14g:21, ≤30g:13, ≤60g:6, ≤90g:2)
 *  - Açık talep ................... 0..20 (talep başına 10)
 *  - Acil talep ................... +8
 *  - Portal beğenisi (30 gün) ..... 0..15 (beğeni başına 8)
 *  - Açık teklif/anlaşma .......... +18
 *  - Yeni kayıt (≤14 gün) ......... +6
 */
export function scoreCustomerHeat(inputs: CustomerHeatInputs, nowMs: number): CustomerHeat {
  const ageDays = daysBetween(inputs.createdAt, nowMs);
  const contactDays = daysBetween(inputs.lastContactAt, nowMs);
  // Temas hiç yoksa "temassız süre" kayıt yaşıdır — uykuda kuralı buna bakar.
  const daysSinceContact = contactDays ?? ageDays;

  if (inputs.blacklist) {
    const segment: HeatSegment =
      daysSinceContact !== null && daysSinceContact >= DORMANT_DAYS ? "uykuda" : "soguk";
    return {
      score: 0,
      segment,
      label: HEAT_SEGMENTS[segment].label,
      daysSinceContact,
      factors: [{ label: "Kara liste", points: 0 }],
    };
  }

  const factors: { label: string; points: number }[] = [];
  let score = 0;

  // Son temas güncelliği
  let recency = 0;
  if (contactDays !== null) {
    if (contactDays <= 3) recency = 35;
    else if (contactDays <= 7) recency = 28;
    else if (contactDays <= 14) recency = 21;
    else if (contactDays <= 30) recency = 13;
    else if (contactDays <= 60) recency = 6;
    else if (contactDays <= 90) recency = 2;
  }
  score += recency;
  factors.push({ label: "Son temas", points: recency });

  // Açık talep = niyet
  const demandPts = Math.min(20, Math.max(0, inputs.openDemands) * 10);
  if (demandPts > 0) {
    score += demandPts;
    factors.push({ label: "Açık talep", points: demandPts });
  }
  if (inputs.urgentDemands > 0) {
    score += 8;
    factors.push({ label: "Acil talep", points: 8 });
  }

  // Portal beğenisi = taze, kendi eliyle verilmiş sinyal
  const likePts = Math.min(15, Math.max(0, inputs.portalLikes30d) * 8);
  if (likePts > 0) {
    score += likePts;
    factors.push({ label: "Portal beğenisi (30 gün)", points: likePts });
  }

  // Açık teklif / süren anlaşma = masada iş var
  if (inputs.hasOpenOfferOrDeal) {
    score += 18;
    factors.push({ label: "Açık teklif/anlaşma", points: 18 });
  }

  // Yeni kayıt tazeliği — henüz sinyal biriktirememiş müşteri hemen "soğuk" damgası yemesin
  if (ageDays !== null && ageDays <= 14) {
    score += 6;
    factors.push({ label: "Yeni kayıt", points: 6 });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let segment: HeatSegment;
  if (score >= 70) segment = "sicak";
  else if (score >= 40) segment = "ilgili";
  else if (score >= 15) segment = "soguk";
  else segment = daysSinceContact !== null && daysSinceContact >= DORMANT_DAYS ? "uykuda" : "soguk";

  return { score, segment, label: HEAT_SEGMENTS[segment].label, daysSinceContact, factors };
}

/** Satır rozetinin `title` metni — hangi bileşen kaç puan + uykudaysa temassız gün. */
export function heatTitle(heat: CustomerHeat): string {
  const parts = heat.factors.map((f) => `${f.label}: ${f.points > 0 ? "+" : ""}${f.points}`);
  const head = `Sıcaklık ${heat.score}/100 (${heat.label})`;
  const dormant =
    heat.segment === "uykuda" && heat.daysSinceContact !== null
      ? ` · ${heat.daysSinceContact} gündür temassız`
      : "";
  return `${head}${dormant} — ${parts.join(" · ")}`;
}
