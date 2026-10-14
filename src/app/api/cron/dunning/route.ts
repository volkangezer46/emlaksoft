import { guardCron } from "@/lib/cron-run";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { findNotifiedIds, insertNotificationsDetailed, type NotificationRow } from "@/lib/notify-batch";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { heartbeatFor, failureNote } from "@/lib/cron-heartbeat-status";
import { runAutoRenewPass } from "@/lib/billing/auto-renew";
import { authorizeCron } from "@/lib/cron-auth";
import { beginCronRun } from "@/lib/cron-pause";
import { now as clockNow } from "@/lib/clock";
import { getBaseUrl } from "@/lib/base-url";
import {
  BILLING_HREF,
  CARD_UPDATE_HREF,
  dunningMessage,
  finalWarningDay,
  finalWarningMessage,
  loadDunningPolicy,
  stageOf,
  type DunningMessageVars,
} from "@/lib/billing/dunning-policy";

/**
 * DUNNING: gecikmiş ödemeler için kademeli tahsilat akışı. Politika ADMINDEN gelir (`dunning.*` ayarları,
 * `/admin/billing/tahsilat#ayarlar`; okuyucu `src/lib/billing/dunning-policy.ts`). Varsayılanlar bugünkü davranıştır.
 *
 * - Gecikmiş AÇIK faturalar: vade aşımına göre ayarlı kademe günleri (varsayılan 1/4/8); `reminder_count` hangi
 *   kademenin gönderildiğini tutar, bu sayede günlük çalıştırmada mükerrer bildirim oluşmaz.
 * - Kademe kanalları: uygulama içi her zaman; e-posta (Resend) / SMS (platform Netgsm) kademe ayarında seçiliyse.
 *   Kanal yapılandırılmamışsa gönderim YAPILMAZ ve `dunning_events`'e `channel_disabled` ("kanal kapalı") düşer.
 *   Her fatura+kademe+kanal tek satırdır (önce talep satırı, sonra gönderim → mükerrer dış gönderim yok).
 * - Otomatik askı KAPALIYKEN (varsayılan): son kademede platform personeline "askıya alma adayı" bildirimi (bugünkü
 *   davranış). AÇIKKEN: askı gününden `final_warning_days` önce ofise son uyarı; askı gününde hâlâ ödenmemiş ofis
 *   `suspended` olur, platform denetimine `tenant.suspend` (kaynak: dunning) yazılır. Ödeme gelince ofis aktifleşir.
 * - past_due abonelik olup gecikmiş faturası OLMAYAN tenant'lara 3 günde bir marker (`dunsub:<id>`) ile tekrar korumalı
 *   genel hatırlatma gönderilir.
 *
 * Zamanlama (vercel.json'da tanımlı): "0 9 * * *" (her gün 09:00 UTC = 12:00 TR)
 */

const DAY_MS = 86_400_000;
/** Sorgu tavanı: dolarsa liste kesildi sayılır (heartbeat error). */
const LIST_LIMIT = 500;
/** Askıya alınabilir ofis durumları (deneme/iptal/askı dokunulmaz). */
const SUSPENDABLE = ["active", "past_due"];

type EventStage = "stage1" | "stage2" | "stage3" | "final_warning" | "suspend" | "candidate";
type EventRow = {
  tenant_id: string;
  invoice_id: string;
  stage: EventStage;
  channel: "in_app" | "email" | "sms" | "staff" | "system";
  result: "pending" | "sent" | "channel_disabled" | "no_recipient" | "failed" | "suspended";
  detail?: string | null;
};
type ExternalJob = { tenantId: string; invoiceId: string; stage: EventStage; email: boolean; sms: boolean; title: string; body: string };

/** Tablo yok (migration bekliyor) — hata sayılmaz; dış kanallar atlanır. */
function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (/dunning_events/.test(error.message ?? "") && /does not exist|schema cache/.test(error.message ?? ""))
  );
}

function relName(t: unknown): { name?: string; status?: string } | null {
  if (!t) return null;
  return (Array.isArray(t) ? t[0] : t) as { name?: string; status?: string } | null;
}

/** Uzun süren toplu işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

async function run(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const pausedRun = await beginCronRun("dunning", req);
  if (pausedRun) return pausedRun;

  const admin = createAdminClient();
  const now = clockNow();
  const nowIso = new Date(now).toISOString();
  const base = getBaseUrl();

  let failed = 0;
  const [policy, { data: overdueInvoices, error: invErr }, { data: pastDueSubs, error: subErr }] = await Promise.all([
    loadDunningPolicy(),
    admin
      .from("invoices")
      .select("id, tenant_id, invoice_no, due_at, reminder_count, tenant:tenants(name, status)")
      .eq("status", "open")
      .not("due_at", "is", null)
      .lt("due_at", nowIso)
      .limit(LIST_LIMIT),
    admin
      .from("subscriptions")
      .select("id, tenant_id, current_period_end")
      .eq("status", "past_due")
      .limit(LIST_LIMIT),
  ]);
  // Sorgu hatası "bildirilecek kimse yok" değildir: sayaca girer, heartbeat error olur.
  if (invErr) { console.error("dunning invoices", invErr.message); failed += 1; }
  if (subErr) { console.error("dunning subs", subErr.message); failed += 1; }

  const invoices = overdueInvoices ?? [];
  const subs = pastDueSubs ?? [];
  const truncated = invoices.length >= LIST_LIMIT || subs.length >= LIST_LIMIT;
  const lastStage = policy.stages[policy.stages.length - 1]?.stage ?? 0;
  const suspendDay = policy.autoSuspendDays > 0 ? policy.autoSuspendDays : null;
  const warnDay = finalWarningDay(policy);
  const lastStageDef = policy.stages[policy.stages.length - 1];

  // ---- 1) Gecikmiş faturalar: kademe, son uyarı, askı ----
  const toNotify: NotificationRow[] = [];
  const idsByStage = new Map<number, string[]>();
  const inAppEvents: EventRow[] = [];
  const external: ExternalJob[] = [];
  type SuspendTarget = { invoiceId: string; invoiceNo: string; daysOverdue: number; tenantName: string };
  const suspendTargets = new Map<string, SuspendTarget>();
  /** Askı günü gelmiş faturalar: son uyarı kapısından geçince askı hedefi olur. */
  const suspendDue: (SuspendTarget & { tenantId: string; vars: DunningMessageVars })[] = [];
  let suspensionCandidates = 0;

  for (const inv of invoices) {
    const daysOverdue = Math.floor((now - new Date(inv.due_at as string).getTime()) / DAY_MS);
    const tenantId = String(inv.tenant_id);
    const t = relName(inv.tenant);
    const tenantName = t?.name ?? "Bir ofis";
    const vars: DunningMessageVars = {
      ofis: tenantName,
      fatura: String(inv.invoice_no),
      gun: daysOverdue,
      odeme_linki: `${base}${BILLING_HREF}`,
      kart_linki: `${base}${CARD_UPDATE_HREF}`,
    };
    const stage = stageOf(daysOverdue, policy.stages);
    const sent = Number(inv.reminder_count ?? 0);

    if (stage && stage.stage > sent) {
      const msg = dunningMessage(stage, lastStage, vars);
      toNotify.push({
        tenant_id: tenantId,
        title: msg.title,
        body: msg.body,
        href: BILLING_HREF,
        kind: msg.kind,
        // Aynı fatura+kademe için ikinci bildirim yazılmaz (sayaç güncellemesi başarısız olsa da).
        dedupe_key: `dunning:${inv.id}:${stage.stage}`,
      });
      idsByStage.set(stage.stage, [...(idsByStage.get(stage.stage) ?? []), inv.id]);
      const ev = `stage${stage.stage}` as EventStage;
      inAppEvents.push({ tenant_id: tenantId, invoice_id: inv.id, stage: ev, channel: "in_app", result: "sent" });
      if (stage.email || stage.sms) {
        external.push({ tenantId, invoiceId: inv.id, stage: ev, email: stage.email, sms: stage.sms, title: msg.title, body: msg.body });
      }

      // Otomatik askı KAPALI (varsayılan): son kademede personele aday bildirimi (bugünkü davranış).
      if (stage.stage >= lastStage && !suspendDay) {
        suspensionCandidates += 1;
        try {
          await notifyPlatformStaff({
            title: "Askıya alma adayı",
            body: `${tenantName} · ${inv.invoice_no} faturası ${daysOverdue} gündür ödenmedi (${lastStage} hatırlatma tamamlandı).`,
            href: `/admin/tenants/${tenantId}`,
            kind: "danger",
            meta: { invoice_id: inv.id, tenant_id: tenantId, days_overdue: daysOverdue },
          });
          inAppEvents.push({ tenant_id: tenantId, invoice_id: inv.id, stage: "candidate", channel: "staff", result: "sent" });
        } catch (e) {
          console.error("dunning platform notify", e instanceof Error ? e.message : "error");
          failed += 1;
        }
      }
    }

    if (suspendDay && warnDay !== null && daysOverdue >= warnDay && daysOverdue < suspendDay) {
      const msg = finalWarningMessage(vars, suspendDay);
      // Günlük koşuda tekrar yazılmaz: dedupe_key fatura başına tek son uyarı.
      toNotify.push({ tenant_id: tenantId, title: msg.title, body: msg.body, href: BILLING_HREF, kind: msg.kind, dedupe_key: `dunning:${inv.id}:final` });
      inAppEvents.push({ tenant_id: tenantId, invoice_id: inv.id, stage: "final_warning", channel: "in_app", result: "sent" });
      if (lastStageDef && (lastStageDef.email || lastStageDef.sms)) {
        external.push({ tenantId, invoiceId: inv.id, stage: "final_warning", email: lastStageDef.email, sms: lastStageDef.sms, title: msg.title, body: msg.body });
      }
    }

    if (suspendDay && daysOverdue >= suspendDay && SUSPENDABLE.includes(String(t?.status ?? ""))) {
      suspendDue.push({ tenantId, vars, invoiceId: inv.id, invoiceNo: String(inv.invoice_no), daysOverdue, tenantName });
    }
  }

  // ---- 1a) Son uyarı kapısı: askıdan önce ofis son uyarıyı en az final_warning_days önce almış olmalı ----
  // Askı yeni açıldığında (ya da gün kısaltıldığında) askı gününü çoktan geçmiş ofisler son uyarı görmeden askıya
  // alınmaz: uyarı yoksa ŞİMDİ gönderilir, askı final_warning_days sonraya kalır. final_warning_days=0 → kapı yok.
  if (suspendDay && suspendDue.length > 0) {
    let warnedAt: Map<string, number> | null = new Map();
    if (warnDay !== null) {
      const { data, error } = await admin
        .from("notifications")
        .select("dedupe_key, created_at")
        .in("tenant_id", [...new Set(suspendDue.map((d) => d.tenantId))])
        .in("dedupe_key", suspendDue.map((d) => `dunning:${d.invoiceId}:final`))
        .limit(suspendDue.length);
      if (error) {
        // Okunamadı: güvenli taraf — bu koşuda askı yok, yeniden uyarı da yok (dedupe_key zaten korur).
        console.error("dunning final warning lookup", error.message);
        failed += 1;
        warnedAt = null;
      } else {
        for (const r of (data ?? []) as { dedupe_key: string; created_at: string }[]) {
          warnedAt.set(r.dedupe_key, new Date(r.created_at).getTime());
        }
      }
    }
    // Günlük koşu saati kayabilir: yarım gün tolerans (2 gün önceki koşudaki uyarı "2 gün" sayılır).
    const minGap = policy.finalWarningDays * DAY_MS - DAY_MS / 2;
    for (const d of warnedAt ? suspendDue : []) {
      if (suspendTargets.has(d.tenantId)) continue;
      if (warnDay === null) {
        suspendTargets.set(d.tenantId, d);
        continue;
      }
      const key = `dunning:${d.invoiceId}:final`;
      const at = warnedAt!.get(key);
      if (at !== undefined) {
        if (now - at >= minGap) suspendTargets.set(d.tenantId, d);
        continue;
      }
      // Son uyarı hiç gitmemiş: şimdi gönder, askı final_warning_days sonra.
      const msg = finalWarningMessage(d.vars, d.daysOverdue + policy.finalWarningDays);
      toNotify.push({ tenant_id: d.tenantId, title: msg.title, body: msg.body, href: BILLING_HREF, kind: msg.kind, dedupe_key: key });
      inAppEvents.push({ tenant_id: d.tenantId, invoice_id: d.invoiceId, stage: "final_warning", channel: "in_app", result: "sent" });
      if (lastStageDef && (lastStageDef.email || lastStageDef.sms)) {
        external.push({ tenantId: d.tenantId, invoiceId: d.invoiceId, stage: "final_warning", email: lastStageDef.email, sms: lastStageDef.sms, title: msg.title, body: msg.body });
      }
    }
  }

  // Önce bildirimler yazılır, SONRA sayaç güncellenir: insert başarısızsa
  // sayaç ilerlemez ve bir sonraki cron aynı kademeyi yeniden dener
  // (tersi sırada bildirim sessizce kaybolurdu). Mükerrer riski yalnız
  // "insert oldu + update olamadı" penceresinde — kayıptan iyidir.
  const invoiceResult = await insertNotificationsDetailed(admin, toNotify);
  const invoiceNotified = invoiceResult.written;
  failed += invoiceResult.failed;

  // Kısmi yazımda (failed > 0) sayaç ilerletilmez: dedupe_key sayesinde yeniden deneme mükerrer üretmez.
  if (invoiceResult.failed === 0) {
    // Sayaç güncellemeleri kademe başına tek UPDATE (en fazla 3 sorgu)
    for (const [stage, ids] of idsByStage) {
      const { error } = await admin
        .from("invoices")
        .update({ reminder_count: stage, last_reminder_at: nowIso })
        .in("id", ids);
      if (error) {
        console.error("dunning reminder_count update", error.message);
        failed += 1;
      }
    }
  }

  // ---- 1b) Tahsilat günlüğü (uygulama içi olaylar; tablo yoksa sessizce atlanır) ----
  let eventsReady = true;
  if (inAppEvents.length > 0 && invoiceResult.failed === 0) {
    const { error } = await admin
      .from("dunning_events")
      .upsert(inAppEvents, { onConflict: "invoice_id,stage,channel", ignoreDuplicates: true });
    if (isMissingTable(error)) eventsReady = false;
    else if (error) {
      console.error("dunning events", error.message);
      failed += 1;
    }
  }

  // ---- 1c) Dış kanallar (e-posta / SMS) ----
  const ext = eventsReady ? await deliverExternal(admin, external) : { sent: 0, disabled: 0, failed: 0, skipped: external.length };
  failed += ext.failed;

  // ---- 1d) Otomatik yenileme (KAPALI bayrak: billing.auto_renew_enabled; kapalıyken ödeme kod yolu çalışmaz) ----
  // Bildirimler yukarıda her zamanki gibi gider; tahsilat başarısızsa bu akış değişmez (ek bildirim eklenir).
  // Deneme sayısı ve aralığı politikadan (adminden) gelir.
  let autoRenew: Awaited<ReturnType<typeof runAutoRenewPass>> = { enabled: false, attempted: 0, charged: 0, failed: 0, skipped: 0 };
  let renewThrew = 0;
  try {
    autoRenew = await runAutoRenewPass(admin, now, policy);
  } catch (e) {
    console.error("dunning auto-renew", e instanceof Error ? e.message : "error");
    renewThrew = 1;
  }
  failed += autoRenew.failed + renewThrew;

  // Tahsilat bu koşuda başarılıysa askı hedefleri yeniden doğrulanır: kartla ödenen ofis askıya alınmaz
  // (yanıltıcı "askıya alındı" bildirimi ve gereksiz denetim kaydı oluşmaz).
  if (suspendTargets.size > 0 && autoRenew.charged > 0) {
    const ids = [...suspendTargets.values()].map((x) => x.invoiceId);
    const { data, error } = await admin.from("invoices").select("id").in("id", ids).eq("status", "open");
    if (error) {
      console.error("dunning suspend recheck", error.message);
      failed += 1;
      suspendTargets.clear();
    } else {
      const open = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
      for (const [tid, x] of suspendTargets) if (!open.has(x.invoiceId)) suspendTargets.delete(tid);
    }
  }

  // ---- 1e) Otomatik askı (yalnız ayar açıkken; son uyarı kapısından geçenler) ----
  let suspended = 0;
  for (const [tenantId, s] of suspendTargets) {
    const r = await suspendTenant(admin, tenantId, s, suspendDay ?? 0);
    if (r.suspended) suspended += 1;
    if (r.failed) failed += 1;
  }

  // ---- 2) past_due abonelik + gecikmiş faturası olmayan tenant'lar ----
  // Sayaç yok → marker (`dunsub:<sub_id>`) ile 3 günde bir tekrar koruması.
  const invoiceTenants = new Set(invoices.map((i) => String(i.tenant_id)));
  const subOnly = subs.filter((s) => !invoiceTenants.has(String(s.tenant_id)));
  let subNotified = 0;

  if (subOnly.length > 0) {
    const since = new Date(now - 3 * DAY_MS).toISOString();
    const already = await findNotifiedIds(admin, {
      href: BILLING_HREF,
      tenantIds: subOnly.map((s) => String(s.tenant_id)),
      sinceIso: since,
      markerPrefix: "dunsub",
    });

    const subRows: NotificationRow[] = subOnly
      .filter((s) => !already.has(String(s.id).toLowerCase()))
      .map((s) => ({
        tenant_id: String(s.tenant_id),
        title: "Ödemeniz gecikti",
        body: `Aboneliğinizin ödemesi gecikmiş görünüyor. Hizmet kesintisi yaşamamak için lütfen ödemenizi tamamlayın. · dunsub:${s.id}`,
        href: BILLING_HREF,
        kind: "warning",
        // 3 günlük pencere anahtarı: gövde izi okunamasa da aynı pencerede ikinci kez yazılmaz.
        dedupe_key: `dunsub:${s.id}:${Math.floor(now / (3 * DAY_MS))}`,
      }));
    const subResult = await insertNotificationsDetailed(admin, subRows);
    subNotified = subResult.written;
    failed += subResult.failed;
  }

  await recordHeartbeat(
    "dunning",
    heartbeatFor({ failed, truncated }),
    `${invoiceNotified} fatura hatırlatması, ${subNotified} abonelik hatırlatması, ${suspensionCandidates} askıya alma adayı` +
      (suspendDay ? `, ${suspended} otomatik askı` : "") +
      (ext.sent > 0 ? `, ${ext.sent} e-posta/SMS` : "") +
      (ext.disabled > 0 ? `, ${ext.disabled} kanal kapalı` : "") +
      (!eventsReady && external.length > 0 ? `, ${external.length} dış kanal atlandı (tahsilat günlüğü migration bekliyor)` : "") +
      (autoRenew.enabled ? `, otomatik yenileme ${autoRenew.charged}/${autoRenew.attempted}` : "") +
      failureNote({ failed, truncated }),
  );

  return NextResponse.json({
    ok: true,
    invoiceNotified,
    subNotified,
    suspensionCandidates,
    suspended,
    external: ext,
    failed,
    truncated,
    autoRenew,
  });
}

/**
 * Dış kanal gönderimi. Kanal kapalıysa (anahtar yok) gönderim YAPILMAZ, günlüğe `channel_disabled` düşer. Kanal açıksa
 * önce `pending` talep satırı yazılır (benzersiz: fatura+kademe+kanal); satır zaten varsa gönderilmez.
 */
async function deliverExternal(admin: SupabaseClient, jobs: ExternalJob[]) {
  const out = { sent: 0, disabled: 0, failed: 0, skipped: 0 };
  if (jobs.length === 0) return out;

  const needEmail = jobs.some((j) => j.email);
  const needSms = jobs.some((j) => j.sms);
  const [emailCfg, smsCfg] = await Promise.all([
    needEmail
      ? import("@/lib/email/provider").then((m) => m.resolveEmailChannelConfig()).catch(() => ({ enabled: false, reason: "E-posta yapılandırması okunamadı" }))
      : null,
    needSms ? import("@/lib/messaging/netgsm").then((m) => m.getNetgsmConfig()).catch(() => null) : null,
  ]);
  const emailOn = Boolean(emailCfg?.enabled);
  const smsOn = Boolean(smsCfg);

  // Alıcılar: ofis sahibi (aktif). Yalnız açık kanal varsa okunur.
  const tenantIds = [...new Set(jobs.filter((j) => (j.email && emailOn) || (j.sms && smsOn)).map((j) => j.tenantId))];
  const owners = new Map<string, { id: string; phone: string | null; email?: string | null }>();
  if (tenantIds.length > 0) {
    const { data } = await admin
      .from("profiles")
      .select("id, tenant_id, phone, created_at")
      .in("tenant_id", tenantIds)
      .eq("role", "owner")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(tenantIds.length * 3);
    for (const p of (data ?? []) as { id: string; tenant_id: string; phone: string | null }[]) {
      if (!owners.has(p.tenant_id)) owners.set(p.tenant_id, { id: p.id, phone: p.phone });
    }
  }

  /** Yeni satır yazıldıysa true (yinelenen satır yok sayılır → sayaç her gün şişmez). */
  const logRow = async (row: EventRow): Promise<boolean> => {
    const { data, error } = await admin
      .from("dunning_events")
      .upsert([row], { onConflict: "invoice_id,stage,channel", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error("dunning event", error.message);
      out.failed += 1;
      return false;
    }
    return ((data as unknown[] | null) ?? []).length > 0;
  };

  for (const j of jobs) {
    for (const channel of ["email", "sms"] as const) {
      if (!j[channel]) continue;
      const on = channel === "email" ? emailOn : smsOn;
      const base = { tenant_id: j.tenantId, invoice_id: j.invoiceId, stage: j.stage, channel };
      if (!on) {
        // Kanal kapalı: sahte gönderim yok; günlüğe "kanal kapalı" yazılır.
        console.info(`dunning ${j.stage} ${channel}: kanal kapalı`);
        const fresh = await logRow({ ...base, result: "channel_disabled", detail: `kanal kapalı${channel === "email" && emailCfg?.reason ? `: ${emailCfg.reason}` : channel === "sms" ? ": platform Netgsm hesabı tanımlı değil" : ""}`.slice(0, 300) });
        if (fresh) out.disabled += 1;
        continue;
      }
      // Talep satırı: zaten varsa (önceki koşu) gönderilmez.
      const { data: claimed, error: claimErr } = await admin
        .from("dunning_events")
        .upsert([{ ...base, result: "pending" }], { onConflict: "invoice_id,stage,channel", ignoreDuplicates: true })
        .select("id");
      if (claimErr) {
        console.error("dunning claim", claimErr.message);
        out.failed += 1;
        continue;
      }
      const claimId = (claimed as { id: number }[] | null)?.[0]?.id;
      if (claimId == null) {
        out.skipped += 1;
        continue;
      }
      const owner = owners.get(j.tenantId);
      let result: EventRow["result"] = "no_recipient";
      let detail: string | null = null;
      if (owner) {
        if (channel === "email") {
          if (owner.email === undefined) {
            const { data: u } = await admin.auth.admin.getUserById(owner.id);
            owner.email = u.user?.email ?? null;
          }
          if (owner.email) {
            const { sendEmail } = await import("@/lib/email/provider");
            const r = await sendEmail({ to: owner.email, subject: j.title, text: j.body });
            result = r.ok ? "sent" : r.code === "disabled" ? "channel_disabled" : "failed";
            detail = r.ok ? null : r.code === "disabled" ? `kanal kapalı: ${r.error}` : r.error;
          }
        } else if (owner.phone) {
          const [{ sendSmsWithConfig }, { withSmsLog }] = await Promise.all([import("@/lib/messaging/netgsm"), import("@/lib/messaging/message-log")]);
          const phone = owner.phone;
          const text = j.body.slice(0, 300);
          // SMS/WhatsApp günlüğü (SN3): ofise giden tahsilat SMS'i Ofis 360 "İletişim"te görünür.
          const r = await withSmsLog("platform", { source: "dunning", tenantId: j.tenantId, audience: "office" }, phone, text, () =>
            sendSmsWithConfig(smsCfg!, phone, text),
          );
          result = r.ok ? "sent" : "failed";
          detail = r.ok ? null : (r.error ?? r.code ?? "SMS gönderilemedi");
        }
      }
      if (result === "sent") out.sent += 1;
      else if (result === "failed") out.failed += 1;
      else if (result === "channel_disabled") out.disabled += 1;
      const { error } = await admin
        .from("dunning_events")
        .update({ result, detail: detail ? detail.slice(0, 300) : null })
        .eq("id", claimId);
      if (error) console.error("dunning event update", error.message);
    }
  }
  return out;
}

/**
 * Otomatik askı: yalnız active/past_due ofis, koşullu güncelleme (eşzamanlı ödeme/yönetici işlemiyle yarışmaz).
 * Abonelik `past_due` kalır: ödeme gelince fulfill ofisi yeniden `active` yapar; askıdaki ofis Abonelik ekranına erişir.
 */
async function suspendTenant(
  admin: SupabaseClient,
  tenantId: string,
  s: { invoiceId: string; invoiceNo: string; daysOverdue: number; tenantName: string },
  suspendDay: number,
): Promise<{ suspended: boolean; failed: boolean }> {
  const { data, error } = await admin
    .from("tenants")
    .update({ status: "suspended", updated_at: new Date(clockNow()).toISOString() })
    .eq("id", tenantId)
    .in("status", SUSPENDABLE)
    .select("id");
  if (error) {
    console.error("dunning suspend", error.message);
    return { suspended: false, failed: true };
  }
  if (!data || data.length === 0) return { suspended: false, failed: false };

  const meta = { source: "dunning", auto: true, invoice_id: s.invoiceId, invoice_no: s.invoiceNo, days_overdue: s.daysOverdue, suspend_day: suspendDay };
  const [audit, ev, note] = await Promise.all([
    admin.from("platform_audit_logs").insert({ actor_id: null, action: "tenant.suspend", entity_type: "tenant", entity_id: tenantId, meta }),
    admin
      .from("dunning_events")
      .upsert([{ tenant_id: tenantId, invoice_id: s.invoiceId, stage: "suspend", channel: "system", result: "suspended", detail: `${s.daysOverdue}. gün otomatik askı` }], {
        onConflict: "invoice_id,stage,channel",
        ignoreDuplicates: true,
      }),
    insertNotificationsDetailed(admin, [
      {
        tenant_id: tenantId,
        title: "Hesabınız askıya alındı",
        body: `${s.invoiceNo} numaralı faturanız ${s.daysOverdue} gündür ödenmediği için hesabınız askıya alındı. Ödemenizi tamamladığınızda hesabınız otomatik olarak yeniden açılır.`,
        href: BILLING_HREF,
        kind: "danger",
        dedupe_key: `dunning:${s.invoiceId}:suspend`,
      },
    ]),
  ]);
  if (audit.error) console.error("dunning suspend audit", audit.error.message);
  if (ev.error && !isMissingTable(ev.error)) console.error("dunning suspend event", ev.error.message);
  try {
    await notifyPlatformStaff({
      title: "Ofis otomatik askıya alındı",
      body: `${s.tenantName} · ${s.invoiceNo} faturası ${s.daysOverdue} gündür ödenmedi; tahsilat politikası gereği askıya alındı.`,
      href: `/admin/tenants/${tenantId}`,
      kind: "danger",
      meta,
    });
  } catch (e) {
    console.error("dunning suspend staff notify", e instanceof Error ? e.message : "error");
  }
  // Denetim kaydı yazılamadıysa askı yine geçerlidir ama koşu hata sayılır (sessiz denetim boşluğu olmaz).
  return { suspended: true, failed: Boolean(audit.error) || note.failed > 0 };
}

export const GET = guardCron("dunning", run);
