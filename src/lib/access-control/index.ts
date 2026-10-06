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

export {
  ASSIGNABLE_SCOPES,
  SCOPE_LABELS,
  SCOPE_RANK,
  SCOPE_RESOURCE_TABLES,
  defaultScopeFlagsForRole,
  defaultUserScopeForRole,
  scopeLabel,
} from "./scope-rules";

export { getUserScope, loadScopeOverrides, checkScopeOverride } from "./scope-cache";

export { requireScopePermission } from "./require-scope";

/** Liste sayfaları: sunucu çözümleyici + saf uygulayıcı (kapsam yalnız daraltır). */
export { getListScope, type ListScope } from "./list-scope";
export { applyScopeFilter, resolveScopeFilter, tightenScopeFilter, isNarrowing, type ScopeFilter } from "./query-scope";

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
