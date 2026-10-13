import Link from "@/components/ui/smart-link";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SeoTab = { id: string; label: string; icon: LucideIcon; expert?: boolean };

/**
 * SEO sekme şeridi: TEMEL sekmeler (Genel ve kurulum · Sorunlar ve robot) her zaman görünür; diğerleri "Uzman ▾" altında
 * (details/summary: klavye erişimli, JS gerektirmez). `?sekme=` adresleri DEĞİŞMEZ; etkin sekme uzmandaysa "Uzman" etkin
 * görünür ve menü açık gelir. İlk sekme parametresiz adrestir.
 */
export function SeoTabs({ base, tabs, active }: { base: string; tabs: readonly SeoTab[]; active: string }) {
  const basic = tabs.filter((t) => !t.expert);
  const expert = tabs.filter((t) => t.expert);
  const expertActive = expert.some((t) => t.id === active);
  const href = (t: SeoTab) => (t.id === tabs[0]?.id ? base : `${base}?sekme=${t.id}`);
  const item = (t: SeoTab, inMenu: boolean) => (
    <Link
      key={t.id}
      href={href(t)}
      aria-current={t.id === active ? "page" : undefined}
      className={cn(
        "focus-ring inline-flex items-center gap-2 rounded-[var(--radius-control)] px-3.5 py-1.5 text-sm font-semibold transition touch:min-h-11",
        inMenu && "w-full",
        t.id === active ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]" : "text-text-muted hover:text-ink-950",
      )}
    >
      <t.icon className="h-3.5 w-3.5" aria-hidden />
      {t.label}
    </Link>
  );
  return (
    <nav aria-label="SEO sekmeleri" className="no-print relative space-y-2">
      <div className="inline-flex flex-wrap items-center gap-1 rounded-[var(--radius-card)] border border-line bg-canvas p-1">
        {basic.map((t) => item(t, false))}
        {expert.length === 0 ? null : expertActive ? (
          <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-surface px-3.5 py-1.5 text-sm font-semibold text-ink-950 shadow-[var(--shadow-xs)] touch:min-h-11">
            Uzman
          </span>
        ) : (
          <details className="group relative">
            <summary className="focus-ring inline-flex cursor-pointer list-none items-center gap-1.5 rounded-[var(--radius-control)] px-3.5 py-1.5 text-sm font-semibold text-text-muted transition hover:text-ink-950 touch:min-h-11 [&::-webkit-details-marker]:hidden">
              Uzman
              <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" aria-hidden />
            </summary>
            <div className="absolute left-0 z-20 mt-1 grid min-w-[14rem] gap-0.5 rounded-[var(--radius-card)] border border-line bg-canvas p-1 shadow-[var(--shadow-lg)]">
              {expert.map((t) => item(t, true))}
            </div>
          </details>
        )}
      </div>
      {expertActive ? (
        <div className="-mx-1 overflow-x-auto px-1">
          <div className="inline-flex min-w-max items-center gap-1 rounded-[var(--radius-card)] border border-line bg-canvas p-1" aria-label="Uzman sekmeleri" role="group">
            {expert.map((t) => item(t, false))}
          </div>
        </div>
      ) : null}
    </nav>
  );
}
