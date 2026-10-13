import "server-only";
import { now } from "@/lib/clock";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACTIVE_STATUSES, planCollectorMerge, type MergePlan } from "./state";
import type { CollectorResult, IssueStatus, OptimizerSource, SiteIssue } from "./types";

/**
 * Büyüme Kokpiti deposu: `site_issues` ve `site_optimizer_actions` (yalnız service_role; RLS açık, politika yok).
 * Tablo yoksa (migration 20261013003000 uygulanmadı) okuma `available: false` döner, yazma sessizce atlanır: Kokpit
 * dürüst "kurulum bekliyor" gösterir, yayın akışı etkilenmez. Tüm sorgular TEK istemci yardımcısından geçer.
 */

const ISSUE_COLS =
  "id, area, url, code, severity, title, explain, fingerprint, collector, first_seen, last_seen, status, evidence, proposal, href, manual_only, publish_ref, resolved_at, ignored_by, ignored_reason";

type DbError = { code?: string; message?: string } | null;

/** 42P01: tablo yok (Postgres); PGRST205: şema önbelleğinde tablo yok (PostgREST); PGRST202/42883: RPC yok. */
export function isMissingRelation(error: DbError): boolean {
  if (!error) return false;
  return ["42P01", "PGRST205", "PGRST202", "42883"].includes(error.code ?? "") || /does not exist|could not find the table/i.test(error.message ?? "");
}

let tablesMissing = false;
let missingCheckedAt = 0;
const MISSING_RETRY_MS = 5 * 60_000;

function db() {
  return createAdminClient();
}

/** Tablo yok bilgisi 5 dk önbelleklenir (her yayında boşuna sorgu atılmaz); sonra yeniden denenir. */
function skipBecauseMissing(): boolean {
  return tablesMissing && now() - missingCheckedAt < MISSING_RETRY_MS;
}

function markMissing(error: DbError): boolean {
  if (!isMissingRelation(error)) return false;
  tablesMissing = true;
  missingCheckedAt = now();
  return true;
}

export type Readable<T> = { available: true; data: T } | { available: false; data: T; error?: string };

/* ---------- Bulgular ---------- */

const PAGE = 1000;
const MAX_PAGES = 5;

/** Toplayıcının tüm kayıtları (1000'lik sayfalarla; kaybolan bulgu hesabı eksik listeyle yapılmasın). */
async function listCollectorIssues(collector: string): Promise<SiteIssue[]> {
  const client = db();
  const out: SiteIssue[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await client
      .from("site_issues")
      .select(ISSUE_COLS)
      .eq("collector", collector)
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      markMissing(error);
      throw new Error(error.message ?? "site_issues okunamadı");
    }
    out.push(...((data ?? []) as SiteIssue[]));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

export type UpsertOutcome = { ok: true; counts: MergePlan["counts"] } | { ok: false; error: string; missing?: boolean };

/** Toplayıcı sonucunu kuyruğa işler (kurallar: state.ts planCollectorMerge). */
export async function upsertCollectorResult(result: CollectorResult): Promise<UpsertOutcome> {
  if (skipBecauseMissing()) return { ok: false, error: "Kokpit tabloları henüz kurulmadı.", missing: true };
  let existing: SiteIssue[];
  try {
    existing = await listCollectorIssues(result.collector);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "okunamadı", missing: tablesMissing };
  }
  const plan = planCollectorMerge(existing, result, new Date(now()).toISOString());
  const client = db();
  if (plan.inserts.length) {
    const { error } = await client.from("site_issues").upsert(plan.inserts, { onConflict: "fingerprint", ignoreDuplicates: true });
    if (error) return { ok: false, error: error.message ?? "yazılamadı", missing: markMissing(error) };
  }
  if (plan.updates.length) {
    const { error } = await client.from("site_issues").upsert(plan.updates, { onConflict: "id" });
    if (error) return { ok: false, error: error.message ?? "güncellenemedi" };
  }
  return { ok: true, counts: plan.counts };
}

/** Kokpit kuyruğu: açık + yoksayılmış bulgular (önem ve son görülmeye göre). */
export async function readQueueIssues(limit = 500): Promise<Readable<SiteIssue[]>> {
  if (skipBecauseMissing()) return { available: false, data: [] };
  const { data, error } = await db()
    .from("site_issues")
    .select(ISSUE_COLS)
    .in("status", [...ACTIVE_STATUSES, "yoksayildi"])
    .order("last_seen", { ascending: false })
    .limit(limit);
  if (error) return markMissing(error) ? { available: false, data: [] } : { available: false, data: [], error: error.message };
  return { available: true, data: (data ?? []) as SiteIssue[] };
}

export async function readIssuesByIds(ids: readonly string[]): Promise<SiteIssue[]> {
  if (!ids.length || skipBecauseMissing()) return [];
  const { data, error } = await db().from("site_issues").select(ISSUE_COLS).in("id", [...ids]);
  if (error) {
    markMissing(error);
    return [];
  }
  return (data ?? []) as SiteIssue[];
}

export type IssuePatch = Partial<Pick<SiteIssue, "status" | "publish_ref" | "ignored_by" | "ignored_reason" | "resolved_at">>;

export async function patchIssue(id: string, patch: IssuePatch, expected?: readonly IssueStatus[]): Promise<boolean> {
  if (skipBecauseMissing()) return false;
  let q = db().from("site_issues").update(patch).eq("id", id);
  if (expected?.length) q = q.in("status", [...expected]);
  const { data, error } = await q.select("id");
  if (error) {
    markMissing(error);
    return false;
  }
  return (data ?? []).length > 0;
}

/* ---------- İşlem kaydı ---------- */

export type OptimizerActionInput = {
  kind: string;
  source: OptimizerSource;
  target?: string;
  dryRun?: boolean;
  status: string;
  before?: unknown;
  after?: unknown;
  publishRef?: string | null;
  actor?: string | null;
};

export type OptimizerAction = {
  id: string;
  kind: string;
  source: OptimizerSource;
  target: string;
  dry_run: boolean;
  status: string;
  before: unknown;
  after: unknown;
  publish_ref: string | null;
  actor: string | null;
  created_at: string;
};

/** İşlem kaydı: hata asla fırlatılmaz (kayıt yazılamasa da asıl iş sürer). */
export async function recordOptimizerAction(input: OptimizerActionInput): Promise<boolean> {
  if (skipBecauseMissing()) return false;
  try {
    const { error } = await db()
      .from("site_optimizer_actions")
      .insert({
        kind: input.kind.slice(0, 64),
        source: input.source,
        target: (input.target ?? "").slice(0, 300),
        dry_run: Boolean(input.dryRun),
        status: input.status.slice(0, 32),
        before: input.before ?? null,
        after: input.after ?? null,
        publish_ref: input.publishRef ? input.publishRef.slice(0, 120) : null,
        actor: input.actor ?? null,
      });
    if (error) {
      markMissing(error);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

const ACTION_COLS = "id, kind, source, target, dry_run, status, before, after, publish_ref, actor, created_at";

/** Son işlemler (tür/kaynak/zaman süzgeçli). Tablo yoksa boş. */
export async function readActions(opts: { kinds?: readonly string[]; source?: OptimizerSource; target?: string; sinceIso?: string; limit?: number }): Promise<Readable<OptimizerAction[]>> {
  if (skipBecauseMissing()) return { available: false, data: [] };
  let q = db().from("site_optimizer_actions").select(ACTION_COLS).order("created_at", { ascending: false }).limit(opts.limit ?? 50);
  if (opts.kinds?.length) q = q.in("kind", [...opts.kinds]);
  if (opts.source) q = q.eq("source", opts.source);
  if (opts.target) q = q.eq("target", opts.target);
  if (opts.sinceIso) q = q.gte("created_at", opts.sinceIso);
  const { data, error } = await q;
  if (error) return markMissing(error) ? { available: false, data: [] } : { available: false, data: [], error: error.message };
  return { available: true, data: (data ?? []) as OptimizerAction[] };
}

/** Bakım: 180 gün/2 yıl budama (RPC yoksa 0). */
export async function pruneSiteIssues(): Promise<number> {
  const { data, error } = await db().rpc("site_issues_prune");
  if (error) {
    markMissing(error);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}
