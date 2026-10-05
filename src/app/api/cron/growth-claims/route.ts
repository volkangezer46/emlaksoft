import { NextRequest, NextResponse } from "next/server";
import { runBillingReconciliation } from "@/lib/billing/reconciliation";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Referans/ortak talep işleyicisi (günlük): kaçırılan talepleri üretir, iade/iptali geri alır, bekleme süresi dolan
 * ödülü TL hesap kredisi olarak yükler (cüzdan hazır değilse ATLAR), kademe bonusunu verir, clawback yapar,
 * ortak komisyonlarını onaylar. İdempotent; bayraklar KAPALIYKEN yeni talep/komisyon üretmez.
 * service_role istemcisi mevcut allowlist'li faturalama işleyicisinden gelir (yeni createAdminClient kullanımı yok).
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  try {
    const result = await runBillingReconciliation(0, "growth_claims");
    const summary = result.growthClaims ?? null;
    // Motor/migration yoksa processClaims null döner: hata değil, "etkin değil" kaydı.
    const detail = summary ? JSON.stringify(summary) : "motor etkin değil (migration uygulanmadı)";
    await recordHeartbeat("growth-claims", "ok", detail);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    await recordHeartbeat("growth-claims", "error", detail);
    return NextResponse.json({ ok: false, error: "growth_claims_failed" }, { status: 500 });
  }
}
