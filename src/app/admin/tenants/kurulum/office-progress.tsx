import Link from "@/components/ui/smart-link";
import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import { FilterChip } from "@/components/ui/filter-chip";
import { Progress } from "@/components/ui/progress";
import { Pagination, pageRange } from "@/app/admin/_components/pagination";
import { PROGRESS_DONE_FILTER, stuckSummary, type OfficeProgress } from "@/lib/admin/onboarding-progress";

/**
 * Ofis bazında kurulum ilerlemesi görünümleri (SN5; sunucu bileşenleri). Toplu liste Ofisler > Kurulum'da, tek ofis kartı
 * Ofis 360 > Kullanım ve limitler sekmesinde. Her sayı/çip süzülmüş listeye, her satır ofisin 360 ekranına götürür.
 */

export const PROGRESS_BASE = "/admin/tenants/kurulum";

export function progressHref(adim: string | null, page = 1): string {
  const q = new URLSearchParams();
  if (adim) q.set("adim", adim);
  if (page > 1) q.set("sayfa", String(page));
  const qs = q.toString();
  return qs ? `${PROGRESS_BASE}?${qs}` : PROGRESS_BASE;
}

const STATUS_LABEL: Record<string, string> = { trial: "Deneme", active: "Aktif", past_due: "Ödeme gecikmiş", suspended: "Askıda" };
const toneOf = (p: number) => (p >= 100 ? "success" : p >= 50 ? "accent" : "warning") as "success" | "accent" | "warning";

export function NotReadyNotice() {
  return (
    <p className="rounded-[var(--radius-panel)] border border-amber-400/30 bg-amber-400/8 px-5 py-6 text-sm text-amber-700">
      Kurulum bekliyor: ofis bazında kurulum ilerlemesi veritabanı güncellemesiyle (20261014025000) gelir.
    </p>
  );
}

/** Toplu liste: takılan adıma göre süzgeç çipleri + ofis satırları (sayfalı). */
export function OfficeProgressList({
  all,
  rows,
  adim,
  page,
  planLabel,
}: {
  all: readonly OfficeProgress[];
  rows: readonly OfficeProgress[];
  adim: string | null;
  page: number;
  planLabel: (id: string | null) => string;
}) {
  const summary = stuckSummary(all);
  const [from, to] = pageRange(page);
  const visible = rows.slice(from, to + 1);
  const stuckLabel = adim && adim !== PROGRESS_DONE_FILTER ? (summary.steps.find((s) => s.id === adim)?.label ?? null) : null;

  return (
    <div className="space-y-4">
      <nav aria-label="Takılan adım süzgeci" className="flex flex-wrap gap-2">
        <FilterChip href={progressHref(null)} active={!adim} count={all.length}>
          Tümü
        </FilterChip>
        {summary.steps.map((s) => (
          <FilterChip key={s.id} href={progressHref(s.id)} active={adim === s.id} count={s.count}>
            {s.label}
          </FilterChip>
        ))}
        <FilterChip href={progressHref(PROGRESS_DONE_FILTER)} active={adim === PROGRESS_DONE_FILTER} count={summary.done}>
          Tamamlayan
        </FilterChip>
      </nav>
      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        {visible.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">
            {adim === PROGRESS_DONE_FILTER
              ? "Kurulumu tamamlayan ofis henüz yok."
              : stuckLabel
                ? `"${stuckLabel}" adımında takılan ofis yok.`
                : adim
                  ? "Bu adımda takılan ofis yok."
                  : "Henüz ofis yok."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((r) => (
              <li key={r.tenantId} className="grid gap-2 px-5 py-3.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-4">
                <div className="min-w-0">
                  <Link href={`/admin/tenants/${r.tenantId}?sekme=kullanim`} className="block truncate text-sm font-semibold text-ink-950 hover:text-brand-600">
                    {r.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-text-faint">
                    {STATUS_LABEL[r.status] ?? r.status} · {planLabel(r.plan)}
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-text-muted">
                    <span>
                      {r.doneCount} / {r.total} adım
                    </span>
                    <span className="numeric">%{r.percent}</span>
                  </div>
                  <Progress value={r.percent} label={`${r.name} kurulum ilerlemesi`} tone={toneOf(r.percent)} className="mt-1" />
                </div>
                <div className="text-xs">
                  {r.stuckId ? (
                    <Link href={progressHref(r.stuckId)} className="font-semibold text-amber-700 hover:text-brand-600">
                      Takıldığı adım: {r.stuckLabel}
                    </Link>
                  ) : (
                    <Link href={progressHref(PROGRESS_DONE_FILTER)} className="font-semibold text-mint-700 hover:text-brand-600">
                      Kurulum tamam
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="px-5 pb-4">
          <Pagination page={page} total={rows.length} hrefFor={(p) => progressHref(adim, p)} />
        </div>
      </section>
    </div>
  );
}

/** Ofis 360 kartı: tek ofisin adım listesi; takılan adım toplu listedeki aynı süzgece götürür. */
export function OfficeProgressCard({ progress, ready }: { progress: OfficeProgress | null; ready: boolean }) {
  return (
    <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <ListChecks className="h-4 w-4 text-brand-600" /> Kurulum ilerlemesi
        </h2>
        {progress ? (
          <Link
            href={progress.stuckId ? progressHref(progress.stuckId) : progressHref(PROGRESS_DONE_FILTER)}
            className="rounded-full bg-brand-600/8 px-2.5 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-600/12"
          >
            {progress.doneCount} / {progress.total} adım · %{progress.percent}
          </Link>
        ) : null}
      </div>
      <div className="p-5">
        {!ready ? (
          <p className="text-xs text-amber-700">Kurulum bekliyor: ilerleme veritabanı güncellemesiyle (20261014025000) gelir.</p>
        ) : !progress ? (
          <p className="text-xs text-text-muted">Bu ofisin kurulum durumu okunamadı (iptal edilmiş ofisler listelenmez).</p>
        ) : (
          <>
            <Progress value={progress.percent} label="Kurulum ilerlemesi" tone={toneOf(progress.percent)} />
            <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {progress.steps.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-xs">
                  {s.done ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-mint-600" aria-hidden />
                  ) : (
                    <Circle className={`h-4 w-4 shrink-0 ${s.id === progress.stuckId ? "text-amber-600" : "text-text-faint"}`} aria-hidden />
                  )}
                  <span className={s.done ? "text-text-muted" : "font-semibold text-ink-950"}>{s.title}</span>
                  {s.id === progress.stuckId ? (
                    <Link href={progressHref(s.id)} className="ml-auto shrink-0 font-semibold text-amber-700 hover:text-brand-600">
                      Takıldığı adım
                    </Link>
                  ) : null}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-text-faint">
              Ofis düzeyi: kişisel adım ofis sahibinin bilgisinden sayılır; ofisin &quot;sonra yaparım&quot; tercihleri burada görünmez.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
