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

/**
 * Rol kümeleri — TEK kaynak (denetim B14). Başka yerde elle rol listesi yazma:
 *  - MANAGER_ROLES / OFFICE_WIDE_ROLES: ofis geneli veri kapsamı + rol atama yetkisi (owner, gm, branch_manager).
 *  - MANAGEMENT_TIER_ROLES: yönetim kademesi = ofis geneli + team_lead (onay kararı, randevu danışman filtresi).
 */
export const MANAGER_ROLES: readonly TeamRole[] = ["owner", "gm", "branch_manager"];
export const OFFICE_WIDE_ROLES: readonly TeamRole[] = MANAGER_ROLES;
/** Ofis geneli veri kapsamı: owner/gm/branch_manager tenant genelini, diğerleri kendi satırlarını görür.
 *  İstemci bileşenleri de kullanabilsin diye burada (sunucu bağımlılığı yok); permission-data-scope yeniden dışa aktarır. */
export function hasOfficeWideDataScope(role: string | null | undefined): boolean {
  return OFFICE_WIDE_ROLES.includes(role as TeamRole);
}

export const MANAGEMENT_TIER_ROLES: readonly TeamRole[] = [...MANAGER_ROLES, "team_lead"];
/**
 * Onay kapısı (ofis kontrol) muafiyeti: yalnız owner/gm kendi işlemini bekletmeden yapar (HAFIZA.md §7).
 * branch_manager ve team_lead muaf DEĞİLDİR; onay talebi açarlar. Karar verebilen roller AYRI kümedir:
 * `APPROVAL_DECIDER_ROLES` (@/lib/approvals).
 */
export const APPROVAL_EXEMPT_ROLES: readonly TeamRole[] = ["owner", "gm"];
export function isApprovalExemptRole(role: string | null | undefined): boolean {
  return APPROVAL_EXEMPT_ROLES.includes(role as TeamRole);
}

/** İzin matrisini/istisnalarını düzenleyebilen roller (owner, gm). */
export const PERMISSION_EDITOR_ROLES: readonly TeamRole[] = ["owner", "gm"];

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
