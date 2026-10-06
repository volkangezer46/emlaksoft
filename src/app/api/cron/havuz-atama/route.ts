import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { runPoolSweep } from "@/lib/pool/system-assign";
import { authorizeCron } from "@/lib/cron-auth";
import { getDisabledModulesByTenant, tenantsDisabledFor } from "@/lib/modules/state";
import { runControlStepFrequent } from "@/lib/listing-control/server/cron-steps";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

/**
 * İlan havuzu süpürmesi (10 dakikada bir): süresi dolan sahiplenmeyi yedek zincire/yönetime aktarır,
 * auto modda eşiği geçen ilanı atar, SLA'sı geçeni uyarır. Havuz tabloları yoksa (migration uygulanmamış) sessizce 0 işler.
 *
 * EK ADIM (ilan kontrol, yeni cron YOK): atanmış portföylerin değerlendirme taraması (yayınlanmayan portföy 24/48 saat,
 * yetki bitişi, portal kaybı anomalileri), anomali SLA yükseltmesi (danışman → takım lideri → şube müdürü → ofis sahibi),
 * kontrol işi hasat/planlama. En iyi çaba: bu adımın hatası havuz süpürmesinin sonucunu etkilemez.
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  try {
    const admin = createAdminClient();
    const summary = await runPoolSweep(admin);
    // Modül kapısı: "Portal Kontrol" kapalı ofislerde ilan kontrol adımı çalışmaz.
    const disabled = new Set(tenantsDisabledFor(await getDisabledModulesByTenant(admin), "portals"));
    const control = await runControlStepFrequent(admin, disabled);
    await recordHeartbeat(
      "havuz-atama",
      control.ok ? "ok" : "error",
      `${summary.examined} kayıt, ${summary.autoAssigned} otomatik, ${summary.fallbackAssigned} yedek, ${summary.escalated} yükseltme, ${summary.slaBreached} SLA · ${control.text}`,
    );
    return NextResponse.json({ ok: true, ...summary, control: control.text });
  } catch (err) {
    console.error("cron havuz-atama", err);
    await recordHeartbeat("havuz-atama", "error", "süpürme başarısız");
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 });
  }
}
