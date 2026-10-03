import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, Plus, Sparkles } from "lucide-react";
import { buildDailyBriefing, type BriefingItem, type BriefingTone } from "@/lib/briefing";
import { generateBriefingSummary } from "@/lib/ai/briefing-summary";
import { formatTrTime } from "@/lib/clock";
import { EmptyArt } from "@/components/ui/premium";
import {
  loadCommissionSummary,
  loadExpiringAuthority,
  loadHotLeadCount,
  loadLiveListings,
  loadTaskSummary,
  loadTodayAppointments,
  type HomeCtx,
} from "./data";
import { overdueListingsOf } from "./helpers";
import { apptTypeLabel } from "./format";

/** Brifing tonu → premium ton sınıfı (renk yalnız durum anlamı taşır). */
const QUEUE_TONE: Record<BriefingTone, string> = {
  danger: "pm-t-danger",
  warn: "pm-t-warn",
  amber: "pm-t-gold",
  mint: "pm-t-success",
  brand: "pm-t-brand",
};

/** Kuyruğun görünür satır üst sınırı (şartname: en çok 6). */
const QUEUE_MAX = 6;

/**
 * Opsiyonel AI özet satırı — Suspense içinde ayrı stream edilir, sayfanın
 * ilk boyamasını bekletmez. OpenAI anahtarı yoksa/hata olursa hiç görünmez.
 */
async function BriefingAiLine({ items }: { items: BriefingItem[] }) {
  const summary = await generateBriefingSummary(items);
  if (!summary) return null;
  return (
    <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-3 py-2 text-xs font-medium text-[var(--accent-text)]">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{summary}</span>
    </p>
  );
}

/**
 * "Bugün kuyruğu" — ana ekranın en önemli bloğu: gecikmiş görev, bugünkü randevu,
 * sıcak müşteri, teyitsiz ilan, bekleyen komisyon, süresi dolan yetki. Kural tabanlı
 * (bkz. lib/briefing); her satır filtrelenmiş hedefe gider. Boşken anlamlı boş durum.
 */
export async function BugunOzet({ ctx }: { ctx: HomeCtx }) {
  const [tasks, appts, hotLeadCount, listings, commissionSummary, expiring] = await Promise.all([
    loadTaskSummary(ctx),
    loadTodayAppointments(ctx),
    loadHotLeadCount(ctx),
    loadLiveListings(),
    loadCommissionSummary(ctx),
    loadExpiringAuthority(),
  ]);

  const first = appts.rows[0];
  const items = buildDailyBriefing({
    todayAppointments: appts.total || appts.rows.length,
    firstAppointment: first
      ? { time: formatTrTime(first.scheduled_at), type: apptTypeLabel[first.appointment_type] ?? first.appointment_type }
      : null,
    expiringAuthority: expiring.data.length,
    tasksDueToday: tasks.dueToday,
    tasksOverdue: tasks.overdue,
    unconfirmedListings: overdueListingsOf(listings).length,
    hotLeads: hotLeadCount,
    pendingCommission: commissionSummary.pending,
  });
  const shown = items.slice(0, QUEUE_MAX);

  return (
    <section className="pm-bx flex h-full flex-col p-5" aria-labelledby="bugun-kuyruk-baslik">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="pm-bx-eyebrow">Bugün</p>
          <h2 id="bugun-kuyruk-baslik" className="pm-bx-title mt-0.5 text-lg">
            Bugün kuyruğu
          </h2>
        </div>
        {items.length > 0 ? (
          <span className="pm-num rounded-full bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-2.5 py-1 text-sm text-[var(--accent-text)]">
            {items.length}
            <span className="sr-only"> iş</span>
          </span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="pm-empty flex-1">
          <EmptyArt kind="check" />
          <p className="font-semibold text-[var(--text)]">Bugün için acil iş yok</p>
          <p>Gecikmiş görev, bekleyen randevu ya da sıcak müşteri görünmüyor.</p>
          <Link href="/app/talepler" className="focus-ring mt-1 inline-flex items-center gap-1 rounded-[var(--radius-control)] text-sm font-semibold text-[var(--accent-text)]">
            <Plus className="h-4 w-4" aria-hidden="true" /> Talepleri aç
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-1">
            {shown.map((item) => (
              <li key={item.href} className="min-w-0">
                <Link href={item.href} className={`pm-row focus-ring group ${QUEUE_TONE[item.tone]}`}>
                  <span className="pm-row-ico text-base" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-[var(--text)]">{item.text}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-faint)] group-hover:text-[var(--t-text)]" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          {items.length > shown.length ? (
            <p className="mt-2 px-2 text-xs text-[var(--text-muted)]">+{items.length - shown.length} iş daha — görevler ve randevular aşağıda.</p>
          ) : null}
          <Suspense fallback={null}>
            <BriefingAiLine items={items} />
          </Suspense>
        </>
      )}
    </section>
  );
}
