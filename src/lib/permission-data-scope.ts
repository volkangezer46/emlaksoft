import type { AppModule } from "@/lib/permissions";
import {
  effectiveCanAccessModule,
  effectiveHasPermission,
  type EffectivePermissions,
} from "@/lib/permissions-effective";

import { hasOfficeWideDataScope } from "@/lib/office-wide-scope";

export { hasOfficeWideDataScope };

export const SEARCH_KIND_MODULE = {
  customer: "customers",
  property: "properties",
  demand: "demands",
  deal: "commissions",
  task: "tasks",
  ticket: "support",
} as const satisfies Record<string, AppModule>;

export type SearchableKind = keyof typeof SEARCH_KIND_MODULE;

export function canSearchKind(perms: EffectivePermissions, kind: SearchableKind): boolean {
  return effectiveCanAccessModule(perms, SEARCH_KIND_MODULE[kind]);
}

export type TenantAdvisorCapabilities = {
  customers: boolean;
  properties: boolean;
  deals: boolean;
  demands: boolean;
  tasks: boolean;
  appointments: boolean;
  commissions: boolean;
  reports: boolean;
  canCreateTasks: boolean;
};

/** AI bağlamında her veri kümesi, onu temsil eden modülün etkin iznine bağlanır. */
export function getTenantAdvisorCapabilities(
  perms: EffectivePermissions,
): TenantAdvisorCapabilities {
  return {
    customers: effectiveCanAccessModule(perms, "customers"),
    properties: effectiveCanAccessModule(perms, "properties"),
    deals: effectiveCanAccessModule(perms, "commissions"),
    demands: effectiveCanAccessModule(perms, "demands"),
    tasks: effectiveCanAccessModule(perms, "tasks"),
    appointments: effectiveCanAccessModule(perms, "appointments"),
    commissions: effectiveCanAccessModule(perms, "commissions"),
    reports: effectiveCanAccessModule(perms, "reports"),
    canCreateTasks:
      effectiveCanAccessModule(perms, "tasks") &&
      effectiveHasPermission(perms, "tasks", "create"),
  };
}
