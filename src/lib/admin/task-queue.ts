import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, trDayKey, trDayStartMs } from "@/lib/clock";
import { isCrmMissing } from "./platform-crm";
import { isPlaybookRule, type PlaybookRule, type TaskPriority } from "./cs-playbook-labels";

/**
 * PLATFORM PERSONELİ İŞ KUYRUĞU (PA-2, /admin/gorevler) — okuyucular. Kapı ÇAĞIRANDA (`requirePlatformModule("tenants")`);
 * istemci parametreyle gelir (bu dosya createAdminClient ÇAĞIRMAZ). Ofislerin müşteri verisi okunmaz.
 * Oyun kitabı sütunları (source_rule, priority) yoksa (migration bekliyor) eski sütunlarla okunur, rozetler çizilmez.
 */

export const TASK_TABS = [
  { id: "benim", label: "Bana atanan" },
  { id: "atanmamis", label: "Atanmamış" },
  { id: "geciken", label: "Geciken" },
  { id: "ekip", label: "Tüm açık" },
  { id: "tamamlanan", label: "Tamamlanan" },
  { id: "portfoy", label: "Ofislerim" },
] as const;
export type TaskTab = (typeof TASK_TABS)[number]["id"];

export function parseTaskTab(v: unknown): TaskTab {
  return TASK_TABS.some((t) => t.id === v) ? (v as TaskTab) : "benim";
}

export type QueueTask = {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  title: string;
  body: string | null;
  assigneeId: string | null;
  dueAt: string | null;
  status: "open" | "done";
  doneAt: string | null;
  createdAt: string;
  rule: PlaybookRule | null;
  priority: TaskPriority;
  score: number | null;
};

export type QueueCounts = { mine: number; mineOverdue: number; unassigned: number; overdue: number; dueToday: number; open: number };

type Db = {
  id: string;
  tenant_id: string | null;
  title: string;
  body: string | null;
  assignee_staff_id: string | null;
  due_at: string | null;
  status: string;
  done_at: string | null;
  created_at: string;
  source_rule?: string | null;
  priority?: string | null;
  tenant?: { name: string } | { name: string }[] | null;
};

const BASE_COLS = "id, tenant_id, title, body, assignee_staff_id, due_at, status, done_at, created_at, tenant:tenants!platform_tasks_tenant_id_fkey(name)";
const FULL_COLS = `${BASE_COLS}, source_rule, priority`;
const MISSING_COL = /42703|PGRST204|source_rule|priority/i;

function toQueueTask(t: Db, scores: ReadonlyMap<string, number>): QueueTask {
  const tenant = Array.isArray(t.tenant) ? t.tenant[0] : t.tenant;
  return {
    id: t.id,
    tenantId: t.tenant_id,
    tenantName: tenant?.name ?? null,
    title: t.title,
    body: t.body,
    assigneeId: t.assignee_staff_id,
    dueAt: t.due_at,
    status: t.status === "done" ? "done" : "open",
    doneAt: t.done_at,
    createdAt: t.created_at,
    rule: isPlaybookRule(t.source_rule) ? t.source_rule : null,
    priority: t.priority === "yuksek" ? "yuksek" : "normal",
    score: t.tenant_id ? (scores.get(t.tenant_id) ?? null) : null,
  };
}

export async function loadTaskQueue(
  admin: SupabaseClient,
  opts: { tab: Exclude<TaskTab, "portfoy">; staffId: string; rule: PlaybookRule | null; range: [number, number]; nowMs: number; focusId?: string | null },
): Promise<{ ready: boolean; rulesReady: boolean; rows: QueueTask[]; total: number; focus: QueueTask | null }> {
  const nowIso = new Date(opts.nowMs).toISOString();
  // Sekme süzgeci (liste ve üst sayılar aynı kümeyi verir: bkz. loadQueueCounts).
  const build = (cols: string, withRule: boolean) => {
    let q = admin.from("platform_tasks").select(cols, { count: "exact" });
    if (opts.tab === "tamamlanan") q = q.eq("status", "done");
    else {
      q = q.eq("status", "open");
      if (opts.tab === "benim") q = q.eq("assignee_staff_id", opts.staffId);
      if (opts.tab === "atanmamis") q = q.is("assignee_staff_id", null);
      if (opts.tab === "geciken") q = q.lt("due_at", nowIso);
    }
    if (withRule && opts.rule) q = q.eq("source_rule", opts.rule);
    q = opts.tab === "tamamlanan" ? q.order("done_at", { ascending: false, nullsFirst: false }) : q.order("due_at", { ascending: true, nullsFirst: false });
    return q.order("created_at", { ascending: false }).range(...opts.range);
  };
  let rulesReady = true;
  let res = await build(FULL_COLS, true);
  if (res.error && MISSING_COL.test(`${res.error.code ?? ""} ${res.error.message ?? ""}`) && !isCrmMissing(res.error)) {
    rulesReady = false;
    res = await build(BASE_COLS, false);
  }
  if (res.error) return { ready: !isCrmMissing(res.error), rulesReady, rows: [], total: 0, focus: null };

  const raw = (res.data ?? []) as unknown as Db[];
  let focusRaw: Db | null = null;
  if (opts.focusId) {
    const f = await admin.from("platform_tasks").select(rulesReady ? FULL_COLS : BASE_COLS).eq("id", opts.focusId).maybeSingle();
    focusRaw = (f.data as unknown as Db | null) ?? null;
  }
  const tenantIds = [...new Set([...raw, ...(focusRaw ? [focusRaw] : [])].map((t) => t.tenant_id).filter((v): v is string => Boolean(v)))];
  const scores = new Map<string, number>();
  if (tenantIds.length) {
    const { data } = await admin.from("platform_tenant_crm").select("tenant_id, health_score").in("tenant_id", tenantIds);
    for (const c of (data ?? []) as { tenant_id: string; health_score: number | null }[]) if (c.health_score != null) scores.set(c.tenant_id, c.health_score);
  }
  return {
    ready: true,
    rulesReady,
    rows: raw.map((t) => toQueueTask(t, scores)).filter((t) => t.id !== opts.focusId),
    total: res.count ?? raw.length,
    focus: focusRaw ? toQueueTask(focusRaw, scores) : null,
  };
}

/** Üst gösterge sayıları (her biri ilgili sekmeye götürür). */
export async function loadQueueCounts(admin: SupabaseClient, staffId: string, nowMs: number): Promise<QueueCounts | null> {
  const nowIso = new Date(nowMs).toISOString();
  const endOfDay = new Date(nowMs + DAY_MS).toISOString();
  const head = () => admin.from("platform_tasks").select("id", { count: "exact", head: true }).eq("status", "open");
  const [mine, mineOverdue, unassigned, overdue, dueToday, open] = await Promise.all([
    head().eq("assignee_staff_id", staffId),
    head().eq("assignee_staff_id", staffId).lt("due_at", nowIso),
    head().is("assignee_staff_id", null),
    head().lt("due_at", nowIso),
    head().eq("assignee_staff_id", staffId).gte("due_at", nowIso).lt("due_at", endOfDay),
    head(),
  ]);
  if (mine.error) return null;
  return {
    mine: mine.count ?? 0,
    mineOverdue: mineOverdue.count ?? 0,
    unassigned: unassigned.count ?? 0,
    overdue: overdue.count ?? 0,
    dueToday: dueToday.count ?? 0,
    open: open.count ?? 0,
  };
}

// ---- Ofislerim (sorumlu olduğum ofisler) ---------------------------------------------------------------------------

export type OwnedAccount = {
  tenantId: string;
  name: string;
  status: string;
  plan: string | null;
  score: number | null;
  /** Son 7 günde skor değişimi (bugün − 7 gün önce); veri yoksa null. */
  delta7: number | null;
  periodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  openTickets: number;
  openTasks: number;
};

export async function loadOwnedAccounts(admin: SupabaseClient, staffId: string, nowMs: number): Promise<{ ready: boolean; rows: OwnedAccount[] }> {
  const { data, error } = await admin
    .from("platform_tenant_crm")
    .select("tenant_id, health_score, tenant:tenants!platform_tenant_crm_tenant_id_fkey(name, status, plan, trial_ends_at)")
    .eq("account_owner_staff_id", staffId)
    .limit(300);
  if (error) return { ready: !isCrmMissing(error), rows: [] };
  type Row = { tenant_id: string; health_score: number | null; tenant: { name: string; status: string; plan: string | null; trial_ends_at: string | null } | { name: string; status: string; plan: string | null; trial_ends_at: string | null }[] | null };
  const base = ((data ?? []) as unknown as Row[])
    .map((r) => ({ r, t: Array.isArray(r.tenant) ? r.tenant[0] : r.tenant }))
    .filter((x): x is { r: Row; t: NonNullable<typeof x.t> } => Boolean(x.t) && x.t!.status !== "cancelled");
  const ids = base.map((x) => x.r.tenant_id);
  if (ids.length === 0) return { ready: true, rows: [] };

  const weekAgo = trDayKey(nowMs - 7 * DAY_MS);
  const [hist, subs, tickets, tasks] = await Promise.all([
    // Ofis başına ≤8 gün: 100'lük parçalar PostgREST 1000 satır sınırının altında kalır.
    Promise.all(
      Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) =>
        admin.from("tenant_health_daily").select("tenant_id, day, score").in("tenant_id", ids.slice(i * 100, i * 100 + 100)).gte("day", weekAgo).order("day", { ascending: true }).limit(1000),
      ),
    ).then((parts) => ({ data: parts.flatMap((p) => (p.data ?? []) as { tenant_id: string; day: string; score: number }[]) })),
    admin.from("subscriptions").select("tenant_id, status, current_period_end, cancel_at_period_end, updated_at").in("tenant_id", ids),
    admin.from("support_tickets").select("tenant_id").in("tenant_id", ids).in("status", ["open", "in_progress", "waiting"]).limit(1000),
    admin.from("platform_tasks").select("tenant_id").in("tenant_id", ids).eq("status", "open").limit(1000),
  ]);
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  for (const h of hist.data) {
    if (!first.has(h.tenant_id)) first.set(h.tenant_id, h.score);
    last.set(h.tenant_id, h.score);
  }
  const sub = new Map<string, { status: string; current_period_end: string | null; cancel_at_period_end: boolean | null }>();
  for (const s of (subs.data ?? []) as { tenant_id: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean | null }[]) {
    const prev = sub.get(s.tenant_id);
    if (!prev || (s.status === "active" && prev.status !== "active")) sub.set(s.tenant_id, s);
  }
  const countBy = (rows: { tenant_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.tenant_id, (m.get(r.tenant_id) ?? 0) + 1);
    return m;
  };
  const ticketN = countBy(tickets.data as { tenant_id: string }[] | null);
  const taskN = countBy(tasks.data as { tenant_id: string }[] | null);
  const rows: OwnedAccount[] = base.map(({ r, t }) => {
    const f = first.get(r.tenant_id);
    const l = last.get(r.tenant_id);
    const s = sub.get(r.tenant_id);
    return {
      tenantId: r.tenant_id,
      name: t.name,
      status: t.status,
      plan: t.plan,
      score: r.health_score,
      delta7: f != null && l != null ? l - f : null,
      periodEnd: s?.current_period_end ?? null,
      trialEndsAt: t.trial_ends_at,
      cancelAtPeriodEnd: s?.cancel_at_period_end === true,
      openTickets: ticketN.get(r.tenant_id) ?? 0,
      openTasks: taskN.get(r.tenant_id) ?? 0,
    };
  });
  return { ready: true, rows: sortOwnedAccounts(rows) };
}

/** SAF: önce dikkat isteyen (iptal talebi, düşük skor, sert düşüş), sonra ada göre. */
export function sortOwnedAccounts(rows: readonly OwnedAccount[]): OwnedAccount[] {
  const weight = (a: OwnedAccount) => (a.cancelAtPeriodEnd ? 0 : 1000) + (a.score ?? 101) + Math.min(0, a.delta7 ?? 0);
  return [...rows].sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name, "tr"));
}

/** SAF: vade etiketi bağlamı (sunucuda hesaplanır, istemci saat okumaz). */
export function dueState(dueAt: string | null, nowMs: number): "none" | "overdue" | "today" | "later" {
  if (!dueAt) return "none";
  const t = Date.parse(dueAt);
  if (!Number.isFinite(t)) return "none";
  if (t < nowMs) return "overdue";
  return trDayKey(t) === trDayKey(nowMs) ? "today" : "later";
}

/** SAF: erteleme vadesi = TR takviminde `days` gün sonra 09:00 (gece yarısı hatırlatması olmaz). */
export function snoozeDueIso(nowMs: number, days: number): string {
  const start = trDayStartMs(nowMs + days * DAY_MS);
  return new Date(start + 9 * 3_600_000).toISOString();
}
