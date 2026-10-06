import { NextRequest, NextResponse } from "next/server";
import { runBillingReconciliation } from "@/lib/billing/reconciliation";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
/** Tenant döngülü toplu iş: zaman bütçesi (240 sn) bu sınırın altındadır. */
export const maxDuration = 300;

/**
 * Insight Engine (30 dakikada bir): ofisleri imleçle sırayla tarar, kural tabanlı içgörüleri (`insights`) üretir.
 * Bütçe: çalıştırma başına ≤60 ofis ve 240 sn; dolunca kalan iş sayısı heartbeat detayına yazılır, imleç kaldığı yerden devam eder.
 * Yalnız `insights` satırı yazar (+ yüksek şiddette zil bildirimi, günde kullanıcı başına ≤3); başka hiçbir kaydı DEĞİŞTİRMEZ.
 * Migration uygulanmadıysa hata değil "etkin değil" kaydı düşer.
 * service_role istemcisi mevcut allowlist'li faturalama işleyicisinden gelir (yeni createAdminClient kullanımı yok).
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  try {
    const result = await runBillingReconciliation(0, "insight_engine");
    const s = result.insightEngine;
    if (!s) {
      await recordHeartbeat("insight-engine", "error", "motor sonuç döndürmedi");
      return NextResponse.json({ ok: false, error: "insight_engine_no_result" }, { status: 500 });
    }

    if (s.tableMissing) {
      await recordHeartbeat("insight-engine", "ok", "motor etkin değil (insights migration uygulanmadı)");
      return NextResponse.json({ ok: true, enabled: false });
    }

    const parts = [
      `${s.tenantsProcessed}/${s.tenantsTotal} ofis`,
      `${s.inserted} içgörü`,
      `${s.notified} bildirim`,
    ];
    if (s.tenantsSkippedSample > 0) parts.push(`${s.tenantsSkippedSample} örnek veri ofisi atlandı`);
    if (s.rulesUnavailable.length > 0) parts.push(`etkin olmayan kural: ${s.rulesUnavailable.join(",")}`);
    if (s.tenantsFailed > 0) parts.push(`${s.tenantsFailed} ofis hatası`);
    if (s.notifyFailed > 0) parts.push(`${s.notifyFailed} bildirim hatası`);
    if (s.remaining > 0) parts.push(`${s.remaining} ofis kaldı${s.timedOut ? " (zaman bütçesi doldu)" : ""}`);
    if (s.listError) parts.push(`liste hatası: ${s.listError}`);
    if (s.wrapped) parts.push(`tur tamamlandı${s.housekeepingDeleted !== null ? `, ${s.housekeepingDeleted} eski satır temizlendi` : ""}`);

    // Yalnız gerçek hata (ofis/liste hatası) 'error'. Kalan ofis normal devam eden turdur (bir sonraki çalıştırma sürdürür).
    // Platform içgörüleri (EmlakSoft ekibi için; en iyi çaba: hata ofis içgörü sonucunu bozmaz).
    try {
      const p = (await runBillingReconciliation(0, "platform_insights")).platformInsights;
      if (p && !p.tableMissing) parts.push(`${p.inserted} platform içgörüsü`);
      if (p && p.rulesUnavailable.length > 0) parts.push(`etkin olmayan platform kuralı: ${p.rulesUnavailable.join(",")}`);
    } catch (e) {
      console.error("insight-engine platform", e instanceof Error ? e.message : "hata");
      parts.push("platform içgörüleri hata verdi");
    }

    const failed = s.tenantsFailed > 0 || Boolean(s.listError);
    await recordHeartbeat("insight-engine", failed ? "error" : "ok", parts.join(" · "));
    return NextResponse.json({ ok: !failed, summary: s });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    await recordHeartbeat("insight-engine", "error", detail);
    return NextResponse.json({ ok: false, error: "insight_engine_failed" }, { status: 500 });
  }
}
