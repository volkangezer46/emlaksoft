import type { AutopilotRun } from "./autopilot";
import type { SyncStep } from "./collectors";

/**
 * GECE KOKPİT ADIMI (mevcut `seo-robot` cron'unun yalıtılmış son adımı; yeni cron rotası YOK):
 *  1. Kuyruk bakımı: tüm toplayıcılar "cron" modunda (SEO robotunun az önceki koşusu okunur, robot yeniden çalışmaz).
 *  2. Otopilot: ayar `growth.autopilot` KAPALIYSA (varsayılan) hiçbir yazma yapmaz, yalnız "kapalı" notu döner.
 *  3. Budama: `site_issues_prune` (180 gün / 2 yıl; RPC yoksa 0).
 * Her alt adım kendi try/catch'iyle yalıtılır: biri hata verse de sonrakiler çalışır ve robotun sonucu/heartbeat'i
 * bozulmaz. Dönen not heartbeat detayına eklenir; `failed` alt adım hata sayısıdır.
 */

export type NightlyDeps = {
  sync: () => Promise<SyncStep[]>;
  autopilot: () => Promise<AutopilotRun>;
  prune: () => Promise<number>;
};

export type NightlyOutcome = { failed: number; note: string };

const errText = (e: unknown) => (e instanceof Error ? e.message : "bilinmeyen hata").slice(0, 120);

export async function runNightlyKokpit(deps: NightlyDeps): Promise<NightlyOutcome> {
  const parts: string[] = [];
  let failed = 0;

  try {
    const steps = await deps.sync();
    const ok = steps.filter((s) => s.ok).length;
    const yeni = steps.reduce((n, s) => n + (s.counts?.yeni ?? 0), 0);
    const kapanan = steps.reduce((n, s) => n + (s.counts?.dogrulandi ?? 0), 0);
    if (ok < steps.length) failed++;
    parts.push(`kuyruk ${ok}/${steps.length} toplayıcı, ${yeni} yeni, ${kapanan} düzelmiş`);
  } catch (e) {
    failed++;
    parts.push(`kuyruk hata: ${errText(e)}`);
  }

  try {
    const r = await deps.autopilot();
    if (!r.ran) parts.push("Otopilot kapalı");
    else {
      if (r.failed > 0) failed++;
      const pub = r.published.filter((p) => p.ok && !p.skipped).length;
      parts.push(`Otopilot ${r.prepared} hazırladı, ${pub} yayın, ${r.failed} hata`);
    }
  } catch (e) {
    failed++;
    parts.push(`Otopilot hata: ${errText(e)}`);
  }

  try {
    const n = await deps.prune();
    parts.push(`${n} eski kayıt budandı`);
  } catch (e) {
    failed++;
    parts.push(`budama hata: ${errText(e)}`);
  }

  return { failed, note: `Kokpit: ${parts.join(" · ")}` };
}

/** Gerçek bağımlılıklar (sunucu modülleri tembel yüklenir: robot rotası Kokpit modüllerini yalnız bu adımda çeker). */
export async function runNightlyKokpitNow(): Promise<NightlyOutcome> {
  const [{ syncSiteIssues }, { runAutopilotNow }, { pruneSiteIssues }] = await Promise.all([import("./collectors"), import("./autopilot-server"), import("./store")]);
  return runNightlyKokpit({ sync: () => syncSiteIssues("cron"), autopilot: runAutopilotNow, prune: pruneSiteIssues });
}
