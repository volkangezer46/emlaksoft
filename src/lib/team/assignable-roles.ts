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

/**
 * Müşteri/ilan/başvuru ATANABİLEN satış rolleri — TEK kaynak (B070). Salt okunur, ofis muhasebe ve çağrı merkezi
 * danışman seçicilerinde görünmez; yeniden atama ve toplu atama sunucuda bu kümeyle doğrulanır. Başvuru dağıtımı
 * (lead-intake) ve ilan havuzu (pool/server) da bu listeyi kullanır.
 */
export const SALES_ASSIGNEE_ROLES: readonly TeamRole[] = ["owner", "gm", "branch_manager", "team_lead", "advisor"];

export function isSalesAssigneeRole(role: string | null | undefined): boolean {
  return SALES_ASSIGNEE_ROLES.includes(role as TeamRole);
}

/** Danışman seçici seçeneği. `featured`: bakanın kendi takımı ("Takımım" grubu; PersonSelect featuredIds). */
export type AssignableAdvisor = { id: string; full_name: string; featured?: boolean };

type ProfileRow = { id: string; full_name: string | null; role: string | null; team_id?: string | null };

/** Profil satırlarından atanabilir danışmanlar (saf; sunucu ve test aynı kural). Takım lideri için takımı öne alınır. */
export function toAssignableAdvisors(
  rows: readonly ProfileRow[],
  viewer?: { userId: string; role: string | null | undefined; teamId?: string | null },
): AssignableAdvisor[] {
  // Takım lideri: kendi takımı (verilmediyse kendi profil satırından) "Takımım" olarak öne alınır.
  const teamId =
    viewer?.role === "team_lead" ? (viewer.teamId ?? rows.find((r) => r.id === viewer.userId)?.team_id ?? null) : null;
  return rows
    .filter((r) => isSalesAssigneeRole(r.role))
    .map((r) => ({
      id: r.id,
      full_name: r.full_name ?? "",
      ...(teamId && r.team_id === teamId ? { featured: true } : {}),
    }));
}

/** Supabase istemcisinin burada kullanılan yüzü (istemci güvenli modül: sunucu içe aktarımı yok). */
type ProfilesDb = {
  from: (table: "profiles") => {
    select: (cols: string) => {
      eq: (c: string, v: unknown) => {
        eq: (c: string, v: unknown) => {
          in: (c: string, v: readonly string[]) => {
            order: (c: string) => PromiseLike<{ data: unknown; error: unknown }>;
          };
        };
      };
    };
  };
};

/**
 * Ofisin AKTİF satış rolündeki kullanıcıları (danışman seçicileri: müşteri listesi toplu atama, müşteri kartı, içe aktarma).
 * `team_id` sütunu yoksa (eski şema) takım gruplaması olmadan döner.
 */
export async function loadAssignableAdvisors(
  db: unknown,
  tenantId: string,
  viewer?: { userId: string; role: string | null | undefined; teamId?: string | null },
): Promise<AssignableAdvisor[]> {
  const q = (cols: string) =>
    (db as ProfilesDb)
      .from("profiles")
      .select(cols)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .in("role", SALES_ASSIGNEE_ROLES)
      .order("full_name");
  let res = await q("id, full_name, role, team_id");
  if (res.error) res = await q("id, full_name, role");
  return toAssignableAdvisors((res.data ?? []) as ProfileRow[], viewer);
}
