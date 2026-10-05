import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { notifyPoolAssigned, notifyPoolBreach } from "./notify";
import { computeSuggestions, loadFallbackChain, loadPoolRule, toPoolProperty, type Db } from "./server";
import { decidePoolAction, slaState } from "./modes";

/**
 * SİSTEM ataması (method='auto' | 'fallback'): assign_pool_entry RPC'si bu yöntemleri yalnız service_role'e açar.
 * Bu dosya havuz için TEK createAdminClient kullanımıdır. Kayıt önce verilen ofise aitliği doğrulanır.
 */
export async function assignPoolEntryAsSystem(input: {
  tenantId: string;
  entryId: string;
  profileId: string;
  method: "auto" | "fallback";
  score: number | null;
  reason: string;
}): Promise<{ ok: boolean; propertyId?: string; error?: string }> {
  const admin = createAdminClient();
  const { data: own } = await admin
    .from("listing_pool_entries")
    .select("id, property_id, status")
    .eq("id", input.entryId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  if (!own || (own as { status?: string }).status !== "pending") return { ok: false, error: "Kayıt bekleyen durumda değil." };
  const { data, error } = await admin.rpc("assign_pool_entry", {
    p_entry_id: input.entryId,
    p_profile_id: input.profileId,
    p_method: input.method,
    p_reason: input.reason,
    p_score: input.score,
    p_detail: {},
  });
  if (error) {
    console.error("assignPoolEntryAsSystem", { code: error.code });
    return { ok: false, error: "Atama yapılamadı." };
  }
  return { ok: true, propertyId: String((data as { property_id?: string } | null)?.property_id ?? (own as { property_id: string }).property_id) };
}

async function propertyLabel(db: Db, tenantId: string, propertyId: string): Promise<{ label: string; row: Record<string, unknown> | null }> {
  const { data } = await db
    .from("properties")
    .select("id, property_code, title, property_type, transaction_type, province_id, district_id, neighborhood_id, list_price")
    .eq("id", propertyId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const row = (data ?? null) as Record<string, unknown> | null;
  return { label: row ? String(row.title || row.property_code || "İlan") : "İlan", row };
}

export type SweepSummary = { examined: number; autoAssigned: number; fallbackAssigned: number; escalated: number; slaBreached: number };

/**
 * Cron süpürmesi (service_role istemcisi dışarıdan verilir): bekleyen kayıtlarda
 *  1) süresi dolan sahiplenme -> yedek zincirden ilk uygun danışman (fallback) yoksa yönetime yükseltme (escalated),
 *  2) auto modda eşiği artık geçen kayıt -> otomatik atama,
 *  3) SLA'sı geçen kayıt -> bir kez sla_breached olayı + yönetici uyarısı.
 */
export async function runPoolSweep(admin: Db): Promise<SweepSummary> {
  const summary: SweepSummary = { examined: 0, autoAssigned: 0, fallbackAssigned: 0, escalated: 0, slaBreached: 0 };
  const nowMs = now();
  const { data, error } = await admin
    .from("listing_pool_entries")
    .select("id, tenant_id, property_id, source, rule_id, created_at, sla_due_at, claim_open_until")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error || !data) return summary;

  type Entry = {
    id: string;
    tenant_id: string;
    property_id: string;
    source: string;
    rule_id: string | null;
    created_at: string;
    sla_due_at: string | null;
    claim_open_until: string | null;
  };
  const entries = data as Entry[];
  const ids = entries.map((e) => e.id);
  const { data: past } = ids.length
    ? await admin.from("listing_pool_events").select("entry_id, event").in("entry_id", ids).in("event", ["sla_breached", "escalated"])
    : { data: [] as { entry_id: string; event: string }[] };
  const seen = new Set((past ?? []).map((p) => `${p.entry_id}:${p.event}`));

  for (const e of entries) {
    summary.examined++;
    try {
      const { label, row } = await propertyLabel(admin, e.tenant_id, e.property_id);
      if (!row) continue;
      const rule = await loadPoolRule(admin, e.tenant_id, e.source);
      const claimExpired = e.claim_open_until != null && Date.parse(e.claim_open_until) < nowMs;

      if (claimExpired) {
        const suggestions = await computeSuggestions(admin, e.tenant_id, toPoolProperty(row), nowMs, rule.id);
        const eligible = new Set(suggestions.filter((s) => !s.excluded).map((s) => s.profileId));
        const chain = await loadFallbackChain(admin, e.tenant_id, rule.id);
        const pick = chain.find((id) => eligible.has(id));
        if (pick && rule.escalate) {
          const res = await assignPoolEntryAsSystem({
            tenantId: e.tenant_id,
            entryId: e.id,
            profileId: pick,
            method: "fallback",
            score: suggestions.find((s) => s.profileId === pick)?.score ?? null,
            reason: "Sahiplenme süresi doldu; yedek zincirden atandı.",
          });
          if (res.ok) {
            summary.fallbackAssigned++;
            await notifyPoolAssigned(admin, { tenantId: e.tenant_id, actorId: null, assigneeId: pick, propertyId: e.property_id, label, method: "fallback" });
            continue;
          }
        }
        await admin.from("listing_pool_entries").update({ claim_open_until: null }).eq("id", e.id).eq("tenant_id", e.tenant_id);
        if (!seen.has(`${e.id}:escalated`)) {
          await admin.from("listing_pool_events").insert({
            tenant_id: e.tenant_id,
            entry_id: e.id,
            event: "escalated",
            detail: { reason: pick ? "Yükseltme kapalı" : "Yedek zincirde uygun danışman yok" },
          });
          await notifyPoolBreach(admin, { tenantId: e.tenant_id, label, kind: "escalated" });
          summary.escalated++;
        }
        continue;
      }

      if (rule.mode === "auto" && e.claim_open_until == null) {
        const suggestions = await computeSuggestions(admin, e.tenant_id, toPoolProperty(row), nowMs, rule.id);
        const decision = decidePoolAction({ mode: "auto", suggestions, minScore: rule.minScore, slaMinutes: rule.slaMinutes, nowMs });
        if (decision.kind === "auto_assign") {
          const res = await assignPoolEntryAsSystem({
            tenantId: e.tenant_id,
            entryId: e.id,
            profileId: decision.profileId,
            method: "auto",
            score: decision.score,
            reason: "Puan eşiği aşıldı; otomatik atandı.",
          });
          if (res.ok) {
            summary.autoAssigned++;
            await notifyPoolAssigned(admin, { tenantId: e.tenant_id, actorId: null, assigneeId: decision.profileId, propertyId: e.property_id, label, method: "auto" });
            continue;
          }
        }
      }

      const state = slaState({ dueMs: e.sla_due_at ? Date.parse(e.sla_due_at) : null, createdMs: Date.parse(e.created_at), nowMs });
      if (state === "breached" && !seen.has(`${e.id}:sla_breached`)) {
        await admin.from("listing_pool_events").insert({ tenant_id: e.tenant_id, entry_id: e.id, event: "sla_breached", detail: {} });
        await notifyPoolBreach(admin, { tenantId: e.tenant_id, label, kind: "sla" });
        summary.slaBreached++;
      }
    } catch (err) {
      console.error("runPoolSweep entry", { id: e.id }, err);
    }
  }
  return summary;
}
