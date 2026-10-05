import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { findNotifiedIds, insertNotifications, type NotificationRow } from "@/lib/notify-batch";
import { getDisabledModulesByTenant, isDisabledFor, skippedTenantsNote } from "@/lib/modules/state";
import { collectFor } from "@/lib/surveys/collect";
import { isOverdue } from "@/lib/surveys/logic";
import {
  ensureSurveyDefaults,
  insertCandidates,
  isSurveySchemaMissing,
  loadActiveTemplateMap,
  loadAssigneeIds,
  loadOpenLoad,
  loadSurveySettings,
  type TriggerRow,
} from "@/lib/surveys/server";
import { isSurveyEventType } from "@/lib/surveys/types";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const LOOKBACK_DAYS = 45;
const OVERDUE_HREF = "/app/anketler/kuyruk?durum=geciken";
const DAY_MS = 86_400_000;

/**
 * Anket görevleri cron'u (günlük 06:20 — vercel.json).
 *
 * 1) Açık tetikleyicisi olan her ofis için olayları tarar (yayından kalkan ilan, kazanılan/kaybedilen anlaşma,
 *    kapanan talep, tamamlanan ziyaret) ve anket görevi üretir. Mükerrer yok: `unique(tenant_id, event_key)`;
 *    tetikleyici açılmadan ÖNCEKİ olaylar için geriye dönük görev üretilmez (en çok 45 gün).
 * 2) Geciken görevler için anketöre ve ofis sahibine günde en fazla bir bildirim yazar.
 * "Anketler" modülünü kapatan ofisler atlanır (kayıtlar silinmez). Tablolar yoksa iş sessizce "ok" döner.
 * Yetki süresi uzatma görevi bu cron'dan değil, tarih değiştirilirken (`updatePropertyAuthorization`) üretilir.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const nowMs = Date.now();
    const todayDate = new Date(nowMs).toISOString().slice(0, 10);

    const { data: triggerRows, error } = await admin
      .from("survey_triggers")
      .select("tenant_id, event_type, enabled, delay_days, max_attempts, enabled_since")
      .eq("enabled", true)
      .limit(5000);
    if (error) {
      if (isSurveySchemaMissing(error)) {
        await recordHeartbeat("anket-gorevleri", "ok", "anket tabloları henüz yok (migration bekleniyor)");
        return NextResponse.json({ ok: true, skipped: "schema" });
      }
      console.error("cron anket-gorevleri tetikleyiciler", error);
      await recordHeartbeat("anket-gorevleri", "error", "tetikleyici sorgusu başarısız");
      return NextResponse.json({ error: "query_failed" }, { status: 500 });
    }

    const disabled = await getDisabledModulesByTenant(admin);
    const byTenant = new Map<string, TriggerRow[]>();
    for (const r of triggerRows ?? []) {
      const tenantId = String(r.tenant_id);
      if (isDisabledFor(disabled, tenantId, "surveys")) continue;
      if (!isSurveyEventType(r.event_type)) continue;
      byTenant.set(tenantId, [
        ...(byTenant.get(tenantId) ?? []),
        {
          event_type: r.event_type,
          enabled: true,
          delay_days: Number(r.delay_days),
          max_attempts: Number(r.max_attempts),
          enabled_since: (r.enabled_since as string | null) ?? null,
        },
      ]);
    }

    let created = 0;
    for (const [tenantId, triggers] of byTenant) {
      try {
        await ensureSurveyDefaults(admin, tenantId);
        const [settings, assigneeIds, load, templates] = await Promise.all([
          loadSurveySettings(admin, tenantId),
          loadAssigneeIds(admin, tenantId),
          loadOpenLoad(admin, tenantId),
          loadActiveTemplateMap(admin, tenantId),
        ]);
        for (const trigger of triggers) {
          const floor = nowMs - LOOKBACK_DAYS * DAY_MS;
          const enabledSince = trigger.enabled_since ? Date.parse(trigger.enabled_since) : floor;
          const since = new Date(Math.max(floor, Number.isFinite(enabledSince) ? enabledSince : floor)).toISOString();
          const candidates = await collectFor(admin, tenantId, trigger.event_type, since, todayDate);
          created += await insertCandidates(admin, tenantId, trigger, candidates, { settings, assigneeIds, load, templates });
        }
      } catch (e) {
        console.error("cron anket-gorevleri ofis", tenantId, e);
      }
    }

    const reminded = await remindOverdue(admin, nowMs, disabled);

    await recordHeartbeat(
      "anket-gorevleri",
      "ok",
      `${byTenant.size} ofis, ${created} yeni görev, ${reminded} gecikme bildirimi${skippedTenantsNote(disabled, "surveys")}`,
    );
    return NextResponse.json({ ok: true, tenants: byTenant.size, created, reminded });
  } catch (e) {
    console.error("cron anket-gorevleri", e);
    await recordHeartbeat("anket-gorevleri", "error", e instanceof Error ? e.message : "bilinmeyen hata");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

async function remindOverdue(
  admin: ReturnType<typeof createAdminClient>,
  nowMs: number,
  disabled: Awaited<ReturnType<typeof getDisabledModulesByTenant>>,
): Promise<number> {
  // En geç eşik 30 gün: daha eski bekleyenler de listelenir; eşik ofis ayarından uygulanır.
  const { data: pending, error } = await admin
    .from("survey_tasks")
    .select("tenant_id, assigned_to, due_at, next_attempt_at, status")
    .eq("status", "pending")
    .lt("due_at", new Date(nowMs - 3_600_000).toISOString())
    .limit(5000);
  if (error || !pending || pending.length === 0) return 0;

  const tenantIds = [...new Set(pending.map((p) => String(p.tenant_id)))].filter((id) => !isDisabledFor(disabled, id, "surveys"));
  if (tenantIds.length === 0) return 0;

  const [{ data: settingRows }, { data: owners }] = await Promise.all([
    admin.from("survey_settings").select("tenant_id, overdue_hours").in("tenant_id", tenantIds),
    admin.from("profiles").select("id, tenant_id").in("tenant_id", tenantIds).eq("role", "owner").eq("is_active", true),
  ]);
  const hoursOf = new Map((settingRows ?? []).map((s) => [String(s.tenant_id), Number(s.overdue_hours) || 48]));
  const ownerOf = new Map<string, string>();
  for (const o of owners ?? []) if (!ownerOf.has(String(o.tenant_id))) ownerOf.set(String(o.tenant_id), String(o.id));

  // tenant -> kullanıcı -> geciken sayısı (atanmamışlar ofis sahibine yazılır)
  const counts = new Map<string, Map<string, number>>();
  for (const p of pending) {
    const tenantId = String(p.tenant_id);
    if (!tenantIds.includes(tenantId)) continue;
    const overdue = isOverdue(
      { status: "pending", due_at: String(p.due_at), next_attempt_at: (p.next_attempt_at as string | null) ?? null },
      nowMs,
      hoursOf.get(tenantId) ?? 48,
    );
    if (!overdue) continue;
    const userId = (p.assigned_to as string | null) ?? ownerOf.get(tenantId) ?? null;
    if (!userId) continue;
    const perUser = counts.get(tenantId) ?? new Map<string, number>();
    perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
    counts.set(tenantId, perUser);
  }
  if (counts.size === 0) return 0;

  const notified = await findNotifiedIds(admin, {
    href: OVERDUE_HREF,
    tenantIds: [...counts.keys()],
    sinceIso: new Date(nowMs - 20 * 3_600_000).toISOString(),
    markerPrefix: "anket",
  });

  const rows: NotificationRow[] = [];
  for (const [tenantId, perUser] of counts) {
    for (const [userId, n] of perUser) {
      if (notified.has(userId.toLowerCase())) continue;
      rows.push({
        tenant_id: tenantId,
        user_id: userId,
        title: `${n} anket görevi gecikti`,
        body: `Arama zamanı geçen ${n} anket görevi bekliyor · anket:${userId}`,
        href: OVERDUE_HREF,
        kind: "warning",
      });
    }
  }
  return insertNotifications(admin, rows);
}
