import { NextRequest, NextResponse } from "next/server";
import { runBillingReconciliation } from "@/lib/billing/reconciliation";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";
import { beginCronRun } from "@/lib/cron-pause";
import { heartbeatFor } from "@/lib/cron-heartbeat-status";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * EmlakFiyati analiz bakiyesi rezerv süpürmesi (10 dakikada bir): 15 dakikadan eski AÇIK rezervleri `ef_credit_sweep()` ile serbest
 * bırakır (rapor isteği yarıda kalırsa analiz bakiyesi sonsuza dek rezervde kalmaz). İdempotent; cüzdan SQL'i uygulanmamışsa
 * "etkin değil" kaydı düşer, hata vermez. service_role istemcisi mevcut allowlist'li faturalama işleyicisinden gelir
 * (yeni createAdminClient kullanımı yok).
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const pausedRun = await beginCronRun("ef-kontor-sweep", req);
  if (pausedRun) return pausedRun;

  try {
    const result = await runBillingReconciliation(0, "ef_sweep");
    if (result.efSweepError) {
      await recordHeartbeat("ef-kontor-sweep", "error", `süpürme RPC hatası (${result.efSweepError})`);
      return NextResponse.json({ ok: false, error: "ef_sweep_failed" }, { status: 500 });
    }
    const released = result.efSweep ?? null;
    if (released === null) {
      await recordHeartbeat("ef-kontor-sweep", "ok", "atlandı: cüzdan etkin değil (migration uygulanmadı)");
      return NextResponse.json({ ok: true, released: null });
    }
    await recordHeartbeat("ef-kontor-sweep", heartbeatFor({}), `${released} rezerv serbest bırakıldı`);
    return NextResponse.json({ ok: true, released });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    await recordHeartbeat("ef-kontor-sweep", "error", detail);
    return NextResponse.json({ ok: false, error: "ef_sweep_failed" }, { status: 500 });
  }
}
