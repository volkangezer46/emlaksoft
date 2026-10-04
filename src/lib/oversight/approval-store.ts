import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { isManagerRole } from "@/lib/approvals";
import { loadApprovalRules } from "@/lib/oversight/store";
import type { ApprovalGateStore } from "@/lib/oversight/approval-gate";

/**
 * Onay kapisinin gercek deposu (RLS'li kullanici istemcisi; admin client YOK).
 * Talep, mevcut /app/onaylar akisindaki `approval_requests` tablosuna yazilir.
 */
export function createApprovalGateStore(): ApprovalGateStore {
  return {
    async loadRules(tenantId) {
      const supabase = await createClient();
      return loadApprovalRules(supabase, tenantId);
    },

    async isManager(tenantId, actorId) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", actorId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      return isManagerRole(data?.role);
    },

    async findOpen(tenantId, actorId, fingerprint) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("approval_requests")
        .select("id, status, decided_at")
        .eq("tenant_id", tenantId)
        .eq("requested_by", actorId)
        .in("status", ["bekliyor", "onaylandi"])
        .like("description", `[${fingerprint}]%`)
        .order("created_at", { ascending: false })
        .limit(5);
      const rows = (data ?? []) as { id: string; status: "bekliyor" | "onaylandi"; decided_at: string | null }[];
      // Bekleyen varsa o; yoksa en yeni onayli.
      const pending = rows.find((r) => r.status === "bekliyor");
      const row = pending ?? rows[0];
      return row ? { id: row.id, status: row.status, decidedAt: row.decided_at } : null;
    },

    async isConsumed(tenantId, approvalId) {
      const supabase = await createClient();
      const { count } = await supabase
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("action", "oversight.approval_consumed")
        .eq("entity_id", approvalId);
      return (count ?? 0) > 0;
    },

    async consume(tenantId, actorId, approvalId) {
      await logActivity({
        tenantId,
        actorId,
        action: "oversight.approval_consumed",
        entityType: "approval_request",
        entityId: approvalId,
      });
    },

    async create(tenantId, actorId, decision, payload, actionType) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("approval_requests")
        .insert({
          tenant_id: tenantId,
          kind: decision.kind,
          title: decision.title,
          description: `[${decision.fingerprint}] ${decision.reason}`,
          amount: decision.requestedValue,
          current_value: decision.currentValue,
          requested_value: decision.requestedValue,
          entity_type: payload.entityType ?? null,
          entity_id: payload.entityId && payload.entityType ? payload.entityId : null,
          status: "bekliyor",
          requested_by: actorId,
        })
        .select("id")
        .single();
      if (error || !data) return null;

      await logActivity({
        tenantId,
        actorId,
        action: "oversight.approval_requested",
        entityType: "approval_request",
        entityId: data.id,
        newValue: { action_type: actionType, reason: decision.reason },
      });

      // Ofis sahibi / genel mudur: bildirim (is akisini bloklayan karar istegi; tercih anahtari yok).
      const { data: managers } = await supabase
        .from("profiles")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .in("role", ["owner", "gm"]);
      await Promise.all(
        (managers ?? [])
          .filter((m) => m.id !== actorId)
          .map((m) =>
            notifyTenant({
              tenantId,
              userId: m.id,
              title: `Onay bekliyor: ${decision.title}`,
              body: decision.reason,
              href: "/app/onaylar?durum=bekliyor",
              kind: "warning",
            }).catch(() => undefined),
          ),
      );
      return { id: data.id };
    },
  };
}
