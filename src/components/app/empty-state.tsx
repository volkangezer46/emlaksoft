import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * Premium, tutarlı boş-durum bileşeni.
 * İllüstrasyon: yumuşak gradient orb + ikon tile + ince ızgara dokusu.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "brand",
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { href?: string; label: string; node?: React.ReactNode };
  tone?: "brand" | "mint" | "amber" | "danger";
}) {
  const toneCls: Record<string, { glow: string; tile: string }> = {
    brand: { glow: "bg-brand-600/20", tile: "bg-brand-600/10 text-brand-600" },
    mint: { glow: "bg-mint-500/20", tile: "bg-mint-500/12 text-mint-600" },
    amber: { glow: "bg-amber-400/20", tile: "bg-amber-400/15 text-amber-600" },
    danger: { glow: "bg-danger-500/15", tile: "bg-danger-500/10 text-danger-500" },
  };
  const t = toneCls[tone];

  return (
    <div className="relative grid place-items-center overflow-hidden rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
      <div className={`pointer-events-none absolute -top-10 h-40 w-40 rounded-full blur-[70px] ${t.glow}`} />
      <div className="relative">
        <span className={`mx-auto grid h-16 w-16 place-items-center rounded-[18px] ${t.tile}`}>
          <Icon className="h-8 w-8" />
        </span>
        <h2 className="mt-4 font-display text-lg font-bold text-ink-950">{title}</h2>
        {description ? <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-muted">{description}</p> : null}
        {action ? (
          <div className="mt-5 flex justify-center">
            {action.node ? (
              action.node
            ) : action.href ? (
              <Link
                href={action.href}
                className="btn-shine inline-flex items-center gap-2 rounded-[11px] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                {action.label}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
