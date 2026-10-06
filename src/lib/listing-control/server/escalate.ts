import { insertNotificationsDetailed, type NotificationRow } from "@/lib/notify-batch";
import { buildDedupeKey } from "@/lib/notify-dedupe";
import { normalizeListingControlConfig, type ListingControlConfig } from "../config";
import { planSlaEscalation, slaNotificationKind, type SlaRecipients } from "../sla-plan";
import type { AnomalySeverity } from "../types";
import { chunk, isMissingSchema, type Db } from "./db";

/**
 * SLA YÜKSELTME (sunucu): açık/üstlenilmiş anomalileri 4 saat danışman→takım lideri, 8 saat şube müdürü, 24 saat ofis
 * sahibi zincirinde yükseltir (süreler ofis ayarlı). Aşama kaydı `lc_escalate_anomaly` ile tekil (anomali, aşama):
 * aynı aşama ASLA iki kez bildirilmez; bildirim yazılamazsa kayıt zaten atıldığından tekrar denenmez ama bildirim
 * `dedupe_key` taşır (kısmi hata sonraki turda aynı anahtarla güvenle yeniden yazılabilir). Takım modeli olmadığından
 * takım lideri alıcısı şimdilik boş (aşama kaydı düşer, bildirim üretilmez). Mevcut `leak-sla` kapanış-formu SLA'sı
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
};

export type EscalationSummary = { examined: number; escalated: number; notified: number; skippedNoRecipient: number; schemaMissing: boolean };

const LIMIT = 500;

export async function runSlaEscalation(
  db: Db,
  nowMs: number,
  opts: { cfgFor?: (tenantId: string) => Promise<ListingControlConfig>; disabledTenantIds?: ReadonlySet<string> } = {},
): Promise<EscalationSummary> {
  const out: EscalationSummary = { examined: 0, escalated: 0, notified: 0, skippedNoRecipient: 0, schemaMissing: false };
  const { data, error } = await db
    .from("listing_anomalies")
    .select("id, tenant_id, property_id, type, severity, advisor_id, branch_id, first_seen_at")
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

  const notifications: NotificationRow[] = [];
  const cfgCache = new Map<string, ListingControlConfig>();
  for (const a of anomalies) {
    let cfg = cfgCache.get(a.tenant_id);
    if (!cfg) {
      cfg = opts.cfgFor ? await opts.cfgFor(a.tenant_id) : normalizeListingControlConfig(null);
      cfgCache.set(a.tenant_id, cfg);
    }
    const recipients: SlaRecipients = {
      advisorId: a.advisor_id,
      teamLeadId: null,
      branchManagerId: a.branch_id ? (managers.get(a.branch_id) ?? null) : null,
      ownerIds: owners.get(a.tenant_id) ?? [],
    };
    const decisions = planSlaEscalation({
      openedAtMs: Date.parse(a.first_seen_at),
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
      for (const uid of d.recipientIds) {
        notifications.push({
          tenant_id: a.tenant_id,
          user_id: uid,
          title: d.stage === 1 ? "Portal ilanı kontrol uyarısı" : "Portal ilanı uyarısı yükseltildi",
          body: `${anomalyLabel(a.type)} · ${d.stage === 1 ? "açıklama bekleniyor" : `${d.stage}. aşama (${roleLabel(d.role)})`}`,
          href: "/app/portallar",
          kind: slaNotificationKind(d.stage, a.severity),
          dedupe_key: buildDedupeKey("lc-sla", a.id, d.stage, uid),
        });
      }
    }
  }
  const res = await insertNotificationsDetailed(db, notifications);
  out.notified = res.written;
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
  };
  return map[type] ?? "İlan uyarısı";
}
