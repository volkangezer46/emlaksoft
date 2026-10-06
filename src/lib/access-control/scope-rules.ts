/**
 * Kapsam temelli erişim kontrol kuralları.
 * Role göre hangi kaynaklara erişim izni verilir.
 */

import type { AccessScope, ScopePermissionContext, AccessDecision } from "./types";
import type { AppRole } from "@/lib/permissions";

/**
 * Role göre varsayılan kapsam türü.
 */
export function getDefaultScopeForRole(role: AppRole): AccessScope {
  switch (role) {
    case "owner":
    case "gm":
      return "office";
    case "branch_manager":
      return "branch";
    case "team_lead":
      return "team";
    case "advisor":
    case "call_center":
      return "user";
    case "accounting":
    case "readonly":
      return "office";
    default:
      return "user";
  }
}

/**
 * Danışman talep erişim kontrol kuralı.
 * Danışman sadece:
 * 1. Atandığı talepleri görebilir
 * 2. Kendi talepleri görebilir
 * 3. Takım lideri tarafından atanmış talepleri görebilir
 */
export function canAdvisorAccessDemand(context: ScopePermissionContext): AccessDecision {
  const { userId, targetUserId, action } = context;

  // Danışman kendi verilerine her zaman erişebilir
  if (targetUserId === userId && action === "view") {
    return { allowed: true, scope: "user" };
  }

  // Danışman view dışında erişemez (normal permission matrix kontrolü yapılacak)
  if (action !== "view") {
    return { allowed: false, scope: "user", reason: "Danışman bu işlem için yetkilendirilmemiş" };
  }

  // Diğer kısıtlamalar resource-specific (demand_assigned_to, demand_owner_id vb) olmalı
  // Bu seviyede genel kural: user scope'ta başladık, daha spesifik kontrol DB RLS ile
  return { allowed: true, scope: "user" };
}

/**
 * Danışman portföy erişim kontrol kuralı.
 * Danışman sadece:
 * 1. Atandığı/ilgili oldığı portföyleri görebilir
 * 2. Kendi müşterilerine ait portföyleri görebilir
 */
export function canAdvisorAccessProperty(context: ScopePermissionContext): AccessDecision {
  const { userId, targetUserId, action } = context;

  // Kendi verilerine her zaman erişebilir
  if (targetUserId === userId && action === "view") {
    return { allowed: true, scope: "user" };
  }

  // Danışman view harici işlem yapamaz
  if (action !== "view") {
    return { allowed: false, scope: "user", reason: "Danışman portföy değiştiremez" };
  }

  // Spesifik kısıtlamalar DB RLS tarafından kontrol edilir
  return { allowed: true, scope: "user" };
}

/**
 * Anlaşma imzalama erişim kuralı.
 * Sadece:
 * 1. Talep sahibi (lead owner)
 * 2. Takım lideri (ünvanı varsa)
 * 3. Ofis yönetim (gm/owner)
 */
export function canSignDeal(context: ScopePermissionContext): AccessDecision {
  const { userRole, action } = context;

  if (action !== "sign") {
    return { allowed: false, scope: "user", reason: "Yalnızca imzalama işlemi yapılabilir" };
  }

  // GM, owner her zaman imzalayabilir
  if (userRole === "gm" || userRole === "owner") {
    return { allowed: true, scope: "office" };
  }

  // Takım lideri imzalayabilir (team scope)
  if (userRole === "team_lead") {
    return { allowed: true, scope: "team" };
  }

  // Danışman talep sahibiyse (DB'den kontrol edilecek)
  if (userRole === "advisor") {
    return { allowed: true, scope: "user" };
  }

  return { allowed: false, scope: "user", reason: "Anlaşma imzalama yetkiniz yok" };
}

/**
 * Komisyon reddi erişim kuralı.
 * Takım lideri ve üstü reddetebilir.
 */
export function canRejectCommission(context: ScopePermissionContext): AccessDecision {
  const { userRole, action } = context;

  if (action !== "reject") {
    return { allowed: false, scope: "user", reason: "Yalnızca reddetme işlemi yapılabilir" };
  }

  // Takım lideri ve üstü
  if (["owner", "gm", "branch_manager", "team_lead"].includes(userRole)) {
    return { allowed: true, scope: "team" };
  }

  return { allowed: false, scope: "user", reason: "Komisyon reddetme yetkiniz yok" };
}

/**
 * Rapor görüntüleme erişim kuralı.
 * Kendi verisi + yetki alanı.
 */
export function canViewReport(context: ScopePermissionContext): AccessDecision {
  const { userRole, userScope, action } = context;

  if (action !== "view") {
    return { allowed: false, scope: userScope, reason: "Raporlar salt-okunurdur" };
  }

  // Her rol kendi kapsamındaki raporu görebilir
  return { allowed: true, scope: userScope };
}

/**
 * Talep başı atama erişim kuralı (takım lideri).
 * Takım lideri, talep sahibini atayabilir.
 */
export function canAssignDemandLead(context: ScopePermissionContext): AccessDecision {
  const { userRole, userTeamId, targetTeamId, action } = context;

  if (action !== "edit") {
    return { allowed: false, scope: "team", reason: "Talep başı atama işlemi gereklidir" };
  }

  // Takım lideri sadece kendi takımındaki taleplere atama yapabilir
  if (userRole === "team_lead" && userTeamId === targetTeamId) {
    return { allowed: true, scope: "team" };
  }

  // GM/owner her zaman atama yapabilir
  if (userRole === "gm" || userRole === "owner") {
    return { allowed: true, scope: "office" };
  }

  return { allowed: false, scope: "user", reason: "Talep başı atama yetkiniz yok" };
}

/**
 * Şube müdürü saatlik raporlama kuralı.
 */
export function canViewBranchReport(context: ScopePermissionContext): AccessDecision {
  const { userRole, userBranchId, targetBranchId, action } = context;

  if (action !== "view") {
    return { allowed: false, scope: "branch", reason: "Raporlar salt-okunurdur" };
  }

  // Şube müdürü kendi şubesinin raporunu görebilir
  if (userRole === "branch_manager" && userBranchId === targetBranchId) {
    return { allowed: true, scope: "branch" };
  }

  // GM/owner tüm şubeyi görebilir
  if (userRole === "gm" || userRole === "owner") {
    return { allowed: true, scope: "office" };
  }

  return { allowed: false, scope: "branch", reason: "Bu şubenin raporunu görüntüleme yetkiniz yok" };
}

/**
 * Genel erişim kararı (context tarafından çağrılır).
 */
export function evaluateScopeAccess(context: ScopePermissionContext): AccessDecision {
  switch (context.targetResourceType) {
    case "demand":
      if (context.action === "view" && context.userRole === "advisor") {
        return canAdvisorAccessDemand(context);
      }
      break;

    case "property":
      if (context.action === "view" && context.userRole === "advisor") {
        return canAdvisorAccessProperty(context);
      }
      break;

    case "deal":
      if (context.action === "sign") {
        return canSignDeal(context);
      }
      if (context.action === "reject") {
        return canRejectCommission(context);
      }
      break;

    case "commission":
      if (context.action === "reject") {
        return canRejectCommission(context);
      }
      break;

    case "report":
      if (context.userScope === "branch") {
        return canViewBranchReport(context);
      } else {
        return canViewReport(context);
      }
      break;

    case "task":
      if (context.action === "edit") {
        return canAssignDemandLead(context);
      }
      break;
  }

  // Varsayılan: izin yok
  return { allowed: false, scope: context.userScope, reason: "Erişim yetkisi yok" };
}
