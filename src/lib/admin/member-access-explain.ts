/**
 * Etkin izin açıklayıcı (SAF — DB yok). Admin > Üye > Yetki ekranı "neden göremiyor?" sorusunu kaynağıyla yanıtlar:
 * her modül için üç katman (rol varsayılanı → ofisin rol ayarı → kişi istisnası) ayrı ayrı gösterilir ve SONUÇ
 * `mergeEffectivePermissions` ile hesaplanır (uygulamanın gerçek kapısıyla aynı fonksiyon; burada kural kopyası yok).
 * Kapsam (user_scopes) satırı yoksa rol varsayılanı geçerlidir (`scope-cache.ts` ile aynı düşüş).
 */
import { DEFAULT_MATRIX, type AppAction, type AppModule, type AppRole } from "@/lib/permissions";
import { isOverrideActive, mergeEffectivePermissions, type RoleOverrideRow, type UserOverrideRow } from "@/lib/permissions-effective";
import { defaultUserScopeForRole, SCOPE_LABELS } from "@/lib/access-control/scope-rules";
import type { AccessScope } from "@/lib/access-control/types";

export const ACTION_ORDER: readonly AppAction[] = ["view", "create", "edit", "delete"];
export const ACTION_LABELS: Record<AppAction, string> = { view: "görüntüleme", create: "ekleme", edit: "düzenleme", delete: "silme" };

/** Tüm rollerin matrisinde geçen modüller (sabit sıra: ilk görüldüğü yer). */
export const ALL_MODULES: readonly AppModule[] = (() => {
  const seen: AppModule[] = [];
  for (const role of Object.keys(DEFAULT_MATRIX) as AppRole[]) {
    for (const mod of Object.keys(DEFAULT_MATRIX[role]) as AppModule[]) if (!seen.includes(mod)) seen.push(mod);
  }
  return seen;
})();

export type ModuleDecider = "role" | "tenant_role" | "user" | "readonly_ceiling" | "unknown_role";

export type ModuleAccessRow = {
  module: AppModule;
  /** Rol varsayılanı (DEFAULT_MATRIX). */
  defaults: AppAction[];
  /** Ofisin rol ayarıyla eklenen / çıkarılan aksiyonlar. */
  roleAdded: AppAction[];
  roleRemoved: AppAction[];
  /** Kişi istisnası (varsa); `active=false` = süresi geçmiş, yok sayılıyor. Owner için hiç uygulanmaz. */
  userOverride: { actions: AppAction[]; expiresAt: string | null; active: boolean } | null;
  /** Etkin sonuç (uygulama kapısıyla aynı birleşim). */
  final: AppAction[];
  /** Sonucu belirleyen en üst katman. */
  decidedBy: ModuleDecider;
};

const sortActions = (list: Iterable<string>): AppAction[] =>
  ACTION_ORDER.filter((a) => Array.from(list).includes(a));

export function explainModuleAccess(input: {
  role: string;
  roleOverrides: readonly RoleOverrideRow[];
  userOverrides: readonly UserOverrideRow[];
  nowMs: number;
}): ModuleAccessRow[] {
  const role = input.role as AppRole;
  const defaults = DEFAULT_MATRIX[role];
  const effective = mergeEffectivePermissions(role, input.roleOverrides, input.userOverrides, input.nowMs);
  const userApplies = Boolean(defaults) && role !== "owner" && role !== "readonly";
  const roleApplies = Boolean(defaults) && role !== "readonly";

  return ALL_MODULES.map((mod) => {
    const base = sortActions(defaults?.[mod] ?? []);
    const rows = roleApplies ? input.roleOverrides.filter((r) => r.module === mod) : [];
    const roleAdded = sortActions(rows.filter((r) => r.allowed && !base.includes(r.action as AppAction)).map((r) => r.action));
    const roleRemoved = sortActions(rows.filter((r) => !r.allowed && base.includes(r.action as AppAction)).map((r) => r.action));
    const uo = userApplies ? input.userOverrides.find((r) => r.module === mod) : undefined;
    const userOverride = uo
      ? { actions: sortActions(uo.actions), expiresAt: uo.expires_at, active: isOverrideActive(uo, input.nowMs) }
      : null;
    const final = sortActions(effective[mod] ?? []);
    let decidedBy: ModuleDecider = "role";
    if (!defaults) decidedBy = "unknown_role";
    else if (role === "readonly") decidedBy = "readonly_ceiling";
    else if (userOverride?.active) decidedBy = "user";
    else if (roleAdded.length || roleRemoved.length) decidedBy = "tenant_role";
    return { module: mod, defaults: base, roleAdded, roleRemoved, userOverride, final, decidedBy };
  });
}

function actionList(actions: readonly AppAction[]): string {
  return actions.length ? actions.map((a) => ACTION_LABELS[a]).join(", ") : "hiçbiri";
}

/**
 * Tek satırlık insan dili: "Müşteriler: görüntüleme yok — kaynak: rol Danışman (varsayılan: görüntüleme, ekleme)
 * + kişi istisnası (yalnız hiçbiri)". `fmtDate` tarih biçimi çağırandan gelir (bileşen saat yardımcısı kullanır).
 */
export function describeModuleAccess(
  row: ModuleAccessRow,
  ctx: { moduleLabel: string; roleLabel: string; fmtDate?: (iso: string) => string },
): { summary: string; source: string } {
  const summary = row.final.includes("view")
    ? `${ctx.moduleLabel}: ${actionList(row.final)}`
    : `${ctx.moduleLabel}: görüntüleme yok (modül görünmez)`;

  if (row.decidedBy === "unknown_role") return { summary, source: `Kaynak: tanımsız rol "${ctx.roleLabel}" — güvenlik gereği hiçbir izin verilmez.` };
  if (row.decidedBy === "readonly_ceiling") {
    return { summary, source: `Kaynak: ${ctx.roleLabel} rolü sabit tavandır; ofis ayarı ve kişi istisnası uygulanmaz.` };
  }

  const parts = [`rol ${ctx.roleLabel} (varsayılan: ${actionList(row.defaults)})`];
  if (row.roleAdded.length) parts.push(`ofis rol ayarı (+${row.roleAdded.map((a) => ACTION_LABELS[a]).join(", +")})`);
  if (row.roleRemoved.length) parts.push(`ofis rol ayarı (−${row.roleRemoved.map((a) => ACTION_LABELS[a]).join(", −")})`);
  if (row.userOverride) {
    const until = row.userOverride.expiresAt && ctx.fmtDate ? `, bitiş ${ctx.fmtDate(row.userOverride.expiresAt)}` : "";
    parts.push(
      row.userOverride.active
        ? `kişi istisnası (yalnız ${actionList(row.userOverride.actions)}${until})`
        : `süresi geçmiş kişi istisnası (yok sayılıyor${until})`,
    );
  }
  return { summary, source: `Kaynak: ${parts.join(" + ")}` };
}

export type ScopeRowInput = {
  scope_type: AccessScope;
  team_id: string | null;
  branch_id: string | null;
  can_view_all_data: boolean;
  can_edit_team_members: boolean;
  can_override_permissions: boolean;
  can_see_earnings: boolean;
};

/** Kapsam açıklaması: satır yoksa rol varsayılanı (scope-cache ile aynı), varsa "özel" işaretiyle. */
export function explainScope(role: string, row: ScopeRowInput | null, ctx: { teamName?: string | null; branchName?: string | null } = {}) {
  const fallback = defaultUserScopeForRole(role as AppRole, { userId: "", tenantId: "" });
  const eff = row ?? {
    scope_type: fallback.scope_type,
    team_id: null,
    branch_id: null,
    can_view_all_data: fallback.can_view_all_data,
    can_edit_team_members: fallback.can_edit_team_members,
    can_override_permissions: fallback.can_override_permissions,
    can_see_earnings: fallback.can_see_earnings,
  };
  const label =
    eff.scope_type === "team" && ctx.teamName
      ? `${SCOPE_LABELS.team} (${ctx.teamName})`
      : eff.scope_type === "branch" && ctx.branchName
        ? `${SCOPE_LABELS.branch} (${ctx.branchName})`
        : SCOPE_LABELS[eff.scope_type];
  const flags = [
    eff.can_view_all_data ? "tüm ofis verisini görür" : null,
    eff.can_edit_team_members ? "ekip üyelerini düzenler" : null,
    eff.can_override_permissions ? "izin istisnası tanımlar" : null,
    eff.can_see_earnings ? "kazançları görür" : null,
  ].filter((x): x is string => Boolean(x));
  return {
    custom: Boolean(row),
    scope: eff,
    text: `${row ? "Özel kapsam" : "Rol varsayılanı"}: ${label}${flags.length ? ` · ${flags.join(", ")}` : ""}.`,
  };
}
