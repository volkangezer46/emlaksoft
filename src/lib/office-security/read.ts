import type { SupabaseClient } from "@supabase/supabase-js";
import { readTenantSettings } from "@/lib/settings/tenant-read";
import {
  DEFAULT_EXPORT_ROLES_TEXT,
  EXPORT_ROLE_IDS,
  OFFICE_EXPORT_ROLES_KEY,
  OFFICE_IDLE_MINUTES_KEY,
  OFFICE_IP_ALLOWLIST_KEY,
  OFFICE_IP_OWNER_EXEMPT_KEY,
  OFFICE_MAX_HOURS_KEY,
  OFFICE_MFA_ROLES_KEY,
  OFFICE_NEW_DEVICE_ALERT_KEY,
  OFFICE_SECURITY_KEYS,
  normalizeExportRoles,
  parseRoleList,
} from "./policy";

/**
 * DG7 ekran okuyucuları (sunucu). Kendi istemcisini OLUŞTURMAZ: Ayarlar > Güvenlik oturumlu istemciyi (RLS: kendi
 * ofisi), Ofis 360 yetkili admin istemcisini verir; her sorgu `tenant_id`'yi açık parametre alır.
 */
export type OfficePolicyForm = {
  mfaRoles: string[];
  ipAllowlist: string;
  ipOwnerExempt: boolean;
  idleMinutes: number;
  maxHours: number;
  newDeviceAlert: boolean;
  /** Dışa aktarabilen roller (sahip her zaman dahil; varsayılan tüm roller). */
  exportRoles: string[];
};

export async function loadOfficePolicyForm(db: SupabaseClient, tenantId: string): Promise<OfficePolicyForm> {
  const v = await readTenantSettings(db, tenantId, OFFICE_SECURITY_KEYS);
  return {
    mfaRoles: parseRoleList(String(v[OFFICE_MFA_ROLES_KEY] ?? "")),
    ipAllowlist: String(v[OFFICE_IP_ALLOWLIST_KEY] ?? ""),
    ipOwnerExempt: v[OFFICE_IP_OWNER_EXEMPT_KEY] !== false,
    idleMinutes: Number(v[OFFICE_IDLE_MINUTES_KEY] ?? 0) || 0,
    maxHours: Number(v[OFFICE_MAX_HOURS_KEY] ?? 0) || 0,
    newDeviceAlert: v[OFFICE_NEW_DEVICE_ALERT_KEY] === true,
    exportRoles: normalizeExportRoles(String(v[OFFICE_EXPORT_ROLES_KEY] ?? DEFAULT_EXPORT_ROLES_TEXT)),
  };
}

/** Politika varsayılandan farklı mı (ekran özeti ve admin acil sıfırlama düğmesi için). */
export function policyIsActive(p: OfficePolicyForm): boolean {
  return p.mfaRoles.length > 0 || p.ipAllowlist.trim() !== "" || !p.ipOwnerExempt || p.idleMinutes > 0 || p.maxHours > 0 || p.newDeviceAlert || p.exportRoles.length < EXPORT_ROLE_IDS.length;
}

export type OfficeSessionRow = {
  sessionId: string;
  userId: string;
  name: string;
  role: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  userAgent: string | null;
  ip: string | null;
};

/** Ofisin açık oturumları (service_role RPC; RPC yoksa `pending`). */
export async function loadOfficeSessions(admin: SupabaseClient, tenantId: string): Promise<{ pending: boolean; rows: OfficeSessionRow[] }> {
  const [{ data, error }, { data: people }] = await Promise.all([
    admin.rpc("office_list_sessions", { p_tenant_id: tenantId }),
    admin.from("profiles").select("id, full_name, role").eq("tenant_id", tenantId).limit(1000),
  ]);
  if (error) return { pending: error.code === "PGRST202" || error.code === "42883", rows: [] };
  const byId = new Map(((people ?? []) as { id: string; full_name: string | null; role: string | null }[]).map((p) => [p.id, p]));
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const person = byId.get(String(r.user_id));
    return {
      sessionId: String(r.session_id),
      userId: String(r.user_id),
      name: person?.full_name?.trim() || "Kullanıcı",
      role: person?.role ?? null,
      createdAt: (r.created_at as string | null) ?? null,
      lastSeenAt: ((r.refreshed_at ?? r.updated_at ?? r.created_at) as string | null) ?? null,
      userAgent: (r.user_agent as string | null) ?? null,
      ip: (r.ip as string | null) ?? null,
    };
  });
  return { pending: false, rows };
}
