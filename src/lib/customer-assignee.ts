import { hasOfficeWideDataScope, isSalesAssigneeRole } from "@/lib/team/assignable-roles";
import { effectiveHasPermission, type EffectivePermissions } from "@/lib/permissions-merge";

/**
 * Yeni müşteride "Danışman" ve "Kaynak" alanlarının SAF kuralları (WP2; istemci + sunucu + test).
 *
 * Kural: müşteriyi BAŞKASINA atamak, başkasının kaydını düzenleyebilen kişinin işidir — ofis geneli veri kapsamı
 * (owner/gm/şube müdürü) + `customers:edit`. Danışman/takım lideri/çağrı merkezi kaydı hep kendisine açar (eski davranış);
 * formdan gelen `assigned_to` onlar için yok sayılmaz, REDDEDİLİR (sessiz düzeltme kullanıcıyı yanıltırdı).
 */
export function canAssignCustomerToOthers(role: string | null | undefined, perms: EffectivePermissions | null | undefined): boolean {
  return hasOfficeWideDataScope(role) && Boolean(perms) && effectiveHasPermission(perms as EffectivePermissions, "customers", "edit");
}

export type AssigneeDecision = { ok: true; assignedTo: string } | { ok: false; error: string };

export const ASSIGN_OTHERS_DENIED = "Müşteriyi başka bir danışmana yalnız yöneticiler atayabilir.";
export const ASSIGNEE_INVALID = "Seçilen danışman bu ofiste müşteri atanabilecek aktif bir üye değil.";

/**
 * İstenen atamayı karara bağlar. `target` istenen kişinin ofis kaydıdır (yoksa null): aktif ve satış rolünde olmalı.
 * Boş istek ya da kendisi = kendisine atanır.
 */
export function resolveCustomerAssignee(input: {
  requested: string | null | undefined;
  userId: string;
  canAssignOthers: boolean;
  target?: { id: string; role: string | null; is_active: boolean | null } | null;
}): AssigneeDecision {
  const requested = String(input.requested ?? "").trim();
  if (!requested || requested === input.userId) return { ok: true, assignedTo: input.userId };
  if (!input.canAssignOthers) return { ok: false, error: ASSIGN_OTHERS_DENIED };
  const t = input.target;
  if (!t || t.id !== requested || t.is_active === false || !isSalesAssigneeRole(t.role)) return { ok: false, error: ASSIGNEE_INVALID };
  return { ok: true, assignedTo: requested };
}

export type AssigneeCandidate = { id: string; name: string; role: string };
export type AssigneeSuggestion = { id: string; name: string; openCustomers: number };

/**
 * "Önerilen danışman" (yeni aday dağıtımıyla aynı sezgi, `lead-intake` pickAssignee): aktif satış üyeleri içinde
 * danışman/takım lideri öncelikli, en az müşterisi olan; eşitlikte ada göre (kararlı). Aday yoksa null.
 */
export function suggestLeastLoadedAssignee(
  members: readonly AssigneeCandidate[],
  ownerIds: readonly (string | null | undefined)[],
): AssigneeSuggestion | null {
  const sales = members.filter((m) => isSalesAssigneeRole(m.role));
  const front = sales.filter((m) => m.role === "advisor" || m.role === "team_lead");
  const pool = front.length > 0 ? front : sales;
  if (pool.length === 0) return null;
  const counts = new Map<string, number>(pool.map((m) => [m.id, 0]));
  for (const id of ownerIds) if (id && counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const best = [...pool].sort((a, b) => (counts.get(a.id)! - counts.get(b.id)!) || a.name.localeCompare(b.name, "tr-TR"))[0]!;
  return { id: best.id, name: best.name, openCustomers: counts.get(best.id) ?? 0 };
}

/** Kaynak değeri: tanım anahtarı biçimi (küçük harf, rakam, alt çizgi; ≤40). Boş/geçersiz = null (kaynak yazılmaz). */
export function normalizeCustomerSource(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return /^[a-z0-9_]{1,40}$/.test(v) ? v : null;
}
