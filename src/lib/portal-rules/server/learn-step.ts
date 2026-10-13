import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { RULE_LIMITS, validateRuleSet, type RuleSet } from "@/lib/portal-transfer/rule-format";
import { applyProposals, type RuleChange, type RuleProposal } from "@/lib/portal-transfer/rule-apply";
import { seedRuleSet } from "@/lib/portal-transfer/seed-rules";
import { TRANSFER_PORTALS, type TransferPortal } from "@/lib/portal-transfer/rules";
import { loadSigningKey, publishRuleSet, readPublished, type SigningKey, type SigningStatus } from "./sign";

/**
 * ÖĞRENME ADIMI (operational-retention cron'unun `portalRulesLearn` adımı; service_role istemcisi çağırandan gelir —
 * createAdminClient sayısı artmaz). Sıra:
 *  1. `pt_rules_learn(p_now)`: oylar, Wilson güveni, öneri durumları, geriletme adayları, katalog, form sürümleri.
 *  2. `auto_degrade` açıksa geriletme adayları (haftalık bütçe ≤3), `auto_publish` açıksa hazır ofis önerileri
 *     (AI önerisi ASLA) portal başına en çok 5 değişiklikle `applyProposals` + `validateRuleSet` + imza →
 *     `pt_rules_publish_system`. Varsayılan ikisi de KAPALI: öneriler personel onayını bekler.
 *     Öneriler TEK TEK uygulanır: uygulanamayan (risky_key, label_shared, ...) öneri atlanır ve
 *     `pt_rules_mark_invalid` ile 'rejected' olur (her gece yeniden seçilip tüm partiyi düşürmez).
 *  3. Süre tazeleme (K3): içerik değişikliği yayınlanmadıysa (öneri yok ya da hepsi düştü) ve yayındaki setin süresi
 *     7 günden az kaldıysa aynı içerik yeni sürümle yeniden imzalanır; imza anahtarı yoksa set süresi dolunca eklenti
 *     tohuma döner (güvenli).
 * Tablolar/fonksiyon yoksa 'skipped' döner, hata vermez.
 */

type Db = SupabaseClient;

const REFRESH_BEFORE_MS = 7 * 86_400_000;

type Candidate = { id: string; portal: string; kind: RuleProposal["kind"]; field_key: string | null; source: RuleProposal["source"]; proposal: Record<string, unknown>; confidence: number | null };
type LearnSummary = {
  outcome?: string;
  settings?: { auto_publish?: boolean; auto_degrade?: boolean };
  demote_budget?: number;
  ready?: Candidate[];
  demote_candidates?: Candidate[];
  eligible_tenants?: number;
  votes?: number;
  form_alerts?: number;
};

export type LearnStepResult =
  | { status: "skipped"; reason: string }
  | {
      status: "ok";
      eligibleTenants: number;
      votes: number;
      ready: number;
      demoteCandidates: number;
      formAlerts: number;
      published: { portal: string; version: number; changes: number; refresh: boolean }[];
      notPublished: { portal: string; reason: string }[];
    };

function toProposal(c: Candidate): RuleProposal {
  return { id: c.id, kind: c.kind, field_key: (c.field_key as RuleProposal["field_key"]) ?? null, source: c.source, proposal: c.proposal ?? {}, confidence: c.confidence };
}

export async function runPortalRulesLearn(
  admin: Db,
  opts: { nowMs: number; signing?: SigningStatus },
): Promise<LearnStepResult> {
  const { data, error } = await admin.rpc("pt_rules_learn", { p_now: new Date(opts.nowMs).toISOString() });
  if (error) {
    if (isMissingSchema(error)) return { status: "skipped", reason: "schema_pending" };
    throw new Error(`pt_rules_learn failed: ${error.code ?? "?"}`);
  }
  const s = (data ?? {}) as LearnSummary;
  const autoPublish = s.settings?.auto_publish === true;
  const autoDegrade = s.settings?.auto_degrade === true;
  const ready = Array.isArray(s.ready) ? s.ready : [];
  const demotes = Array.isArray(s.demote_candidates) ? s.demote_candidates : [];
  const published: { portal: string; version: number; changes: number; refresh: boolean }[] = [];
  const notPublished: { portal: string; reason: string }[] = [];

  const signing = opts.signing ?? loadSigningKey();
  const key: SigningKey | null = signing.ok ? signing.key : null;
  let demoteBudget = Math.max(0, Number(s.demote_budget ?? 0));

  for (const portal of TRANSFER_PORTALS) {
    const picks: RuleProposal[] = [];
    if (autoDegrade) {
      for (const d of demotes.filter((x) => x.portal === portal)) {
        if (demoteBudget <= 0 || picks.length >= 5) break;
        picks.push(toProposal(d));
        demoteBudget--;
      }
    }
    if (autoPublish) {
      for (const r of ready.filter((x) => x.portal === portal && x.source !== "ai")) {
        if (picks.length >= 5) break;
        picks.push(toProposal(r));
      }
    }

    let current: Awaited<ReturnType<typeof readPublished>>;
    try {
      current = await readPublished(admin, portal);
    } catch (e) {
      const pg = (e as { pg?: { code?: string; message?: string } }).pg;
      if (pg && isMissingSchema(pg)) return { status: "skipped", reason: "schema_pending" };
      throw e;
    }

    if (picks.length > 0) {
      if (!key) {
        notPublished.push({ portal, reason: "signing_unavailable" });
        continue;
      }
      const base = current ? validateRuleSet(current.content, { portal }) : null;
      if (base && !base.ok) {
        notPublished.push({ portal, reason: `current_invalid:${base.reason}` });
        continue;
      }
      let acc: RuleSet = base?.ok ? base.set : seedRuleSet(portal as TransferPortal);
      const changes: RuleChange[] = [];
      const appliedIds: string[] = [];
      const invalid = new Map<string, string[]>();
      for (const p of picks) {
        const one = applyProposals(acc, [p], { maxChanges: 1 });
        if (one.ok) {
          acc = one.content;
          changes.push(...one.changeSummary.changes);
          if (p.id) appliedIds.push(p.id);
        } else if (p.id) {
          invalid.set(one.reason, [...(invalid.get(one.reason) ?? []), p.id]);
        }
      }
      for (const [reason, ids] of invalid) {
        notPublished.push({ portal, reason: `proposal_invalid:${reason}` });
        const { error: markErr } = await admin.rpc("pt_rules_mark_invalid", { p_ids: ids, p_reason: reason });
        if (markErr && !isMissingSchema(markErr)) console.error("pt_rules_mark_invalid", { code: markErr.code });
      }
      if (changes.length > 0) {
        const res = await publishRuleSet(admin, {
          portal,
          content: acc,
          kind: "auto",
          parentId: current?.id ?? null,
          changeSummary: { changes, count: changes.length },
          proposalIds: appliedIds,
          nowMs: opts.nowMs,
          key,
        });
        if (res.ok) {
          published.push({ portal, version: res.version, changes: changes.length, refresh: false });
          continue;
        }
        notPublished.push({ portal, reason: res.reason });
      }
      // Hiçbir değişiklik yayınlanamadı: süre tazelemesi yine çalışır.
    }

    // Süre tazeleme: içerik aynı, yeni sürüm + yeni süre.
    if (current && Date.parse(current.expires_at) - opts.nowMs < REFRESH_BEFORE_MS) {
      if (!key) {
        notPublished.push({ portal, reason: "signing_unavailable" });
        continue;
      }
      const v = validateRuleSet(current.content, { portal });
      if (!v.ok) {
        notPublished.push({ portal, reason: `current_invalid:${v.reason}` });
        continue;
      }
      const res = await publishRuleSet(admin, {
        portal,
        content: v.set,
        kind: "auto",
        parentId: current.id,
        changeSummary: { refresh: true, count: 0, changes: [], ttlDays: RULE_LIMITS.ttlDays },
        nowMs: opts.nowMs,
        key,
      });
      if (res.ok) published.push({ portal, version: res.version, changes: 0, refresh: true });
      else notPublished.push({ portal, reason: res.reason });
    }
  }

  return {
    status: "ok",
    eligibleTenants: Number(s.eligible_tenants ?? 0),
    votes: Number(s.votes ?? 0),
    ready: ready.length,
    demoteCandidates: demotes.length,
    formAlerts: Number(s.form_alerts ?? 0),
    published,
    notPublished,
  };
}

/** `portalLearningRetention` adımı: saklama süreleri. Fonksiyon yoksa 'skipped'. */
export async function runPortalLearningRetention(admin: Db, opts: { nowMs: number }): Promise<unknown> {
  const { data, error } = await admin.rpc("pt_learning_retention", { p_now: new Date(opts.nowMs).toISOString() });
  if (error) {
    if (isMissingSchema(error)) return { status: "skipped", reason: "schema_pending" };
    throw new Error(`pt_learning_retention failed: ${error.code ?? "?"}`);
  }
  return data;
}
