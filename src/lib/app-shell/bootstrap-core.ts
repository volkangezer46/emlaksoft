import { getPlan } from "@/lib/billing/plans";
import { isApprovalDeciderRole } from "@/lib/approvals";
import type { ModuleRow } from "@/lib/modules/logic";
import type { NavBadge, PlanUsageRow } from "@/lib/nav-badges";
import type { AppModule } from "@/lib/permissions";
import type { UserOverrideRow } from "@/lib/permissions-effective";

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
  usage: ShellUsageCounts;
  badges: ShellBadgeCounts;
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

  return {
    profile: { id, fullName: str(raw.profile.full_name) ?? "", role, tenantId },
    office,
    roleOverrides,
    userOverrides,
    modules,
    usage: {
      seats: count(raw.usage.seats),
      activeProperties: count(raw.usage.active_properties),
      customers: count(raw.usage.customers),
    },
    badges: {
      overdueTasks: count(raw.badges.overdue_tasks),
      pendingApprovals: count(raw.badges.pending_approvals),
    },
  };
}

/**
 * Yan menü "Kullanım" kartı satırları — `getPlanUsage` ile aynı anahtar/etiket/hedef ve aynı kural:
 * limitsiz (null) kalem hiç döndürülmez. Sayımlar RPC'den (kesin sayım) gelir.
 */
export function usageRowsFromCounts(plan: string | undefined, counts: ShellUsageCounts): PlanUsageRow[] {
  const limits = getPlan(plan ?? "office").limits;
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
 * rozeti yalnız `commissions` erişimi + karar yetkili rolle. Sıfır sayıda rozet çıkmaz.
 */
export function navBadgesFromCounts(args: { counts: ShellBadgeCounts; role: string | null | undefined; accessible: readonly AppModule[] }): NavBadge[] {
  const badges: NavBadge[] = [];
  if (args.accessible.includes("tasks") && args.counts.overdueTasks > 0) {
    badges.push({
      itemHref: "/app/gorevler",
      href: "/app/gorevler?filter=overdue&mine=1",
      count: args.counts.overdueTasks,
      label: "geciken görevin",
      tone: "danger",
    });
  }
  if (args.accessible.includes("commissions") && isApprovalDeciderRole(args.role) && args.counts.pendingApprovals > 0) {
    badges.push({
      itemHref: "/app/onaylar",
      href: "/app/onaylar?kim=bana",
      count: args.counts.pendingApprovals,
      label: "onayınızı bekleyen talebin",
      tone: "warn",
    });
  }
  return badges;
}
