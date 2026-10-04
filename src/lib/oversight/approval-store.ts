import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { daysFromNowIso } from "@/lib/clock";
import { loadApprovalRules } from "@/lib/oversight/store";
import type { ApprovalGateStore } from "@/lib/oversight/approval-gate";

const nowIso = () => daysFromNowIso(0);

/** consumed_at sutunu yok (S2 migration'i uygulanmamis): PG 42703 / PostgREST PGRST204 / sema onbellegi. */
function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return error.code === "42703" || error.code === "PGRST204" || (msg.includes("consumed_at") && (msg.includes("column") || msg.includes("schema cache")));
}

/**
 * Onay kapisinin gercek deposu (RLS'li kullanici istemcisi; admin client YOK).
 * Talep, mevcut /app/onaylar akisindaki `approval_requests` tablosuna yazilir.
 *
 * NOT: Bu kapi YALNIZ UYGULAMA KATMANIDIR. Ayni tenant'in RLS'li kullanicisi veritabanina dogrudan
 * (PostgREST) yazarsa kapidan gecmez; DB tarafi korumasi ayri migration'dadir. Yonetici muafiyeti
 * yalniz owner/gm/branch_manager'dir (team_lead muaf degil).
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
      // Muafiyet DAR: yalniz ofis geneli roller (owner/gm/branch_manager). team_lead muaf DEGILDIR.
      return hasOfficeWideDataScope(data?.role);
    },

    async findOpen(tenantId, actorId, fingerprint) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("approval_requests")
        .select("id, status, decided_at, requested_value, current_value")
        .eq("tenant_id", tenantId)
        .eq("requested_by", actorId)
        .in("status", ["bekliyor", "onaylandi"])
        .like("description", `[${fingerprint}]%`)
        .order("created_at", { ascending: false })
        .limit(5);
      const rows = (data ?? []) as {
        id: string;
        status: "bekliyor" | "onaylandi";
        decided_at: string | null;
        requested_value: number | string | null;
        current_value: number | string | null;
      }[];
      // Bekleyen varsa o; yoksa en yeni onayli.
      const pending = rows.find((r) => r.status === "bekliyor");
      const row = pending ?? rows[0];
      if (!row) return null;
      const num = (v: number | string | null) => (v == null ? null : Number(v));
      return {
        id: row.id,
        status: row.status,
        decidedAt: row.decided_at,
        requestedValue: num(row.requested_value),
        currentValue: num(row.current_value),
      };
    },

    async isConsumed(tenantId, approvalId) {
      const supabase = await createClient();
      // consumed_at sutunu varsa (S2 migration'i) birincil kaynak odur; yoksa probe hatasi yok sayilir.
      const col = await supabase
        .from("approval_requests")
        .select("consumed_at")
        .eq("tenant_id", tenantId)
        .eq("id", approvalId)
        .maybeSingle();
      if (!col.error && (col.data as { consumed_at?: string | null } | null)?.consumed_at) return true;
      const { count, error } = await supabase
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("action", "oversight.approval_consumed")
        .eq("entity_id", approvalId);
      // Okunamiyorsa "tuketilmis" say (guvenli taraf: yeni onay istenir).
      if (error) return true;
      return (count ?? 0) > 0;
    },

    async consume(tenantId, actorId, approvalId) {
      const supabase = await createClient();
      // 1) Sutun varsa: TEK SATIRLIK atomik kosullu guncelleme (yaris kaybeden 0 satir alir).
      const upd = await supabase
        .from("approval_requests")
        .update({ consumed_at: nowIso() })
        .eq("tenant_id", tenantId)
        .eq("id", approvalId)
        .eq("status", "onaylandi")
        .is("consumed_at", null)
        .select("id");
      if (!upd.error) {
        if (!upd.data || upd.data.length !== 1) return false; // baska cagri tuketti
      } else if (!isMissingColumn(upd.error)) {
        return false; // beklenmeyen hata: tuketilemedi -> islem reddedilir
      }
      // 2) Denetim kaydi (sutun yoksa tuketimin kendisi bu kayittir). Yazilamazsa onay tuketilmis sayilir, islem reddedilir.
      const log = await logActivity({
        tenantId,
        actorId,
        action: "oversight.approval_consumed",
        entityType: "approval_request",
        entityId: approvalId,
      });
      return log.ok;
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
