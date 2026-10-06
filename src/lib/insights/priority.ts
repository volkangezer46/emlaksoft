import type { InsightSeverity } from "@/lib/insights/types";

/**
 * Öncelik formülü (TEK yer, açıklanabilir):
 *   priority = şiddet tabanı + aciliyet + etki - bastırma   (0..100'e kırpılır)
 *
 * - şiddet tabanı: bilgi 20 · orta 45 · yüksek 70
 * - aciliyet (0..20): son tarihe kalan gün; gecikmiş/bugün 20, <=3 gün 15, <=7 gün 10, <=15 gün 5
 * - etki (0..10): kayıt sayısı/tutar için çağıranın verdiği 0..10 ölçeği
 * - bastırma (0..-20): aynı kuralın bu ofiste yakın zamandaki yoksayma sayısı × 5
 */
export const SEVERITY_BASE: Record<InsightSeverity, number> = { bilgi: 20, orta: 45, yuksek: 70 };

export type PriorityInput = {
  severity: InsightSeverity;
  /** Son tarihe kalan gün (negatif = gecikmiş); null = zamana bağlı değil. */
  urgencyDays?: number | null;
  /** 0..10 etki ölçeği. */
  impact?: number | null;
  /** Aynı kuralın yakın geçmişteki yoksayma sayısı. */
  recentDismissals?: number | null;
};

export type PriorityResult = {
  priority: number;
  parts: { base: number; urgency: number; impact: number; suppression: number };
};

export function urgencyPoints(days: number | null | undefined): number {
  if (days === null || days === undefined || !Number.isFinite(days)) return 0;
  if (days <= 0) return 20;
  if (days <= 3) return 15;
  if (days <= 7) return 10;
  if (days <= 15) return 5;
  return 0;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function computePriority(input: PriorityInput): PriorityResult {
  const base = SEVERITY_BASE[input.severity];
  const urgency = urgencyPoints(input.urgencyDays);
  const impact = clamp(Math.round(input.impact ?? 0), 0, 10);
  const suppression = -clamp(Math.round((input.recentDismissals ?? 0) * 5), 0, 20);
  const priority = clamp(base + urgency + impact + suppression, 0, 100);
  return { priority, parts: { base, urgency, impact, suppression } };
}

/** "Neden bu sırada" tek satır (kanıt listesine eklenir). */
export function explainPriority(r: PriorityResult): string {
  const { base, urgency, impact, suppression } = r.parts;
  const bits = [`şiddet ${base}`];
  if (urgency) bits.push(`aciliyet +${urgency}`);
  if (impact) bits.push(`etki +${impact}`);
  if (suppression) bits.push(`geçmiş yoksayma ${suppression}`);
  return `${bits.join(" · ")} = ${r.priority}`;
}

/** Kayıt/tutar sayısını 0..10 etki ölçeğine çevirir (log ölçek; 1 -> 1, 10 -> ~5, 1000 -> 10). */
export function impactScale(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return clamp(Math.round(Math.log10(count + 1) * 3.4), 0, 10);
}
