/**
 * Ekibe rol atama kuralı — TEK kaynak (actions/team.ts ve "Yeni danışman" sayfası aynı tabloyu kullanır).
 * Kural: yönetici yalnız KENDİ seviyesinin altındaki rolleri verir; `owner` hiçbir akıştan atanamaz.
 */
export type TeamRole =
  | "owner"
  | "gm"
  | "branch_manager"
  | "team_lead"
  | "advisor"
  | "call_center"
  | "accounting"
  | "readonly";

export const MANAGER_ROLES: readonly TeamRole[] = ["owner", "gm", "branch_manager"];

export const ASSIGNABLE_ROLES: readonly TeamRole[] = [
  "gm",
  "branch_manager",
  "team_lead",
  "advisor",
  "call_center",
  "accounting",
  "readonly",
];

export const ROLES_BY_MANAGER: Record<"owner" | "gm" | "branch_manager", readonly TeamRole[]> = {
  owner: ASSIGNABLE_ROLES,
  gm: ["branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"],
  branch_manager: ["team_lead", "advisor", "call_center", "accounting", "readonly"],
};

export function canManageRole(actorRole: string, targetRole: string): boolean {
  if (!MANAGER_ROLES.includes(actorRole as TeamRole)) return false;
  return ROLES_BY_MANAGER[actorRole as "owner" | "gm" | "branch_manager"].includes(targetRole as TeamRole);
}

/** Aktörün atayabileceği roller (yönetici değilse boş). */
export function assignableRolesFor(actorRole: string): readonly TeamRole[] {
  return MANAGER_ROLES.includes(actorRole as TeamRole)
    ? ROLES_BY_MANAGER[actorRole as "owner" | "gm" | "branch_manager"]
    : [];
}
