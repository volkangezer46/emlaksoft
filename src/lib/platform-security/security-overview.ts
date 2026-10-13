import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { BACKUP_STATUS_KEY, parseBackupRecord, type BackupRecord } from "@/lib/ops/backup-status";
import { RESTORE_DRILL_STATUS_KEY } from "@/lib/ops/backup-settings";
import { parseDrillRecord, type DrillRecord } from "@/lib/ops/restore-drill-status";
import { STEP_UP_REQUIRED_KEY } from "./step-up-policy";
import {
  ADMIN_IP_ALLOWLIST_KEY,
  DEFAULT_IDLE_MINUTES,
  DEFAULT_MAX_HOURS,
  SESSION_IDLE_MINUTES_KEY,
  SESSION_MAX_HOURS_KEY,
  parseAllowlist,
  parseMinutes,
} from "./admin-access";
import { parseSettingBool } from "@/lib/platform-setting-keys";

/**
 * AD11 Personel > Güvenlik politikası verileri (yalnız sunucu; çağıran `requirePlatformModule("personel")` sonrası).
 * Tablo/RPC yoksa (migration bekliyor) boş liste + `pending: true` döner; sahte değer üretilmez.
 */

export type AccessPolicyView = {
  allowlistRaw: string;
  ruleCount: number;
  idleMinutes: number;
  maxHours: number;
  stepUp: boolean;
  backup: BackupRecord | null;
  drill: DrillRecord | null;
};

export async function loadAccessPolicy(): Promise<AccessPolicyView> {
  const raw = await getPlatformSettingsMany([
    ADMIN_IP_ALLOWLIST_KEY,
    SESSION_IDLE_MINUTES_KEY,
    SESSION_MAX_HOURS_KEY,
    STEP_UP_REQUIRED_KEY,
    BACKUP_STATUS_KEY,
    RESTORE_DRILL_STATUS_KEY,
  ]);
  const allowlistRaw = raw[ADMIN_IP_ALLOWLIST_KEY] ?? "";
  return {
    allowlistRaw,
    ruleCount: parseAllowlist(allowlistRaw).rules.length,
    idleMinutes: parseMinutes(raw[SESSION_IDLE_MINUTES_KEY], DEFAULT_IDLE_MINUTES, 0, 1440),
    maxHours: parseMinutes(raw[SESSION_MAX_HOURS_KEY], DEFAULT_MAX_HOURS, 0, 168),
    stepUp: parseSettingBool(raw[STEP_UP_REQUIRED_KEY] ?? undefined, true),
    backup: parseBackupRecord(raw[BACKUP_STATUS_KEY]),
    drill: parseDrillRecord(raw[RESTORE_DRILL_STATUS_KEY]),
  };
}

export type StaffSessionRow = {
  sessionId: string;
  userId: string;
  name: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  userAgent: string | null;
  ip: string | null;
  aal: string | null;
};

export async function loadStaffSessions(): Promise<{ pending: boolean; rows: StaffSessionRow[] }> {
  const admin = createAdminClient();
  const [{ data, error }, { data: staff }] = await Promise.all([
    admin.rpc("platform_list_staff_sessions"),
    admin.from("platform_staff").select("id, full_name, email").limit(500),
  ]);
  if (error) return { pending: error.code === "PGRST202" || error.code === "42883", rows: [] };
  const names = new Map((staff ?? []).map((s) => [s.id as string, String(s.full_name || s.email || "")]));
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    sessionId: String(r.session_id),
    userId: String(r.user_id),
    name: names.get(String(r.user_id)) || "Personel",
    createdAt: (r.created_at as string | null) ?? null,
    lastSeenAt: ((r.refreshed_at ?? r.updated_at ?? r.created_at) as string | null) ?? null,
    userAgent: (r.user_agent as string | null) ?? null,
    ip: (r.ip as string | null) ?? null,
    aal: (r.aal as string | null) ?? null,
  }));
  return { pending: false, rows };
}

export type ImpersonationHistoryRow = {
  id: string;
  staffName: string;
  tenantId: string | null;
  tenantName: string;
  reason: string;
  ticketId: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endKind: string | null;
};

export async function loadImpersonationHistory(limit = 50): Promise<{ pending: boolean; rows: ImpersonationHistoryRow[] }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_impersonation_history")
    .select("id, staff_id, target_tenant_id, reason, ticket_id, started_at, expires_at, ended_at, end_kind")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) return { pending: error.code === "PGRST205" || error.code === "42P01", rows: [] };
  const list = (data ?? []) as Record<string, string | null>[];
  const staffIds = [...new Set(list.map((r) => r.staff_id).filter((v): v is string => Boolean(v)))];
  const tenantIds = [...new Set(list.map((r) => r.target_tenant_id).filter((v): v is string => Boolean(v)))];
  const [{ data: staff }, { data: tenants }] = await Promise.all([
    staffIds.length ? admin.from("platform_staff").select("id, full_name, email").in("id", staffIds) : Promise.resolve({ data: [] }),
    tenantIds.length ? admin.from("tenants").select("id, name").in("id", tenantIds) : Promise.resolve({ data: [] }),
  ]);
  const staffName = new Map(((staff ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((s) => [s.id, s.full_name || s.email || ""]));
  const tenantName = new Map(((tenants ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  return {
    pending: false,
    rows: list.map((r) => ({
      id: String(r.id),
      staffName: (r.staff_id && staffName.get(r.staff_id)) || "Silinmiş personel",
      tenantId: r.target_tenant_id,
      tenantName: (r.target_tenant_id && tenantName.get(r.target_tenant_id)) || "Silinmiş ofis",
      reason: String(r.reason ?? ""),
      ticketId: String(r.ticket_id ?? ""),
      startedAt: String(r.started_at),
      expiresAt: String(r.expires_at),
      endedAt: r.ended_at,
      endKind: r.end_kind,
    })),
  };
}

export async function countActiveSuperAdmins(): Promise<number | null> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("platform_staff")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin")
    .eq("is_active", true);
  return error ? null : (count ?? 0);
}
