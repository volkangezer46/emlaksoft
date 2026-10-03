import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { moneyTry } from "@/lib/leak-shield";
import { DAY_MS } from "@/lib/clock";
import { TaskQuickRow } from "../dashboard-quick-actions";
import { Widget } from "../dashboard-widgets";
import { loadClosures, loadDeals, loadLiveListings, loadTaskSummary, type HomeCtx } from "./data";
import { daysSince, overdueListingsOf, pipelineStats } from "./helpers";
import { timeFmt } from "./format";
import { PanelLink } from "./ortak";

type Hint = { t: string; meta: string; tone: "brand" | "warn" | "amber" | "mint"; href: string };

const dotTone: Record<Hint["tone"], string> = {
  warn: "bg-warn-500",
  amber: "bg-amber-500",
  mint: "bg-mint-500",
  brand: "bg-brand-600",
};

export async function Gorevler({ ctx }: { ctx: HomeCtx }) {
  const [summary, listings, closures, deals] = await Promise.all([
    loadTaskSummary(ctx),
    loadLiveListings(),
    loadClosures(ctx),
    loadDeals(),
  ]);
  const overdueListings = overdueListingsOf(listings);
  const { openDeals } = pipelineStats({ new: 0, active: 0, matched: 0 }, deals);

  const hints: Hint[] = [
    ...overdueListings.slice(0, 3).map((r) => ({
      t: `${r.portal_name}${r.portal_listing_id ? ` #${r.portal_listing_id}` : ""} — teyit et`,
      meta: `${daysSince(r.last_confirmed_at)} gündür teyit yok`,
      tone: "warn" as const,
      href: "/app/portallar?durum=teyit",
    })),
    ...closures.recent
      .filter((c) => Number(c.estimated_lost_commission || 0) > 0)
      .slice(0, 2)
      .map((c) => ({
        t: `Kayıp: ${c.reason}`,
        meta: moneyTry(Number(c.estimated_lost_commission || 0)),
        tone: "amber" as const,
        href: "/app/kayip-kacak",
      })),
  ];
  if (openDeals > 0) {
    hints.push({ t: `${openDeals} açık anlaşma`, meta: "Satış hattını ilerletin", tone: "mint", href: "/app/anlasmalar" });
  }
  if (hints.length === 0) {
    hints.push({ t: "Portal Kontrol’ü gözden geçir", meta: "Teyit ve kapanışları güncelle", tone: "brand", href: "/app/portallar" });
  }

  const dayStartMs = new Date(ctx.dayStartIso).getTime();
  const dueTasks = summary.open.map((t) => {
    const overdueDays = t.due_at
      ? Math.max(0, Math.floor((dayStartMs - new Date(t.due_at).getTime()) / DAY_MS))
      : 0;
    return {
      id: t.id as string,
      title: (t.title as string) ?? "Görev",
      meta: t.due_at
        ? overdueDays > 0
          ? `${overdueDays} gün gecikmiş`
          : `Bugün ${timeFmt.format(new Date(t.due_at))}`
        : "Vadesiz",
      urgent: overdueDays > 0 || t.priority === "high",
    };
  });

  return (
    <Widget id="gorevler" className="h-full">
      <section className="pm-bx h-full p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-ink-950">Bugünkü görevler</h2>
          <span className="flex items-center gap-2">
            <Link
              href="/app/gorevler"
              className="focus-ring rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-600"
              title="Görevleri aç"
            >
              {dueTasks.length + hints.length}
            </Link>
            <PanelLink href="/app/gorevler">
              Tümü <ArrowUpRight className="h-3.5 w-3.5" />
            </PanelLink>
          </span>
        </div>
        <ul className="mt-4 space-y-2.5">
          {/* Gerçek görev kayıtları — hover'da tek tıkla "Tamamla" */}
          {dueTasks.map((task) => (
            <li key={task.id}>
              <TaskQuickRow id={task.id} showAction={!ctx.tvMode}>
                <div className="relative flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5 transition group-hover/task:border-brand-300 group-hover/task:bg-surface">
                  <Link
                    href="/app/gorevler"
                    className="focus-ring absolute inset-0 rounded-[var(--radius-card)]"
                    aria-label={task.title}
                  />
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${task.urgent ? "bg-danger-500" : "bg-brand-600"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-950">{task.title}</span>
                    <span className={`block text-xs ${task.urgent ? "font-semibold text-danger-500" : "text-text-muted"}`}>
                      {task.meta}
                    </span>
                  </span>
                </div>
              </TaskQuickRow>
            </li>
          ))}
          {hints.map((task) => (
            <li key={task.t}>
              <Link
                href={task.href}
                className="focus-ring group flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5 transition hover:border-brand-300 hover:bg-surface"
              >
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dotTone[task.tone]}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink-950">{task.t}</span>
                  <span className="block text-xs text-text-muted">{task.meta}</span>
                </span>
                <ArrowUpRight className="hover-action mt-1 h-4 w-4 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Widget>
  );
}
