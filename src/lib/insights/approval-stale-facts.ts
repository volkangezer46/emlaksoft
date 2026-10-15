import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import { APPROVAL_DECIDER_ROLES, canDecideApproval, type ApprovalStatus } from "@/lib/approvals";
import { mergeEffectivePermissions, type RoleOverrideRow, type UserOverrideRow } from "@/lib/permissions-merge";
import { InsightFactsUnavailable, isMissingSchemaError } from "@/lib/insights/facts";
import { APPROVAL_REMIND_HOURS, type ApprovalDecider, type ApprovalStaleFact } from "@/lib/insights/rules/approval-stale";

/**
 * approval_stale@1 olguları. `admin` engine'den gelir (istemci OLUŞTURULMAZ); tüm sorgular AÇIK tenant_id filtreli.
 * Talepler: durumu "bekliyor" olup en az {@link APPROVAL_REMIND_HOURS} saattir bekleyenler (sayfalı, üst sınırsız →
 * canlı küme güvenilir). Karar vericiler: actions/approvals.ts `approvalDeciderIds` ile AYNI kural (aktif yönetim
 * kademesi + etkin commissions:edit; ofis rol istisnası ve kişi istisnası dahil, owner'a kişi istisnası uygulanmaz).
 */
const PENDING: ApprovalStatus = "bekliyor";
const HOUR_MS = 3_600_000;

type Err = { message: string; code?: string };
type Row = {
  id: string;
  kind: string;
  title: string | null;
  requested_by: string | null;
  created_at: string;
  requester: { full_name: string | null } | { full_name: string | null }[] | null;
};

export async function loadApprovalStaleFacts(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<ApprovalStaleFact[]> {
  const cutoff = new Date(nowMs - APPROVAL_REMIND_HOURS * HOUR_MS).toISOString();
  const { data, error } = await fetchAllRowsKeepError<Row, Err>((from, to) =>
    admin
      .from("approval_requests")
      .select("id, kind, title, requested_by, created_at, requester:profiles!approval_requests_requested_by_fkey(full_name)")
      .eq("tenant_id", tenantId)
      .eq("status", PENDING)
      .lte("created_at", cutoff)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: Err | null }>,
  );
  if (error) {
    if (isMissingSchemaError(error)) throw new InsightFactsUnavailable("approval_requests");
    throw new Error(`approval_requests(approval_stale): ${error.code ?? "hata"}`);
  }
  return data.map((r) => {
    const p = Array.isArray(r.requester) ? r.requester[0] : r.requester;
    return {
      requestId: r.id,
      kind: r.kind,
      title: r.title,
      requestedBy: r.requested_by,
      requesterName: p?.full_name ?? null,
      createdAtMs: Date.parse(r.created_at),
    };
  });
}

export async function loadApprovalDeciders(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<ApprovalDecider[]> {
  const [managers, roleRows, userRows] = await Promise.all([
    admin.from("profiles").select("id, role").eq("tenant_id", tenantId).eq("is_active", true).in("role", [...APPROVAL_DECIDER_ROLES]),
    admin.from("tenant_role_permissions").select("role, module, action, allowed").eq("tenant_id", tenantId).eq("module", "commissions"),
    admin.from("user_permission_overrides").select("user_id, module, actions, expires_at").eq("tenant_id", tenantId).eq("module", "commissions"),
  ]);
  // İstisnalar okunamazsa yetkisi kaldırılmış birine kart gidebilir: güvenli taraf, bu tur kural çalışmaz.
  const failed = managers.error ?? roleRows.error ?? userRows.error;
  if (failed) throw new Error(`profiles/izinler(approval_stale): ${failed.code ?? "hata"}`);
  const roleOverrides = (roleRows.data ?? []) as (RoleOverrideRow & { role: string })[];
  const userOverrides = (userRows.data ?? []) as (UserOverrideRow & { user_id: string })[];
  return ((managers.data ?? []) as { id: string; role: string }[]).filter((m) =>
    canDecideApproval(
      m.role,
      mergeEffectivePermissions(
        m.role,
        roleOverrides.filter((r) => r.role === m.role),
        m.role === "owner" ? [] : userOverrides.filter((u) => u.user_id === m.id),
        nowMs,
      ),
    ),
  );
}
