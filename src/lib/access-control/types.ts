/**
 * Kapsam (scope) tabanlı erişim kontrol türleri.
 * Danışmanlar, takım liderleri, şube müdürleri ve ofis sahipleri
 * için hiyerarşik veri erişimi.
 */

/**
 * Scope türleri (hiyerarşi: user < team < branch < office < platform)
 */
export type AccessScope = "user" | "team" | "branch" | "office" | "platform";

/**
 * Kullanıcı kapsamı tanımı.
 * Her kullanıcı bu kapsamlar içinde bir profil sahibidir.
 */
export interface UserScope {
  user_id: string;
  scope_type: AccessScope;
  tenant_id: string;
  // Scope bağlamı
  branch_id?: string | null; // branch_manager, şube müdürü için
  team_id?: string | null; // team_lead, takım lideri için
  // Erişim
  can_view_all_data: boolean; // true = office/platform, false = kapsama göre
  can_edit_team_members: boolean;
  can_override_permissions: boolean;
  can_see_earnings: boolean;
}

/**
 * Kapsam override'ı (istisna).
 * Örn: Danışman X talep Y'yi görebilir (normalde göremez).
 */
export interface ScopeOverride {
  id: string;
  user_id: string;
  resource_type: "demand" | "property" | "portfolio" | "deal" | "commission";
  resource_id: string;
  tenant_id: string;
  allowed: boolean;
  reason?: string;
  created_at: string;
  created_by: string;
  expires_at?: string | null;
}

/**
 * Erişim karar sonucu.
 */
export interface AccessDecision {
  allowed: boolean;
  scope: AccessScope;
  reason?: string;
}

/**
 * Kapsam yetki kontrol konteksti.
 */
export interface ScopePermissionContext {
  userId: string;
  tenantId: string;
  userRole: string;
  userScope: AccessScope;
  userBranchId?: string | null;
  userTeamId?: string | null;
  targetResourceType:
    | "demand"
    | "property"
    | "portfolio"
    | "deal"
    | "commission"
    | "report"
    | "task";
  targetResourceId?: string;
  targetUserId?: string;
  targetBranchId?: string;
  targetTeamId?: string;
  action: "view" | "edit" | "delete" | "create" | "sign" | "reject" | "approve";
}

/**
 * Danışman kapsamlı erişim kuralları.
 */
export interface AdvisorAccessRule {
  // Talep (demand): Danışman sadece atandığı talepleri görebilir
  can_view_demand: boolean;
  // Portföy (property): Danışman sadece atandığı/müşteriye ait olanları görebilir
  can_view_property: boolean;
  // Anlaşma (deal): Talep sahibiyse veya takım lideri ünvanıysa görebilir
  can_view_deal: boolean;
  // Anlaşma imzalama: Talep sahibi ise yapabilir
  can_sign_deal: boolean;
  // Komisyon reddi: Takım lideri ise yapabilir
  can_reject_commission: boolean;
  // Rapor: Kendi verisi
  can_view_report: boolean;
}

/**
 * Takım lideri kapsamlı erişim kuralları.
 */
export interface TeamLeadAccessRule {
  // Takım verileri
  can_view_team_data: boolean;
  // Talep başı atama
  can_assign_demand_lead: boolean;
  // Komisyon onayı
  can_approve_commission: boolean;
  // Takım raporu
  can_view_team_report: boolean;
}

/**
 * Şube müdürü kapsamlı erişim kuralları.
 */
export interface BranchManagerAccessRule {
  can_view_branch_data: boolean;
  can_manage_branch_team: boolean;
  can_set_commission_rate: boolean;
  can_view_branch_earnings: boolean;
}
