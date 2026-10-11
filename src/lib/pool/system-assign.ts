import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { notifyPoolAssigned, notifyPoolBreach } from "./notify";
import { computeSuggestions, loadFallbackChain, loadPoolCandidates, loadPoolRule, toPoolProperty, type Db, type PoolRule } from "./server";
import { decidePoolAction, slaState } from "./modes";
import type { PoolCandidate } from "./score";

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

type PropertyRow = Record<string, unknown>;

const PROPERTY_CHUNK = 100;

/** Bekleyen kayıtların ilanları TOPLU okunur (kayıt başına sorgu yok); anahtar `tenant:property`. */
async function loadPropertiesBatch(db: Db, entries: { tenant_id: string; property_id: string }[]): Promise<{ rows: Map<string, PropertyRow>; failed: number }> {
  const rows = new Map<string, PropertyRow>();
  let failed = 0;
  const ids = [...new Set(entries.map((e) => e.property_id))];
  for (let i = 0; i < ids.length; i += PROPERTY_CHUNK) {
    const { data, error } = await db
      .from("properties")
      .select("id, tenant_id, property_code, title, property_type, transaction_type, province_id, district_id, neighborhood_id, list_price")
      .in("id", ids.slice(i, i + PROPERTY_CHUNK));
    if (error) {
      console.error("runPoolSweep properties", error.message);
      failed += 1;
      continue;
    }
    for (const r of (data ?? []) as PropertyRow[]) rows.set(`${String(r.tenant_id)}:${String(r.id)}`, r);
  }
  return { rows, failed };
}

const labelOf = (row: PropertyRow) => String(row.title || row.property_code || "İlan");

export type SweepSummary = {
  examined: number;
  autoAssigned: number;
  fallbackAssigned: number;
  escalated: number;
  slaBreached: number;
  /** Sorgu/atama/olay/bildirim hataları (heartbeat error). */
  failed: number;
  /** Bekleyen kayıt listesi tavanına (500) dayandı: kalanı sonraki turda. */
  truncated: boolean;
};

const ENTRY_LIMIT = 500;

/**
 * Cron süpürmesi (service_role istemcisi dışarıdan verilir): bekleyen kayıtlarda
 *  1) süresi dolan sahiplenme -> yedek zincirden ilk uygun danışman (fallback) yoksa yönetime yükseltme (escalated),
 *  2) auto modda eşiği artık geçen kayıt -> otomatik atama,
 *  3) SLA'sı geçen kayıt -> bir kez sla_breached olayı + yönetici uyarısı.
 *
 * Sorgu sayısı: ilanlar toplu, kural/yedek zincir/aday bağlamı ofis(+kural) başına BİR kez (önceden kayıt başına 3-15 sorgu).
 * Bildirimler `dedupeKey` taşır; her hata `failed` sayacına girer (sessiz yutma yok).
 */
export async function runPoolSweep(admin: Db): Promise<SweepSummary> {
  const summary: SweepSummary = { examined: 0, autoAssigned: 0, fallbackAssigned: 0, escalated: 0, slaBreached: 0, failed: 0, truncated: false };
  const nowMs = now();
  const { data, error } = await admin
    .from("listing_pool_entries")
    .select("id, tenant_id, property_id, source, rule_id, created_at, sla_due_at, claim_open_until")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(ENTRY_LIMIT);
  if (error) {
    console.error("runPoolSweep entries", error.message);
    summary.failed += 1;
    return summary;
  }
  if (!data) return summary;

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
  summary.truncated = entries.length >= ENTRY_LIMIT;
  const ids = entries.map((e) => e.id);
  let seen = new Set<string>();
  if (ids.length) {
    const { data: past, error: pastErr } = await admin
      .from("listing_pool_events")
      .select("entry_id, event")
      .in("entry_id", ids)
      .in("event", ["sla_breached", "escalated"]);
    if (pastErr) {
      // Geçmiş olay okunamazsa bildirim mükerrer riski var: bu turda uyarı/yükseltme yazma, hatayı say.
      console.error("runPoolSweep events", pastErr.message);
      summary.failed += 1;
    }
    seen = new Set((past ?? []).map((p: { entry_id: string; event: string }) => `${p.entry_id}:${p.event}`));
    if (pastErr) for (const id of ids) { seen.add(`${id}:escalated`); seen.add(`${id}:sla_breached`); }
  }

  const props = await loadPropertiesBatch(admin, entries);
  summary.failed += props.failed;

  // Ofis(+kaynak) kuralı ve ofis+kural aday bağlamı/yedek zinciri bir kez okunur.
  const rules = new Map<string, Promise<PoolRule>>();
  const ruleFor = (tenantId: string, source: string) => {
    const k = `${tenantId}:${source}`;
    if (!rules.has(k)) rules.set(k, loadPoolRule(admin, tenantId, source));
    return rules.get(k)!;
  };
  const contexts = new Map<string, Promise<{ candidates: PoolCandidate[]; officeAvgOpen: number }>>();
  const contextFor = (tenantId: string, ruleId: string | null) => {
    const k = `${tenantId}:${ruleId ?? ""}`;
    if (!contexts.has(k)) contexts.set(k, loadPoolCandidates(admin, tenantId, nowMs, ruleId));
    return contexts.get(k)!;
  };
  const chains = new Map<string, Promise<string[]>>();
  const chainFor = (tenantId: string, ruleId: string | null) => {
    const k = `${tenantId}:${ruleId ?? ""}`;
    if (!chains.has(k)) chains.set(k, loadFallbackChain(admin, tenantId, ruleId));
    return chains.get(k)!;
  };

  for (const e of entries) {
    summary.examined++;
    try {
      const row = props.rows.get(`${e.tenant_id}:${e.property_id}`) ?? null;
      if (!row) continue;
      const label = labelOf(row);
      const rule = await ruleFor(e.tenant_id, e.source);
      const claimExpired = e.claim_open_until != null && Date.parse(e.claim_open_until) < nowMs;

      if (claimExpired) {
        const suggestions = await computeSuggestions(admin, e.tenant_id, toPoolProperty(row), nowMs, rule.id, undefined, await contextFor(e.tenant_id, rule.id));
        const eligible = new Set(suggestions.filter((s) => !s.excluded).map((s) => s.profileId));
        const chain = await chainFor(e.tenant_id, rule.id);
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
            summary.failed += await notifyPoolAssigned(admin, { tenantId: e.tenant_id, actorId: null, assigneeId: pick, propertyId: e.property_id, label, method: "fallback", dedupeScope: e.id });
            continue;
          }
          summary.failed++;
        }
        const { error: clearErr } = await admin.from("listing_pool_entries").update({ claim_open_until: null }).eq("id", e.id).eq("tenant_id", e.tenant_id);
        if (clearErr) {
          summary.failed++;
          continue;
        }
        if (!seen.has(`${e.id}:escalated`)) {
          const { error: evErr } = await admin.from("listing_pool_events").insert({
            tenant_id: e.tenant_id,
            entry_id: e.id,
            event: "escalated",
            detail: { reason: pick ? "Yükseltme kapalı" : "Yedek zincirde uygun danışman yok" },
          });
          if (evErr) {
            summary.failed++;
            continue;
          }
          summary.failed += await notifyPoolBreach(admin, { tenantId: e.tenant_id, label, kind: "escalated", entryId: e.id });
          summary.escalated++;
        }
        continue;
      }

      if (rule.mode === "auto" && e.claim_open_until == null) {
        const suggestions = await computeSuggestions(admin, e.tenant_id, toPoolProperty(row), nowMs, rule.id, undefined, await contextFor(e.tenant_id, rule.id));
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
            summary.failed += await notifyPoolAssigned(admin, { tenantId: e.tenant_id, actorId: null, assigneeId: decision.profileId, propertyId: e.property_id, label, method: "auto", dedupeScope: e.id });
            continue;
          }
          summary.failed++;
        }
      }

      const state = slaState({ dueMs: e.sla_due_at ? Date.parse(e.sla_due_at) : null, createdMs: Date.parse(e.created_at), nowMs });
      if (state === "breached" && !seen.has(`${e.id}:sla_breached`)) {
        const { error: evErr } = await admin.from("listing_pool_events").insert({ tenant_id: e.tenant_id, entry_id: e.id, event: "sla_breached", detail: {} });
        if (evErr) {
          summary.failed++;
          continue;
        }
        summary.failed += await notifyPoolBreach(admin, { tenantId: e.tenant_id, label, kind: "sla", entryId: e.id });
        summary.slaBreached++;
      }
    } catch (err) {
      console.error("runPoolSweep entry", { id: e.id }, err);
      summary.failed++;
    }
  }
  return summary;
}
