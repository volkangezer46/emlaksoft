import Link from "@/components/ui/smart-link";
import { ArrowLeft, FlaskConical, Info, KeyRound } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { requirePlatformModule } from "@/lib/platform";
import { METRIC_LABELS, formatMetric, rateScore, type MetricKey } from "@/lib/perf/cwv";
import { PSI_DEVICES, type PsiDevice } from "@/lib/perf/psi";
import { listLabRuns, psiKeyStatus, type LabRun } from "@/lib/perf/store";
import { STATIC_ROUTES } from "@/lib/static-home/registry";
import { LabRunButton, PsiKeyForm } from "../speed-controls";

export const metadata = { title: "Hız laboratuvarı" };

const DEVICE_TR: Record<PsiDevice, string> = { mobile: "Mobil", desktop: "Masaüstü" };
const SCORE_TONE = { iyi: "text-mint-700", orta: "text-amber-900", kotu: "text-danger-700" } as const;
const SHOWN: MetricKey[] = ["lcp_ms", "cls", "tbt_ms", "ttfb_ms"];
const MODE_TR: Record<string, string> = { statik: "statik sürüm", yedek: "yedek (normal HTML)", normal: "normal sürüm" };

/**
 * HIZ LABORATUVARI: kayıt defterindeki her herkese açık yol için PageSpeed (Lighthouse) mobil + masaüstü ölçümü,
 * tek tuşla. Sonuçlar `perf_lab_runs`'a yazılır (gecelik `hiz-robotu` de aynı tabloya yazar). Anahtar yoksa anahtarsız
 * düşük kota denenir; kota dolarsa dürüst "kota doldu / anahtar ekleyin" mesajı görünür. Render sırasında dış çağrı yok.
 */
export default async function AdminSpeedLabPage() {
  const staff = await requirePlatformModule("sitecontent");
  const isSuper = staff.role === "super_admin";
  const [lab, key] = await Promise.all([
    listLabRuns({ limit: 300 }).catch(() => ({ rows: [] as LabRun[], tableMissing: false, failed: true as const })),
    psiKeyStatus(),
  ]);
  const latest = new Map<string, LabRun>();
  for (const run of lab.rows) {
    if (run.source !== "psi") continue;
    const k = `${run.path}|${run.device}`;
    if (!latest.has(k)) latest.set(k, run);
  }
  const failed = "failed" in lab;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Hız"
        icon={FlaskConical}
        title="Hız laboratuvarı"
        description="PageSpeed Insights ile mobil ve masaüstü laboratuvar ölçümü. Yalnız Hız ekranındaki herkese açık sayfalar ölçülür; her koşu yaklaşık bir dakika sürer."
        glow="brand"
      />
      <Link href="/admin/site/hiz" className="focus-ring inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Hız ekranına dön
      </Link>

      <section aria-labelledby="anahtar" className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <h2 id="anahtar" className="flex items-center gap-2 text-sm font-extrabold text-ink-950">
          <KeyRound className="h-4 w-4 text-brand-600" aria-hidden="true" /> PageSpeed anahtarı
        </h2>
        {key.configured ? (
          <p className="text-sm text-mint-700">{key.readable ? "Anahtar tanımlı (şifreli saklanıyor)." : "Anahtar kayıtlı ama çözülemiyor; yeniden girin."}</p>
        ) : (
          <p className="flex gap-2 text-sm text-text-muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Anahtar yok: ölçüm anahtarsız (çok düşük günlük kota) denenir; kota dolarsa &quot;kota doldu&quot; yazar. Gecelik hız robotu anahtar olmadan çalışmaz.
          </p>
        )}
        <PsiKeyForm configured={key.configured} canWrite={isSuper} />
      </section>

      {lab.tableMissing ? (
        <p className="flex gap-3 rounded-[var(--radius-panel)] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Laboratuvar tablosu (perf_lab_runs) henüz kurulmadı; ölçüm yapılabilir ama sonuç saklanamaz.
        </p>
      ) : failed ? (
        <p className="rounded-[var(--radius-panel)] border border-danger-500/30 bg-danger-500/5 p-4 text-sm text-danger-700">Geçmiş ölçümler okunamadı; sayfayı yenileyin.</p>
      ) : null}

      <ul className="space-y-3" aria-label="Ölçülebilir sayfalar">
        {STATIC_ROUTES.map((r) => (
          <li key={r.id} className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-base font-extrabold text-ink-950">{r.label}</p>
                <p className="font-mono text-xs text-text-faint">{r.path}</p>
              </div>
              <LabRunButton path={r.path} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {PSI_DEVICES.map((d) => {
                const run = latest.get(`${r.path}|${d}`);
                const tone = rateScore(run?.score);
                return (
                  <div key={d} className="rounded-[var(--radius-card)] border border-line p-3 text-sm">
                    <p className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-bold text-text-faint">{DEVICE_TR[d]}</span>
                      {run ? <span className="text-xs text-text-faint">{run.day}{run.static_mode ? ` · ${MODE_TR[run.static_mode] ?? run.static_mode}` : ""}</span> : null}
                    </p>
                    {run ? (
                      <>
                        <p className={`font-display text-2xl font-extrabold ${tone ? SCORE_TONE[tone] : "text-ink-950"}`}>{run.score ?? "—"}</p>
                        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                          {SHOWN.map((m) => (
                            <div key={m} className="flex justify-between gap-2">
                              <dt className="text-text-faint">{METRIC_LABELS[m].replace(/ \(.*\)$/, "")}</dt>
                              <dd className="font-semibold text-ink-950">{formatMetric(m, run[m])}</dd>
                            </div>
                          ))}
                        </dl>
                      </>
                    ) : (
                      <p className="text-sm text-text-muted">Henüz ölçülmedi.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
