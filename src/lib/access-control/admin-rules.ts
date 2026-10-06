/**
 * Yetkilendirme yönetimi SAF kuralları (DB yok, zaman dışarıdan gelir; vitest ile kilitli).
 *
 * Kim kimin kapsamını/istisnasını değiştirebilir?
 *  - Yalnız owner/gm (PERMISSION_EDITOR_ROLES ile aynı küme) yazar.
 *  - Kimse KENDİ kapsamını/istisnasını değiştiremez (kendini yükseltme yasağı; daraltma da kapalıdır:
 *    yönetici kendini verisinden kilitlemesin).
 *  - Ofis sahibinin kapsamını yalnız ofis sahibi değiştirir; owner/gm kapsamı "office" altına DÜŞÜRÜLEMEZ.
 *  - "platform" kapsamı ofisten atanmaz.
 *  - team → team_id, branch → branch_id zorunlu; `can_view_all_data` yalnız office kapsamında anlamlıdır.
 */
import { PERMISSION_EDITOR_ROLES, type TeamRole } from "@/lib/team/assignable-roles";
import { ASSIGNABLE_SCOPES, SCOPE_RANK, getDefaultScopeForRole } from "./scope-rules";
import type { AccessScope, ScopeOverride } from "./types";
import type { AppRole } from "@/lib/permissions";

export type Actor = { userId: string; role: string };
export type Target = { userId: string; role: string };

export type RuleResult = { ok: true } | { ok: false; reason: string };

export type ScopeInput = {
  scope_type: AccessScope;
  team_id: string | null;
  branch_id: string | null;
  can_view_all_data: boolean;
  can_edit_team_members: boolean;
  can_override_permissions: boolean;
  can_see_earnings: boolean;
};

const deny = (reason: string): RuleResult => ({ ok: false, reason });

export function isScopeEditorRole(role: string): boolean {
  return PERMISSION_EDITOR_ROLES.includes(role as TeamRole);
}

/** Owner/gm için taban kapsam: altına inilemez. */
export function minimumScopeForRole(role: string): AccessScope {
  return role === "owner" || role === "gm" ? "office" : "user";
}

export function canChangeScope(actor: Actor, target: Target, next: ScopeInput): RuleResult {
  if (!isScopeEditorRole(actor.role)) return deny("Kapsamı yalnız ofis sahibi ve genel müdür düzenler.");
  if (actor.userId === target.userId) return deny("Kendi kapsamınızı değiştiremezsiniz; başka bir yönetici yapmalı.");
  if (target.role === "owner" && actor.role !== "owner") return deny("Ofis sahibinin kapsamını yalnız ofis sahibi değiştirir.");
  if (!ASSIGNABLE_SCOPES.includes(next.scope_type)) return deny("Bu kapsam türü ofisten atanamaz.");
  if (SCOPE_RANK[next.scope_type] < SCOPE_RANK[minimumScopeForRole(target.role)]) {
    return deny("Ofis sahibi ve genel müdür kapsamı ofis genelinin altına düşürülemez.");
  }
  if (next.scope_type === "team" && !next.team_id) return deny("Takım kapsamı için bir takım seçin.");
  if (next.scope_type === "branch" && !next.branch_id) return deny("Şube kapsamı için bir şube seçin.");
  if (next.can_view_all_data && next.scope_type !== "office") {
    return deny("“Tüm ofis verisini görür” yalnız ofis geneli kapsamla birlikte verilebilir.");
  }
  if (next.can_override_permissions && !isScopeEditorRole(target.role)) {
    return deny("İzin istisnası tanımlama yetkisi yalnız ofis sahibi/genel müdür rolüne verilebilir.");
  }
  return { ok: true };
}

/** Kapsam türüne uymayan bağlam alanlarını temizler (team olmayan satırda team_id taşınmaz vb.). */
export function normalizeScopeInput(input: ScopeInput): ScopeInput {
  return {
    ...input,
    team_id: input.scope_type === "team" ? input.team_id : null,
    branch_id: input.scope_type === "branch" ? input.branch_id : null,
  };
}

/** Rol varsayılanından sapıyor mu? (tabloda "özel" rozeti). */
export function isCustomScope(role: string, scope: Pick<ScopeInput, "scope_type">): boolean {
  return scope.scope_type !== getDefaultScopeForRole(role as AppRole);
}

/** Ofisten atanabilir kapsam türü (platform hariç). */
export type AssignableScope = Exclude<AccessScope, "platform">;

/** İstisna ekranında seçilebilen kaynak türleri ("portfolio" eski eş anlamlı; yeni kayıt "property" ile yazılır). */
export const OVERRIDE_RESOURCE_TYPES = ["demand", "property", "deal", "commission"] as const;
export type OverrideResourceType = (typeof OVERRIDE_RESOURCE_TYPES)[number];
export const OVERRIDE_RESOURCE_LABELS: Record<ScopeOverride["resource_type"], string> = {
  demand: "Talep",
  property: "Portföy",
  portfolio: "Portföy",
  deal: "Anlaşma",
  commission: "Komisyon",
};

export const OVERRIDE_DEFAULT_DAYS = 30;
export const OVERRIDE_MAX_DAYS = 365;
export const OVERRIDE_REASON_MIN = 5;
export const OVERRIDE_REASON_MAX = 300;

export type OverrideInput = {
  resource_type: ScopeOverride["resource_type"];
  resource_id: string;
  allowed: boolean;
  reason: string;
  /** ISO; null = süresiz (yalnız yasaklama için kabul edilir). */
  expires_at: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canCreateOverride(actor: Actor, target: Target, input: OverrideInput, nowMs: number): RuleResult {
  if (!isScopeEditorRole(actor.role)) return deny("İstisnayı yalnız ofis sahibi ve genel müdür tanımlar.");
  if (actor.userId === target.userId) return deny("Kendinize istisna tanımlayamazsınız.");
  if (target.role === "owner") return deny("Ofis sahibi zaten tüm kayıtları görür; istisna tanımlanamaz.");
  if (!(OVERRIDE_RESOURCE_TYPES as readonly string[]).includes(input.resource_type)) return deny("Geçersiz kaynak türü.");
  if (!UUID_RE.test(input.resource_id)) return deny("Kaynak seçin.");
  const reason = input.reason.trim();
  if (reason.length < OVERRIDE_REASON_MIN) return deny(`Gerekçe zorunlu (en az ${OVERRIDE_REASON_MIN} karakter).`);
  if (reason.length > OVERRIDE_REASON_MAX) return deny(`Gerekçe en fazla ${OVERRIDE_REASON_MAX} karakter.`);
  if (input.expires_at === null) {
    if (input.allowed) return deny("Ek erişim izni süresiz olamaz; bitiş tarihi seçin.");
    return { ok: true };
  }
  const t = new Date(input.expires_at).getTime();
  if (Number.isNaN(t)) return deny("Geçerli bir bitiş tarihi girin.");
  if (t <= nowMs) return deny("Bitiş tarihi gelecekte olmalı.");
  if (t > nowMs + OVERRIDE_MAX_DAYS * 86_400_000) return deny(`Bitiş en fazla ${OVERRIDE_MAX_DAYS} gün sonrası olabilir.`);
  return { ok: true };
}

/** Varsayılan bitiş: bugünden N gün sonra (ISO). */
export function defaultOverrideExpiry(nowMs: number, days = OVERRIDE_DEFAULT_DAYS): string {
  return new Date(nowMs + days * 86_400_000).toISOString();
}

export function isOverrideExpired(expiresAt: string | null | undefined, nowMs: number): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  return !Number.isNaN(t) && t <= nowMs;
}

/** Kişi bazlı izin istisnası hedefi: kendine yazamaz, ofis sahibine yazılamaz, yalnız owner/gm yazar. */
export function canEditPermissionOverride(actor: Actor, target: Target): RuleResult {
  if (!isScopeEditorRole(actor.role)) return deny("Bu işlem için yetkiniz yok. Sadece ofis sahibi ve genel müdür izin matrisini düzenleyebilir.");
  if (actor.userId === target.userId) return deny("Kendi izinlerinizi değiştiremezsiniz; başka bir yönetici yapmalı.");
  if (target.role === "owner") return deny("Ofis sahibine istisna tanımlanamaz — her zaman tam yetkilidir.");
  return { ok: true };
}

/** Denetim günlüğü değişiklik türü etiketleri (ekran + CSV tek kaynak). */
export const AUDIT_CHANGE_LABELS: Record<string, string> = {
  scope_created: "Kapsam tanımlandı",
  scope_updated: "Kapsam güncellendi",
  scope_deleted: "Kapsam kaldırıldı",
  override_created: "İstisna eklendi",
  override_updated: "İstisna güncellendi",
  override_deleted: "İstisna iptal edildi",
  permission_granted: "İzin istisnası yazıldı",
  permission_revoked: "İzin istisnası kaldırıldı",
};
export const AUDIT_CHANGE_TYPES = Object.keys(AUDIT_CHANGE_LABELS);
