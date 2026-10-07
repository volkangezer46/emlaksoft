import Link from "@/components/ui/smart-link";
import { ArrowUpRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { DAY_MS } from "@/lib/clock";
import { TaskQuickRow } from "../dashboard-quick-actions";
import { Widget } from "../dashboard-widgets";
import { loadTaskSummary, type HomeCtx } from "./data";
import { formatTrTime } from "@/lib/clock";
import { PanelLink } from "./ortak";

export async function Gorevler({ ctx }: { ctx: HomeCtx }) {
  const summary = await loadTaskSummary(ctx);

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
          : `Bugün ${formatTrTime(t.due_at)}`
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
              {summary.dueToday + summary.overdue}
            </Link>
            <PanelLink href="/app/gorevler">
              Tümü <ArrowUpRight className="h-3.5 w-3.5" />
            </PanelLink>
          </span>
        </div>
        {dueTasks.length === 0 ? (
          <EmptyState
            variant="compact"
            illustration="gorev"
            tone="mint"
            title="Bugün için açık görev yok"
            description="Yeni görev ekleyerek günü planlayın."
            action={{ href: "/app/gorevler", label: "Görev ekle" }}
          />
        ) : (
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
        </ul>
        )}
      </section>
    </Widget>
  );
}
