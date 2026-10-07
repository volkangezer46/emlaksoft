import Link from "@/components/ui/smart-link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type DonutSegment = {
  key: string;
  label: string;
  count: number;
  color: string;
  href: string;
  active?: boolean;
};

const DONUT_RADIUS = 44;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

export function TicketStatusDonut({
  segments,
  total,
}: {
  segments: DonutSegment[];
  total: number;
}) {
  const arcs = segments.map((segment, index) => {
    const length = total > 0 ? (segment.count / total) * DONUT_CIRCUMFERENCE : 0;
    const offset = segments.slice(0, index).reduce(
      (sum, previous) => sum + (total > 0 ? (previous.count / total) * DONUT_CIRCUMFERENCE : 0),
      0,
    );
    return { ...segment, length, offset };
  });
  const titleId = "ticket-status-donut-title";
  const description = segments.map((segment) => `${segment.label}: ${segment.count}`).join(", ");

  return (
    <section className="surface-card min-w-0 rounded-[var(--radius-panel)] p-4 sm:p-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-brand-600">Kuyruk yapısı</p>
        <h2 className="mt-1 font-display text-base font-extrabold text-ink-950">Durum dağılımı</h2>
        <p className="mt-0.5 text-xs text-text-muted">Tüm destek taleplerinin güncel görünümü</p>
      </div>

      <div className="mt-4 grid items-center gap-4 sm:grid-cols-[132px_1fr] lg:grid-cols-1 xl:grid-cols-[132px_1fr]">
        <div className="relative mx-auto h-[132px] w-[132px]">
          <svg
            viewBox="0 0 120 120"
            className="h-full w-full"
            role="img"
            aria-labelledby={titleId}
          >
            <title id={titleId}>{`Destek talepleri durum dağılımı. ${description}`}</title>
            <circle
              cx="60"
              cy="60"
              r={DONUT_RADIUS}
              fill="none"
              stroke="var(--line)"
              strokeWidth="12"
            />
            {arcs
              .filter((arc) => arc.count > 0)
              .map((arc) => (
                <circle
                  key={arc.key}
                  cx="60"
                  cy="60"
                  r={DONUT_RADIUS}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth="12"
                  strokeLinecap={arc.length >= DONUT_CIRCUMFERENCE - 0.5 ? "round" : "butt"}
                  strokeDasharray={`${arc.length} ${Math.max(0, DONUT_CIRCUMFERENCE - arc.length)}`}
                  strokeDashoffset={-arc.offset}
                  transform="rotate(-90 60 60)"
                />
              ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="numeric font-display text-2xl font-extrabold leading-none text-ink-950">
                {total.toLocaleString("tr-TR")}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">Toplam</p>
            </div>
          </div>
        </div>

        <ul className="space-y-1.5">
          {segments.map((segment) => {
            const percent = total > 0 ? Math.round((segment.count / total) * 100) : 0;
            return (
              <li key={segment.key}>
                <Link
                  href={segment.href}
                  aria-current={segment.active ? "page" : undefined}
                  className={cn(
                    "focus-ring group flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs transition",
                    segment.active ? "bg-brand-600/[0.07]" : "hover:bg-canvas",
                  )}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: segment.color }} aria-hidden />
                  <span className={cn("min-w-0 flex-1 truncate", segment.active ? "font-bold text-ink-950" : "text-text-muted")}>{segment.label}</span>
                  <span className="numeric font-bold tabular-nums text-ink-950">{segment.count}</span>
                  <span className="numeric w-8 text-right text-xs text-text-faint">%{percent}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export function TicketResolutionGauge({
  rate,
  resolved,
  total,
  averageLabel,
  href,
}: {
  rate: number;
  resolved: number;
  total: number;
  averageLabel: string;
  href: string;
}) {
  const safeRate = Math.min(100, Math.max(0, rate));
  const titleId = "ticket-resolution-gauge-title";

  return (
    <section className="surface-card min-w-0 rounded-[var(--radius-panel)] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-mint-600">Operasyon kalitesi</p>
          <h2 className="mt-1 font-display text-base font-extrabold text-ink-950">Çözüm performansı</h2>
          <p className="mt-0.5 text-xs text-text-muted">Tüm zamanlar · gerçek kayıtlar</p>
        </div>
        <Link href={href} aria-label="Çözülen talepleri listele" className="focus-ring rounded-[var(--radius-control)] p-1.5 text-text-faint transition hover:bg-canvas hover:text-mint-600">
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="relative mx-auto mt-3 h-[118px] max-w-[220px]">
        <svg viewBox="0 0 120 78" className="h-full w-full" role="img" aria-labelledby={titleId}>
          <title id={titleId}>{`Çözüm oranı yüzde ${safeRate}. ${resolved}/${total} talep çözüldü.`}</title>
          <path
            d="M 14 66 A 46 46 0 0 1 106 66"
            fill="none"
            stroke="var(--mint-500)"
            strokeOpacity="0.12"
            strokeWidth="10"
            strokeLinecap="round"
            pathLength="100"
          />
          <path
            d="M 14 66 A 46 46 0 0 1 106 66"
            fill="none"
            stroke="var(--mint-500)"
            strokeWidth="10"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray={`${safeRate} 100`}
          />
        </svg>
        <div className="pointer-events-none absolute inset-x-0 bottom-1 text-center">
          <p className="numeric font-display text-3xl font-extrabold leading-none text-ink-950">%{safeRate}</p>
          <p className="mt-1 text-xs font-semibold text-text-muted">{resolved}/{total} çözüldü</p>
        </div>
      </div>

      <div className="mt-2 rounded-[var(--radius-card)] border border-hairline bg-canvas/70 px-3 py-2.5 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">Ortalama çözüm süresi</p>
        <p className="mt-0.5 font-display text-base font-extrabold text-ink-950">{averageLabel}</p>
      </div>
    </section>
  );
}
