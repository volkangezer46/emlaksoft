import Link from "@/components/ui/smart-link";
import { ArrowDownCircle, ArrowUpCircle, ArrowUpRight, CalendarClock } from "lucide-react";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { shiftDayKey } from "@/lib/finance/smart-entry";
import { cn } from "@/lib/utils";

/**
 * Genel bakış: önümüzdeki 7 günün zaman çizelgesi (alacak / borç / kira / komisyon / düzenli ödeme / mülk sahibi ödemesi).
 * Kaynak `finance_open_items_v` (veri kopyalanmaz; `upcoming-load.ts`, yalnız bugün..+7); her satır kendi hedefine gider.
 * Vadesi geçenlerin SAYISI pano özetinden (`overdueCount`, kesilmemiş) gelir ve rozetle Cari'deki "vadesi geçen" süzgecine gider.
 */

export type UpcomingRow = {
  key: string;
  source: string;
  direction: "receivable" | "payable";
  title: string;
  partyLabel: string | null;
  amount: number;
  currency: string;
  dueDate: string | null;
  href: string;
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "Vadeli kayıt",
  rent: "Kira",
  commission: "Komisyon",
  recurring: "Düzenli ödeme",
  owner_payout: "Mülk sahibi ödemesi",
};

const DAY_FMT = new Intl.DateTimeFormat("tr-TR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function dayLabel(day: string, today: string): string {
  if (day === today) return "Bugün";
  if (day === shiftDayKey(today, 1)) return "Yarın";
  const [y, m, d] = day.split("-").map(Number);
  return DAY_FMT.format(Date.UTC(y!, m! - 1, d!));
}

export function UpcomingList({
  rows,
  today,
  overdueCount,
  overdueHref,
  allHref,
}: {
  rows: readonly UpcomingRow[];
  today: string;
  overdueCount: number;
  overdueHref: string;
  allHref: string;
}) {
  const upcoming = rows.filter((r) => r.dueDate == null || r.dueDate >= today).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const groups = new Map<string, UpcomingRow[]>();
  for (const r of upcoming) {
    const k = r.dueDate ?? today;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]" aria-labelledby="fin-upcoming">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="fin-upcoming" className="flex items-center gap-1.5 font-display text-base font-bold text-text">
          <CalendarClock className="h-4 w-4 text-accent-text" aria-hidden="true" /> Önümüzdeki 7 gün
        </h2>
        <div className="flex items-center gap-2">
          {overdueCount > 0 ? (
            <Link href={overdueHref} className="focus-ring press inline-flex min-h-8 touch:min-h-11 items-center gap-1 rounded-full bg-danger-500 px-2.5 text-xs font-bold text-white">
              Vadesi geçen {overdueCount}
            </Link>
          ) : null}
          <Link href={allHref} className="focus-ring inline-flex min-h-8 touch:min-h-11 items-center gap-1 text-xs font-semibold text-accent-text hover:underline">
            Tümü <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </header>
      {upcoming.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line px-3 py-6 text-center text-xs text-text-muted">
          Önümüzdeki 7 günde vadesi gelen tahsilat ya da ödeme yok.
        </p>
      ) : (
        <ol className="grid grid-cols-[minmax(0,1fr)] gap-3">
          {[...groups.entries()].map(([day, items]) => (
            <li key={day} className="grid gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">{dayLabel(day, today)}</p>
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
                {items.map((r) => {
                  const inbound = r.direction === "receivable";
                  return (
                    <li key={r.key}>
                      <Link
                        href={r.href}
                        className="focus-ring press group flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] border border-transparent px-2 py-1.5 transition hover:border-line hover:bg-surface-hover"
                      >
                        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", inbound ? "bg-success-soft text-success-strong" : "bg-warning-soft text-warning-strong")}>
                          {inbound ? <ArrowDownCircle className="h-4 w-4" aria-hidden="true" /> : <ArrowUpCircle className="h-4 w-4" aria-hidden="true" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-text">{r.title}</span>
                          <span className="block truncate text-xs text-text-muted">
                            {SOURCE_LABEL[r.source] ?? "Açık kalem"}
                            {r.partyLabel ? ` · ${r.partyLabel}` : ""}
                          </span>
                        </span>
                        <span className={cn("numeric shrink-0 text-sm font-bold", inbound ? "text-success-strong" : "text-text")}>
                          {inbound ? "+" : "−"}
                          {formatAccountMoney(r.amount, r.currency)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
