import { resolvePlanDef, type PlanDef } from "@/lib/billing/plans";
import { canDecideApproval, isApprovalDeciderRole } from "@/lib/approvals";
import type { ModuleRow } from "@/lib/modules/logic";
import { OVERDUE_TASKS_HREF, OVERDUE_TASKS_LABEL, type NavBadge, type PlanUsageRow } from "@/lib/nav-badges";
import type { AppModule } from "@/lib/permissions";
import { mergeEffectivePermissions, type EffectivePermissions, type UserOverrideRow } from "@/lib/permissions-merge";

/**
 * `app_shell_bootstrap()` RPC yanıtının SAF tarafı (DB/React yok; vitest kapsamında).
 *
 * RPC ham satırlar döndürür; izin BİRLEŞİMİ (`mergeEffectivePermissions`), modül durumu (`resolveModuleState`),
 * kullanım kartları ve rozet kuralları kodda, mevcut tek kaynaklarıyla hesaplanır. Böylece SQL hiçbir iş kuralını
 * kopyalamaz; RPC yalnız "7 tur yerine 1 tur" taşıyıcısıdır.
 */

export type ShellOffice = {
  name?: string;
  plan?: string;
  status?: string;
  brand_color?: string | null;
  created_at?: string | null;
  slug?: string | null;
  trial_ends_at?: string | null;
  sample_seeded_at?: string | null;
};

export type RoleOverrideRow = { module: string; action: string; allowed: boolean };

export type ShellUsageCounts = { seats: number; activeProperties: number; customers: number };
export type ShellBadgeCounts = { overdueTasks: number; pendingApprovals: number };

export type ShellBootstrap = {
  profile: { id: string; fullName: string; role: string; tenantId: string };
  office: ShellOffice | null;
  roleOverrides: RoleOverrideRow[];
  userOverrides: UserOverrideRow[];
  modules: ModuleRow[];
  /** Kişisel gizli modüller (user_module_prefs). `null` = RPC bu alanı henüz döndürmüyor (migration yok) → eski okuma. */
  hiddenModules: string[] | null;
  /**
   * Çağıranın aktif platform_staff satırı (RLS: yalnız kendi satırı). `undefined` = RPC bu alanı henüz döndürmüyor
   * (migration yok) → eski ayrı okuma; `null` = aktif personel değil (ayrı tur atılmaz).
   */
  platformStaff: { id: string } | null | undefined;
  usage: ShellUsageCounts;
  badges: ShellBadgeCounts;
  /**
   * PERF-1: ofis büyüklüğü (aktif koltuk = `usage.seats`, aktif şube = `usage.active_branches`). `null` = RPC şube sayısını
   * henüz döndürmüyor (20261027030000 yok) → çağıran eski `getOfficeSize` head-count turuna düşer.
   */
  officeSize: { seats: number; branches: number } | null;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
};

/** Ham JSON → tipli kabuk verisi. Şekil bozuksa `null` (çağıran eski yola düşer; yarım veri kullanılmaz). */
export function parseShellBootstrap(raw: unknown): ShellBootstrap | null {
  if (!isObj(raw) || !isObj(raw.profile)) return null;
  const id = str(raw.profile.id);
  const role = str(raw.profile.role);
  const tenantId = str(raw.profile.tenant_id);
  if (!id || !role || !tenantId) return null;
  if (!isObj(raw.usage) || !isObj(raw.badges)) return null;

  const office: ShellOffice | null = isObj(raw.tenant)
    ? {
        name: str(raw.tenant.name),
        plan: str(raw.tenant.plan),
        status: str(raw.tenant.status),
        brand_color: strOrNull(raw.tenant.brand_color),
        created_at: strOrNull(raw.tenant.created_at),
        slug: strOrNull(raw.tenant.slug),
        trial_ends_at: strOrNull(raw.tenant.trial_ends_at),
        sample_seeded_at: strOrNull(raw.tenant.sample_seeded_at),
      }
    : null;

  const roleOverrides: RoleOverrideRow[] = [];
  for (const r of Array.isArray(raw.role_overrides) ? raw.role_overrides : []) {
    if (!isObj(r)) continue;
    const mod = str(r.module);
    const action = str(r.action);
    if (!mod || !action || typeof r.allowed !== "boolean") continue;
    roleOverrides.push({ module: mod, action, allowed: r.allowed });
  }

  const userOverrides: UserOverrideRow[] = [];
  for (const r of Array.isArray(raw.user_overrides) ? raw.user_overrides : []) {
    if (!isObj(r)) continue;
    const mod = str(r.module);
    if (!mod || !Array.isArray(r.actions)) continue;
    userOverrides.push({
      module: mod,
      actions: r.actions.filter((a): a is string => typeof a === "string"),
      expires_at: strOrNull(r.expires_at),
    });
  }

  const modules: ModuleRow[] = [];
  for (const r of Array.isArray(raw.modules) ? raw.modules : []) {
    if (!isObj(r)) continue;
    const key = str(r.module_key);
    if (!key || typeof r.enabled !== "boolean") continue;
    modules.push({ module_key: key, enabled: r.enabled, locked_by_platform: r.locked_by_platform === true });
  }

  const hiddenModules: string[] | null = Array.isArray(raw.hidden_modules)
    ? raw.hidden_modules.filter((k): k is string => typeof k === "string")
    : null;

  const platformStaff: { id: string } | null | undefined = "platform_staff" in raw
    ? isObj(raw.platform_staff) && str(raw.platform_staff.id) && raw.platform_staff.is_active === true
      ? { id: str(raw.platform_staff.id)! }
      : null
    : undefined;

  // Bekleyen onay rozeti yalnız KARAR VEREBİLENE (SK10 / B164: canDecideApproval = kademe + etkin commissions:edit).
  // Sayı burada sıfırlanır; böylece rozeti çizen her yol (navBadgesFromCounts) aynı kurala uyar.
  const canDecide = canDecideApproval(role, mergeEffectivePermissions(role, roleOverrides, userOverrides));

  return {
    profile: { id, fullName: str(raw.profile.full_name) ?? "", role, tenantId },
    office,
    roleOverrides,
    userOverrides,
    modules,
    hiddenModules,
    platformStaff,
    usage: {
      seats: count(raw.usage.seats),
      activeProperties: count(raw.usage.active_properties),
      customers: count(raw.usage.customers),
    },
    officeSize: "active_branches" in raw.usage
      ? { seats: count(raw.usage.seats), branches: count(raw.usage.active_branches) }
      : null,
    badges: {
      overdueTasks: count(raw.badges.overdue_tasks),
      pendingApprovals: canDecide ? count(raw.badges.pending_approvals) : 0,
    },
  };
}

/**
 * Yan menü "Kullanım" kartı satırları — `getPlanUsage` ile aynı anahtar/etiket/hedef ve aynı kural:
 * limitsiz (null) kalem hiç döndürülmez. Sayımlar RPC'den (kesin sayım) gelir. Adminden eklenen pakette limitler
 * `catalog` (getCatalogForPlan) kaydından okunur; taban kimlikte kod tanımı.
 */
export function usageRowsFromCounts(plan: string | undefined, counts: ShellUsageCounts, catalog?: readonly PlanDef[]): PlanUsageRow[] {
  const limits = resolvePlanDef(plan, catalog).limits;
  const rows: PlanUsageRow[] = [];
  if (limits.seats != null) rows.push({ key: "seats", label: "Kullanıcı", used: counts.seats, limit: limits.seats, href: "/app/ekip" });
  if (limits.activeProperties != null) {
    rows.push({ key: "properties", label: "Aktif ilan", used: counts.activeProperties, limit: limits.activeProperties, href: "/app/portfoyler" });
  }
  if (limits.customers != null) rows.push({ key: "customers", label: "Müşteri", used: counts.customers, limit: limits.customers, href: "/app/musteriler" });
  return rows;
}

/**
 * Menü rozetleri — `getNavBadges` ile aynı kurallar: geciken görev rozeti yalnız `tasks` erişimiyle; bekleyen onay
 * rozeti yalnız `commissions` erişimi + karar yetkisi (`canDecideApproval`; `perms` verilmezse kademe — sayı zaten
 * `parseShellBootstrap`'ta karar yetkisine göre sıfırlanır). Sıfır sayıda rozet çıkmaz.
 */
export function navBadgesFromCounts(args: {
  counts: ShellBadgeCounts;
  role: string | null | undefined;
  accessible: readonly AppModule[];
  perms?: EffectivePermissions;
}): NavBadge[] {
  const badges: NavBadge[] = [];
  if (args.accessible.includes("tasks") && args.counts.overdueTasks > 0) {
    badges.push({
      itemHref: "/app/gorevler",
      href: OVERDUE_TASKS_HREF,
      count: args.counts.overdueTasks,
      label: OVERDUE_TASKS_LABEL,
      tone: "danger",
    });
  }
  const decider = args.perms ? canDecideApproval(args.role, args.perms) : isApprovalDeciderRole(args.role);
  if (args.accessible.includes("commissions") && decider && args.counts.pendingApprovals > 0) {
    badges.push({
      itemHref: "/app/onaylar",
      href: "/app/onaylar?kim=bana",
      count: args.counts.pendingApprovals,
      label: "onay bekliyor",
      tone: "warn",
    });
  }
  return badges;
}
