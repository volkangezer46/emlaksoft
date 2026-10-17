import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { daysAgoIso, now, trDayKey } from "@/lib/clock";
import { isSchemaMissing } from "@/lib/platform-announcements/queue";
import { averageSeries, buildHealthRadar, dayKeyMinus, weeklyDays, type HealthRadar, type HealthRow } from "./health-radar";
import { summarizeLogins, twoFactorAdoption, type LoginEventRow, type LoginResult, type LoginSecuritySummary, type TwoFactorAdoption } from "./login-security";
import { CONSENT_CHANNELS, CONSENT_STATUSES, channelCoverage, consentActivity, type ChannelCoverage, type ConsentActivity, type ConsentCounts, type ConsentEventRow } from "./consent-coverage";
import { QUEUES, queueState, type QueueCounts, type QueueDef, type QueueState } from "./queue-health";
import { backupHealth, parseRetentionDetail, type BackupHealth, type BackupRunRow, type ParsedRetentionRun } from "./retention-catalog";
import { LISTING_STATES, listingProblemOffices, summarizePortalAccounts, type ListingState, type PortalAccountRow, type PortalKey, type PortalOverview } from "./portal-accounts";

/**
 * /admin OPERASYON OKUYUCULARI (yalnız sunucu, service_role). Her işlev sayfasının `requirePlatformModule` kapısından
 * SONRA çağrılır; platform geneli okur (ofis filtresi yok, satırlar `tenant_id` taşır ve yalnız ofis adına çevrilir).
 * Dış servis çağrılmaz. Tablo/kolon yoksa (migration bekliyor) ilgili bölüm `ready: false` ya da boş döner; sahte değer
 * üretilmez. Çok satırlı okumalar `readAllPaged` ile AÇIK üst sınırlıdır (`truncated`).
 */

type Admin = ReturnType<typeof createAdminClient>;
type Res<T> = { data: T[] | null; error: { message: string; code?: string } | null };

const NAME_CHUNK = 200;

/** Ofis kimlikleri → ad (yalnız gösterilen satırlar için; en çok birkaç yüz kimlik). */
async function officeNames(admin: Admin, ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const list = [...new Set([...ids].filter((v): v is string => Boolean(v)))];
  const out = new Map<string, string>();
  for (let i = 0; i < list.length; i += NAME_CHUNK) {
    const { data } = await admin.from("tenants").select("id, name").in("id", list.slice(i, i + NAME_CHUNK));
    for (const r of (data ?? []) as { id: string; name: string }[]) out.set(r.id, r.name);
  }
  return out;
}

const headCount = (r: { count: number | null; error: unknown }): number | null => (r.error ? null : (r.count ?? 0));

// ---------------------------------------------------------------------------
// Ofis sağlığı ve kayıp riski
// ---------------------------------------------------------------------------

export type HealthRadarData = {
  ready: boolean;
  radar: HealthRadar;
  series: { day: string; average: number }[];
  names: Map<string, string>;
  truncated: boolean;
};

type HealthDbRow = { day: string; tenant_id: string; score: number; usage_score: number; payment_score: number; support_score: number; inputs?: { reasons?: unknown } | null };

const toHealthRow = (r: HealthDbRow): HealthRow => ({
  tenantId: r.tenant_id,
  day: r.day,
  score: Number(r.score) || 0,
  usage: Number(r.usage_score) || 0,
  payment: Number(r.payment_score) || 0,
  support: Number(r.support_score) || 0,
  reasons: Array.isArray(r.inputs?.reasons) ? (r.inputs!.reasons as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 3) : undefined,
});

export async function loadHealthRadar(riskThreshold: number): Promise<HealthRadarData> {
  const admin = createAdminClient();
  const empty: HealthRadarData = { ready: true, radar: buildHealthRadar([], []), series: [], names: new Map(), truncated: false };
  const { data: head, error } = await admin.from("tenant_health_daily").select("day, tenant_id").order("day", { ascending: false }).limit(1);
  if (error) return { ...empty, ready: !isSchemaMissing(error) };
  const latestDay = (head?.[0] as { day?: string } | undefined)?.day;
  if (!latestDay) return empty;
  const compareDay = dayKeyMinus(latestDay, 7);
  const weeks = weeklyDays(latestDay, 8);
  const cols = "day, tenant_id, score, usage_score, payment_score, support_score";
  const [latest, previous, trend] = await Promise.all([
    readAllPaged<HealthDbRow>((from, to) => admin.from("tenant_health_daily").select(`${cols}, inputs`).eq("day", latestDay).order("tenant_id").range(from, to) as unknown as PromiseLike<Res<HealthDbRow>>, { maxRows: 10_000 }),
    readAllPaged<HealthDbRow>((from, to) => admin.from("tenant_health_daily").select(cols).eq("day", compareDay).order("tenant_id").range(from, to) as unknown as PromiseLike<Res<HealthDbRow>>, { maxRows: 10_000 }),
    readAllPaged<HealthDbRow>((from, to) => admin.from("tenant_health_daily").select("day, tenant_id, score").in("day", weeks).order("day").order("tenant_id").range(from, to) as unknown as PromiseLike<Res<HealthDbRow>>, { maxRows: 40_000 }),
  ]);
  const radar = buildHealthRadar(latest.rows.map(toHealthRow), previous.rows.map(toHealthRow), { riskThreshold });
  const names = await officeNames(admin, [...radar.decliners, ...radar.newlyRisky, ...radar.risky].map((m) => m.tenantId));
  return {
    ready: true,
    radar,
    series: averageSeries(trend.rows.map(toHealthRow)),
    names,
    truncated: latest.truncated || previous.truncated || trend.truncated,
  };
}

// ---------------------------------------------------------------------------
// Giriş güvenliği
// ---------------------------------------------------------------------------

export const LOGIN_WINDOW_DAYS = 7;

export type LoginSecurityData = {
  ready: boolean;
  summary: LoginSecuritySummary;
  twoFactor: TwoFactorAdoption;
  pending2fa: number | null;
  people: Map<string, { name: string; tenantId: string | null; active: boolean }>;
  names: Map<string, string>;
  truncated: boolean;
};

type LoginDbRow = { user_id: string | null; tenant_id: string | null; ip: string | null; result: LoginResult; created_at: string };
const toLogin = (r: LoginDbRow): LoginEventRow => ({ userId: r.user_id, tenantId: r.tenant_id, ip: r.ip, result: r.result, createdAt: r.created_at });

export async function loadLoginSecurity(): Promise<LoginSecurityData> {
  const admin = createAdminClient();
  const since = daysAgoIso(LOGIN_WINDOW_DAYS);
  const endDay = trDayKey(now());
  const [failures, success, pending, profiles] = await Promise.all([
    readAllPaged<LoginDbRow>(
      (from, to) =>
        admin
          .from("login_events")
          .select("user_id, tenant_id, ip, result, created_at")
          .in("result", ["failed", "2fa_failed"])
          .gte("created_at", since)
          .order("created_at")
          .order("id")
          .range(from, to) as unknown as PromiseLike<Res<LoginDbRow>>,
      { maxRows: 10_000 },
    ),
    admin.from("login_events").select("tenant_id", { count: "exact", head: true }).eq("result", "success").gte("created_at", since),
    admin.from("login_events").select("tenant_id", { count: "exact", head: true }).eq("result", "2fa_pending").gte("created_at", since),
    readAllPaged<{ tenant_id: string | null; two_factor_sms: boolean | null }>(
      (from, to) =>
        admin.from("profiles").select("tenant_id, two_factor_sms").eq("is_active", true).not("tenant_id", "is", null).order("id").range(from, to) as unknown as PromiseLike<
          Res<{ tenant_id: string | null; two_factor_sms: boolean | null }>
        >,
      { maxRows: 30_000 },
    ),
  ]);
  const ready = !(failures.error && /login_events/.test(failures.error));
  const first = summarizeLogins(failures.rows.map(toLogin), headCount(success), { days: LOGIN_WINDOW_DAYS, endDay });
  // Hedeflenen hesapların pencere içi BAŞARILI girişleri: "deneme sonrası girildi mi" (ele geçirme şüphesi).
  const targeted = first.users.map((u) => u.userId);
  const { data: okRows } = targeted.length
    ? await admin.from("login_events").select("user_id, tenant_id, ip, result, created_at").eq("result", "success").in("user_id", targeted).gte("created_at", since).order("created_at", { ascending: false }).limit(1000)
    : { data: [] as LoginDbRow[] };
  const summary = summarizeLogins([...failures.rows, ...((okRows ?? []) as LoginDbRow[])].map(toLogin), headCount(success), { days: LOGIN_WINDOW_DAYS, endDay });
  const twoFactor = twoFactorAdoption(profiles.rows.filter((r) => r.tenant_id).map((r) => ({ tenantId: r.tenant_id!, twoFactor: Boolean(r.two_factor_sms) })));

  const userIds = summary.users.map((u) => u.userId);
  const { data: people } = userIds.length ? await admin.from("profiles").select("id, full_name, tenant_id, is_active").in("id", userIds) : { data: [] };
  const peopleMap = new Map(
    ((people ?? []) as { id: string; full_name: string | null; tenant_id: string | null; is_active: boolean | null }[]).map((p) => [p.id, { name: p.full_name || "Adsız kullanıcı", tenantId: p.tenant_id, active: p.is_active !== false }]),
  );
  const names = await officeNames(admin, [...summary.users.map((u) => u.tenantId ?? peopleMap.get(u.userId)?.tenantId), ...twoFactor.officesWithout.map((o) => o.tenantId)]);
  return {
    ready,
    summary,
    twoFactor,
    pending2fa: headCount(pending),
    people: peopleMap,
    names,
    truncated: failures.truncated || profiles.truncated,
  };
}

// ---------------------------------------------------------------------------
// İleti izni (İYS) uyumu
// ---------------------------------------------------------------------------

export const CONSENT_WINDOW_DAYS = 30;

export type ConsentData = { ready: boolean; coverage: ChannelCoverage[]; activity: ConsentActivity; names: Map<string, string>; truncated: boolean };

type ConsentDbRow = { tenant_id: string; channel: ConsentEventRow["channel"]; from_status: ConsentEventRow["from"]; to_status: ConsentEventRow["to"]; source: string | null; occurred_at: string };

export async function loadConsentCoverage(): Promise<ConsentData> {
  const admin = createAdminClient();
  const pairs = CONSENT_CHANNELS.flatMap((channel) => CONSENT_STATUSES.map((status) => ({ channel, status })));
  const since = daysAgoIso(CONSENT_WINDOW_DAYS);
  const [counts, events] = await Promise.all([
    Promise.all(pairs.map((p) => admin.from("iys_consents").select("tenant_id", { count: "exact", head: true }).eq("channel", p.channel).eq("status", p.status))),
    readAllPaged<ConsentDbRow>(
      (from, to) =>
        admin
          .from("iys_consent_events")
          .select("tenant_id, channel, from_status, to_status, source, occurred_at")
          .gte("occurred_at", since)
          .order("occurred_at")
          .order("id")
          .range(from, to) as unknown as PromiseLike<Res<ConsentDbRow>>,
      { maxRows: 20_000 },
    ),
  ]);
  const table = Object.fromEntries(CONSENT_CHANNELS.map((c) => [c, Object.fromEntries(CONSENT_STATUSES.map((s) => [s, null]))])) as ConsentCounts;
  pairs.forEach((p, i) => {
    table[p.channel][p.status] = headCount(counts[i]!);
  });
  const ready = !counts.every((c) => c.error && isSchemaMissing(c.error));
  const activity = consentActivity(
    events.rows.map((r) => ({ tenantId: r.tenant_id, channel: r.channel, from: r.from_status, to: r.to_status, source: r.source ?? "bilinmiyor", occurredAt: r.occurred_at })),
  );
  const names = await officeNames(admin, activity.revocationOffices.map((o) => o.tenantId));
  return { ready, coverage: channelCoverage(table), activity, names, truncated: events.truncated };
}

// ---------------------------------------------------------------------------
// Arka plan kuyrukları
// ---------------------------------------------------------------------------

export type QueueFailedItem = { id: string; tenantId: string | null; createdAt: string; attempts: number; error: string | null };

export type QueueView = {
  def: QueueDef;
  counts: QueueCounts;
  state: QueueState;
  failedItems: QueueFailedItem[];
};

export type QueueHealthData = { queues: QueueView[]; pausedJobs: { job: string; pausedAt: string | null; reason: string | null }[]; names: Map<string, string> };

export async function loadQueueHealth(): Promise<QueueHealthData> {
  const admin = createAdminClient();
  const nowMs = now();
  const perQueue = await Promise.all(
    QUEUES.map(async (def) => {
      const [waiting, failed, oldest, items] = await Promise.all([
        admin.from(def.table).select("id", { count: "exact", head: true }).in("status", [...def.waiting]),
        admin.from(def.table).select("id", { count: "exact", head: true }).in("status", [...def.failed]),
        admin.from(def.table).select(def.ageColumn).in("status", [...def.waiting]).order(def.ageColumn, { ascending: true }).limit(1),
        def.retryable
          ? admin
              .from(def.table)
              .select(["id", "tenant_id", "created_at", def.attemptsColumn, def.errorColumn].filter(Boolean).join(", "))
              .in("status", [...def.failed])
              .order("created_at", { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
      ]);
      const oldestRow = (oldest.data?.[0] ?? null) as Record<string, unknown> | null;
      const counts: QueueCounts = {
        waiting: headCount(waiting),
        failed: headCount(failed),
        oldestWaitingAt: oldestRow && typeof oldestRow[def.ageColumn] === "string" ? (oldestRow[def.ageColumn] as string) : null,
      };
      const failedItems: QueueFailedItem[] = ((items.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        tenantId: typeof r.tenant_id === "string" ? r.tenant_id : null,
        createdAt: String(r.created_at ?? ""),
        attempts: Number(r[def.attemptsColumn]) || 0,
        error: def.errorColumn && r[def.errorColumn] !== null && r[def.errorColumn] !== undefined ? String(r[def.errorColumn]).slice(0, 120) : null,
      }));
      return { def, counts, state: queueState(def, counts, nowMs), failedItems } satisfies QueueView;
    }),
  );
  const { data: paused } = await admin.from("cron_job_state").select("job, paused_at, reason").eq("paused", true).order("job");
  const names = await officeNames(admin, perQueue.flatMap((q) => q.failedItems.map((i) => i.tenantId)));
  return {
    queues: perQueue,
    pausedJobs: ((paused ?? []) as { job: string; paused_at: string | null; reason: string | null }[]).map((p) => ({ job: p.job, pausedAt: p.paused_at, reason: p.reason })),
    names,
  };
}

// ---------------------------------------------------------------------------
// Veri saklama ve yedekler
// ---------------------------------------------------------------------------

export type RetentionRunView = { finishedAt: string; status: string; durationMs: number | null; trigger: string | null; parsed: ParsedRetentionRun };

export type RetentionData = {
  runs: RetentionRunView[];
  backups: BackupRunRow[];
  backup: BackupHealth;
  storage: { waiting: number | null; failed: number | null };
  kvkk: { erasures30d: number | null; activeExports: number | null } | null;
};

export async function loadRetention(opts: { kvkk: boolean }): Promise<RetentionData> {
  const admin = createAdminClient();
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const [runs, backups, waiting, failed, erasures, exportsActive] = await Promise.all([
    admin.from("cron_runs").select("finished_at, status, duration_ms, trigger, detail").eq("job", "operational-retention").order("finished_at", { ascending: false }).limit(14),
    admin.from("backup_runs").select("finished_at, status, size_bytes, encrypted, remote").order("finished_at", { ascending: false }).limit(14),
    admin.from("storage_deletion_outbox").select("tenant_id", { count: "exact", head: true }).in("status", ["pending", "retry", "processing"]),
    admin.from("storage_deletion_outbox").select("tenant_id", { count: "exact", head: true }).eq("status", "failed"),
    opts.kvkk ? admin.from("kvkk_erasure_log").select("tenant_id", { count: "exact", head: true }).gte("performed_at", daysAgoIso(30)) : Promise.resolve(null),
    opts.kvkk ? admin.from("kvkk_subject_exports").select("tenant_id", { count: "exact", head: true }).gt("expires_at", nowIso) : Promise.resolve(null),
  ]);
  const backupRows: BackupRunRow[] = ((backups.data ?? []) as { finished_at: string; status: BackupRunRow["status"]; size_bytes: number | null; encrypted: boolean; remote: boolean }[]).map((b) => ({
    finishedAt: b.finished_at,
    status: b.status,
    sizeBytes: b.size_bytes === null ? null : Number(b.size_bytes),
    encrypted: Boolean(b.encrypted),
    remote: Boolean(b.remote),
  }));
  return {
    runs: ((runs.data ?? []) as { finished_at: string; status: string; duration_ms: number | null; trigger: string | null; detail: string | null }[]).map((r) => ({
      finishedAt: r.finished_at,
      status: r.status,
      durationMs: r.duration_ms,
      trigger: r.trigger,
      parsed: parseRetentionDetail(r.detail),
    })),
    backups: backupRows,
    backup: backupHealth(backupRows, nowMs),
    storage: { waiting: headCount(waiting), failed: headCount(failed) },
    kvkk: opts.kvkk ? { erasures30d: erasures ? headCount(erasures) : null, activeExports: exportsActive ? headCount(exportsActive) : null } : null,
  };
}

// ---------------------------------------------------------------------------
// Portal hesapları ve ilan doğrulama
// ---------------------------------------------------------------------------

export type PortalData = {
  ready: boolean;
  overview: PortalOverview;
  listingStates: Record<ListingState, number | null>;
  problemOffices: { tenantId: string; suspect: number; missing: number }[];
  names: Map<string, string>;
  truncated: boolean;
};

type PortalDbRow = {
  tenant_id: string;
  portal: PortalKey;
  status: PortalAccountRow["status"];
  check_enabled: boolean;
  plan_ends_at: string | null;
  last_login_ok_at: string | null;
  last_login_fail_at: string | null;
  login_fail_streak: number;
};

export async function loadPortalAccounts(): Promise<PortalData> {
  const admin = createAdminClient();
  const [accounts, stateCounts, problems] = await Promise.all([
    readAllPaged<PortalDbRow>(
      (from, to) =>
        admin
          .from("tenant_portal_accounts")
          .select("tenant_id, portal, status, check_enabled, plan_ends_at, last_login_ok_at, last_login_fail_at, login_fail_streak")
          .order("tenant_id")
          .order("portal")
          .range(from, to) as unknown as PromiseLike<Res<PortalDbRow>>,
      { maxRows: 10_000 },
    ),
    Promise.all(LISTING_STATES.map((s) => admin.from("portal_listing_health").select("tenant_id", { count: "exact", head: true }).eq("check_state", s))),
    readAllPaged<{ tenant_id: string; check_state: ListingState }>(
      (from, to) =>
        admin
          .from("portal_listing_health")
          .select("tenant_id, check_state")
          .in("check_state", ["suspect", "probable_missing", "confirmed_missing"])
          .order("portal_listing_id")
          .range(from, to) as unknown as PromiseLike<Res<{ tenant_id: string; check_state: ListingState }>>,
      { maxRows: 20_000 },
    ),
  ]);
  const overview = summarizePortalAccounts(
    accounts.rows.map((r) => ({
      tenantId: r.tenant_id,
      portal: r.portal,
      status: r.status,
      checkEnabled: r.check_enabled !== false,
      planEndsAt: r.plan_ends_at,
      lastLoginOkAt: r.last_login_ok_at,
      lastLoginFailAt: r.last_login_fail_at,
      loginFailStreak: Number(r.login_fail_streak) || 0,
    })),
    trDayKey(now()),
  );
  const listingStates = Object.fromEntries(LISTING_STATES.map((s, i) => [s, headCount(stateCounts[i]!)])) as Record<ListingState, number | null>;
  const problemOffices = listingProblemOffices(problems.rows.map((r) => ({ tenantId: r.tenant_id, state: r.check_state })));
  const names = await officeNames(admin, [...overview.issueRows.map((r) => r.tenantId), ...problemOffices.map((o) => o.tenantId)]);
  return {
    ready: !(accounts.error && /tenant_portal_accounts|does not exist|schema cache/i.test(accounts.error)),
    overview,
    listingStates,
    problemOffices,
    names,
    truncated: accounts.truncated || problems.truncated,
  };
}
