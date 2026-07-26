import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findNotifiedIds, insertNotifications, type NotificationRow } from "@/lib/notify-batch";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { recordHeartbeat } from "@/lib/cron-heartbeat";

/**
 * DUNNING: gecikmiş ödemeler için kademeli tenant bildirimi (e-posta yok).
 *
 * - Gecikmiş AÇIK faturalar: vade aşımına göre 1. gün / 4. gün / 8. gün
 *   kademeleri; `reminder_count` hangi kademenin gönderildiğini tutar, bu
 *   sayede günlük çalıştırmada mükerrer bildirim oluşmaz.
 * - 8. gün kademesinde ayrıca platform personeline "askıya alma adayı"
 *   bildirimi düşer.
 * - past_due abonelik olup gecikmiş faturası OLMAYAN tenant'lara 3 günde bir
 *   marker (`dunsub:<id>`) ile tekrar korumalı genel hatırlatma gönderilir.
 *
 * Önerilen zamanlama (vercel.json'a eklenecek): "0 9 * * *" (her gün 09:00 UTC)
 */

const DAY_MS = 86_400_000;
const BILLING_HREF = "/app/abonelik";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Vade aşım gününe göre kademe: 1+ gün → 1, 4+ gün → 2, 8+ gün → 3. */
function stageOf(daysOverdue: number): number {
  if (daysOverdue >= 8) return 3;
  if (daysOverdue >= 4) return 2;
  if (daysOverdue >= 1) return 1;
  return 0;
}

function stageMessage(stage: number, invoiceNo: string, daysOverdue: number) {
  if (stage >= 3) {
    return {
      title: "Ödemeniz 8 gündür gecikmiş — hesabınız askıya alınabilir",
      body: `${invoiceNo} numaralı faturanız ${daysOverdue} gündür ödenmedi. Hizmet kesintisi yaşamamak için lütfen ödemenizi hemen tamamlayın.`,
      kind: "danger" as const,
    };
  }
  if (stage === 2) {
    return {
      title: "Ödemeniz gecikti — lütfen en kısa sürede tamamlayın",
      body: `${invoiceNo} numaralı faturanızın vadesi ${daysOverdue} gün önce doldu. Hizmet kesintisi yaşamamak için ödemenizi tamamlamanızı rica ederiz.`,
      kind: "warning" as const,
    };
  }
  return {
    title: "Ödemeniz gecikti",
    body: `${invoiceNo} numaralı faturanızın vadesi geçti. Hizmet kesintisi yaşamamak için lütfen ödemenizi tamamlayın.`,
    kind: "warning" as const,
  };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const [{ data: overdueInvoices }, { data: pastDueSubs }] = await Promise.all([
    admin
      .from("invoices")
      .select("id, tenant_id, invoice_no, due_at, reminder_count, tenant:tenants(name)")
      .eq("status", "open")
      .not("due_at", "is", null)
      .lt("due_at", nowIso)
      .limit(500),
    admin
      .from("subscriptions")
      .select("id, tenant_id, current_period_end")
      .eq("status", "past_due")
      .limit(500),
  ]);

  const invoices = overdueInvoices ?? [];
  const subs = pastDueSubs ?? [];

  // ---- 1) Gecikmiş faturalar: reminder_count kademesine göre ----
  const toNotify: NotificationRow[] = [];
  const idsByStage = new Map<number, string[]>();
  let suspensionCandidates = 0;

  for (const inv of invoices) {
    const daysOverdue = Math.floor((now - new Date(inv.due_at as string).getTime()) / DAY_MS);
    const stage = stageOf(daysOverdue);
    const sent = Number(inv.reminder_count ?? 0);
    if (stage <= sent) continue; // bu kademe zaten gönderildi

    const msg = stageMessage(stage, inv.invoice_no, daysOverdue);
    toNotify.push({
      tenant_id: String(inv.tenant_id),
      title: msg.title,
      body: msg.body,
      href: BILLING_HREF,
      kind: msg.kind,
    });
    idsByStage.set(stage, [...(idsByStage.get(stage) ?? []), inv.id]);

    if (stage >= 3) {
      suspensionCandidates += 1;
      const t = inv.tenant as { name?: string } | { name?: string }[] | null;
      const tenantName = (Array.isArray(t) ? t[0]?.name : t?.name) ?? "Bir ofis";
      await notifyPlatformStaff({
        title: "Askıya alma adayı",
        body: `${tenantName} · ${inv.invoice_no} faturası ${daysOverdue} gündür ödenmedi (3 hatırlatma tamamlandı).`,
        href: `/admin/tenants/${inv.tenant_id}`,
        kind: "danger",
        meta: { invoice_id: inv.id, tenant_id: inv.tenant_id, days_overdue: daysOverdue },
      });
    }
  }

  // Önce bildirimler yazılır, SONRA sayaç güncellenir: insert başarısızsa
  // sayaç ilerlemez ve bir sonraki cron aynı kademeyi yeniden dener
  // (tersi sırada bildirim sessizce kaybolurdu). Mükerrer riski yalnız
  // "insert oldu + update olamadı" penceresinde — kayıptan iyidir.
  const invoiceNotified = await insertNotifications(admin, toNotify);

  if (invoiceNotified > 0 || toNotify.length === 0) {
    // Sayaç güncellemeleri kademe başına tek UPDATE (en fazla 3 sorgu)
    for (const [stage, ids] of idsByStage) {
      const { error } = await admin
        .from("invoices")
        .update({ reminder_count: stage, last_reminder_at: nowIso })
        .in("id", ids);
      if (error) console.error("dunning reminder_count update", error.message);
    }
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
      }));
    subNotified = await insertNotifications(admin, subRows);
  }

  await recordHeartbeat(
    "dunning",
    "ok",
    `${invoiceNotified} fatura hatırlatması, ${subNotified} abonelik hatırlatması, ${suspensionCandidates} askıya alma adayı`,
  );

  return NextResponse.json({
    ok: true,
    invoiceNotified,
    subNotified,
    suspensionCandidates,
  });
}
