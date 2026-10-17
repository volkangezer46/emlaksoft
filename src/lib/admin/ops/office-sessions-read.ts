import "server-only";
import { createClient } from "@/lib/supabase/server";
import { toOfficeSessionRow, type OfficeSessionRow } from "./office-sessions";

/**
 * Ofis oturumları okuyucusu (SUNUCU, OTURUMLU istemci; service_role YOK). `platform_list_office_sessions` SECURITY
 * DEFINER RPC'si çağıranın (auth.uid()) members modülünü görüntüleme yetkisini kendisi denetler; sayfa ayrıca
 * `requirePlatformModule("members")` kapısından geçer. IP maskeli, user agent kırpılmış gelir; belirteç dönmez.
 */

export const OFFICE_SESSIONS_LIMIT = 300;

export type OfficeSessionsData = {
  /** false: RPC yok (migration bekliyor) ya da okunamadı. */
  ready: boolean;
  rows: OfficeSessionRow[];
  truncated: boolean;
};

export async function loadOfficeSessions(opts: { tenantId?: string | null } = {}): Promise<OfficeSessionsData> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("platform_list_office_sessions", {
      p_tenant_id: opts.tenantId ?? null,
      p_user_id: null,
      p_limit: OFFICE_SESSIONS_LIMIT,
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
