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
  | "open_house"
  | "rentals"
  | "projects"
  | "network"
  | "surveys"
  | "earnings_all"
  | "office_center"
  | "prospecting";

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
        "rentals",
        "projects",
        "network",
        "surveys",
        "earnings_all",
        "office_center",
        "prospecting",
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
    rentals:      ALL,
    projects:     ALL,
    network:      ALL,
    surveys:      ALL,
    // Başkasının kazancını görme (belge 3e). DB permission_defaults seed: Faz 2 migration.
    earnings_all: VIEW,
    // Ofis Merkezi (DB seed: 20261006000500).
    office_center: ALL,
    // Sahibinden ilanlar (portföy avı; DB seed: 20261012002410).
    prospecting:  ALL,
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
    // WP2 (20261023040000): kendi kapsamındaki anlaşmayı açar/düzenler; "Kazanıldı" ve komisyon paylaşımı onaya gider
    // (lib/approval-mandatory.ts), komisyon defteri/fatura/ödeme linki `canWriteCommissionLedger` ister.
    commissions:  CRUD_NO_DEL,
    offers:       CRUD_NO_DEL,
    tasks:        ALL,
    team:         VIEW,
    support:      CRUD_NO_DEL,
    reports:      VIEW,
    valuation:    CRUD_NO_DEL,
    campaigns:    CRUD_NO_DEL,
    contracts:    CRUD_NO_DEL,
    rentals:      CRUD_NO_DEL,
    network:      CRUD_NO_DEL,
    surveys:      CRUD_NO_DEL,
    // DB seed'i (20260726000075) ile senkron: proje satış şube müdüründe tam yetki
    projects:     ALL,
    // DB seed'i (20261006000500) ile senkron: şube müdürü kendi şubesinde atama/düzenleme yapar, danışman ekleyemez.
    office_center: ["view", "edit"],
    prospecting:  ALL,
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
    // WP2 (20261023040000): yalnız KENDİ anlaşması/teklifi (kapsam: permission-data-scope `isDealSelfScopeRole`).
    commissions:  CRUD_NO_DEL,
    offers:       CRUD_NO_DEL,
    tasks:        ALL,
    support:      VIEW,
    valuation:    VIEW,
    campaigns:    VIEW,
    contracts:    CRUD_NO_DEL,
    surveys:      VIEW,
    // DB seed'i (20261006000500) ile senkron: takım lideri ofis merkezini yalnız görür.
    office_center: VIEW,
    prospecting:  ALL,
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
    // WP2 (20261023040000): yalnız KENDİ anlaşması/teklifi; "Kazanıldı" ve komisyon paylaşımı yönetici onayına gider.
    commissions:  CRUD_NO_DEL,
    offers:       CRUD_NO_DEL,
    tasks:        CRUD_NO_DEL,
    support:      VIEW,
    settings:     VIEW,
    reports:      VIEW,
    valuation:    VIEW,
    compliance:   VIEW,
    campaigns:    VIEW,
    contracts:    CRUD_NO_DEL,
    rentals:      VIEW,
    network:      VIEW,
    surveys:      VIEW,
    // DB seed'i (20260726000075) ile senkron
    projects:     CRUD_NO_DEL,
    prospecting:  CRUD_NO_DEL,
  },
  call_center: {
    dashboard: VIEW,
    customers: CRUD_NO_DEL,
    demands: CRUD_NO_DEL,
    calls: ALL,
    appointments: CRUD_NO_DEL,
    tasks: CRUD_NO_DEL,
    support: VIEW,
    surveys: VIEW,
    // Sahibinden ilanlar: arar, not ve sonuç kaydeder; silme/dönüştürme yok (sahip kararı).
    prospecting: CRUD_NO_DEL,
  },
  accounting: {
    dashboard: VIEW,
    customers: VIEW,
    commissions: ALL,
    billing: CRUD_NO_DEL,
    // Muhasebe (/app/finans) + aidat sayfaları aynı "expenses" modülünü kullanır (ayrı "dues" modülü YOK).
    // Finans v2 (2026-10-14): muhasebe rolü gelir/gider ekler ve düzenler, SİLMEZ/İPTAL ETMEZ (delete yok); ay kilidini
    // açamaz (yalnız owner/gm). DB kopyası: 20260826001700 (view) + 20261014001200_finance_ledger_v2_backfill.sql (create, edit).
    expenses: CRUD_NO_DEL,
    reports: VIEW,
    support: VIEW,
    surveys: VIEW,
    earnings_all: VIEW,
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
    surveys: VIEW,
    prospecting: VIEW,
    // Yardım / Destek sayfası (SK10 / B168, B189): tur bitişi Yardım'ı gösterir; salt okunur da açabilmeli.
    // DB kopyası: 20261016100200_trp_gm_guard_readonly_support.sql.
    support: VIEW,
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
