/**
 * KANAL ROI (SAF, yan etkisiz; sayfa + test ortak). Pazarlama harcaması → kayıt → ödeyen → gelir hunisi kanal bazında.
 *
 * Tanımlar (ekranda da yazılır):
 *  - Dönem: son N takvim ayı (bu ay dahil, İstanbul saati). Harcama ve kayıt AYNI aylardan sayılır (kohort).
 *  - Kanal: kaydın atıf kanalı (`signup_attributions.channel`, ziyaret sayacıyla aynı kural: measure/channel.ts).
 *    Atıf satırı olmayan ofis "Atıfsız kayıt" (`bilinmiyor`) satırına düşer; harcaması olamaz.
 *  - Harcama: adminden girilen aylık tutar (`marketing_spend`) + Google Ads maliyeti (`ads_daily_metrics`, Ücretli arama).
 *  - Ödeyen: dönemde kayıt olan ve EN AZ BİR ödenmiş faturası olan ofis (ödeme tarihi dönemden sonra da olabilir).
 *  - Gelir: o ofislerin ödenmiş faturalarının KDV hariç tutarı − alacak dekontlarının KDV hariç tutarı (bugüne kadar).
 *  - CAC: harcama ÷ ödeyen. Kayıt başı maliyet: harcama ÷ kayıt.
 *  - Geri ödeme süresi (ay): CAC ÷ ödeyen başına gerçekleşen aylık gelir (ofisin geliri ÷ ilk ödemesinden bu yana geçen ay,
 *    en az 1). Tahmin değil, bugüne kadar gerçekleşen ortalamadır; ödeyen ya da harcama yoksa hesaplanmaz.
 */
import { CHANNEL_LABEL, CHANNELS, isChannel, type Channel } from "@/lib/measure/channel";

export type RoiChannel = Channel | "bilinmiyor";

export const ROI_PERIODS = [3, 6, 12] as const;
export type RoiPeriod = (typeof ROI_PERIODS)[number];
export const DEFAULT_ROI_PERIOD: RoiPeriod = 6;

export function parseRoiPeriod(raw: string | undefined): RoiPeriod {
  const n = Number(raw);
  return (ROI_PERIODS as readonly number[]).includes(n) ? (n as RoiPeriod) : DEFAULT_ROI_PERIOD;
}

/** Harcama girilebilen kanallar (kayıt kanalıyla aynı anahtarlar; "Belirsiz" ve doğrudan için harcama anlamsız). */
export const SPEND_CHANNELS: readonly Channel[] = CHANNELS.filter((c) => c !== "unknown" && c !== "direct");

export function isSpendChannel(v: unknown): v is Channel {
  return isChannel(v) && SPEND_CHANNELS.includes(v);
}

export function roiChannelLabel(c: RoiChannel): string {
  return CHANNEL_LABEL[c];
}

const IST_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS;

/** UTC zaman damgasının İstanbul takvim ayı ("YYYY-MM"). */
export function istMonth(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 7);
}

/** Son `count` ay (eskiden yeniye, bu ay dahil) ve dönemin başlangıcı (İstanbul ay başı, UTC ISO). */
export function roiWindow(nowMs: number, count: number): { months: string[]; startIso: string; startDay: string } {
  const ist = new Date(nowMs + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const startUtc = Date.UTC(y, m - (count - 1), 1) - IST_OFFSET_MS;
  return { months, startIso: new Date(startUtc).toISOString(), startDay: `${months[0]}-01` };
}

export type SpendInput = { month: string; channel: Channel; amount: number; source: "manual" | "google_ads" };
export type SignupInput = { tenantId: string; channel: Channel | null; attributed: boolean; createdAt: string };
export type PaymentInput = { tenantId: string; paidAt: string; net: number };
export type RefundInput = { tenantId: string; net: number };

export type ChannelRoiRow = {
  channel: RoiChannel;
  label: string;
  spend: number;
  spendManual: number;
  spendAds: number;
  signups: number;
  payers: number;
  revenue: number;
  /** Harcama ÷ ödeyen; ödeyen yoksa null. */
  cac: number | null;
  /** Harcama ÷ kayıt; kayıt yoksa null. */
  costPerSignup: number | null;
  /** Ödeyen ÷ kayıt (0..1); kayıt yoksa null. */
  conversion: number | null;
  /** Gelir ÷ harcama; harcama yoksa null. */
  roas: number | null;
  /** Ay; CAC ya da aylık gelir yoksa null. */
  paybackMonths: number | null;
};

export type ChannelRoiResult = { rows: ChannelRoiRow[]; total: ChannelRoiRow };

const round2 = (n: number) => Math.round(n * 100) / 100;

function finish(channel: RoiChannel, acc: { spendManual: number; spendAds: number; signups: number; payers: number; revenue: number; monthlyPerPayerSum: number }): ChannelRoiRow {
  const spend = round2(acc.spendManual + acc.spendAds);
  const cac = acc.payers > 0 && spend > 0 ? round2(spend / acc.payers) : null;
  const monthlyPerPayer = acc.payers > 0 ? acc.monthlyPerPayerSum / acc.payers : 0;
  return {
    channel,
    label: roiChannelLabel(channel),
    spend,
    spendManual: round2(acc.spendManual),
    spendAds: round2(acc.spendAds),
    signups: acc.signups,
    payers: acc.payers,
    revenue: round2(acc.revenue),
    cac,
    costPerSignup: acc.signups > 0 && spend > 0 ? round2(spend / acc.signups) : null,
    conversion: acc.signups > 0 ? acc.payers / acc.signups : null,
    roas: spend > 0 ? acc.revenue / spend : null,
    paybackMonths: cac !== null && monthlyPerPayer > 0 ? Math.round((cac / monthlyPerPayer) * 10) / 10 : null,
  };
}

/**
 * Kanal satırları: harcaması, kaydı ya da geliri olan her kanal (sıra: harcama, sonra kayıt; Atıfsız en sonda) + toplam.
 * Dönem dışındaki harcama ve kayıtlar yok sayılır (çağıran yine de süzerek verir; burada ikinci kez denetlenir).
 */
export function computeChannelRoi(input: {
  months: readonly string[];
  spend: readonly SpendInput[];
  signups: readonly SignupInput[];
  payments: readonly PaymentInput[];
  refunds: readonly RefundInput[];
  nowMs: number;
}): ChannelRoiResult {
  const inWindow = new Set(input.months);
  type Acc = { spendManual: number; spendAds: number; signups: number; payers: number; revenue: number; monthlyPerPayerSum: number };
  const blank = (): Acc => ({ spendManual: 0, spendAds: 0, signups: 0, payers: 0, revenue: 0, monthlyPerPayerSum: 0 });
  const acc = new Map<RoiChannel, Acc>();
  const get = (c: RoiChannel) => {
    let a = acc.get(c);
    if (!a) acc.set(c, (a = blank()));
    return a;
  };

  for (const s of input.spend) {
    if (!inWindow.has(s.month) || !(s.amount > 0)) continue;
    const a = get(s.channel);
    if (s.source === "google_ads") a.spendAds += s.amount;
    else a.spendManual += s.amount;
  }

  const revenueByTenant = new Map<string, number>();
  const firstPaid = new Map<string, number>();
  for (const p of input.payments) {
    const t = new Date(p.paidAt).getTime();
    if (!Number.isFinite(t)) continue;
    revenueByTenant.set(p.tenantId, (revenueByTenant.get(p.tenantId) ?? 0) + (Number(p.net) || 0));
    const prev = firstPaid.get(p.tenantId);
    if (prev === undefined || t < prev) firstPaid.set(p.tenantId, t);
  }
  for (const r of input.refunds) {
    if (revenueByTenant.has(r.tenantId)) revenueByTenant.set(r.tenantId, (revenueByTenant.get(r.tenantId) ?? 0) - (Number(r.net) || 0));
  }

  const seen = new Set<string>();
  for (const s of input.signups) {
    const t = new Date(s.createdAt).getTime();
    if (!Number.isFinite(t) || !inWindow.has(istMonth(t)) || seen.has(s.tenantId)) continue;
    seen.add(s.tenantId);
    const channel: RoiChannel = !s.attributed ? "bilinmiyor" : (s.channel ?? "unknown");
    const a = get(channel);
    a.signups += 1;
    const first = firstPaid.get(s.tenantId);
    if (first === undefined) continue;
    const rev = Math.max(0, revenueByTenant.get(s.tenantId) ?? 0);
    a.payers += 1;
    a.revenue += rev;
    a.monthlyPerPayerSum += rev / Math.max(1, Math.ceil((input.nowMs - first) / MONTH_MS));
  }

  const rows = [...acc.entries()]
    .map(([c, a]) => finish(c, a))
    .sort((x, y) => {
      if (x.channel === "bilinmiyor") return 1;
      if (y.channel === "bilinmiyor") return -1;
      return y.spend - x.spend || y.signups - x.signups || x.label.localeCompare(y.label, "tr");
    });
  const sum = blank();
  for (const a of acc.values()) {
    sum.spendManual += a.spendManual;
    sum.spendAds += a.spendAds;
    sum.signups += a.signups;
    sum.payers += a.payers;
    sum.revenue += a.revenue;
    sum.monthlyPerPayerSum += a.monthlyPerPayerSum;
  }
  const total = { ...finish("unknown", sum), label: "Toplam" };
  return { rows, total };
}

/** Google Ads günlük maliyetini aya toplar (mikro birim → TL). */
export function adsSpendByMonth(rows: readonly { day: string; cost_micros: number }[], months: readonly string[]): SpendInput[] {
  const inWindow = new Set(months);
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const m = String(r.day).slice(0, 7);
    if (!inWindow.has(m)) continue;
    byMonth.set(m, (byMonth.get(m) ?? 0) + (Number(r.cost_micros) || 0) / 1_000_000);
  }
  return [...byMonth.entries()].map(([month, amount]) => ({ month, channel: "paid_search" as const, amount: round2(amount), source: "google_ads" as const }));
}

/** "YYYY-MM" → "Ekim 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 15)).toLocaleDateString("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Form girdisi "YYYY-MM" → DB ay başı "YYYY-MM-01"; geçersizse null. */
export function parseSpendMonth(raw: string): string | null {
  const v = raw.trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return null;
  const y = Number(v.slice(0, 4));
  return y >= 2020 && y <= 2100 ? `${v}-01` : null;
}

/** Form tutarı: "12.500,50" / "12500.5" / "12500" → sayı; negatif/bozuk/çok büyük → null. */
export function parseSpendAmount(raw: string): number | null {
  let v = raw.trim().replace(/\s|₺|TL/gi, "");
  if (!v) return null;
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100_000_000 ? round2(n) : null;
}
