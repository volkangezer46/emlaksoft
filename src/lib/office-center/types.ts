/**
 * Ofis Merkezi veri modeli
 */

export type AdvisorRole = "advisor" | "team_lead" | "branch_manager" | "gm" | "owner";

export interface OfficeAdvisor {
  id: string;
  tenantId: string;
  fullName: string;
  phone: string | null;
  email: string;
  role: AdvisorRole;
  branchId?: string;
  teamId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  joinedAt?: string;
}

export interface PoolAssignment {
  id: string;
  tenantId: string;
  propertyId: string;
  assignedToId: string; // advisor id
  assignedAt: string;
  assignedBy: string; // user id
  slaDeadlineAt: string;
  cancelledAt?: string;
  cancelledReason?: string;
  completedAt?: string;
}

export interface OfficeSettings {
  key: string;
  value: unknown;
  tenantId: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface SLADefinition {
  assignmentSLAHours: number;
  escalationSLAHours: number;
  closureSLADays: number;
}

export interface CommissionDefinition {
  advisorCommissionPercent: number;
  officeCommissionPercent: number;
  specialtyBonuses: Record<string, number>;
}

export interface AlertThreshold {
  unassignedPropertyCount: number;
  slaBreach: number; // hours
  noActivityDays: number;
}

export interface OfficeStatistics {
  totalProperties: number;
  totalDeals: number;
  totalRentals: number;
  salesRatio: number; // 0-1
  rentalRatio: number; // 0-1
  averageProcessTime: number; // days
  alertCount: number;
}

export interface AdvisorLeagueEntry {
  advisorId: string;
  name: string;
  rank: number;
  sales: number;
  rentals: number;
  commission: number;
  activityScore: number;
}

export interface TeamHealthMetrics {
  averageProcessTime: number;
  activeAdvisors: number;
  inactiveAdvisors: number;
  alertCount: number;
  systemHealth: "healthy" | "warning" | "critical";
}
