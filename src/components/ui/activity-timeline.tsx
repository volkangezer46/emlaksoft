import Link from "next/link";
import type { ComponentType } from "react";
import {
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarDays,
  CheckCircle2,
  Eye,
  FileSignature,
  FileText,
  Globe,
  Handshake,
  History,
  Mail,
  MessageSquare,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Tag,
  User,
} from "lucide-react";
import { EmptyStateV3 } from "@/components/ui/empty-state-v3";
import { formatCount } from "@/lib/ui/filter-params";
import { formatTrTime } from "@/lib/clock";
import { cn } from "@/lib/utils";
import {
  groupEventsByDay,
  pageEvents,
  type TimelineEvent,
  type TimelineTone,
} from "@/lib/activity-timeline";

export type { TimelineEvent, TimelineTone };

type IconC = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** `TimelineEvent.icon` anahtarları. */
export const TIMELINE_ICONS: Record<string, IconC> = {
  phone: PhoneCall,
  calendar: CalendarDays,
  message: MessageSquare,
  mail: Mail,
  offer: Tag,
  deal: Handshake,
  task: CheckCircle2,
  note: StickyNote,
  portal: Globe,
  file: FileText,
  sign: FileSignature,
  money: Banknote,
  user: User,
  property: Building2,
  view: Eye,
  shield: ShieldCheck,
  spark: Sparkles,
  history: History,
};

/** Kategori anahtarına göre varsayılan ikon (icon verilmediyse). */
const CATEGORY_ICON: Record<string, string> = {
  gorusme: "phone",
  randevu: "calendar",
  teklif: "offer",
  anlasma: "deal",
  gorev: "task",
  not: "note",
  portal: "portal",
  belge: "file",
  komisyon: "money",
  fiyat: "money",
};

const TONE_CLASS: Record<TimelineTone, string> = {
  neutral: "tone-neutral",
  success: "tone-success",
  warn: "tone-warning",
  danger: "tone-danger",
  info: "tone-info",
};

export type TimelineCategory = { key: string; label: string; count?: number };

export function ActivityTimeline({
  events,
  categories,
  activeCategory = "",
  hrefForCategory,
  emptyTitle,
  emptyHint,
  pageSize,
  loadMoreHref,
}: {
  events: TimelineEvent[];
  categories?: TimelineCategory[];
  /** URL `?kategori=` değeri; olaylar sunucuda bu kategoriye göre süzülmüş gelmelidir. */
  activeCategory?: string;
  hrefForCategory?: (key: string) => string;
  emptyTitle: string;
  emptyHint?: string;
  pageSize?: number;
  loadMoreHref?: string;
}) {
  const { visible, hasMore } = pageEvents(events, pageSize);
  const groups = groupEventsByDay(visible);
  const showChips = categories && categories.length > 0 && hrefForCategory;
  const total = categories?.every((c) => c.count !== undefined)
    ? categories.reduce((n, c) => n + (c.count ?? 0), 0)
    : undefined;

  return (
    <div className="space-y-4">
      {showChips ? (
        <nav aria-label="Olay kategorileri" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
          {[{ key: "", label: "Tümü", count: total }, ...categories].map((c) => {
            const on = c.key === activeCategory;
            return (
              <Link
                key={c.key || "all"}
                href={hrefForCategory(c.key)}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "focus-ring press inline-flex min-h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold transition",
                  on
                    ? "bg-brand-600/10 text-brand-700 ring-1 ring-inset ring-brand-600/25"
                    : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                {c.label}
                {c.count !== undefined ? (
                  <span
                    className={cn(
                      "numeric rounded-full px-1.5 text-xs font-semibold",
                      on ? "bg-brand-600/15 text-brand-700" : "bg-canvas text-text-faint",
                    )}
                  >
                    {formatCount(c.count)}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {groups.length === 0 ? (
        <EmptyStateV3 variant="compact" title={emptyTitle} description={emptyHint} />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.dayKey} aria-label={g.heading}>
              <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-text-faint">{g.heading}</h3>
              <ol className="mt-3">
                {g.events.map((e, i) => {
                  const Icon = TIMELINE_ICONS[e.icon ?? CATEGORY_ICON[e.category] ?? "history"] ?? History;
                  const last = i === g.events.length - 1;
                  const sub = [e.actor, e.ip].filter(Boolean).join(" · ");
                  const body = (
                    <>
                      <span className="flex shrink-0 flex-col items-center self-stretch" aria-hidden="true">
                        <span className={cn("grid h-9 w-9 place-items-center rounded-full", TONE_CLASS[e.tone ?? "neutral"])}>
                          <Icon className="h-4 w-4" />
                        </span>
                        {last ? null : <span className="mt-1 w-px flex-1 bg-line" />}
                      </span>
                      <span className={cn("min-w-0 flex-1", last ? "pb-1" : "pb-5")}>
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0 break-words text-sm font-semibold text-ink-950">{e.title}</span>
                          <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs text-text-faint">
                            <time dateTime={e.at} className="numeric">{formatTrTime(e.at)}</time>
                            {e.href ? <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 transition group-hover:text-brand-600" /> : null}
                          </span>
                        </span>
                        {e.detail ? <span className="mt-0.5 line-clamp-2 block break-words text-xs text-text-muted">{e.detail}</span> : null}
                        {sub ? <span className="mt-0.5 block truncate text-xs text-text-faint">{sub}</span> : null}
                      </span>
                    </>
                  );
                  return (
                    <li key={e.id}>
                      {e.href ? (
                        <Link href={e.href} className="focus-ring group flex gap-3 rounded-[var(--radius-card)] transition hover:bg-surface-2/60">
                          {body}
                        </Link>
                      ) : (
                        <div className="flex gap-3">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {hasMore && loadMoreHref ? (
            <div className="flex justify-center">
              <Link
                href={loadMoreHref}
                scroll={false}
                className="focus-ring press inline-flex min-h-9 items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-700"
              >
                Daha eski olayları göster
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
