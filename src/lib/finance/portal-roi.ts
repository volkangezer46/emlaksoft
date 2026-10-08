/**
 * Portal yatırım getirisi (SAF). Portal başına gider (dönem payına bölünmüş) ↔ o portaldan gelen talep, kazanılan anlaşma ve
 * komisyon. Sıfıra bölme yok (null döner); veri yetersizse karar/uyarı üretilmez.
 *
 * DÜRÜSTLÜK: "gösterim" portal bazında ölçülmez (portal gösterim sayısı sisteme gelmiyor) — burada gösterilmez.
 * Kaynak eşlemesi: `customers.lead_source = portal_<anahtar>`; gider eşlemesi: `expenses.portal_key`.
 */
import { addDaysKey, addMonthsKey, daysBetweenKeys, isRecurrence, RECURRENCE_MONTHS, type Recurrence } from "@/lib/finance/recurring-expenses";

export const PORTAL_KEYS = ["sahibinden", "hepsiemlak", "zingat", "emlakjet"] as const;
export type PortalKey = (typeof PORTAL_KEYS)[number];

export const PORTAL_LABEL: Record<PortalKey, string> = {
  sahibinden: "Sahibinden.com",
  hepsiemlak: "Hepsiemlak",
  zingat: "Zingat",
  emlakjet: "Emlak Jet",
};

/** Analiz penceresi (gün). */
export const ROI_WINDOW_DAYS = 90;
/** Maliyet geçmişi en az bu kadar gün olmadan karar verilmez. */
export const ROI_MIN_COST_HISTORY_DAYS = 45;
/** "Talep yok" uyarısı için asgari pencere maliyeti (TL). */
export const ROI_MIN_ALERT_COST = 1000;
/** Göreli verimsizlik: en iyi portalın talep başına maliyetinin en az bu katı. */
export const ROI_WORST_FACTOR = 2;
/** Göreli kıyas için portal başına asgari talep sayısı. */
export const ROI_MIN_LEADS_FOR_RATIO = 3;

export function isPortalKey(v: unknown): v is PortalKey {
  return typeof v === "string" && (PORTAL_KEYS as readonly string[]).includes(v);
}

export const leadSourceOf = (key: PortalKey): string => `portal_${key}`;

export function portalKeyFromLeadSource(source: string | null | undefined): PortalKey | null {
  const s = (source ?? "").trim().toLowerCase();
  if (!s.startsWith("portal_")) return null;
  const key = s.slice("portal_".length);
  return isPortalKey(key) ? key : null;
}

/** `portal_listings.portal_name` serbest metindir ("Sahibinden.com", "sahibinden"): içerme ile eşler. */
export function portalKeyFromName(name: string | null | undefined): PortalKey | null {
  const s = (name ?? "").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i");
  for (const key of PORTAL_KEYS) if (s.includes(key)) return key;
  if (s.includes("emlak jet")) return "emlakjet";
  return null;
}

export type PortalExpense = { portalKey: PortalKey; amount: number; date: string; recurrence: Recurrence | null };

/**
 * Bir giderin [windowStart, windowEnd] penceresine düşen payı. Tek seferlik: tarih pencerede ise tamamı.
 * Tekrarlayan (yıllık/3 aylık/aylık): [tarih, tarih+dönem) aralığının pencere ile kesişim günü / dönem günü × tutar.
 */
export function allocatedCost(e: PortalExpense, windowStart: string, windowEnd: string): number {
  if (!(e.amount > 0)) return 0;
  if (!e.recurrence || !isRecurrence(e.recurrence)) {
    return e.date >= windowStart && e.date <= windowEnd ? e.amount : 0;
  }
  const periodEnd = addMonthsKey(e.date, RECURRENCE_MONTHS[e.recurrence]);
  const periodDays = Math.max(1, daysBetweenKeys(e.date, periodEnd));
  const from = e.date > windowStart ? e.date : windowStart;
  // pencere sonu dahil: +1 gün; dönem sonu hariç.
  const windowEndExclusive = addDaysKey(windowEnd, 1);
  const to = periodEnd < windowEndExclusive ? periodEnd : windowEndExclusive;
  const overlap = daysBetweenKeys(from, to);
  if (overlap <= 0) return 0;
  return (e.amount * Math.min(overlap, periodDays)) / periodDays;
}

export type PortalRoiInput = {
  expenses: readonly PortalExpense[];
  /** Pencerede gelen talepler (müşteri sayısı) — portal başına. */
  leads: Readonly<Partial<Record<PortalKey, number>>>;
  /** Pencerede kazanılan anlaşma sayısı + komisyon tutarı (brüt) — portal başına. */
  won: Readonly<Partial<Record<PortalKey, { deals: number; commission: number }>>>;
  /** Şu an yayında olan ilan sayısı ve pencerede yayına girenler — portal başına. */
  liveListings: Readonly<Partial<Record<PortalKey, number>>>;
  listingsInWindow: Readonly<Partial<Record<PortalKey, number>>>;
  windowStart: string;
  windowEnd: string;
};

export type PortalRoiRow = {
  portalKey: PortalKey;
  label: string;
  cost: number;
  /** En eski portal gideri tarihi (null = hiç gider eşlenmemiş). */
  firstCostDate: string | null;
  /** Karar verecek kadar maliyet geçmişi var mı. */
  sufficient: boolean;
  leads: number;
  wonDeals: number;
  commission: number;
  liveListings: number;
  listingsInWindow: number;
  costPerLead: number | null;
  costPerDeal: number | null;
  /** Komisyon − maliyet; maliyet yoksa null. */
  netReturn: number | null;
};

const safeDiv = (a: number, b: number): number | null => (b > 0 && Number.isFinite(a / b) ? a / b : null);

export function computePortalRoi(input: PortalRoiInput): PortalRoiRow[] {
  const rows: PortalRoiRow[] = [];
  for (const key of PORTAL_KEYS) {
    const own = input.expenses.filter((e) => e.portalKey === key);
    if (own.length === 0 && !(input.leads[key] ?? 0) && !(input.won[key]?.deals ?? 0)) continue;
    const cost = own.reduce((s, e) => s + allocatedCost(e, input.windowStart, input.windowEnd), 0);
    const firstCostDate = own.length ? own.map((e) => e.date).sort()[0]! : null;
    const history = firstCostDate ? daysBetweenKeys(firstCostDate, input.windowEnd) : 0;
    // Tekrarlayan gider geçmişi ileriye de örter: yıllık tek ödeme dönemi pencereyi kapsıyorsa yeterli sayılır.
    const covered = own.some((e) => e.recurrence && allocatedCost(e, input.windowStart, input.windowEnd) > 0);
    const sufficient = cost > 0 && (history >= ROI_MIN_COST_HISTORY_DAYS || covered);
    const leads = Math.max(0, Math.trunc(input.leads[key] ?? 0));
    const wonDeals = Math.max(0, Math.trunc(input.won[key]?.deals ?? 0));
    const commission = Math.max(0, input.won[key]?.commission ?? 0);
    rows.push({
      portalKey: key,
      label: PORTAL_LABEL[key],
      cost: Math.round(cost),
      firstCostDate,
      sufficient,
      leads,
      wonDeals,
      commission: Math.round(commission),
      liveListings: Math.max(0, Math.trunc(input.liveListings[key] ?? 0)),
      listingsInWindow: Math.max(0, Math.trunc(input.listingsInWindow[key] ?? 0)),
      costPerLead: sufficient ? safeDiv(cost, leads) : null,
      costPerDeal: sufficient ? safeDiv(cost, wonDeals) : null,
      netReturn: sufficient ? Math.round(commission - cost) : null,
    });
  }
  return rows.sort((a, b) => b.cost - a.cost);
}

export type WorstPortal =
  | { kind: "no_leads"; portalKey: PortalKey; cost: number; liveListings: number }
  | { kind: "relative"; portalKey: PortalKey; costPerLead: number; benchmarkKey: PortalKey; benchmarkCostPerLead: number };

/** En verimsiz portal; yetersiz veri / kıyas yoksa null (kart üretilmez). */
export function pickLeastEfficientPortal(rows: readonly PortalRoiRow[]): WorstPortal | null {
  const ok = rows.filter((r) => r.sufficient);
  if (ok.length === 0) return null;

  // 1) İlan yayında, maliyet var, pencerede hiç talep yok.
  const noLeads = ok
    .filter((r) => r.leads === 0 && r.cost >= ROI_MIN_ALERT_COST && r.liveListings > 0)
    .sort((a, b) => b.cost - a.cost)[0];
  if (noLeads) return { kind: "no_leads", portalKey: noLeads.portalKey, cost: noLeads.cost, liveListings: noLeads.liveListings };

  // 2) Göreli: yeterli talebi olan en az iki portal içinde en pahalı talep, en ucuzun >= ROI_WORST_FACTOR katı.
  const priced = ok.filter((r) => r.leads >= ROI_MIN_LEADS_FOR_RATIO && r.costPerLead !== null);
  if (priced.length < 2) return null;
  const sorted = [...priced].sort((a, b) => (a.costPerLead as number) - (b.costPerLead as number));
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;
  if ((best.costPerLead as number) <= 0) return null;
  if ((worst.costPerLead as number) < (best.costPerLead as number) * ROI_WORST_FACTOR) return null;
  return {
    kind: "relative",
    portalKey: worst.portalKey,
    costPerLead: worst.costPerLead as number,
    benchmarkKey: best.portalKey,
    benchmarkCostPerLead: best.costPerLead as number,
  };
}

/**
 * Kullanılmayan abonelik: maliyeti var, pencerede hiç ilan yayınlanmamış, şu an yayında ilan yok ve talep gelmemiş.
 * Yalnız ölçülebilen (portal) abonelikler için; veri yetersizse boş.
 */
export function unusedPortalSubscriptions(rows: readonly PortalRoiRow[]): PortalRoiRow[] {
  return rows.filter((r) => r.sufficient && r.cost >= ROI_MIN_ALERT_COST && r.liveListings === 0 && r.listingsInWindow === 0 && r.leads === 0);
}
