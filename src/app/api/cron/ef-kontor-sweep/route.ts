import { NextRequest, NextResponse } from "next/server";
import { runBillingReconciliation } from "@/lib/billing/reconciliation";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * EmlakFiyati kontör rezerv süpürmesi (10 dakikada bir): 15 dakikadan eski AÇIK rezervleri `ef_credit_sweep()` ile serbest
 * bırakır (rapor isteği yarıda kalırsa kontör sonsuza dek rezervde kalmaz). İdempotent; cüzdan SQL'i uygulanmamışsa
 * "etkin değil" kaydı düşer, hata vermez. service_role istemcisi mevcut allowlist'li faturalama işleyicisinden gelir
 * (yeni createAdminClient kullanımı yok).
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  try {
    const result = await runBillingReconciliation(0, "ef_sweep");
    const released = result.efSweep ?? null;
    const detail = released === null ? "cüzdan etkin değil (migration uygulanmadı)" : `${released} rezerv serbest bırakıldı`;
    await recordHeartbeat("ef-kontor-sweep", "ok", detail);
    return NextResponse.json({ ok: true, released });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    await recordHeartbeat("ef-kontor-sweep", "error", detail);
    return NextResponse.json({ ok: false, error: "ef_sweep_failed" }, { status: 500 });
  }
}
