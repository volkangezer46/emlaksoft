/**
 * Ofis Merkezi saf mantık (işlem yok, veri dönüştürme ve hesaplamalar)
 */

import type {
  OfficeAdvisor,
  SLADefinition,
  CommissionDefinition,
  AlertThreshold,
  AdvisorLeagueEntry,
} from "./types";

/**
 * Danışman sıralaması (performans puanına göre)
 */
export function rankAdvisors(
  advisors: OfficeAdvisor[],
  metrics: Record<string, { sales: number; commission: number; activityScore: number }>,
  sortBy: "sales" | "commission" | "activity" = "sales"
): AdvisorLeagueEntry[] {
  const entries: AdvisorLeagueEntry[] = advisors.map((advisor, index) => {
    const m = metrics[advisor.id] || { sales: 0, commission: 0, activityScore: 0 };
    return {
      advisorId: advisor.id,
      name: advisor.fullName,
      rank: index + 1,
      sales: m.sales,
      rentals: 0, // TODO: add to metrics
      commission: m.commission,
      activityScore: m.activityScore,
    };
  });

  // Sıralamaya göre sırala ve rank'i güncelle
  entries.sort((a, b) => {
    const aVal = sortBy === "sales" ? a.sales : sortBy === "commission" ? a.commission : a.activityScore;
    const bVal = sortBy === "sales" ? b.sales : sortBy === "commission" ? b.commission : b.activityScore;
    return bVal - aVal; // azalan sıra
  });

  return entries.map((e, idx) => ({ ...e, rank: idx + 1 }));
}

/**
 * SLA hesaplaması - atama zamanından ne kadar geçti
 */
export function calculateSLAStatus(
  assignedAt: string,
  definition: SLADefinition,
  cancelledAt?: string
): {
  status: "ok" | "warning" | "breached";
  hoursElapsed: number;
  percentageUsed: number;
} {
  const now = new Date();
  const assigned = new Date(assignedAt);
  const elapsed = (now.getTime() - assigned.getTime()) / (1000 * 60 * 60); // hours

  const sla = definition.assignmentSLAHours;
  const percentageUsed = (elapsed / sla) * 100;

  let status: "ok" | "warning" | "breached" = "ok";
  if (percentageUsed >= 100) status = "breached";
  else if (percentageUsed >= 75) status = "warning";

  return {
    status,
    hoursElapsed: Math.round(elapsed),
    percentageUsed: Math.round(percentageUsed),
  };
}

/**
 * Komis yonu hesapla (temel)
 */
export function calculateCommission(
  dealAmount: number,
  definition: CommissionDefinition,
  specialtyKey?: string
): {
  advisorShare: number;
  officeShare: number;
  total: number;
} {
  let advisorPercent = definition.advisorCommissionPercent / 100;
  const officePercent = definition.officeCommissionPercent / 100;

  // Uzmanlık bonusu varsa
  if (specialtyKey && definition.specialtyBonuses[specialtyKey]) {
    advisorPercent += definition.specialtyBonuses[specialtyKey] / 100;
  }

  const advisorShare = dealAmount * advisorPercent;
  const officeShare = dealAmount * officePercent;
  const total = advisorShare + officeShare;

  return {
    advisorShare: Math.round(advisorShare * 100) / 100,
    officeShare: Math.round(officeShare * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

/**
 * Uyarı tetikleyicileri kontrol et
 */
export function checkAlerts(
  unassignedCount: number,
  slaBreachedCount: number,
  noActivityDays: number,
  thresholds: AlertThreshold
): {
  alertType: "none" | "warning" | "critical";
  alerts: string[];
} {
  const alerts: string[] = [];

  if (unassignedCount >= thresholds.unassignedPropertyCount) {
    alerts.push(`${unassignedCount} atanmamış portföy (eşik: ${thresholds.unassignedPropertyCount})`);
  }

  if (slaBreachedCount > 0) {
    alerts.push(`${slaBreachedCount} SLA ihlali`);
  }

  if (noActivityDays >= thresholds.noActivityDays) {
    alerts.push(`${noActivityDays} gün hiç aktivite yok`);
  }

  const alertType = alerts.length > 2 ? "critical" : alerts.length > 0 ? "warning" : "none";

  return { alertType, alerts };
}

/**
 * Performans ligi hesapla (basit sıralama)
 */
export function calculateLeagueStats(
  advisors: OfficeAdvisor[],
  metricsMap: Record<string, { sales: number; commission: number }>
): {
  totalSales: number;
  averageCommission: number;
  topAdvisor?: OfficeAdvisor;
} {
  let totalSales = 0;
  let totalCommission = 0;
  let topAdvisor = advisors[0];
  let maxSales = 0;

  for (const advisor of advisors) {
    const metrics = metricsMap[advisor.id];
    if (!metrics) continue;

    totalSales += metrics.sales;
    totalCommission += metrics.commission;

    if (metrics.sales > maxSales) {
      maxSales = metrics.sales;
      topAdvisor = advisor;
    }
  }

  return {
    totalSales,
    averageCommission: advisors.length > 0 ? totalCommission / advisors.length : 0,
    topAdvisor,
  };
}

/**
 * Danışman durumu (etkin/pasif/inzivada vs.)
 */
export function getAdvisorStatus(advisor: OfficeAdvisor): {
  status: "active" | "inactive" | "onleave";
  label: string;
} {
  // TODO: is_active, leave_status vs. kontrolü
  if (!advisor.isActive) {
    return { status: "inactive", label: "Pasif" };
  }

  return { status: "active", label: "Aktif" };
}
