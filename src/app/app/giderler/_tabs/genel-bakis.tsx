import { Suspense } from "react";
import dynamic from "next/dynamic";
import Link from "@/components/ui/smart-link";
import { AlertTriangle, ArchiveRestore, ArrowDownCircle, ArrowUpCircle, Inbox, Landmark, Receipt, Scale, TrendingDown, Wallet } from "lucide-react";
import { KpiStrip, type KpiItem } from "@/components/ui/list-kit";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { SampleDataBadge } from "@/components/ui/sample-data-badge";
import { SkeletonCard } from "@/components/ui/viz";
import { createClient } from "@/lib/supabase/server";
import { now as nowMs, trDayKey } from "@/lib/clock";
import { loadSampleKpiScope } from "@/lib/sample-scope";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { loadForecast, loadOverview, loadSettings, loadUpcoming } from "@/lib/finance/ledger/load";
import type { FinanceTabProps } from "@/lib/finance/ledger/types";
import { cn } from "@/lib/utils";
import { UpcomingList, type UpcomingRow } from "../_components/upcoming-list";
import type { ForecastChartPoint } from "../_components/forecast-chart";
import { NewEntryButton } from "../quick-entry";
import { financeHref } from "./finance-shell";
import { PendingApprovalsCard } from "./pending-card";
import { ManagementFeeCard, OwnerPayoutsCard } from "./management-fee-card";

/**
 * Genel bakış (Muhasebe varsayılan sekmesi). Dört KPI (TL'ye çevrilmiş nakit, bu ay net, tahsil edilecek, ödenecek),
 * 30/90 gün nakit akışı (gerçekleşen düz, tahmin kesikli ve etiketli), 7 günlük yaklaşanlar, vadesi geçenler, incelenecekler,
 * KDV, eski giderleri taşıma uyarısı ve mevcut onay / yönetim ücreti kartları. Her sayı ve satır filtreli hedefe gider.
 * Sorgular paralel (`Promise.all`); grafik `next/dynamic` ile iner. Veri yoksa kart çizilmez ya da anlamlı boş durum çıkar.
 */

const ForecastChart = dynamic(() => import("../_components/forecast-chart").then((m) => m.ForecastChart), {
  loading: () => <SkeletonCard height={300} label="Nakit akışı yükleniyor" />,
});

const money = (n: number) => formatAccountMoney(n, "TRY");

export async function GenelBakisTab(props: FinanceTabProps) {
  const { params, perms, tenantId } = props;
  const today = trDayKey(nowMs());
  const monthFrom = `${today.slice(0, 8)}01`;
  const days = params.gun === "90" ? 90 : 30;
  const supabase = await createClient();

  const [overview, forecast, upcomingItems, settings, sample] = await Promise.all([
    loadOverview(monthFrom, today),
    loadForecast(days),
    loadUpcoming(7),
    loadSettings(),
    loadSampleKpiScope(supabase, tenantId),
  ]);

  const byCurrency = overview?.byCurrency ?? [];
  const cashTotal = overview?.cashTotalTry ?? 0;
  const inTotal = overview?.inTotal ?? 0;
  const outTotal = overview?.outTotal ?? 0;
  const net = overview?.net ?? inTotal - outTotal;
  const receivable = overview?.receivableOpen ?? 0;
  const payable = overview?.payableOpen ?? 0;
  const overdueCount = overview?.overdueCount ?? 0;
  const reviewCount = overview?.reviewCount ?? 0;
  const legacyCount = overview?.legacyUnadoptedCount ?? 0;
  const vatMonth = overview?.vatPayableMonth ?? 0;
  const fxMissing = overview?.fxMissing === true;
  const minBalance = settings.forecastMinBalance;

  // Gerçekleşen gün → o günün hareketleri; tahmin günü → o gün vadesi gelen açık kalemler (Cari).
  const points: ForecastChartPoint[] = forecast.map((p) => ({
    day: p.date,
    balance: p.balance,
    inflow: p.inflow,
    outflow: p.outflow,
    actual: p.isActual,
    href: p.isActual ? financeHref("hareketler", { from: p.date, to: p.date }) : financeHref("cari", { vade: p.date }),
  }));

  const upcoming: UpcomingRow[] = upcomingItems
    .filter((r) => r.amountOpen > 0)
    .map((r) => ({
      key: r.key,
      source: r.source,
      direction: r.direction,
      title: r.title,
      partyLabel: r.partyLabel || null,
      amount: r.amountOpen,
      currency: r.currency,
      dueDate: r.dueDate || null,
      href: r.href || financeHref("cari"),
    }));

  const hasAccounts = byCurrency.length > 0;
  const hasAnything = hasAccounts || receivable > 0 || payable > 0 || inTotal > 0 || outTotal > 0 || upcoming.length > 0 || legacyCount > 0;
  const canRentals = perms.rentals?.includes("edit") ?? false;

  if (!hasAnything) {
    return (
      <div className="grid gap-4">
        <SampleDataBadge label={sample.label} />
        <EmptyState
          illustration="komisyon"
          icon={Wallet}
          title="Muhasebeniz hazır"
          description="Ofis kasasını ya da banka hesabınızı açın, ilk gelir veya giderinizi girin. Nakit, alacak, borç ve 30 günlük nakit tahmini burada belirir."
          action={{ href: financeHref("kasa-banka"), label: "Hesap aç" }}
          secondary={props.canCreate ? { node: <NewEntryButton variant="outline">İlk kaydı ekle</NewEntryButton> } : undefined}
          tone="brand"
        />
      </div>
    );
  }

  const multiCurrency = byCurrency.length > 1 || (byCurrency.length === 1 && byCurrency[0]!.currency !== "TRY");
  const kpis: KpiItem[] = [
    {
      label: "Nakit",
      value: money(cashTotal),
      icon: <Landmark />,
      tone: "info",
      href: financeHref("kasa-banka"),
      hint: multiCurrency ? byCurrency.map((c) => formatAccountMoney(c.amount, c.currency)).join(" · ") : "kasa ve banka, ofis hesapları",
      title: multiCurrency ? "Döviz hesapları güncel TCMB satış kuruyla TL'ye çevrildi" : undefined,
    },
    {
      label: "Bu ay net",
      value: money(net),
      icon: net >= 0 ? <ArrowDownCircle /> : <TrendingDown />,
      tone: net >= 0 ? "success" : "danger",
      href: financeHref("hareketler", { from: monthFrom, to: today }),
      hint: `Giriş ${money(inTotal)} · Çıkış ${money(outTotal)}`,
    },
    {
      label: "Tahsil edilecek",
      value: money(receivable),
      icon: <ArrowDownCircle />,
      tone: "success",
      href: financeHref("cari", { yon: "alacak" }),
      hint: "açık alacak, kira ve komisyon",
    },
    {
      label: "Ödenecek",
      value: money(payable),
      icon: <ArrowUpCircle />,
      tone: "warning",
      href: financeHref("cari", { yon: "borc" }),
      hint: "açık borç ve düzenli ödemeler",
      attention: overdueCount > 0,
    },
  ];

  // Tahmin bölgesinde en düşük bakiye ve eşik uyarısı (eşik yoksa sıfırın altına düşme).
  const forecastOnly = points.filter((p) => !p.actual);
  const lowest = forecastOnly.reduce<ForecastChartPoint | null>((lo, p) => (!lo || p.balance < lo.balance ? p : lo), null);
  const threshold = minBalance ?? 0;
  const lowWarning = lowest && lowest.balance < threshold ? lowest : null;

  const alerts: { key: string; href: string; icon: typeof AlertTriangle; title: string; text: string; tone: "danger" | "warning" | "info" }[] = [];
  if (lowWarning) {
    alerts.push({
      key: "low",
      href: lowWarning.href,
      icon: AlertTriangle,
      tone: "danger",
      title: `Tahmine göre ${lowWarning.day.slice(8, 10)}.${lowWarning.day.slice(5, 7)} günü bakiye ${money(lowWarning.balance)}`,
      text: minBalance != null ? `Belirlediğiniz en düşük bakiye eşiğinin (${money(minBalance)}) altı. Vadesi gelen ödemeleri gözden geçirin.` : "Bakiye eksiye düşüyor. Vadesi gelen ödemeleri gözden geçirin.",
    });
  }
  if (overdueCount > 0) {
    alerts.push({ key: "overdue", href: financeHref("cari", { vade: "gecmis" }), icon: AlertTriangle, tone: "warning", title: `Vadesi geçen ${overdueCount} kalem`, text: "Tahsil edilmemiş alacaklar ve ödenmemiş borçlar." });
  }
  if (reviewCount > 0) {
    alerts.push({ key: "review", href: financeHref("kasa-banka", { incele: "1" }), icon: Inbox, tone: "info", title: `İncelenecek ${reviewCount} kayıt`, text: "Ekstre satırları, onay bekleyen düzenli ödemeler ve eşleşmemiş fişler." });
  }
  if (legacyCount > 0) {
    alerts.push({
      key: "legacy",
      href: financeHref("hareketler", { origin: "legacy_expense" }),
      icon: ArchiveRestore,
      tone: "info",
      title: `Hesaba bağlı olmayan ${legacyCount} eski gider`,
      text: "Bakiyeleri bozmamak için \"Hesapsız\" listelenir. İsterseniz tek tıkla bir hesaba taşıyın.",
    });
  }

  return (
    <div className="grid gap-4">
      {sample.label || fxMissing ? (
        <div className="flex flex-wrap items-center gap-2">
          <SampleDataBadge label={sample.label} />
          {fxMissing ? <span className="text-xs text-text-muted">Bazı döviz hesapları için güncel kur yok; o hesaplar TL toplamına katılmadı.</span> : null}
        </div>
      ) : null}

      <KpiStrip items={kpis} />

      {alerts.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Dikkat gerektirenler">
          {alerts.map((a) => (
            <li key={a.key}>
              <Link
                href={a.href}
                className={cn(
                  "focus-ring press lift flex min-h-11 items-start gap-3 rounded-[var(--radius-card)] border bg-surface p-3 transition hover:border-brand-300",
                  a.tone === "danger" ? "border-danger-300" : a.tone === "warning" ? "border-amber-400" : "border-line",
                )}
              >
                <span
                  className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)]",
                    a.tone === "danger" ? "bg-danger-soft text-danger-strong" : a.tone === "warning" ? "bg-warning-soft text-warning-strong" : "bg-surface-accent-soft text-accent-text",
                  )}
                >
                  <a.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-text">{a.title}</span>
                  <span className="block text-xs text-text-muted">{a.text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]" aria-labelledby="fin-forecast">
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="fin-forecast" className="flex items-center gap-1.5 font-display text-base font-bold text-text">
                <Scale className="h-4 w-4 text-accent-text" aria-hidden="true" /> Nakit akışı
              </h2>
              <p className="text-xs text-text-muted">Gün sonu bakiye (TL). Kesikli kısım tahmindir: açık kalemler, kira, komisyon ve düzenli ödemelerden hesaplanır.</p>
            </div>
            <div className="flex gap-1.5" role="group" aria-label="Tahmin süresi">
              <FilterChip href={financeHref("genel", { gun: null })} active={days === 30} scroll={false}>
                30 gün
              </FilterChip>
              <FilterChip href={financeHref("genel", { gun: 90 })} active={days === 90} scroll={false}>
                90 gün
              </FilterChip>
            </div>
          </header>
          {points.length >= 2 ? (
            <ForecastChart points={points} minBalance={minBalance} />
          ) : (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line px-3 py-10 text-center text-xs text-text-muted">
              Tahmin için en az bir hesap ve hareket gerekir.{" "}
              <Link href={financeHref("kasa-banka")} className="font-semibold text-accent-text hover:underline">
                Kasa ve banka
              </Link>
            </p>
          )}
        </section>

        <div className="grid content-start gap-4">
          <UpcomingList rows={upcoming} today={today} overdueHref={financeHref("cari", { vade: "gecmis" })} allHref={financeHref("cari", { yon: "tumu" })} />

          {vatMonth !== 0 ? (
            <Link
              href={financeHref("vergi")}
              className="focus-ring press lift flex items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 transition hover:border-brand-300"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-accent-soft text-accent-text">
                <Receipt className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-display text-sm font-bold text-text">
                  {vatMonth > 0 ? `Bu ay ödenecek KDV: ${money(vatMonth)}` : `Bu ay devreden KDV: ${money(Math.abs(vatMonth))}`}
                </span>
                <span className="block text-xs text-text-muted">Hesaplanan KDV ile indirilecek KDV farkı (KDV girilmiş kayıtlardan).</span>
              </span>
            </Link>
          ) : null}

          <Suspense fallback={null}>
            <PendingApprovalsCard supabase={supabase} />
          </Suspense>
          {tenantId && canRentals ? (
            <>
              <Suspense fallback={null}>
                <ManagementFeeCard supabase={supabase} tenantId={tenantId} today={today} />
              </Suspense>
              <Suspense fallback={null}>
                <OwnerPayoutsCard supabase={supabase} tenantId={tenantId} today={today} />
              </Suspense>
            </>
          ) : null}
          {!hasAccounts ? (
            <Link
              href={financeHref("kasa-banka")}
              className="focus-ring press lift flex items-center gap-3 rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface p-4 transition hover:border-brand-300"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-accent-soft text-accent-text">
                <Wallet className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-display text-sm font-bold text-text">İlk hesabınızı açın</span>
                <span className="block text-xs text-text-muted">Ofis kasası veya banka hesabı 10 saniyede açılır; nakit ve tahmin buradan hesaplanır.</span>
              </span>
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
