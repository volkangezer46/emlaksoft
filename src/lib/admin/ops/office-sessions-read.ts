import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { toOfficeSessionRow, type OfficeSessionRow } from "./office-sessions";

/**
 * Ofis oturumları okuyucusu (SUNUCU). `platform_list_office_sessions` (20261027010100) YALNIZ service_role'a açıktır:
 * çağıran sayfa önce `requirePlatformModule("members")` kapısından geçer ve personel kimliğini (`actorStaffId`) verir;
 * RPC bu personelin members modülünü görüntüleme yetkisini SQL'de yeniden denetler. IP maskeli, user agent kırpılmış
 * gelir; belirteç dönmez. `hideInternal`: demo/test ofisleri (tenants.is_internal) sunucuda süzülür.
 */

export const OFFICE_SESSIONS_LIMIT = 300;

export type OfficeSessionsData = {
  /** false: RPC yok (migration bekliyor) ya da okunamadı. */
  ready: boolean;
  rows: OfficeSessionRow[];
  truncated: boolean;
};

export async function loadOfficeSessions(opts: { actorStaffId: string; tenantId?: string | null; hideInternal?: boolean }): Promise<OfficeSessionsData> {
  try {
    const { data, error } = await createAdminClient().rpc("platform_list_office_sessions", {
      p_actor_staff_id: opts.actorStaffId,
      p_tenant_id: opts.tenantId ?? null,
      p_user_id: null,
      p_limit: OFFICE_SESSIONS_LIMIT,
      p_hide_internal: opts.hideInternal === true,
    });
    if (error) {
      console.error("loadOfficeSessions", error.code);
      return { ready: false, rows: [], truncated: false };
    }
    const rows = ((data ?? []) as Record<string, unknown>[]).map(toOfficeSessionRow).filter((r): r is OfficeSessionRow => r !== null);
    return { ready: true, rows, truncated: rows.length >= OFFICE_SESSIONS_LIMIT };
  } catch (e) {
    console.error("loadOfficeSessions", e instanceof Error ? e.message : e);
    return { ready: false, rows: [], truncated: false };
  }
}
