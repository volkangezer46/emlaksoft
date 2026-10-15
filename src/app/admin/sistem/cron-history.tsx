import Link from "@/components/ui/smart-link";
import { History, X } from "lucide-react";
import { relativeTimeTR } from "@/lib/admin-format";
import { cronDetailView } from "@/lib/admin/cron-detail";

export type CronRun = {
  id: number;
  started_at: string;
  finished_at: string;
  duration_ms: number | null;
  status: "ok" | "error";
  trigger: "schedule" | "manual";
  detail: string | null;
};

const sec = (ms: number) => `${(ms / 1000).toLocaleString("tr-TR", { maximumFractionDigits: ms < 10_000 ? 1 : 0 })} sn`;
const fmt = (iso: string) => new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" });

/**
 * Bir cron'un son 30 çalışması: süre sütunları (eskiden yeniye; kırmızı = hata, kesikli = elle) + satır listesi.
 * Veri `cron_runs` (recordHeartbeat yazar). Süre ölçülemeyen satır (başlangıç kaydı yok) sıfır yükseklikte çizilir ve
 * "süre yok" olarak etiketlenir; sahte süre üretilmez.
 */
export function CronHistoryPanel({
  job,
  label,
  runs,
  setupPending,
}: {
  job: string;
  label: string;
  runs: readonly CronRun[];
  setupPending: boolean;
}) {
  const ordered = [...runs].reverse();
  const durations = runs.map((r) => r.duration_ms).filter((v): v is number => typeof v === "number");
  const max = Math.max(1, ...durations);
  const avg = durations.length ? durations.reduce((s, v) => s + v, 0) / durations.length : null;
  const errors = runs.filter((r) => r.status === "error").length;

  return (
    <section id="cron-gecmis" aria-label={`${label} çalışma geçmişi`} className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <History className="h-4 w-4" /> Çalışma geçmişi · <span className="numeric">{job}</span>
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">{label}: son {runs.length} çalışma</h2>
        </div>
        <Link href={`/admin/sistem#cron-${job}`} className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-ink-950" aria-label="Geçmişi kapat">
          <X className="h-3.5 w-3.5" /> Kapat
        </Link>
      </div>

      {setupPending ? (
        <p className="mt-3 text-sm text-text-muted">Çalışma geçmişi tablosu bu ortamda yok (migration 20261013004900 bekliyor); yalnız son durum görünür.</p>
      ) : runs.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">Bu iş için henüz çalışma kaydı yok. İlk çalışmadan sonra süre grafiği burada belirir.</p>
      ) : (
        <>
          <p className="mt-2 text-xs text-text-muted tabular-nums">
            {avg != null ? `ortalama ${sec(avg)} · en uzun ${sec(max)}` : "süre ölçümü yok"}
            {errors ? ` · ${errors} hata` : " · hata yok"}
          </p>
          <div className="mt-3 flex h-36 items-end gap-[3px] border-b border-line" role="img" aria-label={`Son ${runs.length} çalışmanın süreleri; ${errors} hata`}>
            {ordered.map((r) => {
              const h = r.duration_ms != null ? Math.max(3, (r.duration_ms / max) * 100) : 2;
              const color = r.status === "error" ? "var(--viz-neg)" : "var(--viz-pos)";
              return (
                <span
                  key={r.id}
                  title={`${fmt(r.started_at)} · ${r.duration_ms != null ? sec(r.duration_ms) : "süre yok"} · ${r.status === "error" ? "hata" : "başarılı"}${r.trigger === "manual" ? " · elle" : ""}${cronDetailView(r.detail).summary ? ` · ${cronDetailView(r.detail).summary}` : ""}`}
                  className="min-w-[4px] flex-1 rounded-t-[3px]"
                  style={{
                    height: `${h}%`,
                    background: color,
                    opacity: r.duration_ms == null ? 0.35 : 1,
                    outline: r.trigger === "manual" ? "1px dashed var(--ink-950)" : undefined,
                  }}
                />
              );
            })}
          </div>
          <p className="mt-1 flex justify-between text-xs text-text-faint">
            <span>{ordered[0] ? relativeTimeTR(ordered[0].started_at) : ""}</span>
            <span>şimdi</span>
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold text-text-muted">Satır satır ({runs.length})</summary>
            <ul className="mt-2 divide-y divide-line text-xs">
              {runs.map((r) => {
                // B192: insan özeti satırda; ham JSON yalnız "Ayrıntı" altında (camelCase anahtar ekrana dökülmez).
                const d = cronDetailView(r.detail);
                return (
                  <li key={r.id} className="py-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-text-muted">
                        {fmt(r.started_at)}
                        {r.trigger === "manual" ? " · elle" : ""}
                        {d.summary ? <span className="text-text-faint"> · {d.summary}</span> : null}
                      </span>
                      <span className="inline-flex items-center gap-2 tabular-nums">
                        <span className="text-ink-950">{r.duration_ms != null ? sec(r.duration_ms) : "süre yok"}</span>
                        <span className={r.status === "error" ? "font-semibold text-danger-600" : "font-semibold text-mint-700"}>{r.status === "error" ? "Hata" : "Başarılı"}</span>
                      </span>
                    </div>
                    {d.raw ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-semibold text-text-faint">Ayrıntı</summary>
                        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-control)] bg-canvas p-2 font-mono text-xs text-text-muted">{d.raw}</pre>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
