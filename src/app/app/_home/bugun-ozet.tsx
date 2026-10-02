import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRight, CheckCircle2, Sparkles } from "lucide-react";
import { buildDailyBriefing, type BriefingItem } from "@/lib/briefing";
import { generateBriefingSummary } from "@/lib/ai/briefing-summary";
import {
  loadCommissions,
  loadExpiringAuthority,
  loadHotLeadCount,
  loadLiveListings,
  loadTaskSummary,
  loadTodayAppointments,
  type HomeCtx,
} from "./data";
import { commissionTotals, overdueListingsOf } from "./helpers";
import { apptTypeLabel, timeFmt } from "./format";
import { toneBg } from "./ortak";

/**
 * Opsiyonel AI özet satırı — Suspense içinde ayrı stream edilir, sayfanın
 * ilk boyamasını bekletmez. OpenAI anahtarı yoksa/hata olursa hiç görünmez.
 */
async function BriefingAiLine({ items }: { items: BriefingItem[] }) {
  const summary = await generateBriefingSummary(items);
  if (!summary) return null;
  return (
    <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-control)] bg-brand-600/[0.06] px-3 py-2 text-xs font-medium text-brand-600">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{summary}</span>
    </p>
  );
}

/**
 * Bugünün işleri — gecikmiş görev, bugünkü randevu, sıcak müşteri, teyitsiz ilan,
 * bekleyen komisyon. İlk ekranda ilk akan bölümdür; kural tabanlı (bkz. lib/briefing).
 */
export async function BugunOzet({ ctx }: { ctx: HomeCtx }) {
  const [tasks, appts, hotLeadCount, listings, commissions, expiring] = await Promise.all([
    loadTaskSummary(ctx),
    loadTodayAppointments(ctx),
    loadHotLeadCount(ctx),
    loadLiveListings(),
    loadCommissions(ctx),
    loadExpiringAuthority(),
  ]);

  const first = appts.rows[0];
  const items = buildDailyBriefing({
    todayAppointments: appts.total || appts.rows.length,
    firstAppointment: first
      ? { time: timeFmt.format(new Date(first.scheduled_at)), type: apptTypeLabel[first.appointment_type] ?? first.appointment_type }
      : null,
    expiringAuthority: expiring.data.length,
    tasksDueToday: tasks.dueToday,
    tasksOverdue: tasks.overdue,
    unconfirmedListings: overdueListingsOf(listings).length,
    hotLeads: hotLeadCount,
    pendingCommission: commissionTotals(commissions).pending,
  });

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-bold text-ink-950">Bugünün işleri</h2>
        {items.length > 0 ? (
          <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-600">
            {items.length}
          </span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/5 px-3 py-3 text-sm font-semibold text-mint-600">
          <CheckCircle2 className="h-4 w-4" /> Bugün için acil iş görünmüyor.
        </p>
      ) : (
        <>
          {/* grid-cols-[minmax(0,1fr)]: truncate'li içerik li'yi min-content'e açıp
              mobilde yatay taşma yaratıyordu */}
          <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <li key={item.href} className="min-w-0">
                <Link
                  href={item.href}
                  className="focus-ring group flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5 transition hover:border-brand-300 hover:bg-surface"
                >
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-base ${toneBg[item.tone]}`}>
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-950">{item.text}</span>
                  <ArrowUpRight className="hover-action h-4 w-4 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
          <Suspense fallback={null}>
            <BriefingAiLine items={items} />
          </Suspense>
        </>
      )}
    </section>
  );
}
