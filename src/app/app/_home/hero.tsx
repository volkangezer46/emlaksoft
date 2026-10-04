import { Suspense } from "react";
import Link from "next/link";
import { Plus, Tv } from "lucide-react";
import { GlassKpi, HeroBanner, PeriodToggle, type Period } from "@/components/ui/premium";
import { formatTrTime, now, trParts } from "@/lib/clock";
import { ICONS } from "@/lib/icons";
import { moneyTry } from "@/lib/leak-shield";
import { WidgetEditToggle } from "../dashboard-widgets";
import { loadCommissionSummary, loadKpiCounts, loadPeriodStats, loadTaskSummary, loadTodayAppointments, type HomeCtx } from "./data";
import { apptTypeLabel } from "./format";
import { greetingFor, weekBuckets } from "./helpers";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

/** "3 EKİM CUMARTESİ · GENEL BAKIŞ" — Türkiye saatine göre (clock.ts). */
export function heroEyebrow(nowMs: number): string {
  const p = trParts(nowMs);
  return `${p.day} ${MONTHS[p.month]} ${WEEKDAYS[p.weekday]} · Genel bakış`.toLocaleUpperCase("tr-TR");
}

/** Tek cümle özet: bugünün gerçek randevu/görev sayısı + seçili dönemdeki yeni kayıtlar. */
async function HeroSummary({ ctx }: { ctx: HomeCtx }) {
  const [appts, tasks, stats] = await Promise.all([loadTodayAppointments(ctx), loadTaskSummary(ctx), loadPeriodStats(ctx)]);
  const apptCount = appts.total || appts.rows.length;
  const taskCount = tasks.dueToday + tasks.overdue;
  const today: string[] = [];
  if (apptCount > 0) today.push(`${apptCount} randevu`);
  if (taskCount > 0) today.push(`${taskCount} görev`);
  const first = today.length > 0 ? `Bugün ${today.join(" ve ")} sizi bekliyor.` : "Bugün için planlanmış randevu ya da görev yok.";
  return (
    <p className={SUMMARY_MIN}>
      {first} Son {ctx.period} günde {stats.customers} yeni müşteri ve {stats.demands} yeni talep kaydedildi.
    </p>
  );
}

/** Özet cümlesi mobilde ~3 satır: iskelet ile gerçek metin aynı asgari yüksekliği paylaşır (CLS). */
const SUMMARY_MIN = "min-h-[4.5rem] sm:min-h-6";

function GlassIskelet() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="pm-glass animate-pulse" aria-hidden="true" />
      ))}
    </>
  );
}

/** Hero içi 4 cam KPI — hepsi gerçek veri; seri yalnız gerçek geçmişten. */
async function HeroKpis({ ctx }: { ctx: HomeCtx }) {
  const [appts, tasks, counts, commission] = await Promise.all([
    loadTodayAppointments(ctx),
    loadTaskSummary(ctx),
    loadKpiCounts(ctx),
    loadCommissionSummary(ctx),
  ]);
  const apptCount = appts.total || appts.rows.length;
  const first = appts.rows[0];
  const nowMs = now();
  return (
    <>
      <GlassKpi
        label="Bugünkü randevu"
        value={apptCount}
        sub={first ? `İlk: ${formatTrTime(first.scheduled_at)} · ${apptTypeLabel[first.appointment_type] ?? first.appointment_type}` : "Bugün plan yok"}
        href="/app/randevular"
        icon={ICONS.randevu}
      />
      <GlassKpi
        label="Bugünün görevleri"
        value={tasks.dueToday + tasks.overdue}
        sub={tasks.overdue > 0 ? `${tasks.overdue} gecikmiş` : tasks.dueToday > 0 ? "Hepsi zamanında" : "Açık görev yok"}
        subTone={tasks.overdue > 0 ? "danger" : undefined}
        href="/app/gorevler"
        icon={ICONS.gorev}
      />
      <GlassKpi
        label="Toplam müşteri"
        value={counts.customerCount}
        sub={`Bu ay ${counts.customersThisMonth} yeni`}
        href="/app/musteriler"
        icon={ICONS.musteri}
        series={weekBuckets(counts.customerDates, nowMs)}
        seriesUnit="hafta"
        seriesLabel="Son 7 hafta haftalık yeni müşteri sayısı"
      />
      <GlassKpi
        label="Bekleyen komisyon"
        value={moneyTry(commission.pending)}
        sub="Tahsil bekleyen toplam"
        href="/app/komisyon?durum=bekleyen"
        icon={ICONS.komisyon}
        series={commission.monthTotals}
        seriesUnit="ay"
        seriesLabel="Son 6 ay komisyon tutarı"
      />
    </>
  );
}

/**
 * Ana ekran karşılama bandı. Kabuk (selamlama, eyebrow, eylemler) anında çizilir;
 * özet cümlesi ve KPI kutuları kendi Suspense sınırında akar.
 */
export function AnaHero({
  ctx,
  hasName,
  params,
}: {
  ctx: HomeCtx;
  hasName: boolean;
  params: Record<string, string | undefined>;
}) {
  const nowMs = now();
  const greeting = greetingFor(trParts(nowMs).hour);
  return (
    <HeroBanner
      eyebrow={heroEyebrow(nowMs)}
      title={greeting}
      highlight={hasName ? ctx.firstName : undefined}
      summary={
        <Suspense fallback={<p className={SUMMARY_MIN}>Bugünün özeti hazırlanıyor…</p>}>
          <HeroSummary ctx={ctx} />
        </Suspense>
      }
      actions={
        <>
          <PeriodToggle current={ctx.period as Period} basePath="/app" params={params} label="Özet dönemi" />
          <Link href="/app/musteriler/yeni" className="pm-hero-btn focus-ring">
            <Plus className="h-4 w-4" aria-hidden="true" /> Müşteri
          </Link>
          <WidgetEditToggle className="border-white/20 bg-white/8 text-white hover:bg-white/14" />
          <Link
            href="/app/pano-tv"
            title="TV modu — büyük ekran görünümü"
            aria-label="TV modunu aç"
            className="pm-hero-btn pm-hero-btn-ghost focus-ring"
          >
            <Tv className="h-4 w-4" aria-hidden="true" />
          </Link>
        </>
      }
    >
      <Suspense fallback={<GlassIskelet />}>
        <HeroKpis ctx={ctx} />
      </Suspense>
    </HeroBanner>
  );
}
