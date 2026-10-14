import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isIncidentKind,
  isMissingTableError as missingTable,
  isImpact,
  isStatusFor,
  PAST_INCIDENT_DAYS,
  statusReadable,
  UPTIME_DAYS,
  type AnyStatus,
  type Outage,
  type PublicIncident,
} from "./model";

/**
 * Durum sayfası SUNUCU okuyucusu (service_role; tek `db()` noktası). Kamuya YALNIZ şu alanlar çıkar: olay başlığı,
 * türü, etkisi, durumu, zamanları ve güncelleme metinleri; ölçülen kesintilerin yalnız başlangıç/bitiş zamanı.
 * Personel kimliği, uyarı gövdesi, teslim günlüğü ve sürüm bilgisi dışarı ÇIKMAZ.
 * Hata yutulur ve `readable:false` / `setupPending:true` olarak döner (sayfa asla düşmez; sahte "çalışıyor" yok).
 */

function db() {
  return createAdminClient();
}

const DAY_MS = 86_400_000;

type IncidentRow = {
  id: string;
  kind: string;
  title: string;
  impact: string;
  status: string;
  started_at: string;
  resolved_at: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
};
type UpdateRow = { incident_id: string; status: string; message: string; created_at: string };

const INCIDENT_COLS = "id, kind, title, impact, status, started_at, resolved_at, scheduled_start, scheduled_end";

function toIncident(r: IncidentRow, updates: UpdateRow[]): PublicIncident | null {
  const kind = r.kind;
  if (!isIncidentKind(kind) || !isStatusFor(kind, r.status)) return null;
  return {
    id: r.id,
    kind,
    title: r.title,
    impact: isImpact(r.impact) ? r.impact : "minor",
    status: r.status,
    startedAt: r.started_at,
    resolvedAt: r.resolved_at,
    scheduledStart: r.scheduled_start,
    scheduledEnd: r.scheduled_end,
    updates: updates
      .filter((u) => u.incident_id === r.id && isStatusFor(kind, u.status))
      .map((u) => ({ status: u.status as AnyStatus, message: u.message, at: u.created_at }))
      .sort((a, b) => b.at.localeCompare(a.at)),
  };
}

/** Güncelleme metinleri; hata da döner (kamu okuyucusu tablo eksikliği dışındaki hatayı "okunamadı" sayar). */
async function readUpdates(ids: string[]): Promise<{ rows: UpdateRow[]; error: { code?: string; message?: string } | null }> {
  if (ids.length === 0) return { rows: [], error: null };
  const { data, error } = await db()
    .from("status_incident_updates")
    .select("incident_id, status, message, created_at")
    .in("incident_id", ids)
    .order("created_at", { ascending: false })
    .limit(500);
  return error ? { rows: [], error } : { rows: (data ?? []) as UpdateRow[], error: null };
}

export type PublicStatus = {
  /** Ölçüm (alert_events) ve olaylar okunabildi mi (tablo eksikliği hariç); okunamadıysa genel durum "bilinmiyor". */
  readable: boolean;
  /** Yalnız ölçüm (alert_events) okunabildi mi; erişilebilirlik çubuğu buna bağlı. */
  uptimeReadable: boolean;
  /** Olay tabloları yok (migration 20261014005000 bekliyor). */
  setupPending: boolean;
  /** Açık olaylar, sürmekte/yaklaşan bakımlar ve son 14 günde kapananlar. */
  incidents: PublicIncident[];
  outages: Outage[];
  outageOpen: boolean;
};

export async function loadPublicStatus(nowMs: number): Promise<PublicStatus> {
  const client = db();
  const sinceUptime = new Date(nowMs - (UPTIME_DAYS + 1) * DAY_MS).toISOString();
  const sincePast = new Date(nowMs - PAST_INCIDENT_DAYS * DAY_MS).toISOString();
  try {
    const [openRes, recentRes, outageRes] = await Promise.all([
      client.from("status_incidents").select(INCIDENT_COLS).is("resolved_at", null).order("started_at", { ascending: false }).limit(50),
      client.from("status_incidents").select(INCIDENT_COLS).gte("resolved_at", sincePast).order("resolved_at", { ascending: false }).limit(50),
      // Kesinti aralıkları: dönemde başlayan ya da hâlâ açık olan health_down olayları (yalnız zamanlar).
      client
        .from("alert_events")
        .select("first_at, resolved_at")
        .eq("rule_key", "health_down")
        .or(`first_at.gte.${sinceUptime},resolved_at.is.null,resolved_at.gte.${sinceUptime}`)
        .order("first_at", { ascending: false })
        .limit(1000),
    ]);
    const setupPending = missingTable(openRes.error) || missingTable(recentRes.error);
    const rows = [...((openRes.error ? [] : openRes.data) ?? []), ...((recentRes.error ? [] : recentRes.data) ?? [])] as IncidentRow[];
    const updates = await readUpdates(rows.map((r) => r.id));
    const incidents = rows.flatMap((r) => toIncident(r, updates.rows) ?? []);
    const outages: Outage[] = outageRes.error ? [] : ((outageRes.data ?? []) as { first_at: string; resolved_at: string | null }[]).map((o) => ({ start: o.first_at, end: o.resolved_at }));
    return {
      // Olay/güncelleme okuması (tablo eksikliği dışında) düştüyse açık olay kaybolmuş olabilir → "okunamıyor".
      readable: statusReadable({ outage: outageRes.error, incidents: [openRes.error, recentRes.error, updates.error] }),
      uptimeReadable: !outageRes.error,
      setupPending,
      incidents,
      outages,
      outageOpen: outages.some((o) => o.end === null),
    };
  } catch {
    return { readable: false, uptimeReadable: false, setupPending: false, incidents: [], outages: [], outageOpen: false };
  }
}

export type AdminIncident = PublicIncident & { createdAt: string; updatedAt: string };
export type ReleaseRow = {
  id: number;
  sha: string;
  tag: string;
  outcome: "ok" | "rolled_back" | "failed";
  startedAt: string | null;
  finishedAt: string;
  durationSec: number | null;
  releaseMigration: string | null;
  subject: string | null;
  actor: string | null;
  /** Bu sürümde görülen açık hata türü sayısı (error_logs.release eşleşmesi); okunamazsa null. */
  openErrors: number | null;
};

export type AdminStatusData = {
  setupPending: boolean;
  incidents: AdminIncident[];
  releases: ReleaseRow[];
  releasesPending: boolean;
  outages: Outage[];
  outageReadable: boolean;
};

/** Admin ekranı: son olaylar (açıklar önce), sürüm geçmişi (son 30) ve sürüm başına açık hata sayısı. */
export async function loadAdminStatus(nowMs: number): Promise<AdminStatusData> {
  const client = db();
  const sinceUptime = new Date(nowMs - (UPTIME_DAYS + 1) * DAY_MS).toISOString();
  const [incRes, relRes, outageRes] = await Promise.all([
    client.from("status_incidents").select(`${INCIDENT_COLS}, created_at, updated_at`).order("started_at", { ascending: false }).limit(60),
    client
      .from("release_history")
      .select("id, sha, tag, outcome, started_at, finished_at, duration_sec, release_migration, subject, actor")
      .order("finished_at", { ascending: false })
      .limit(30),
    client
      .from("alert_events")
      .select("first_at, resolved_at")
      .eq("rule_key", "health_down")
      .or(`first_at.gte.${sinceUptime},resolved_at.is.null,resolved_at.gte.${sinceUptime}`)
      .order("first_at", { ascending: false })
      .limit(1000),
  ]);
  const rows = (incRes.error ? [] : (incRes.data ?? [])) as (IncidentRow & { created_at: string; updated_at: string })[];
  const updates = (await readUpdates(rows.map((r) => r.id))).rows;
  const incidents = rows
    .flatMap((r) => {
      const i = toIncident(r, updates);
      return i ? [{ ...i, createdAt: r.created_at, updatedAt: r.updated_at }] : [];
    })
    .sort((a, b) => Number(a.resolvedAt !== null) - Number(b.resolvedAt !== null) || b.startedAt.localeCompare(a.startedAt));

  type RelRow = { id: number; sha: string; tag: string; outcome: string; started_at: string | null; finished_at: string; duration_sec: number | null; release_migration: string | null; subject: string | null; actor: string | null };
  const rel = (relRes.error ? [] : (relRes.data ?? [])) as RelRow[];
  // Sürüm başına açık hata türü: error_logs.release = SHA'nın ilk 12 karakteri (error-log.ts ile aynı kesim).
  const shas = [...new Set(rel.map((r) => r.sha.slice(0, 12)))];
  const counts = new Map<string, number | null>();
  await Promise.all(
    shas.map(async (sha) => {
      const { count, error } = await client.from("error_logs").select("id", { count: "exact", head: true }).eq("release", sha).eq("status", "open");
      counts.set(sha, error ? null : (count ?? 0));
    }),
  );
  const releases: ReleaseRow[] = rel.map((r) => ({
    id: r.id,
    sha: r.sha,
    tag: r.tag,
    outcome: r.outcome === "rolled_back" || r.outcome === "failed" ? r.outcome : "ok",
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationSec: r.duration_sec,
    releaseMigration: r.release_migration,
    subject: r.subject,
    actor: r.actor,
    openErrors: counts.get(r.sha.slice(0, 12)) ?? null,
  }));

  return {
    setupPending: missingTable(incRes.error),
    incidents,
    releases,
    releasesPending: missingTable(relRes.error),
    outages: outageRes.error ? [] : ((outageRes.data ?? []) as { first_at: string; resolved_at: string | null }[]).map((o) => ({ start: o.first_at, end: o.resolved_at })),
    outageReadable: !outageRes.error,
  };
}
