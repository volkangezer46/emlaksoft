/**
 * Liste sorgularına kapsam süzgeci — SAF (Supabase'e bağımlı değil; `eq`/`in` olan her sorgu nesnesiyle çalışır).
 *
 * Kural: kapsam yalnız DARALTIR. Mevcut rol kuralı (`hasOfficeWideDataScope`, `scopeMine`) zaten "kendi
 * kayıtları" diyorsa kapsam onu genişletemez (`tightenScopeFilter`). office/platform = süzgeç yok (mevcut davranış).
 *  - user   → ownerColumn = self
 *  - team   → ownerColumn IN (takım üyeleri + self); takım bilinmiyorsa/boşsa self (fail-closed)
 *  - branch → ownerColumn IN (şube üyeleri + self); şube bilinmiyorsa/boşsa self
 */
import type { AccessScope, UserScope } from "./types";

export type ScopeFilter =
  | { kind: "none" }
  | { kind: "self"; userId: string }
  | { kind: "members"; ids: string[] };

/** PostgREST `in(...)` listesi için üst sınır; aşan büyük şube/takımda liste kesilmez, self + ilk N uygulanır. */
export const SCOPE_MEMBER_CAP = 500;

export function resolveScopeFilter(scope: Pick<UserScope, "scope_type" | "user_id" | "team_id" | "branch_id">, memberIds: readonly string[] | null): ScopeFilter {
  if (scope.scope_type === "office" || scope.scope_type === "platform") return { kind: "none" };
  if (scope.scope_type === "user") return { kind: "self", userId: scope.user_id };
  const contextId = scope.scope_type === "team" ? scope.team_id : scope.branch_id;
  if (!contextId || !memberIds || memberIds.length === 0) return { kind: "self", userId: scope.user_id };
  const ids = [...new Set([scope.user_id, ...memberIds])].slice(0, SCOPE_MEMBER_CAP);
  return { kind: "members", ids };
}

/** Eski "yalnız kendi kayıtları" kuralı kapsamdan daha darsa o kazanır; kapsam asla genişletmez. */
export function tightenScopeFilter(filter: ScopeFilter, legacy: { mineOnly: boolean; userId: string }): ScopeFilter {
  if (legacy.mineOnly) return { kind: "self", userId: legacy.userId };
  return filter;
}

type ScopeQuery = { eq(column: string, value: string): ScopeQuery; in(column: string, values: readonly string[]): ScopeQuery };

/**
 * Süzgeci sorguya uygular. `ownerColumn` gömülü alan da olabilir (`customer.assigned_to`; çağıran `!inner` gömmeyi kurar).
 * `kind: "none"` sorguyu değiştirmez. Yapısal tip: Supabase kurucusunun derin generiğine girmez (TS2589), zincir türü korunur.
 */
export function applyScopeFilter<Q>(query: Q, filter: ScopeFilter, opts: { ownerColumn: string }): Q {
  const q = query as unknown as ScopeQuery;
  switch (filter.kind) {
    case "none":
      return query;
    case "self":
      return q.eq(opts.ownerColumn, filter.userId) as unknown as Q;
    case "members":
      return q.in(opts.ownerColumn, filter.ids) as unknown as Q;
  }
}

/** Süzgeç veriyi daraltıyor mu? (rozet gösterimi için) */
export function isNarrowing(filter: ScopeFilter): boolean {
  return filter.kind !== "none";
}

/** Rozet metni: kapsam türü + bağlam adı; daraltmıyorsa null. */
export function scopeBadgeText(scopeType: AccessScope, filter: ScopeFilter, ctx: { teamName?: string | null; branchName?: string | null }): string | null {
  if (!isNarrowing(filter)) return null;
  if (filter.kind === "self") return "Kapsam: Kendi kayıtlarım";
  if (scopeType === "team") return `Kapsam: Takım${ctx.teamName ? ` (${ctx.teamName})` : ""}`;
  if (scopeType === "branch") return `Kapsam: Şube${ctx.branchName ? ` (${ctx.branchName})` : ""}`;
  return "Kapsam: Sınırlı";
}
