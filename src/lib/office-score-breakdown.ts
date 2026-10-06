import type { OfficeScoreInputs } from "@/lib/office-score";

/**
 * Ofis sağlık skoru BİLEŞEN KIRILIMI sunumu (saf; skor formülü DEĞİŞMEZ).
 *
 * Amaç: tek bir "73" sayısı yerine, hangi bileşenin kaç puan getirdiği ve her bileşenin
 * filtrelenmiş hedefi (sıfır çıkmaz metrik) gösterilsin. Sabit `42` başlangıç değeri bir
 * "taban" olarak AÇIKÇA etiketlenir (veriden gelmediği saklanmaz). Formül `computeOfficeScore` ile
 * aynıdır; `office-score-breakdown.test.ts` toplamın birebir aynı olduğunu doğrular (kayma olursa test kırılır).
 */

export const OFFICE_SCORE_BASE = 42;

export type OfficeScoreComponent = {
  key: "base" | "demands" | "portals" | "appointments" | "calls" | "closures" | "overdue";
  label: string;
  /** Bu bileşenin skora katkısı (ceza negatif). */
  points: number;
  /** Alabileceği en yüksek katkı (ceza için en düşük, negatif). */
  max: number;
  /** Ham girdi (taban için null). */
  value: number | null;
  /** Filtrelenmiş hedef; taban için null (veri değil). */
  href: string | null;
  /** "Neden bu puan" tek satır. */
  hint: string;
};

export function explainOfficeScore(input: OfficeScoreInputs): { components: OfficeScoreComponent[]; rawTotal: number; total: number } {
  const components: OfficeScoreComponent[] = [
    {
      key: "base",
      label: "Taban puan (sabit başlangıç)",
      points: OFFICE_SCORE_BASE,
      max: OFFICE_SCORE_BASE,
      value: null,
      href: null,
      hint: "Veriden gelmez; her ofis bu puanla başlar.",
    },
    {
      key: "demands",
      label: "Açık talepler",
      points: Math.min(18, input.openDemands * 4),
      max: 18,
      value: input.openDemands,
      href: "/app/talepler",
      hint: `${input.openDemands} açık talep · talep başına 4 puan, en çok 18`,
    },
    {
      key: "portals",
      label: "Yayındaki portal ilanları",
      points: Math.min(16, input.livePortals * 3),
      max: 16,
      value: input.livePortals,
      href: "/app/portallar",
      hint: `${input.livePortals} canlı ilan · ilan başına 3 puan, en çok 16`,
    },
    {
      key: "appointments",
      label: "Son 7 gün randevu",
      points: Math.min(12, input.appointments7d * 3),
      max: 12,
      value: input.appointments7d,
      href: "/app/randevular",
      hint: `${input.appointments7d} randevu · randevu başına 3 puan, en çok 12`,
    },
    {
      key: "calls",
      label: "Son 7 gün arama",
      points: Math.min(10, input.calls7d * 2),
      max: 10,
      value: input.calls7d,
      href: "/app/musteriler",
      hint: `${input.calls7d} arama · arama başına 2 puan, en çok 10`,
    },
    {
      key: "closures",
      label: "Son 30 gün kapanış",
      points: Math.min(12, input.closures30d * 4),
      max: 12,
      value: input.closures30d,
      href: "/app/anlasmalar",
      hint: `${input.closures30d} kapanış · kapanış başına 4 puan, en çok 12`,
    },
    {
      key: "overdue",
      label: "Gecikmiş teyit cezası",
      points: -Math.min(28, input.overdueConfirmations * 7),
      max: -28,
      value: input.overdueConfirmations,
      href: "/app/portallar?durum=teyit",
      hint: `${input.overdueConfirmations} teyitsiz ilan · ilan başına -7 puan, en çok -28`,
    },
  ];
  const rawTotal = components.reduce((a, c) => a + c.points, 0);
  return { components, rawTotal, total: Math.max(0, Math.min(100, Math.round(rawTotal))) };
}
