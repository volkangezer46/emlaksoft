import { now } from "@/lib/clock";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { worsened } from "./audit-rules";
import { runIndexNow, runSeoAudit, type IndexNowOutcome } from "./audit-runner";
import { loadSitemapFresh } from "./sitemap-data";
import { prune404, readAuditLatest, type AuditRun } from "./store";

/** Cron ve "şimdi çalıştır" ortak giriş noktası: denetim -> IndexNow -> bildirim -> 404 temizliği. */
export type RobotResult = { run: AuditRun; indexNow: IndexNowOutcome; notified: boolean };

export async function executeSeoRobot(trigger: "cron" | "manual"): Promise<RobotResult> {
  const previous = await readAuditLatest();
  const run = await runSeoAudit(trigger);

  // IndexNow'a yalnız robotun sorun bulmadığı, indekslenebilir sitemap adresleri gider.
  const bad = new Set(
    run.findings
      .filter((f) => ["http-error", "sitemap-redirect", "noindex-in-sitemap", "sitemap-disallowed", "canonical-host-mismatch"].includes(f.code))
      .map((f) => f.url),
  );
  const { chunks } = await loadSitemapFresh();
  const indexNow = await runIndexNow(chunks.flat(), bad, now());

  let notified = false;
  if (worsened(previous?.summary ?? null, run.summary)) {
    const s = run.summary;
    await notifyPlatformStaff({
      title: s.critical > 0 ? `SEO robotu ${s.critical} kritik bulgu buldu` : `SEO robotu ${s.warning} uyarı buldu`,
      body: `${s.pagesChecked} sayfa denetlendi: ${s.critical} kritik, ${s.warning} uyarı, ${s.info} bilgi.`,
      href: "/admin/seo?sekme=robot",
      kind: s.critical > 0 ? "danger" : "warning",
      roles: ["super_admin", "ops"],
      meta: { source: "seo-robot", critical: s.critical, warning: s.warning },
    });
    notified = true;
  }

  await prune404();
  return { run, indexNow, notified };
}
