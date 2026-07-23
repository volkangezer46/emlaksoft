export type AppRole =
  | "owner"
  | "gm"
  | "branch_manager"
  | "team_lead"
  | "advisor"
  | "call_center"
  | "accounting"
  | "readonly";

export type AppModule =
  | "dashboard"
  | "customers"
  | "demands"
  | "properties"
  | "matching"
  | "portals"
  | "leak"
  | "appointments"
  | "calls"
  | "commissions"
  | "tasks"
  | "team"
  | "support"
  | "settings"
  | "billing"
  | "reports"
  | "valuation"
  | "compliance"
  | "campaigns"
  | "contracts"
  | "expenses"
  | "offers"
  | "targets"
  | "open_house";

export type AppAction = "view" | "create" | "edit" | "delete";

const ALL: AppAction[] = ["view", "create", "edit", "delete"];
const VIEW: AppAction[] = ["view"];
const CRUD_NO_DEL: AppAction[] = ["view", "create", "edit"];

/**
 * Rol × modül × aksiyon VARSAYILAN matrisi. Bu, `supabase/migrations/20260722000014_permission_matrix.sql`
 * içindeki `permission_defaults` tablosuna birebir seed edilmiştir — biri değişirse diğeri de güncellenmeli.
 * Gerçek çalışma zamanı yetkisi (tenant override'larıyla birleştirilmiş hali) için
 * `src/lib/permissions-effective.ts`'deki `getEffectivePermissions` kullanılır; bu MATRIX sadece
 * varsayılan/fallback kaynağıdır.
 */
export const DEFAULT_MATRIX: Record<AppRole, Partial<Record<AppModule, AppAction[]>>> = {
  owner: Object.fromEntries(
    (
      [
        "dashboard",
        "customers",
        "demands",
        "properties",
        "matching",
        "portals",
        "leak",
        "appointments",
        "calls",
        "commissions",
        "tasks",
        "team",
        "support",
        "settings",
        "billing",
        "reports",
        "valuation",
        "compliance",
        "campaigns",
        "contracts",
        "expenses",
        "offers",
        "targets",
        "open_house",
      ] as AppModule[]
    ).map((m) => [m, ALL]),
  ),
  gm: {
    dashboard:    ALL,
    customers:    ALL,
    demands:      ALL,
    properties:   ALL,
    matching:     ALL,
    portals:      ALL,
    leak:         ALL,
    appointments: ALL,
    calls:        ALL,
    commissions:  ALL,
    tasks:        ALL,
    team:         CRUD_NO_DEL,
    support:      ALL,
    settings:     CRUD_NO_DEL,
    billing:      CRUD_NO_DEL,
    reports:      VIEW,
    valuation:    ALL,
    compliance:   ALL,
    campaigns:    ALL,
    contracts:    ALL,
    expenses:     ALL,
    offers:       ALL,
    targets:      ALL,
    open_house:   ALL,
  },
  branch_manager: {
    dashboard:    VIEW,
    customers:    ALL,
    demands:      ALL,
    properties:   ALL,
    matching:     ALL,
    portals:      ALL,
    leak:         VIEW,
    appointments: ALL,
    calls:        ALL,
    commissions:  VIEW,
    tasks:        ALL,
    team:         VIEW,
    support:      CRUD_NO_DEL,
    reports:      VIEW,
    valuation:    CRUD_NO_DEL,
    campaigns:    CRUD_NO_DEL,
    contracts:    CRUD_NO_DEL,
  },
  team_lead: {
    dashboard:    VIEW,
    customers:    ALL,
    demands:      ALL,
    properties:   ALL,
    matching:     ALL,
    portals:      CRUD_NO_DEL,
    appointments: ALL,
    calls:        ALL,
    commissions:  VIEW,
    tasks:        ALL,
    support:      VIEW,
    valuation:    VIEW,
    campaigns:    VIEW,
    contracts:    CRUD_NO_DEL,
  },
  advisor: {
    dashboard:    VIEW,
    customers:    CRUD_NO_DEL,
    demands:      CRUD_NO_DEL,
    properties:   CRUD_NO_DEL,
    matching:     CRUD_NO_DEL,
    portals:      CRUD_NO_DEL,
    leak:         VIEW,
    appointments: CRUD_NO_DEL,
    calls:        CRUD_NO_DEL,
    commissions:  VIEW,
    tasks:        CRUD_NO_DEL,
    support:      VIEW,
    settings:     VIEW,
    reports:      VIEW,
    valuation:    VIEW,
    compliance:   VIEW,
    campaigns:    VIEW,
    contracts:    CRUD_NO_DEL,
  },
  call_center: {
    dashboard: VIEW,
    customers: CRUD_NO_DEL,
    demands: CRUD_NO_DEL,
    calls: ALL,
    appointments: CRUD_NO_DEL,
    tasks: CRUD_NO_DEL,
    support: VIEW,
  },
  accounting: {
    dashboard: VIEW,
    customers: VIEW,
    commissions: ALL,
    billing: CRUD_NO_DEL,
    reports: VIEW,
    support: VIEW,
  },
  readonly: {
    dashboard: VIEW,
    customers: VIEW,
    demands: VIEW,
    properties: VIEW,
    matching: VIEW,
    portals: VIEW,
    leak: VIEW,
    appointments: VIEW,
    calls: VIEW,
    commissions: VIEW,
    tasks: VIEW,
    reports: VIEW,
    valuation: VIEW,
  },
};

/** Sadece varsayılan matrise bakar (tenant override'ı hesaba katmaz). Fallback/acil durum kontrolü için. */
export function hasPermission(role: string | null | undefined, mod: AppModule, action: AppAction) {
  const r = (role || "advisor") as AppRole;
  const allowed = DEFAULT_MATRIX[r]?.[mod] ?? [];
  return allowed.includes(action);
}

export function canAccessModule(role: string | null | undefined, mod: AppModule) {
  return hasPermission(role, mod, "view");
}
