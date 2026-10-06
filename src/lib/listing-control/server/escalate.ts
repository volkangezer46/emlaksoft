import { insertNotificationsDetailed, type NotificationRow } from "@/lib/notify-batch";
import { notifyTenant } from "@/lib/notify";
import { buildDedupeKey } from "@/lib/notify-dedupe";
import { normalizeListingControlConfig, type ListingControlConfig } from "../config";
import { planSlaEscalation, slaNotificationKind, type SlaRecipients } from "../sla-plan";
import type { AnomalySeverity } from "../types";
import { chunk, isMissingSchema, type Db } from "./db";

/**
 * SLA YÜKSELTME (sunucu): açık/üstlenilmiş anomalileri 4 saat danışman→takım lideri, 8 saat şube müdürü, 24 saat ofis
 * sahibi zincirinde yükseltir (süreler ofis ayarlı). Aşama kaydı `lc_escalate_anomaly` ile tekil (anomali, aşama):
 * aynı aşama ASLA iki kez bildirilmez; bildirim yazılamazsa kayıt zaten atıldığından tekrar denenmez ama bildirim
 * `dedupe_key` taşır (kısmi hata sonraki turda aynı anahtarla güvenle yeniden yazılabilir). Takım lideri alıcısı danışmanın
 * `profiles.team_id` → `teams.lead_user_id` zincirinden çözülür (takım şeması uygulanmadıysa ya da takım/lider yoksa boş:
 * aşama kaydı düşer, bildirim üretilmez; sahte alıcı uydurulmaz). Lider danışmanın kendisiyse atlanır. Mevcut `leak-sla` kapanış-formu SLA'sı
 * AYRIDIR ve davranışı değişmez; aynı portföyde açık `potential_lost_deal` anomalisi varsa orada çifte uyarı üretilmez.
 */

type OpenAnomaly = {
  id: string;
  tenant_id: string;
  property_id: string;
  type: string;
  severity: AnomalySeverity;
  advisor_id: string | null;
  branch_id: string | null;
  first_seen_at: string;
  sla_due_at: string | null;
};

export type EscalationSummary = {
  examined: number;
  escalated: number;
  notified: number;
  pushed: number;
  tasksCreated: number;
  skippedNoRecipient: number;
  schemaMissing: boolean;
};

const LIMIT = 500;
/** Push'lu (tek tek) bildirim üst sınırı; fazlası toplu zil satırı olarak yazılır (cron süresi korunur). */
const PUSH_LIMIT = 150;
const HOUR = 3_600_000;

/**
 * Zincirin başlangıcı: yeni anomalide ilk görülme; YENİDEN AÇILAN anomalide yeniden açılış anı. Yeniden açılışta
 * `sla_due_at` = açılış + takım lideri süresi yazıldığı için başlangıç oradan geri hesaplanır (ilk görülmeden eskiyse
 * ilk görülme kullanılır). Böylece yeniden açılan uyarı bütün kademeleri AYNI ANDA tetiklemez.
 */
export function slaChainStartMs(firstSeenIso: string, slaDueIso: string | null, teamLeadHours: number): number {
  const first = Date.parse(firstSeenIso);
  const due = slaDueIso ? Date.parse(slaDueIso) : Number.NaN;
  if (!Number.isFinite(due)) return first;
  return Math.max(first, due - teamLeadHours * HOUR);
}

/** Danışman görevi başlığı (aynı portföyde aynı başlıkla açık görev varsa yenisi açılmaz). */
export function slaTaskTitle(type: string): string {
  return `İlan uyarısı: ${anomalyLabel(type)}`;
}

export function anomalyHref(propertyId: string): string {
  return `/app/ilan-kontrol/anomaliler?portfoy=${encodeURIComponent(propertyId)}`;
}

export async function runSlaEscalation(
  db: Db,
  nowMs: number,
  opts: { cfgFor?: (tenantId: string) => Promise<ListingControlConfig>; disabledTenantIds?: ReadonlySet<string> } = {},
): Promise<EscalationSummary> {
  const out: EscalationSummary = { examined: 0, escalated: 0, notified: 0, pushed: 0, tasksCreated: 0, skippedNoRecipient: 0, schemaMissing: false };
  const { data, error } = await db
    .from("listing_anomalies")
    .select("id, tenant_id, property_id, type, severity, advisor_id, branch_id, first_seen_at, sla_due_at")
    .in("status", ["open", "acknowledged"])
    .not("sla_due_at", "is", null)
    .lt("sla_stage", 4)
    .order("first_seen_at", { ascending: true })
    .limit(LIMIT);
  if (error) {
    out.schemaMissing = isMissingSchema(error);
    if (!out.schemaMissing) console.error("runSlaEscalation list", { code: error.code });
    return out;
  }
  const anomalies = ((data ?? []) as OpenAnomaly[]).filter((a) => !opts.disabledTenantIds?.has(a.tenant_id));
  out.examined = anomalies.length;
  if (anomalies.length === 0) return out;

  const ids = anomalies.map((a) => a.id);
  const fired = new Map<string, number[]>();
  for (const part of chunk(ids, 200)) {
    const { data: ev } = await db.from("listing_sla_events").select("anomaly_id, stage").in("anomaly_id", part);
    for (const e of (ev ?? []) as { anomaly_id: string; stage: number }[]) fired.set(e.anomaly_id, [...(fired.get(e.anomaly_id) ?? []), e.stage]);
  }

  const tenants = [...new Set(anomalies.map((a) => a.tenant_id))];
  const owners = new Map<string, string[]>();
  const { data: ownerRows } = await db.from("profiles").select("id, tenant_id").in("tenant_id", tenants).in("role", ["owner", "gm"]).eq("is_active", true);
  for (const r of (ownerRows ?? []) as { id: string; tenant_id: string }[]) owners.set(r.tenant_id, [...(owners.get(r.tenant_id) ?? []), r.id]);
  const branchIds = [...new Set(anomalies.map((a) => a.branch_id).filter((x): x is string => !!x))];
  const managers = new Map<string, string>();
  if (branchIds.length) {
    const { data: br } = await db.from("branches").select("id, manager_user_id").in("id", branchIds);
    for (const b of (br ?? []) as { id: string; manager_user_id: string | null }[]) if (b.manager_user_id) managers.set(b.id, b.manager_user_id);
  }

  const teamLeads = await resolveTeamLeads(db, anomalies.map((a) => a.advisor_id).filter((x): x is string => !!x));

  const notifications: NotificationRow[] = [];
  const tasks: { tenantId: string; anomalyId: string; propertyId: string; advisorId: string; type: string; severity: AnomalySeverity; dueAtIso: string }[] = [];
  const cfgCache = new Map<string, ListingControlConfig>();
  for (const a of anomalies) {
    let cfg = cfgCache.get(a.tenant_id);
    if (!cfg) {
      cfg = opts.cfgFor ? await opts.cfgFor(a.tenant_id) : normalizeListingControlConfig(null);
      cfgCache.set(a.tenant_id, cfg);
    }
    const recipients: SlaRecipients = {
      advisorId: a.advisor_id,
      teamLeadId: a.advisor_id ? (teamLeads.get(a.advisor_id) ?? null) : null,
      branchManagerId: a.branch_id ? (managers.get(a.branch_id) ?? null) : null,
      ownerIds: owners.get(a.tenant_id) ?? [],
    };
    const decisions = planSlaEscalation({
      openedAtMs: slaChainStartMs(a.first_seen_at, a.sla_due_at, cfg.sla.teamLeadHours),
      nowMs,
      firedStages: fired.get(a.id) ?? [],
      recipients,
      sla: cfg.sla,
    });
    for (const d of decisions) {
      const { data: res, error: e } = await db.rpc("lc_escalate_anomaly", {
        p_tenant_id: a.tenant_id,
        p_anomaly_id: a.id,
        p_stage: d.stage,
        p_recipient_role: d.role,
        p_recipient_id: d.recipientIds[0] ?? null,
        p_notification_key: buildDedupeKey("lc-sla", a.id, d.stage),
      });
      if (e) {
        if (isMissingSchema(e)) out.schemaMissing = true;
        continue;
      }
      if (!(res as { inserted?: boolean } | null)?.inserted) continue; // başka tur/süreç zaten kaydetti
      out.escalated += 1;
      if (!d.deliver) {
        out.skippedNoRecipient += 1;
        continue;
      }
      // 1. aşama (açılış): danışmana takım lideri süresi kadar vadeli GÖREV. Aşama kaydı tekil olduğu için anomali başına
      // bir kez; aynı portföyde aynı başlıkla açık görev varsa ikinci görev açılmaz.
      if (d.stage === 1 && d.role === "advisor" && a.advisor_id) {
        tasks.push({
          tenantId: a.tenant_id,
          anomalyId: a.id,
          propertyId: a.property_id,
          advisorId: a.advisor_id,
          type: a.type,
          severity: a.severity,
          dueAtIso: new Date(nowMs + cfg.sla.teamLeadHours * HOUR).toISOString(),
        });
      }
      for (const uid of d.recipientIds) {
        notifications.push({
          tenant_id: a.tenant_id,
          user_id: uid,
          title: d.stage === 1 ? "Portal ilanı kontrol uyarısı" : "Portal ilanı uyarısı yükseltildi",
          body: `${anomalyLabel(a.type)} · ${d.stage === 1 ? `${cfg.sla.teamLeadHours} saat içinde açıklama bekleniyor` : `${d.stage}. aşama (${roleLabel(d.role)})`}`,
          href: anomalyHref(a.property_id),
          kind: slaNotificationKind(d.stage, a.severity),
          dedupe_key: buildDedupeKey("lc-sla", a.id, d.stage, uid),
        });
      }
    }
  }
  out.tasksCreated = await createSlaTasks(db, tasks);
  const delivered = await deliverNotifications(db, notifications);
  out.notified = delivered.written;
  out.pushed = delivered.pushed;
  return out;
}

/**
 * Bildirim teslimi: ilk PUSH_LIMIT satır `notifyTenant` ile (zil + push + kullanıcı tercihi "portal" + tek seferlik anahtar),
 * kalanı toplu zil satırı. Hata akışı bozmaz. Aşama kaydı (lc_escalate_anomaly) tekil olduğundan aynı aşama iki kez gelmez.
 */
async function deliverNotifications(db: Db, rows: NotificationRow[]): Promise<{ written: number; pushed: number }> {
  let written = 0;
  let pushed = 0;
  const direct = rows.slice(0, PUSH_LIMIT);
  for (const part of chunk(direct, 5)) {
    const results = await Promise.allSettled(
      part.map((n) =>
        notifyTenant({
          tenantId: n.tenant_id,
          userId: n.user_id ?? null,
          title: n.title,
          body: n.body ?? undefined,
          href: n.href ?? undefined,
          kind: (n.kind as "info" | "warning" | "danger" | undefined) ?? "info",
          prefKey: "portal",
          dedupeKey: n.dedupe_key ?? undefined,
        }),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        written += 1;
        pushed += 1;
      }
    }
  }
  const rest = rows.slice(PUSH_LIMIT);
  if (rest.length) written += (await insertNotificationsDetailed(db, rest)).written;
  return { written, pushed };
}

async function createSlaTasks(
  db: Db,
  tasks: { tenantId: string; anomalyId: string; propertyId: string; advisorId: string; type: string; severity: AnomalySeverity; dueAtIso: string }[],
): Promise<number> {
  let created = 0;
  for (const t of tasks) {
    const title = slaTaskTitle(t.type);
    try {
      const { data: existing, error: exErr } = await db
        .from("tasks")
        .select("id")
        .eq("tenant_id", t.tenantId)
        .eq("assigned_to", t.advisorId)
        .eq("property_id", t.propertyId)
        .eq("status", "open")
        .eq("title", title)
        .limit(1);
      if (exErr) continue;
      if ((existing ?? []).length > 0) continue;
      const { error } = await db.from("tasks").insert({
        tenant_id: t.tenantId,
        title,
        notes: `Portal ilan kontrolü bir sorun tespit etti. Açıklama girin ya da düzeltin: ${anomalyHref(t.propertyId)}`,
        kind: "followup",
        priority: t.severity === "critical" || t.severity === "high" ? "high" : "normal",
        status: "open",
        due_at: t.dueAtIso,
        assigned_to: t.advisorId,
        property_id: t.propertyId,
        created_by: null,
      });
      if (error) {
        console.error("lc sla task", { code: error.code });
        continue;
      }
      created += 1;
      await db.from("listing_anomaly_actions").insert({ tenant_id: t.tenantId, anomaly_id: t.anomalyId, action: "task_created", stage: 1 });
    } catch (e) {
      console.error("lc sla task", e);
    }
  }
  return created;
}

/**
 * danışman → takım lideri. Takım tabloları yoksa (migration uygulanmadı) ya da hata olursa boş harita (eski davranış).
 * Lider danışmanın kendisiyse eşleşme yazılmaz (kendi kendine yükseltme anlamsız).
 */
export async function resolveTeamLeads(db: Db, advisorIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(advisorIds)];
  if (ids.length === 0) return out;
  const teamOf = new Map<string, string>();
  for (const part of chunk(ids, 200)) {
    const { data, error } = await db.from("profiles").select("id, team_id").in("id", part).not("team_id", "is", null);
    if (error) return out; // team_id kolonu yok → takım lideri aşaması boş
    for (const r of (data ?? []) as { id: string; team_id: string | null }[]) if (r.team_id) teamOf.set(r.id, r.team_id);
  }
  const teamIds = [...new Set(teamOf.values())];
  const leadOf = new Map<string, string>();
  for (const part of chunk(teamIds, 200)) {
    const { data, error } = await db.from("teams").select("id, lead_user_id").in("id", part).eq("is_active", true).not("lead_user_id", "is", null);
    if (error) return out;
    for (const t of (data ?? []) as { id: string; lead_user_id: string | null }[]) if (t.lead_user_id) leadOf.set(t.id, t.lead_user_id);
  }
  for (const [advisor, team] of teamOf) {
    const lead = leadOf.get(team);
    if (lead && lead !== advisor) out.set(advisor, lead);
  }
  return out;
}

function roleLabel(role: string): string {
  return role === "team_lead" ? "takım lideri" : role === "branch_manager" ? "şube müdürü" : role === "owner" ? "ofis sahibi" : "danışman";
}

function anomalyLabel(type: string): string {
  const map: Record<string, string> = {
    portal_missing: "Portal ilanı kayıp",
    not_published: "Portföy yayınlanmadı",
    price_mismatch: "Fiyat uyuşmazlığı",
    potential_lost_deal: "Potansiyel kayıp işlem",
    sold_still_listed: "Satılmış portföy hâlâ portalda",
    incomplete_closure: "Eksik kapanış",
    authority_expiring: "Yetki bitiyor",
    unregistered_listing: "Portalda CRM'e kayıtsız ilan",
    advisor_mismatch: "Danışman uyuşmazlığı",
    duplicate: "Olası kopya portföy",
  };
  return map[type] ?? "İlan uyarısı";
}
