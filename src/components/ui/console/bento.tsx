import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Bento ızgara: mobil 1, tablet 6, masaüstü 12 sütun. */
export function Bento({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12", className)}>{children}</div>;
}

/** Bento kutusu: `span` sınıfı çağıranda verilir (ör. "md:col-span-6 xl:col-span-7"). */
export function Bx({
  title,
  eyebrow,
  icon: Icon,
  href,
  hrefLabel = "Tümü",
  className,
  children,
}: {
  title?: string;
  eyebrow?: string;
  icon?: LucideIcon;
  /** Başlık şeridindeki "Tümü" hedefi. */
  href?: string;
  hrefLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("bx min-w-0 p-4 sm:p-5", className)}>
      {title || eyebrow ? (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="bx-eyebrow flex items-center gap-1.5">
                {Icon ? <Icon className="h-4 w-4 text-text-faint" aria-hidden /> : null}
                {eyebrow}
              </p>
            ) : null}
            {title ? <h2 className="mt-0.5 font-display text-base font-bold text-text">{title}</h2> : null}
          </div>
          {href ? (
            <Link href={href} className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-1 text-xs font-semibold text-accent-text transition-colors hover:text-text">
              {hrefLabel} <ArrowUpRight className="icon-nudge h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export type QueueItem = {
  label: string;
  /** Gerçek sayı. */
  count?: number;
  hint?: string;
  href: string;
  icon: LucideIcon;
  tone?: "danger" | "warn" | "brand" | "neutral";
};

const TONE: Record<NonNullable<QueueItem["tone"]>, string> = {
  danger: "text-danger-600",
  warn: "text-amber-700",
  brand: "text-accent-text",
  neutral: "text-text-muted",
};

/** Kuyruk satırları: 44 px, tam satır bağlantı, sağda sayı + ok. */
export function QueueList({ items }: { items: readonly QueueItem[] }) {
  return (
    <ul className="-mx-1 space-y-0.5">
      {items.map((it) => (
        <li key={it.href + it.label}>
          <Link href={it.href} className="qrow focus-ring group">
            <it.icon className={cn("h-4 w-4 shrink-0", TONE[it.tone ?? "neutral"])} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-text">{it.label}</span>
              {it.hint ? <span className="block truncate text-xs text-text-muted">{it.hint}</span> : null}
            </span>
            {it.count !== undefined ? <span className="num text-sm text-text">{it.count}</span> : null}
            <ChevronRight className="h-4 w-4 shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
