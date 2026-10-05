import { NextRequest, NextResponse } from "next/server";
import { runBillingReconciliation } from "@/lib/billing/reconciliation";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { EF_ORTAK_FLAG_SETTING_KEY } from "@/lib/ef-credits/config";
import { describeReconciliation, EF_RECONCILE_WINDOW_DAYS } from "@/lib/ef-credits/reconcile";
import { resolveEmlakFiyatiKeys } from "@/lib/integrations/emlakfiyati/keys";
import { ortakKullanim } from "@/lib/integrations/emlakfiyati/ortak-client";
import { parseSettingBool } from "@/lib/platform-setting-keys";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { authorizeCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const JOB = "ef-kontor-mutabakat";

/**
 * EmlakFiyati gunluk kontor MUTABAKATI: EF `GET /kullanim` (son 31 gun) `toplam.degerleme`/`toplam.pdf` ile defterdeki
 * KESINLESTIRILMIS (committed) rezerv sayilari karsilastirilir, sonuc `ef_reconciliation_runs`a yazilir; sapma varsa platform
 * personeline bildirim gider. EF anahtari/ortak bayragi yoksa HICBIR sey yapilmaz ('atlandi' heartbeat, hata degil).
 * service_role istemcisi mevcut allowlist'li faturalama isleyicisinden gelir (yeni createAdminClient kullanimi yok).
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  try {
    const [settings, keys] = await Promise.all([getPlatformSettingsMany([EF_ORTAK_FLAG_SETTING_KEY]), resolveEmlakFiyatiKeys()]);
    if (!keys.current || !parseSettingBool(settings[EF_ORTAK_FLAG_SETTING_KEY], false)) {
      await recordHeartbeat("ef-kontor-mutabakat", "ok", "atlandı: EmlakFiyati anahtarı veya ortak bayrağı yok");
      return NextResponse.json({ ok: true, skipped: true });
    }

    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - EF_RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const usage = await ortakKullanim();
    if (!usage.ok) {
      // Kapı kapalı/ağ hatası: mutabakat yapılamadı; sağlık cron'u bağlantıyı ayrıca izler.
      const gateClosed = usage.kind === "disabled";
      await recordHeartbeat("ef-kontor-mutabakat", gateClosed ? "ok" : "error", gateClosed ? "atlandı: ortak kapısı kapalı" : `EF kullanım okunamadı (${usage.kind}${usage.code ? `/${usage.code}` : ""})`);
      return NextResponse.json({ ok: true, skipped: gateClosed, state: usage.kind });
    }

    const summary = await runBillingReconciliation(0, "ef_reconcile", {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      degerleme: usage.data.toplam.degerleme,
      pdf: usage.data.toplam.pdf,
      meta: { requestId: usage.requestId ?? null, windowDays: EF_RECONCILE_WINDOW_DAYS },
    });
    const result = summary.efReconcile ?? null;
    if (!result) {
      await recordHeartbeat("ef-kontor-mutabakat", "error", "defter okunamadı (cüzdan migration'ı uygulanmamış olabilir)");
      return NextResponse.json({ ok: true, state: "ledger_unavailable" });
    }

    const detail = `${describeReconciliation(result)}${result.saved ? "" : "; kayıt yazılamadı (ef_reconciliation_runs migration'ı uygulanmamış olabilir)"}`;
    if (result.status === "drift") {
      await notifyPlatformStaff({
        title: "EmlakFiyati kontör mutabakatında sapma",
        body: detail,
        href: "/admin/ef-kontor",
        kind: "warning",
        meta: { job: JOB, diffDegerleme: result.diffDegerleme, diffPdf: result.diffPdf },
      });
    }
    await recordHeartbeat("ef-kontor-mutabakat", result.status === "ok" ? "ok" : "error", detail);
    return NextResponse.json({ ok: true, status: result.status, saved: result.saved });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    await recordHeartbeat("ef-kontor-mutabakat", "error", detail);
    return NextResponse.json({ ok: false, error: "ef_mutabakat_failed" }, { status: 500 });
  }
}
