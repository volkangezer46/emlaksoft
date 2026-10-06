import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { findNotifiedIds, insertNotifications, type NotificationRow } from "@/lib/notify-batch";
import { getPlatformSetting } from "@/lib/platform-settings";
import { PLATFORM_SETTING_KEYS, parseTrialGraceDays } from "@/lib/platform-setting-keys";
import { authorizeCron } from "@/lib/cron-auth";
import { runLicenseReminders } from "@/lib/license-reminders";
import { runPropertyAuthorityReminders } from "@/lib/property-authority-reminders";
import { trDayKey } from "@/lib/clock";
import { sendTrialEndingEmails } from "@/lib/email/trial-reminder";
import { getBaseUrl } from "@/lib/base-url";

export const maxDuration = 60;

const DAY_MS = 86_400_000;
const BILLING_HREF = "/app/abonelik";

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: trials } = await admin
    .from("subscriptions")
    .select("id, tenant_id, trial_ends_at, status")
    .eq("status", "trialing")
    .lt("trial_ends_at", now)
    .limit(100);

  // N+1 freni: satır başına 3 yazma yerine küme başına 3 toplu yazma.
  // 100 deneme için ~300 gidiş-dönüş → 3'e iner.
  const rows = trials ?? [];
  const subIds = rows.map((s) => s.id);
  const tenantIds = [...new Set(rows.map((s) => s.tenant_id))];

  if (subIds.length > 0) {
    await Promise.all([
      admin.from("subscriptions").update({ status: "past_due", updated_at: now }).in("id", subIds),
      admin.from("tenants").update({ status: "past_due", updated_at: now }).in("id", tenantIds),
      admin.from("notifications").insert(
        tenantIds.map((tenantId) => ({
          tenant_id: tenantId,
          title: "Deneme süresi doldu",
          body: "Aboneliğinizi yenilemek için Paket & ödeme sayfasına gidin.",
          href: "/app/abonelik",
          kind: "warning",
        })),
      ),
    ]);
  }

  const updated = subIds.length;

  // Deneme bitimi hatırlatması: 3 gün ve 1 gün kala, abonelik başına kademe başına BİR kez (marker ile).
  // Kademe: kalan <=1 gün → trial1, <=3 gün → trial3. Aynı kademe 5 günlük pencerede tekrar yazılmaz.
  let trialReminded = 0;
  let trialEmailed = 0;
  const nowMs = Date.now();
  const { data: endingTrials } = await admin
    .from("subscriptions")
    .select("id, tenant_id, trial_ends_at")
    .eq("status", "trialing")
    .gte("trial_ends_at", now)
    .lte("trial_ends_at", new Date(nowMs + 3 * DAY_MS).toISOString())
    .limit(500);
  if (endingTrials && endingTrials.length > 0) {
    const since = new Date(nowMs - 5 * DAY_MS).toISOString();
    const tenantIdsEnding = [...new Set(endingTrials.map((s) => String(s.tenant_id)))];
    const [seen1, seen3] = await Promise.all([
      findNotifiedIds(admin, { href: BILLING_HREF, tenantIds: tenantIdsEnding, sinceIso: since, markerPrefix: "trial1" }),
      findNotifiedIds(admin, { href: BILLING_HREF, tenantIds: tenantIdsEnding, sinceIso: since, markerPrefix: "trial3" }),
    ]);
    const reminderRows: NotificationRow[] = [];
    for (const s of endingTrials) {
      const id = String(s.id).toLowerCase();
      const lastDay = new Date(String(s.trial_ends_at)).getTime() - nowMs <= DAY_MS;
      if (lastDay ? seen1.has(id) : seen3.has(id)) continue;
      reminderRows.push({
        tenant_id: String(s.tenant_id),
        title: lastDay ? "Deneme süreniz 1 gün içinde bitiyor" : "Deneme süreniz 3 gün içinde bitiyor",
        body: `Kesintisiz devam etmek için planınızı seçip ödemenizi tamamlayın. · ${lastDay ? "trial1" : "trial3"}:${s.id}`,
        href: BILLING_HREF,
        kind: "warning",
      });
    }
    trialReminded = await insertNotifications(admin, reminderRows);
    // E-posta kanalı açıksa (RESEND_API_KEY + EMAIL_FROM) aynı hatırlatma ofis sahibine e-postayla da gider; kapalıysa no-op.
    if (trialReminded > 0) {
      try {
        trialEmailed = await sendTrialEndingEmails(
          admin,
          reminderRows.map((r) => ({ tenantId: r.tenant_id, days: r.title.includes("1 gün") ? 1 : 3 })),
          `${getBaseUrl()}${BILLING_HREF}`,
        );
      } catch (e) {
        console.error("abonelik-kontrol trial email", e instanceof Error ? e.message : "hata");
      }
    }
  }

  // Tolerans sonrası otomatik askı: deneme bitti, ödeme yapılmadı (past_due + dönem hiç başlamadı) ve
  // 'billing.trial_grace_days' geçti → abonelik 'paused', ofis 'suspended'. Ödeme (fulfill) ikisini 'active' yapar.
  // Idempotent: yalnız past_due satırlar seçilir/güncellenir; tekrar çalıştırmak etkisizdir.
  let suspended = 0;
  const graceDays = parseTrialGraceDays(await getPlatformSetting(PLATFORM_SETTING_KEYS.trialGraceDays));
  const graceCutoff = new Date(nowMs - graceDays * DAY_MS).toISOString();
  const { data: graceExpired } = await admin
    .from("subscriptions")
    .select("id, tenant_id, trial_ends_at, current_period_end")
    .eq("status", "past_due")
    .not("trial_ends_at", "is", null)
    .lt("trial_ends_at", graceCutoff)
    .limit(100);
  const unpaid = (graceExpired ?? []).filter(
    (s) => !s.current_period_end || new Date(String(s.current_period_end)).getTime() <= new Date(String(s.trial_ends_at)).getTime(),
  );
  if (unpaid.length > 0) {
    const { data: pastDueTenants } = await admin
      .from("tenants")
      .select("id")
      .in("id", [...new Set(unpaid.map((s) => s.tenant_id))])
      .eq("status", "past_due");
    const okTenants = new Set((pastDueTenants ?? []).map((t) => String(t.id)));
    const target = unpaid.filter((s) => okTenants.has(String(s.tenant_id)));
    if (target.length > 0) {
      const suspSubIds = target.map((s) => s.id);
      const suspTenantIds = [...new Set(target.map((s) => String(s.tenant_id)))];
      await Promise.all([
        admin.from("subscriptions").update({ status: "paused", updated_at: now }).in("id", suspSubIds).eq("status", "past_due"),
        admin.from("tenants").update({ status: "suspended", updated_at: now }).in("id", suspTenantIds).eq("status", "past_due"),
        admin.from("notifications").insert(
          suspTenantIds.map((tenantId) => ({
            tenant_id: tenantId,
            title: "Hesabınız askıya alındı",
            body: "Deneme süresi ve tolerans bitti. Planı seçip ödeme yaptığınızda hesabınız otomatik açılır; verileriniz silinmez.",
            href: BILLING_HREF,
            kind: "danger",
          })),
        ),
      ]);
      suspended = suspSubIds.length;
    }
  }

  // Dönem sonunda iptal talepleri (K5): dönem bitince abonelik ve ofis "cancelled" olur.
  // Kolon henüz yoksa (migration uygulanmadı) sorgu hata verir; sessizce atlanır.
  let cancelled = 0;
  const { data: dueCancel, error: cancelReadError } = await admin
    .from("subscriptions")
    .select("id, tenant_id")
    .eq("cancel_at_period_end", true)
    .neq("status", "cancelled")
    .lt("current_period_end", now)
    .limit(100);
  if (!cancelReadError && dueCancel && dueCancel.length > 0) {
    const cancelSubIds = dueCancel.map((s) => s.id);
    const cancelTenantIds = [...new Set(dueCancel.map((s) => s.tenant_id))];
    await Promise.all([
      admin
        .from("subscriptions")
        .update({ status: "cancelled", cancelled_at: now, updated_at: now })
        .in("id", cancelSubIds),
      admin.from("tenants").update({ status: "cancelled", updated_at: now }).in("id", cancelTenantIds),
    ]);
    cancelled = cancelSubIds.length;
  }

  // Yetki belgesi hatırlatmaları (60/30/7 gün + yıllık harç ayı; ofis ayarı kapalı doğar). Hata asıl işi bozmaz.
  let license = { expiry: 0, annualFee: 0, skipped: true };
  try {
    license = await runLicenseReminders(admin, trDayKey(nowMs));
  } catch (e) {
    console.error("abonelik-kontrol license", e instanceof Error ? e.message : "hata");
  }

  // Portföy yetkisi bitiş hatırlatması (30/7/0 gün; varsayılan açık bildirim, tercih "authority"). Hata asıl işi bozmaz.
  let authority = { candidates: 0, written: 0, skipped: true };
  try {
    authority = await runPropertyAuthorityReminders(admin, trDayKey(nowMs));
  } catch (e) {
    console.error("abonelik-kontrol authority", e instanceof Error ? e.message : "hata");
  }

  await recordHeartbeat(
    "abonelik-kontrol",
    "ok",
    `${updated} abonelik güncellendi, ${trialReminded} deneme hatırlatması (${trialEmailed} e-posta), ${suspended} askıya alma, ${cancelled} iptal tamamlandı, yetki belgesi ${license.expiry}+${license.annualFee}, portföy yetkisi ${authority.written}/${authority.candidates}`,
  );

  return NextResponse.json({ ok: true, updated, cancelled, trialReminded, suspended, license, authority });
}
