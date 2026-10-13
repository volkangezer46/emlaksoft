import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { failureNote, heartbeatFor } from "@/lib/cron-heartbeat-status";
import { now } from "@/lib/clock";
import { PSI_DEVICES, staticModeTag, type PsiDevice } from "@/lib/perf/psi";
import { listLabRuns, pruneLabRuns, readPsiKey, readStaticToggles, runAndRecordPsi, trDay, type LabRunOutcome } from "@/lib/perf/store";
import { publicOrigin } from "@/lib/public-redirect";
import { STATIC_ROUTES } from "@/lib/static-home/registry";
import { staticRouteMode } from "@/lib/static-home/settings";

export const dynamic = "force-dynamic";
/**
 * PSI koşusu 10-40 sn sürer, en kötü 90 sn'de kesilir. Bütçe yalnız YENİ koşu başlatmayı durdurur; bütçe anında başlamış
 * koşu 90 sn daha sürebilir: 190 + 90 = 280 sn < 300 sn (maxDuration ve cron-call.sh --max-time 300).
 */
export const maxDuration = 300;

const BUDGET_MS = 190_000;
const ALWAYS = ["/", "/fiyatlar"] as const;

/**
 * Hız robotu (günlük 02:55 UTC): statik sunumu AÇIK kayıt rotaları ile `/` ve `/fiyatlar` için PageSpeed (mobil +
 * masaüstü) laboratuvar ölçümü; günde yol × cihaz başına en çok 1 koşu (aynı gün yeniden çalışırsa ölçülenler atlanır).
 * Sonuçlar `perf_lab_runs`'a yazılır; 400 günden eski koşular budanır.
 * PageSpeed anahtarı yoksa, kota dolduysa ya da hiçbir ölçüm alınamadıysa heartbeat "atlandı" yazar (dış servis
 * hatası altyapı hatası değildir). DB okuma/yazma hatası "error" yazar.
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  try {
    const key = await readPsiKey();
    if (!key) {
      await recordHeartbeat("hiz-robotu", "ok", "atlandı: PageSpeed API anahtarı yok (Hız > Laboratuvar'dan eklenir)");
      return NextResponse.json({ ok: true, skipped: "no_key" });
    }
    const day = trDay();
    const today = await listLabRuns({ sinceDay: day, limit: 500 });
    if (today.tableMissing) {
      await recordHeartbeat("hiz-robotu", "ok", "atlandı: perf_lab_runs tablosu yok (migration 20261013003300 bekliyor)");
      return NextResponse.json({ ok: true, skipped: "table_missing" });
    }
    const done = new Set(today.rows.filter((r) => r.day === day && r.source === "psi").map((r) => `${r.path}|${r.device}`));
    const pruned = await pruneLabRuns();
    const toggles = await readStaticToggles();
    const modes = new Map(STATIC_ROUTES.map((r) => [r.path, staticRouteMode(r, toggles)]));
    const paths = [...new Set([...STATIC_ROUTES.filter((r) => modes.get(r.path) === "on").map((r) => r.path), ...ALWAYS])];
    const tasks: Array<{ path: string; device: PsiDevice }> = [];
    for (const path of paths) for (const device of PSI_DEVICES) if (!done.has(`${path}|${device}`)) tasks.push({ path, device });

    const origin = publicOrigin();
    const started = now();
    const results: LabRunOutcome[] = [];
    let quota = false;
    let next = 0;
    // Paralellik 2; bütçe dolunca ya da kota bitince yeni koşu başlatılmaz.
    const worker = async () => {
      while (next < tasks.length && !quota && now() - started < BUDGET_MS) {
        const t = tasks[next++]!;
        const r = await runAndRecordPsi({ origin, path: t.path, device: t.device, key, staticMode: staticModeTag(modes.get(t.path) ?? null, null), day });
        if (r.status === "quota") quota = true;
        results.push(r);
      }
    };
    await Promise.all([worker(), worker()]);

    const ok = results.filter((r) => r.status === "ok").length;
    const storeFailed = results.filter((r) => r.status === "store_error").length;
    const extFailed = results.filter((r) => r.status === "error" || r.status === "quota").length;
    const remaining = tasks.length - results.length;
    const parts = [`${ok}/${tasks.length} ölçüm`, `${done.size} bugün zaten ölçülmüş`, `${pruned} eski koşu budandı`];
    if (extFailed) parts.push(`${extFailed} PageSpeed hatası${quota ? " (kota doldu)" : ""}`);
    if (remaining > 0) parts.push(`${remaining} koşu kaldı`);

    if (tasks.length > 0 && ok === 0 && storeFailed === 0) {
      await recordHeartbeat("hiz-robotu", "ok", `atlandı: hiçbir ölçüm alınamadı · ${parts.join(", ")}`);
      return NextResponse.json({ ok: true, skipped: quota ? "quota" : "psi_error", results });
    }
    await recordHeartbeat("hiz-robotu", heartbeatFor({ failed: storeFailed }), `${parts.join(", ")}${failureNote({ failed: storeFailed })}`);
    return NextResponse.json({ ok: storeFailed === 0, results, pruned });
  } catch (error) {
    console.error("cron hiz-robotu", error);
    await recordHeartbeat("hiz-robotu", "error", error instanceof Error ? error.message : "bilinmeyen hata");
    return NextResponse.json({ ok: false, error: "hiz_robotu_failed" }, { status: 500 });
  }
}
