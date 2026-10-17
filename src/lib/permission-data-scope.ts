import type { AppModule } from "@/lib/permissions";
import type { ScopeFilter } from "@/lib/access-control/query-scope";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import {
  effectiveCanAccessModule,
  effectiveHasPermission,
  getEffectivePermissions,
  type EffectivePermissions,
} from "@/lib/permissions-effective";

/** Tek kaynak `team/assignable-roles` (istemci güvenli); eski içe aktarma yolu için yeniden dışa aktarılır. */
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

// ---------------------------------------------------------------------------------------------------------------
// WP2 (20261023040000): danışman / takım lideri / şube müdürü kendi kapsamındaki anlaşma ve teklifi açar, düzenler.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Anlaşma/teklif YAZMA kapsamı "yalnız kendi kaydım" olan roller. Ofis geneli roller (owner/gm/branch_manager) ve
 * muhasebe (komisyonda tam yetki, ofis kapsamı) bunun dışındadır; geri kalan HER rol (bilinmeyen dahil) fail-closed
 * kendi kapsamına düşer. DB karşılığı birebir: `public.deal_write_self_only()` (20261023040000).
 */
const DEAL_OFFICE_SCOPE_ROLES: readonly string[] = ["owner", "gm", "branch_manager", "accounting"];
export function isDealSelfScopeRole(role: string | null | undefined): boolean {
  return !DEAL_OFFICE_SCOPE_ROLES.includes(String(role ?? ""));
}

/**
 * Komisyon DEFTERİ (tahsilat, paylaşımın doğrudan yazımı, ödeme linki, e-Fatura, kira/proje/portal kapanışının komisyon
 * kaydı, içe aktarma) yazabilen: ofis sahibi, genel müdür, muhasebe ya da ofisin `commissions:delete` (tam komisyon
 * yetkisi) verdiği rol. Danışman/takım lideri/şube müdürü varsayılan matriste anlaşma için `create/edit` taşır ama
 * deftere yazamaz. DB karşılığı: `public.commission_ledger_writer()` (20261023040000).
 */
const COMMISSION_LEDGER_ROLES: readonly string[] = ["owner", "gm", "accounting"];
export function canWriteCommissionLedger(
  role: string | null | undefined,
  perms: EffectivePermissions | null | undefined,
): boolean {
  if (COMMISSION_LEDGER_ROLES.includes(String(role ?? ""))) return true;
  return Boolean(perms) && effectiveHasPermission(perms as EffectivePermissions, "commissions", "delete");
}

/** Defter kapısının TEK ret metni (arayüz ve sözleşme testi bu ifadeyi bekler). */
export const COMMISSION_LEDGER_DENIED =
  "Komisyon defteri işlemleri (tahsilat, ödeme linki, fatura) ofis sahibi, genel müdür ya da muhasebe yetkisi ister.";

/**
 * Sunucu kapısı: `requirePermission("commissions", …)` geçtikten SONRA defter yazımı için çağrılır. null = izinli,
 * aksi halde kullanıcıya gösterilecek ret metni. Etkin izin istek içinde önbellekli (`getEffectivePermissions`).
 */
export async function commissionLedgerDenied(gate: { tenantId: string; role: string; userId: string }): Promise<string | null> {
  if (COMMISSION_LEDGER_ROLES.includes(gate.role)) return null;
  const perms = await getEffectivePermissions(gate.tenantId, gate.role, gate.userId);
  return canWriteCommissionLedger(gate.role, perms) ? null : COMMISSION_LEDGER_DENIED;
}

/**
 * Kayıt sahibi kapsamda mı (SAF): süzgeç yok = ofis geneli; self = sahiplerden biri kullanıcı; members = sahiplerden
 * biri üye listesinde. Sahip listesi boşsa (atanmamış kayıt) yalnız süzgeçsiz kapsam geçer.
 */
export function scopeFilterAllowsOwner(filter: ScopeFilter, owners: ReadonlyArray<string | null | undefined>): boolean {
  if (filter.kind === "none") return true;
  const ids = owners.filter((o): o is string => typeof o === "string" && o.length > 0);
  if (filter.kind === "self") return ids.includes(filter.userId);
  return ids.some((id) => filter.ids.includes(id));
}

/** Kapsam dışı kaydın TEK ret metni (kayıt varlığını sızdırmaz). */
export const OUT_OF_SCOPE_RECORD = "Bu kayıt sizin kapsamınızda değil; yalnız kendi müşteri ve anlaşmalarınızda işlem yapabilirsiniz.";

/**
 * Kullanıcının anlaşma/teklif YAZMA süzgeci (sunucu): liste sayfalarıyla aynı kural (`getListScope`), "yalnız kendi"
 * eski kuralı `isDealSelfScopeRole` ile. Ofis bayrağı açıksa şube müdürü kendi şubesine daralır.
 */
export async function dealWriteScopeFilter(gate: { userId: string; tenantId: string; role: string }): Promise<ScopeFilter> {
  // Ofis sahibi ve genel müdür her zaman ofis geneli (RLS scope_context de "off" döner): DB turu yok.
  if (gate.role === "owner" || gate.role === "gm") return { kind: "none" };
  // Tembel içe aktarma: kapsam çözümü ayar okuyucusunu (unstable_cache) yükler; bu modülün saf yardımcılarını kullanan
  // istemci dışı modüller (ve testleri) o zinciri yüklemesin.
  const { getListScope } = await import("@/lib/access-control/list-scope");
  const scope = await getListScope({
    userId: gate.userId,
    tenantId: gate.tenantId,
    role: gate.role,
    mineOnly: isDealSelfScopeRole(gate.role),
  });
  return scope.filter;
}

/**
 * Sayfa kapısı (yeni anlaşma / yeni teklif / ön dolgulu formlar): müşteri kullanıcının YAZMA kapsamında mı. Kayıt
 * görünmüyorsa da false (varlık sızmaz). Eylemler aynı kuralı ayrıca uygular (actions/deals.ts, actions/offers.ts).
 */
export async function customerInWriteScope(
  supabase: { from: (t: string) => unknown },
  gate: { userId: string; tenantId: string | null; role: string },
  customerId: string,
): Promise<boolean> {
  if (!gate.tenantId) return false;
  const filter = await dealWriteScopeFilter({ userId: gate.userId, tenantId: gate.tenantId, role: gate.role });
  if (filter.kind === "none") return true;
  type Q = { select: (c: string) => Q; eq: (c: string, v: string) => Q; is: (c: string, v: null) => Q; maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> };
  const { data } = await (supabase.from("customers") as Q)
    .select("id, assigned_to, created_by")
    .eq("id", customerId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return false;
  return scopeFilterAllowsOwner(filter, [data.assigned_to as string | null, data.created_by as string | null]);
}
