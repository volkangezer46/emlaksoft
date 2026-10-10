import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { heartbeatFor, failureNote } from "@/lib/cron-heartbeat-status";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { findNotifiedIds, insertNotificationsDetailed, type NotificationRow } from "@/lib/notify-batch";
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
import { dispatchSurveyLinks } from "@/lib/surveys/dispatch";
import { sendPulseInvites } from "@/lib/surveys/pulse";
import { authorizeCron } from "@/lib/cron-auth";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

const LOOKBACK_DAYS = 45;
/** Gönderim adımı bu süreden sonra yeni ofiste başlamaz (300 sn tavanın altında kalmak için). */
const SEND_BUDGET_MS = 200_000;
const OVERDUE_HREF = "/app/anketler/kuyruk?durum=geciken";
const DAY_MS = 86_400_000;

/**
 * Anket görevleri cron'u (günlük 06:20 — vercel.json).
 *
 * 1) Açık tetikleyicisi olan her ofis için olayları tarar (yayından kalkan ilan, kazanılan/kaybedilen anlaşma,
 *    kapanan talep, tamamlanan ziyaret) ve anket görevi üretir. Mükerrer yok: `unique(tenant_id, event_key)`;
 *    tetikleyici açılmadan ÖNCEKİ olaylar için geriye dönük görev üretilmez (en çok 45 gün).
 *    Kira olayları (bitişe 60 gün, kiracı yıl dönümü) da buradan üretilir; ekip nabzı aylık DAVET bildirimidir.
 *    Ofis "otomatik gönder" açtıysa vadesi gelen bağlantılar SMS/WhatsApp ile gönderilir (İYS izni, sınır, dedupe:
 *    `dispatch.ts`).
 * 2) Geciken görevler için anketöre ve ofis sahibine günde en fazla bir bildirim yazar.
 * "Anketler" modülünü kapatan ofisler atlanır (kayıtlar silinmez). Tablolar yoksa iş sessizce "ok" döner.
 * Yetki süresi uzatma görevi bu cron'dan değil, tarih değiştirilirken (`updatePropertyAuthorization`) üretilir.
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  try {
    const admin = createAdminClient();
    const nowMs = Date.now();
    const todayDate = new Date(nowMs).toISOString().slice(0, 10);

    type TriggerDbRow = { tenant_id: string; event_type: string; enabled: boolean; delay_days: number; max_attempts: number; enabled_since: string | null };
    const triggerRes = await readAllPaged<TriggerDbRow>(
      (from, to) =>
        admin
          .from("survey_triggers")
          .select("tenant_id, event_type, enabled, delay_days, max_attempts, enabled_since")
          .eq("enabled", true)
          .order("tenant_id", { ascending: true })
          .order("event_type", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: TriggerDbRow[] | null; error: { message: string; code?: string } | null }>,
    );
    const triggerRows = triggerRes.rows;
    let truncated = triggerRes.truncated;
    let failed = 0;
    const error = triggerRes.error ? { message: triggerRes.error } : null;
    if (error) {
      if (isSurveySchemaMissing(error)) {
        await recordHeartbeat("anket-gorevleri", "ok", "atlandı: anket tabloları henüz yok (migration bekleniyor)");
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
    let sent = 0;
    let sendFailed = 0;
    let pulseInvites = 0;
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
          if (trigger.event_type === "advisor_pulse") {
            // Ekip nabzı kişiye bağlı görev üretmez: aylık davet bildirimi (cevap anonim RPC ile).
            pulseInvites += await sendPulseInvites(admin, tenantId, trigger, nowMs);
            continue;
          }
          const floor = nowMs - LOOKBACK_DAYS * DAY_MS;
          const enabledSince = trigger.enabled_since ? Date.parse(trigger.enabled_since) : floor;
          const since = new Date(Math.max(floor, Number.isFinite(enabledSince) ? enabledSince : floor)).toISOString();
          const candidates = await collectFor(admin, tenantId, trigger.event_type, since, todayDate);
          created += await insertCandidates(admin, tenantId, trigger, candidates, { settings, assigneeIds, load, templates });
        }
        // Otomatik gönderim (ayar açık + kanal hazır + İYS izni); süre bütçesi aşıldıysa bu tur atlanır.
        if (settings.auto_send && Date.now() - nowMs < SEND_BUDGET_MS) {
          const d = await dispatchSurveyLinks(admin, tenantId, settings, nowMs);
          sent += d.sent;
          sendFailed += d.failed;
        }
      } catch (e) {
        console.error("cron anket-gorevleri ofis", tenantId, e);
        failed += 1;
      }
    }

    const remind = await remindOverdue(admin, nowMs, disabled);
    const reminded = remind.notified;
    failed += remind.failed;
    if (remind.truncated) truncated = true;

    await recordHeartbeat(
      "anket-gorevleri",
      heartbeatFor({ failed: failed + sendFailed, truncated }),
      `${byTenant.size} ofis, ${created} yeni görev, ${sent} bağlantı gönderildi${sendFailed ? ` (${sendFailed} başarısız)` : ""}, ${pulseInvites} ekip nabzı daveti, ${reminded} gecikme bildirimi${skippedTenantsNote(disabled, "surveys")}${failureNote({ failed, truncated })}`,
    );
    return NextResponse.json({ ok: true, tenants: byTenant.size, created, sent, sendFailed, pulseInvites, reminded });
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
): Promise<{ notified: number; failed: number; truncated: boolean }> {
  // En geç eşik 30 gün: daha eski bekleyenler de listelenir; eşik ofis ayarından uygulanır.
  type PendingRow = { id: string; tenant_id: string; assigned_to: string | null; due_at: string; next_attempt_at: string | null; status: string };
  const pendingRes = await readAllPaged<PendingRow>(
    (from, to) =>
      admin
        .from("survey_tasks")
        .select("id, tenant_id, assigned_to, due_at, next_attempt_at, status")
        .eq("status", "pending")
        .lt("due_at", new Date(nowMs - 3_600_000).toISOString())
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: PendingRow[] | null; error: { message: string } | null }>,
  );
  const pending = pendingRes.rows;
  const baseFailed = pendingRes.error ? 1 : 0;
  const truncated = pendingRes.truncated;
  if (pending.length === 0) return { notified: 0, failed: baseFailed, truncated };

  const tenantIds = [...new Set(pending.map((p) => String(p.tenant_id)))].filter((id) => !isDisabledFor(disabled, id, "surveys"));
  if (tenantIds.length === 0) return { notified: 0, failed: baseFailed, truncated };

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
  if (counts.size === 0) return { notified: 0, failed: baseFailed, truncated };

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
  const ins = await insertNotificationsDetailed(admin, rows);
  return { notified: ins.written, failed: baseFailed + ins.failed, truncated };
}
