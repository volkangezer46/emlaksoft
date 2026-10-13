/**
 * OFİS SAĞLIK SKORU (0-100) — SAF hesap (DOM/zaman/DB yok; vitest). Günlük hesaplayan iş: `tenant-health-job.ts`
 * (gorev-hatirlat cron'unun ayrık adımı; yeni cron yok). Girdiler `platform_tenant_health_inputs` RPC'sinden gelir.
 *
 * Bileşenler (her biri 0..1, sonra ağırlıklı ortalama):
 *  - KULLANIM: giriş sıklığı (30 günde girişli gün / 12), koltuk doluluğu (aktif kullanıcı / koltuk tavanı),
 *    modül benimseme (30 günde işlem yapılan iş alanı / 6). Pay: 0.4 / 0.3 / 0.3.
 *  - ÖDEME: askıda = 0; gecikmiş (ofis ya da abonelik) = 0.3; vadesi geçmiş açık fatura: ≤7 gün 0.7, ≤30 gün 0.4, üstü 0.1.
 *  - DESTEK: açık talep 0 → 1, 1 → 0.8, 2-3 → 0.6, 4+ → 0.3; CSAT varsa (ortalama-1)/4 ile 0.6/0.4 karışım.
 * Ağırlıklar ayar defterinden (`crm.health_weight_*`, varsayılan kullanım %50, ödeme %30, destek %20); toplam 0 ise varsayılan.
 * Sahte skor yok: girdi olmayan ofis için skor üretilmez (iş, RPC satırı olmayan ofisi atlar).
 */

export type HealthWeights = { usage: number; payment: number; support: number };

export const HEALTH_DEFAULT_WEIGHTS: HealthWeights = { usage: 50, payment: 30, support: 20 };
export const HEALTH_DEFAULT_RISK_THRESHOLD = 40;
/** "Sağlıklı" bandının alt sınırı (riskli eşiği ile arası "izlenmeli"). */
export const HEALTH_GOOD_THRESHOLD = 70;
export const HEALTH_LOGIN_DAYS_TARGET = 12;
export const HEALTH_MODULE_TARGET = 6;
/** Girdi penceresi (gün). */
export const HEALTH_WINDOW_DAYS = 30;

export type HealthInputs = {
  status: string;
  /** Abonelik durumu (yoksa null). */
  subStatus: string | null;
  loginDays: number;
  activeUsers: number;
  /** Koltuk tavanı (paket koltuğu + ek koltuk); null = sınırsız. */
  seatLimit: number | null;
  moduleAreas: number;
  openTickets: number;
  csatAvg: number | null;
  csatN: number;
  overdueInvoices: number;
  maxOverdueDays: number;
};

export type HealthResult = {
  score: number;
  usage: number;
  payment: number;
  support: number;
  /** Skoru en çok düşüren nedenler (Türkçe, kısa; en fazla 3). */
  reasons: string[];
};

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const pct = (n: number) => Math.round(clamp01(n) * 100);

/** Ayar değerlerinden ağırlık: negatif/bozuk = 0; toplam 0 ise varsayılan. */
export function normalizeWeights(raw: Partial<Record<keyof HealthWeights, unknown>>): HealthWeights {
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? Math.min(100, x) : 0;
  };
  const w = { usage: n(raw.usage), payment: n(raw.payment), support: n(raw.support) };
  return w.usage + w.payment + w.support > 0 ? w : { ...HEALTH_DEFAULT_WEIGHTS };
}

export function usageComponent(i: Pick<HealthInputs, "loginDays" | "activeUsers" | "seatLimit" | "moduleAreas">): number {
  const login = clamp01(i.loginDays / HEALTH_LOGIN_DAYS_TARGET);
  const seat = i.seatLimit && i.seatLimit > 0 ? clamp01(i.activeUsers / i.seatLimit) : i.activeUsers > 0 ? 1 : 0;
  const adoption = clamp01(i.moduleAreas / HEALTH_MODULE_TARGET);
  return 0.4 * login + 0.3 * seat + 0.3 * adoption;
}

export function paymentComponent(i: Pick<HealthInputs, "status" | "subStatus" | "overdueInvoices" | "maxOverdueDays">): number {
  if (i.status === "suspended") return 0;
  let v = 1;
  if (i.status === "past_due" || i.subStatus === "past_due") v = Math.min(v, 0.3);
  if (i.overdueInvoices > 0) {
    const d = i.maxOverdueDays;
    v = Math.min(v, d <= 7 ? 0.7 : d <= 30 ? 0.4 : 0.1);
  }
  return v;
}

export function supportComponent(i: Pick<HealthInputs, "openTickets" | "csatAvg" | "csatN">): number {
  const t = i.openTickets;
  const tickets = t <= 0 ? 1 : t === 1 ? 0.8 : t <= 3 ? 0.6 : 0.3;
  if (i.csatN > 0 && i.csatAvg !== null && Number.isFinite(i.csatAvg)) return 0.6 * tickets + 0.4 * clamp01((i.csatAvg - 1) / 4);
  return tickets;
}

export function computeHealth(i: HealthInputs, weights: HealthWeights = HEALTH_DEFAULT_WEIGHTS): HealthResult {
  const w = normalizeWeights(weights);
  const usage = usageComponent(i);
  const payment = paymentComponent(i);
  const support = supportComponent(i);
  const total = w.usage + w.payment + w.support;
  const score = Math.round((100 * (w.usage * usage + w.payment * payment + w.support * support)) / total);

  const reasons: { text: string; loss: number }[] = [];
  if (i.loginDays < HEALTH_LOGIN_DAYS_TARGET / 2) reasons.push({ text: i.loginDays === 0 ? "30 gündür giriş yok" : `30 günde yalnız ${i.loginDays} gün giriş`, loss: w.usage * 0.4 });
  if (i.seatLimit && i.activeUsers / i.seatLimit < 0.5) reasons.push({ text: `Koltuk doluluğu düşük (${i.activeUsers}/${i.seatLimit})`, loss: w.usage * 0.3 * 0.5 });
  if (i.moduleAreas < HEALTH_MODULE_TARGET / 2) reasons.push({ text: `Az modül kullanılıyor (${i.moduleAreas})`, loss: w.usage * 0.3 * 0.6 });
  if (i.status === "suspended") reasons.push({ text: "Ofis askıda", loss: w.payment });
  else if (i.status === "past_due" || i.subStatus === "past_due") reasons.push({ text: "Ödeme gecikmiş", loss: w.payment * 0.7 });
  if (i.overdueInvoices > 0) reasons.push({ text: `${i.overdueInvoices} vadesi geçmiş fatura (${i.maxOverdueDays} gün)`, loss: w.payment * 0.5 });
  if (i.openTickets > 0) reasons.push({ text: `${i.openTickets} açık destek talebi`, loss: w.support * (1 - (i.openTickets === 1 ? 0.8 : i.openTickets <= 3 ? 0.6 : 0.3)) });
  if (i.csatN > 0 && i.csatAvg !== null && i.csatAvg < 3.5) reasons.push({ text: `Memnuniyet düşük (${i.csatAvg.toFixed(1)}/5)`, loss: w.support * 0.4 });

  return {
    score: Math.min(100, Math.max(0, score)),
    usage: pct(usage),
    payment: pct(payment),
    support: pct(support),
    reasons: reasons.sort((a, b) => b.loss - a.loss).slice(0, 3).map((r) => r.text),
  };
}

export type HealthBand = "riskli" | "izlenmeli" | "saglikli";

export const HEALTH_BAND_LABELS: Record<HealthBand, string> = { riskli: "Riskli", izlenmeli: "İzlenmeli", saglikli: "Sağlıklı" };
export const HEALTH_BAND_TONE: Record<HealthBand, "danger" | "warn" | "success"> = { riskli: "danger", izlenmeli: "warn", saglikli: "success" };

export function healthBand(score: number, riskThreshold = HEALTH_DEFAULT_RISK_THRESHOLD): HealthBand {
  if (score < riskThreshold) return "riskli";
  if (score < Math.max(riskThreshold, HEALTH_GOOD_THRESHOLD)) return "izlenmeli";
  return "saglikli";
}

/** Skor süzgeci (URL `skor=`) → sorgu aralığı [gte, lt). */
export function healthBandRange(band: HealthBand, riskThreshold = HEALTH_DEFAULT_RISK_THRESHOLD): { gte: number; lt: number } {
  const good = Math.max(riskThreshold, HEALTH_GOOD_THRESHOLD);
  if (band === "riskli") return { gte: 0, lt: riskThreshold };
  if (band === "izlenmeli") return { gte: riskThreshold, lt: good };
  return { gte: good, lt: 101 };
}
