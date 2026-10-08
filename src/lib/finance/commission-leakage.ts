/**
 * Komisyon sızıntısı / indirim analizi (SAF). Kazanılmış SATIŞ anlaşmalarında portföyün uygulanan komisyon oranı,
 * ofis standart oranının (ofis tanımı `office.commission.default_rate`) altındaysa fark "indirimle kaçan gelir"dir:
 *   kaçan = işlem bedeli × (standart − uygulanan) / 100.
 *
 * Sınırlar (ekranda da yazılır): uygulanan oran portföy kaydındaki GÜNCEL orandır; kiralama anlaşmaları hariçtir (kira
 * komisyonu aylık kira esaslıdır); standart oran ofis ayarıdır, sözleşme bazlı liste oranı değildir.
 */
import { trMonthKey } from "@/lib/clock";

export type WonSaleFact = {
  dealId: string;
  propertyId: string | null;
  propertyLabel: string | null;
  advisorId: string | null;
  advisorName: string | null;
  dealValue: number;
  /** Portföyün komisyon oranı (%); yoksa null (analiz dışı). */
  appliedRate: number | null;
  /** Kapanış zamanı (ISO). */
  closedAt: string;
};

export type ApprovalInfo = { enabled: boolean; threshold: number };

export type LeakageDeal = {
  dealId: string;
  propertyId: string | null;
  label: string;
  advisorId: string | null;
  advisorName: string | null;
  dealValue: number;
  appliedRate: number;
  standardRate: number;
  /** Standarttan kaç puan indirim. */
  cutPoints: number;
  /** Kaçan komisyon (TL). */
  leak: number;
  /** Onay kuralı açıkken eşiği aşan indirim (onay gerektirirdi). */
  overApprovalThreshold: boolean;
  month: string;
};

export type LeakageAdvisor = { advisorId: string; name: string; deals: number; leak: number; avgCutPoints: number };
export type LeakageMonth = { key: string; leak: number; deals: number };

export type CommissionLeakage = {
  standardRate: number;
  salesAnalyzed: number;
  discountedCount: number;
  totalLeak: number;
  overThresholdCount: number;
  months: LeakageMonth[];
  deals: LeakageDeal[];
  advisors: LeakageAdvisor[];
  approval: ApprovalInfo;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeCommissionLeakage(
  sales: readonly WonSaleFact[],
  standardRate: number,
  monthKeys: readonly string[],
  approval: ApprovalInfo,
): CommissionLeakage {
  const months = new Map<string, LeakageMonth>(monthKeys.map((key) => [key, { key, leak: 0, deals: 0 }]));
  const deals: LeakageDeal[] = [];
  let analyzed = 0;
  if (!(standardRate > 0)) {
    return { standardRate, salesAnalyzed: 0, discountedCount: 0, totalLeak: 0, overThresholdCount: 0, months: [...months.values()], deals, advisors: [], approval };
  }
  for (const s of sales) {
    if (!(s.dealValue > 0) || s.appliedRate === null || !Number.isFinite(s.appliedRate) || s.appliedRate <= 0) continue;
    const month = trMonthKey(Date.parse(s.closedAt));
    const bucket = months.get(month);
    if (!bucket) continue;
    analyzed += 1;
    const cut = round2(standardRate - s.appliedRate);
    if (cut <= 0) continue;
    const leak = round2((s.dealValue * cut) / 100);
    bucket.leak += leak;
    bucket.deals += 1;
    deals.push({
      dealId: s.dealId,
      propertyId: s.propertyId,
      label: (s.propertyLabel ?? "Portföy").trim() || "Portföy",
      advisorId: s.advisorId,
      advisorName: s.advisorName,
      dealValue: s.dealValue,
      appliedRate: s.appliedRate,
      standardRate,
      cutPoints: cut,
      leak,
      overApprovalThreshold: approval.enabled && cut >= approval.threshold,
      month,
    });
  }
  deals.sort((a, b) => b.leak - a.leak || a.dealId.localeCompare(b.dealId));

  const byAdvisor = new Map<string, { name: string; deals: number; leak: number; cut: number }>();
  for (const d of deals) {
    if (!d.advisorId) continue;
    const cur = byAdvisor.get(d.advisorId) ?? { name: d.advisorName ?? "Danışman", deals: 0, leak: 0, cut: 0 };
    cur.deals += 1;
    cur.leak += d.leak;
    cur.cut += d.cutPoints;
    byAdvisor.set(d.advisorId, cur);
  }
  const advisors: LeakageAdvisor[] = [...byAdvisor.entries()]
    .map(([advisorId, v]) => ({ advisorId, name: v.name, deals: v.deals, leak: round2(v.leak), avgCutPoints: round2(v.cut / v.deals) }))
    .sort((a, b) => b.leak - a.leak || a.name.localeCompare(b.name, "tr"));

  const list = [...months.values()].map((m) => ({ ...m, leak: round2(m.leak) }));
  return {
    standardRate,
    salesAnalyzed: analyzed,
    discountedCount: deals.length,
    totalLeak: round2(deals.reduce((s, d) => s + d.leak, 0)),
    overThresholdCount: deals.filter((d) => d.overApprovalThreshold).length,
    months: list,
    deals,
    advisors,
    approval,
  };
}
