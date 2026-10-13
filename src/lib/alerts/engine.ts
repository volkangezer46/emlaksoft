import { createAdminClient } from "@/lib/supabase/admin";
import { getBaseUrl } from "@/lib/base-url";
import { now } from "@/lib/clock";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { noteCronRunStart } from "@/lib/cron-pause";
import { getPlatformSetting } from "@/lib/platform-settings";
import { BACKUP_HEARTBEAT_JOB, BACKUP_STATUS_KEY } from "@/lib/ops/backup-status";
import { getSettings } from "@/lib/settings/read";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { openChannelConfig, sendToChannel } from "./channels";
import { evaluateAlerts, formatAlertText, isPausedJobEvent, type AlertCondition, type AlertSnapshot } from "./evaluate";
import { isMuted, mergeRuleConfigs, notifyDecision, type AlertRuleConfig, type AlertRuleKey, isAlertRuleKey } from "./rules";
import { OPS_ALERT_SETTING_KEYS } from "@/lib/settings/registry/ops-alerts";

/**
 * Uyarı motoru (SUNUCU): anlık görüntüyü toplar, kuralları (`evaluate.ts`, saf) uygular, olayları açar/kapatır ve
 * etkin kanallara gönderir. Yeni cron route'u YOK: `ticket-sla` (5 dakikada bir) içinde AYRIK adım olarak çalışır,
 * kendi kalp atışını `uyari-motoru` adıyla yazar ve hiçbir zaman fırlatmaz (ana işin sonucunu etkilemez).
 *
 * Kurallar: aynı sorun için tek açık olay (parmak izi); ilk tetiklemede ve tekrar aralığı dolunca bildirim, sessizdeyse
 * bildirim yok (olay yine kaydedilir); düzelince "düzeldi" mesajı (yalnız daha önce bildirilmişse). Kanal yoksa ya da
 * kanal kapalıysa teslim günlüğüne "kanal kapalı" düşer — sahte gönderim yapılmaz.
 * `health_down` sunucu betiğinin işidir (error-watch.sh, kaynak 'host'); motor o olaylara dokunmaz.
 */

export const ALERT_ENGINE_HEARTBEAT = "uyari-motoru";

type Admin = ReturnType<typeof createAdminClient>;
type Delivery = { at: string; state: string; channel: string | null; kind: string | null; ok: boolean; detail: string };
type OpenEvent = {
  id: string;
  rule_key: string;
  fingerprint: string;
  last_notified_at: string | null;
  notify_count: number;
  deliveries: Delivery[] | null;
  title: string;
  body: string | null;
  href: string | null;
};
type ChannelRow = { id: string; kind: string; name: string; config_sealed: string };

const MAX_DELIVERY_LOG = 20;
const missing = (e: { code?: string } | null | undefined) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "42703"));

async function dispatch(
  channels: readonly ChannelRow[],
  c: Pick<AlertCondition, "title" | "body" | "href" | "ruleKey" | "fingerprint">,
  state: "firing" | "resolved" | "reminder",
  atIso: string,
): Promise<Delivery[]> {
  if (channels.length === 0) {
    return [{ at: atIso, state, channel: null, kind: null, ok: false, detail: "kanal kapalı: etkin uyarı kanalı yok" }];
  }
  const { subject, text } = formatAlertText(c, state, getBaseUrl());
  const payload = { event: state, rule: c.ruleKey, fingerprint: c.fingerprint, title: c.title, body: c.body, href: c.href, at: atIso };
  return Promise.all(
    channels.map(async (ch): Promise<Delivery> => {
      const cfg = openChannelConfig(ch.id, ch.kind, ch.config_sealed);
      if (!cfg) return { at: atIso, state, channel: ch.name, kind: ch.kind, ok: false, detail: "kanal kapalı: yapılandırma çözülemedi (anahtarı yeniden girin)" };
      const r = await sendToChannel(cfg, { subject, text, payload });
      return { at: atIso, state, channel: ch.name, kind: ch.kind, ok: r.ok, detail: r.detail };
    }),
  );
}

function appendLog(prev: Delivery[] | null, next: Delivery[]): Delivery[] {
  return [...(Array.isArray(prev) ? prev : []), ...next].slice(-MAX_DELIVERY_LOG);
}

async function readSnapshot(admin: Admin, nowMs: number): Promise<{ snapshot: AlertSnapshot; rules: Record<AlertRuleKey, AlertRuleConfig> } | null> {
  const since5 = new Date(nowMs - 5 * 60_000).toISOString();
  const [rulesRes, hbRes, stateRes, rateRes, backupRaw, hostRes, capRes, mrrHeadRes] = await Promise.all([
    admin.from("alert_rules").select("key, enabled, threshold, repeat_minutes, muted_until"),
    admin.from("cron_heartbeats").select("job, last_run_at, last_status, last_detail"),
    admin.from("cron_job_state").select("job").eq("paused", true),
    admin.from("error_rate_minutely").select("n").gte("minute", since5),
    getPlatformSetting(BACKUP_STATUS_KEY).catch(() => null),
    admin.from("host_metrics").select("host, at, disk_used_pct").order("at", { ascending: false }).limit(1),
    admin.from("billing_payment_captures").select("id", { count: "exact", head: true }).in("status", ["manual_review", "refund_required"]),
    admin.from("platform_mrr_daily").select("day").order("day", { ascending: false }).limit(1),
  ]);
  if (missing(rulesRes.error)) return null; // migration bekliyor
  const rules = mergeRuleConfigs(rulesRes.error ? [] : rulesRes.data);

  type Hb = { job: string; last_run_at: string | null; last_status: string | null; last_detail: string | null };
  const heartbeats = hbRes.error ? null : ((hbRes.data ?? []) as Hb[]);
  const host = hostRes.error ? null : ((hostRes.data ?? [])[0] as { host: string; at: string; disk_used_pct: number | string | null } | undefined);

  // MRR: son gün ve 7 gün önceki günün toplamı (yetersiz anlık görüntü = değerlendirme yok).
  let mrr: AlertSnapshot["mrr"] = null;
  const latestDay = mrrHeadRes.error ? null : ((mrrHeadRes.data ?? [])[0] as { day: string } | undefined)?.day ?? null;
  if (latestDay) {
    const prevDay = new Date(Date.parse(`${latestDay}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
    const { rows, error, truncated } = await readAllPaged<{ day: string; mrr_try: number | string }>((from, to) =>
      admin.from("platform_mrr_daily").select("day, mrr_try").in("day", [latestDay, prevDay]).order("day").order("tenant_id").range(from, to),
    );
    if (!error && !truncated) {
      const sum = (d: string) => rows.filter((r) => r.day === d).reduce((s, r) => s + Number(r.mrr_try || 0), 0);
      if (rows.some((r) => r.day === prevDay)) mrr = { latest: sum(latestDay), latestDay, previous: sum(prevDay), previousDay: prevDay };
    }
  }

  const snapshot: AlertSnapshot = {
    nowMs,
    heartbeats,
    pausedJobs: new Set(stateRes.error ? [] : ((stateRes.data ?? []) as { job: string }[]).map((r) => r.job)),
    errorsLast5m: rateRes.error ? null : ((rateRes.data ?? []) as { n: number }[]).reduce((s, r) => s + Number(r.n || 0), 0),
    backup: {
      raw: backupRaw,
      heartbeat: heartbeats?.find((h) => h.job === BACKUP_HEARTBEAT_JOB) ?? null,
    },
    disk: host && host.disk_used_pct != null ? { host: host.host, at: host.at, pct: Number(host.disk_used_pct) } : null,
    captureProblems: capRes.error ? null : (capRes.count ?? 0),
    mrr,
  };
  return { snapshot, rules };
}

/** Saklama: saatte bir (dakika < 5 turunda) eski çalışma/ölçüm/sayaç/olay satırlarını budar. */
async function prune(admin: Admin, nowMs: number, days: { cronRuns: number; hostMetrics: number; events: number }) {
  const ago = (d: number) => new Date(nowMs - d * 86_400_000).toISOString();
  await Promise.all([
    admin.from("cron_runs").delete().lt("started_at", ago(days.cronRuns)),
    admin.from("host_metrics").delete().lt("at", ago(days.hostMetrics)),
    admin.from("error_rate_minutely").delete().lt("minute", ago(2)),
    admin.from("alert_events").delete().not("resolved_at", "is", null).lt("resolved_at", ago(days.events)),
  ]);
}

export type AlertRunResult = { status: "ok" | "error" | "skipped"; detail: string };

export async function runAlertEvaluation(): Promise<AlertRunResult> {
  const settings = await getSettings(Object.values(OPS_ALERT_SETTING_KEYS)).catch(() => ({}) as Record<string, unknown>);
  if (settings[OPS_ALERT_SETTING_KEYS.engineEnabled] === false) return { status: "skipped", detail: "uyarı motoru kapalı (ayar)" };

  const admin = createAdminClient();
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const read = await readSnapshot(admin, nowMs);
  if (!read) return { status: "skipped", detail: "kurulum bekliyor (alert_rules yok)" };
  const { snapshot, rules } = read;
  const { firing, evaluated } = evaluateAlerts(snapshot, rules);

  const [openRes, chRes] = await Promise.all([
    admin
      .from("alert_events")
      .select("id, rule_key, fingerprint, last_notified_at, notify_count, deliveries, title, body, href")
      .is("resolved_at", null)
      .eq("source", "app")
      .limit(500),
    admin.from("alert_channels").select("id, kind, name, config_sealed").eq("enabled", true).order("created_at"),
  ]);
  if (openRes.error) return { status: "error", detail: `olaylar okunamadı: ${openRes.error.code ?? "?"}` };
  const channels = (chRes.error ? [] : chRes.data ?? []) as ChannelRow[];
  const open = new Map(((openRes.data ?? []) as OpenEvent[]).map((e) => [e.fingerprint, e] as const));

  let opened = 0;
  let notified = 0;
  let resolved = 0;
  let failures = 0;

  for (const c of firing) {
    const cfg = rules[c.ruleKey];
    let ev = open.get(c.fingerprint) ?? null;
    if (!ev) {
      const { data, error } = await admin
        .from("alert_events")
        .insert({ rule_key: c.ruleKey, fingerprint: c.fingerprint, severity: c.severity, source: "app", title: c.title, body: c.body, href: c.href })
        .select("id, rule_key, fingerprint, last_notified_at, notify_count, deliveries, title, body, href")
        .single();
      if (error || !data) {
        failures += 1;
        continue;
      }
      ev = data as OpenEvent;
      opened += 1;
    }
    const decision = notifyDecision(ev, cfg, nowMs);
    const patch: Record<string, unknown> = { last_at: nowIso, title: c.title, body: c.body, href: c.href, severity: c.severity };
    if (decision === "notify") {
      const deliveries = await dispatch(channels, c, ev.last_notified_at ? "reminder" : "firing", nowIso);
      patch.deliveries = appendLog(ev.deliveries, deliveries);
      patch.last_notified_at = nowIso;
      patch.notify_count = (ev.notify_count ?? 0) + 1;
      notified += 1;
    }
    const { error } = await admin.from("alert_events").update(patch).eq("id", ev.id);
    if (error) failures += 1;
  }

  // Düzelenler: bu turda değerlendirilen kuralın açık olayı artık tetiklenmiyorsa kapanır.
  // Kural kapatıldıysa da olay kapanır (bildirim yok).
  const firingFps = new Set(firing.map((f) => f.fingerprint));
  for (const ev of open.values()) {
    if (firingFps.has(ev.fingerprint) || !isAlertRuleKey(ev.rule_key)) continue;
    const cfg = rules[ev.rule_key];
    if (!evaluated.has(ev.rule_key) && cfg.enabled) continue;
    const patch: Record<string, unknown> = { resolved_at: nowIso, last_at: nowIso };
    // İş duraklatıldı diye koşul kalktıysa sorun DÜZELMEDİ: olay bildirimsiz kapanır (yanıltıcı "düzeldi" yok).
    if (isPausedJobEvent(ev.fingerprint, snapshot.pausedJobs)) {
      patch.deliveries = appendLog(ev.deliveries, [
        { at: nowIso, state: "resolved", channel: null, kind: null, ok: false, detail: "iş duraklatıldı; olay bildirimsiz kapandı" },
      ]);
    } else if (cfg.enabled && ev.last_notified_at && !isMuted(cfg, nowMs)) {
      const deliveries = await dispatch(
        channels,
        { title: ev.title, body: "Koşul artık sağlanmıyor; sorun düzeldi.", href: ev.href ?? "", ruleKey: ev.rule_key, fingerprint: ev.fingerprint },
        "resolved",
        nowIso,
      );
      patch.deliveries = appendLog(ev.deliveries, deliveries);
      patch.resolved_notified_at = nowIso;
    }
    const { error } = await admin.from("alert_events").update(patch).eq("id", ev.id);
    if (error) failures += 1;
    else resolved += 1;
  }

  // Ertelenen hatalar süresi dolunca yeniden açılır (tetikleyici snoozed_until'ı temizler).
  await admin.from("error_logs").update({ status: "open" }).eq("status", "snoozed").lt("snoozed_until", nowIso);

  if (new Date(nowMs).getUTCMinutes() < 5) {
    await prune(admin, nowMs, {
      cronRuns: Number(settings[OPS_ALERT_SETTING_KEYS.cronRunsRetentionDays] ?? 30),
      hostMetrics: Number(settings[OPS_ALERT_SETTING_KEYS.hostMetricsRetentionDays] ?? 14),
      events: Number(settings[OPS_ALERT_SETTING_KEYS.eventRetentionDays] ?? 90),
    }).catch(() => undefined);
  }

  const detail = `${firing.length} tetikte · ${opened} yeni · ${notified} bildirim · ${resolved} düzeldi · ${channels.length} kanal${failures ? ` · ${failures} hata` : ""}`;
  return { status: failures > 0 ? "error" : "ok", detail };
}

/**
 * Ayrık cron adımı: asla fırlatmaz; kendi kalp atışını yazar (atlandıysa yazmaz: kurulum/ayar durumu nabız değildir).
 * `ticket-sla` route'u bu adımı duraklatma kontrolünden ÖNCE çağırır: o iş duraklatılsa da uyarılar çalışır.
 */
export async function runAlertEvaluationStep(): Promise<void> {
  noteCronRunStart(ALERT_ENGINE_HEARTBEAT);
  try {
    const r = await runAlertEvaluation();
    if (r.status !== "skipped") await recordHeartbeat(ALERT_ENGINE_HEARTBEAT, r.status, r.detail);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("uyarı motoru", { error: message });
    await recordHeartbeat(ALERT_ENGINE_HEARTBEAT, "error", `altyapı hatası: ${message}`.slice(0, 500)).catch(() => undefined);
  }
}
