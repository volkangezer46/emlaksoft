/**
 * Kapsam temelli erişim kontrol sistemi exports.
 */

export {
  getDefaultScopeForRole,
  canAdvisorAccessDemand,
  canAdvisorAccessProperty,
  canSignDeal,
  canRejectCommission,
  canViewReport,
  canAssignDemandLead,
  canViewBranchReport,
  evaluateScopeAccess,
} from "./scope-rules";

export { getUserScope, loadScopeOverrides, checkScopeOverride } from "./scope-cache";

export { requireScopePermission } from "./require-scope";

export type {
  AccessScope,
  UserScope,
  ScopeOverride,
  AccessDecision,
  ScopePermissionContext,
  AdvisorAccessRule,
  TeamLeadAccessRule,
  BranchManagerAccessRule,
} from "./types";

export type { ScopePermissionGate } from "./require-scope";
