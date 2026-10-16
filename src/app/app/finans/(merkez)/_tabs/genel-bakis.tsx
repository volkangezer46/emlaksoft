import { Suspense } from "react";
import dynamic from "next/dynamic";
import Link from "@/components/ui/smart-link";
import { AlertTriangle, ArchiveRestore, ArrowDownCircle, ArrowUpCircle, Inbox, Landmark, Plus, Receipt, Scale, TrendingDown, Wallet } from "lucide-react";
import { KpiStrip, type KpiItem } from "@/components/ui/list-kit";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { SampleDataBadge } from "@/components/ui/sample-data-badge";
import { SkeletonCard } from "@/components/ui/viz";
import { createClient } from "@/lib/supabase/server";
import { now as nowMs, trDayKey } from "@/lib/clock";
import { loadSampleKpiScope } from "@/lib/sample-scope";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { loadForecast, loadOverview, loadSettings } from "@/lib/finance/ledger/load";
import { breachHeadline, forecastInsights, weeklyForecast } from "@/lib/finance/forecast";
import type { FinanceTabProps } from "@/lib/finance/ledger/types";
import { cn } from "@/lib/utils";
import { UpcomingList } from "../_components/upcoming-list";
import { loadUpcomingWindow } from "../_components/upcoming-load";
import type { ForecastChartPoint } from "../_components/forecast-chart";
import { ButtonLink } from "@/components/ui/button";
import { entryHref } from "@/lib/finance/entry-workspace";
import { financeHref } from "@/lib/finance/routes";
import { overviewLinks } from "./finance-shell";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { getUiPrefs } from "@/lib/ui-prefs-server";
import { isHiddenParty, loadHiddenPartyIds } from "../cari/party-list";
import { loadPartyTotals } from "../cari/party-totals";
import { PendingApprovalsCard } from "./pending-card";
import { ManagementFeeCard, OwnerPayoutsCard } from "./management-fee-card";
import { AttentionCard } from "./genel-bakis-dikkat";
import { MonthCloseCard } from "./genel-bakis-kapanis";
import { WeeklyForecast } from "./genel-bakis-haftalik";

/**
 * Genel bakış (Muhasebe varsayılan sekmesi). Dört KPI (TL'ye çevrilmiş nakit, bu ay net, tahsil edilecek, ödenecek),
 * 30/90 gün nakit akışı (gerçekleşen düz, tahmin kesikli ve etiketli) ya da 13 haftalık görünüm (`?gun=91`), bakiyenin
 * eşiğin/sıfırın altına İLK ineceği gün uyarısı (`forecastInsights`), 7 günlük yaklaşanlar, vadesi geçenler, incelenecekler,
 * KDV, eski giderleri taşıma uyarısı, "Dikkat edilmesi gerekenler" (anomali motoru), ay sonu kapanış listesi ve mevcut onay /
 * yönetim ücreti kartları. Zeka kartları kendi Suspense sınırında akar (ana pano onları beklemez). Her sayı filtreli hedefe gider.
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
  const weekly = params.gun === "91";
  const days = weekly ? 91 : params.gun === "90" ? 90 : 30;
  const supabase = await createClient();

  const links = overviewLinks();
  const earningsAll = canSeeAllEarnings(perms);
  const [overview, forecast, upcoming, settings, sample, partyTotals, { simple }] = await Promise.all([
    loadOverview(monthFrom, today),
    loadForecast(days),
    loadUpcomingWindow(today, 7, links.openItems),
    loadSettings(),
    loadSampleKpiScope(supabase, tenantId),
    loadHiddenPartyIds(supabase, { userId: props.userId, earningsAll }).then((hidden) =>
      loadPartyTotals(supabase, (id, kind) => isHiddenParty(hidden, id, kind)),
    ),
    getUiPrefs(),
  ]);

  // Özet okunamadıysa (hata ya da veritabanı güncellemesi bekliyor) "hiç veri yok" gibi görünmesin: ayrı durum.
  if (!overview) {
    return (
      <div className="grid gap-4">
        <EmptyState
          illustration="error"
          icon={AlertTriangle}
          title="Muhasebe özeti şu an okunamadı"
          description="Kayıtlarınız yerinde; özet hesaplanırken bir sorun oldu. Biraz sonra yeniden deneyin ya da hareketleri doğrudan açın."
          action={{ href: financeHref("genel", { gun: days === 30 ? null : days }), label: "Yeniden dene" }}
          secondary={{ href: financeHref("hareketler"), label: "Hareketlere git" }}
          tone="amber"
        />
      </div>
    );
  }

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
    href: p.isActual ? financeHref("hareketler", { from: p.date, to: p.date }) : links.forecastDay,
  }));

  const hasAccounts = byCurrency.length > 0;
  const hasAnything = hasAccounts || receivable > 0 || payable > 0 || overdueCount > 0 || inTotal > 0 || outTotal > 0 || upcoming.length > 0 || legacyCount > 0;
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
          secondary={props.canCreate ? { node: <ButtonLink href={entryHref()} variant="outline" icon={Plus}>İlk kaydı ekle</ButtonLink> } : undefined}
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
    // C24: alacak/borç TEK tanım — Alacak ve borç sayfasındaki kartlarla aynı toplam (party-totals.ts) ve aynı hedef.
    // Cari bakiyeleri okunamazsa özet RPC'sinin açık kalem toplamına düşülür (etiket kapsamı söyler).
    partyTotals
      ? { label: "Alacağımız", value: money(partyTotals.receivable), icon: <ArrowDownCircle />, tone: "success", href: links.partyReceivable, hint: "bize borcu olan kişi ve firmalar" }
      : { label: "Açık alacak", value: money(receivable), icon: <ArrowDownCircle />, tone: "success", href: links.receivable, hint: "açık alacak kalemleri" },
    partyTotals
      ? { label: "Borcumuz", value: money(partyTotals.payable), icon: <ArrowUpCircle />, tone: "warning", href: links.partyPayable, hint: "borçlu olduğumuz kişi ve firmalar", attention: overdueCount > 0 }
      : { label: "Açık borç", value: money(payable), icon: <ArrowUpCircle />, tone: "warning", href: links.payable, hint: "açık borç kalemleri", attention: overdueCount > 0 },
  ];

  // Tahmin özeti: eşiğin (yoksa sıfırın) altına İLK inilen gün ve en düşük nokta; 13 hafta görünümünde haftalık kovalar.
  const insight = forecastInsights(forecast, minBalance);
  const weeks = weekly ? weeklyForecast(forecast, { weeks: 13, threshold: minBalance ?? 0 }) : [];

  const alerts: { key: string; href: string; icon: typeof AlertTriangle; title: string; text: string; tone: "danger" | "warning" | "info" }[] = [];
  const headline = insight ? breachHeadline(insight, minBalance != null) : null;
  if (insight?.firstBreach && headline) {
    const low = insight.lowest;
    const lowText = low && low.date !== insight.firstBreach.date ? ` En düşük nokta ${low.date.slice(8, 10)}.${low.date.slice(5, 7)}: ${money(low.balance)}.` : "";
    alerts.push({
      key: "low",
      href: links.forecastDay,
      icon: AlertTriangle,
      tone: "danger",
      title: headline,
      text: `Tahmini bakiye ${money(insight.firstBreach.balance)}${minBalance != null ? ` (eşik ${money(minBalance)})` : ""}.${lowText} Vadesi gelen ödemeleri ve tahsilatları gözden geçirin.`,
    });
  }
  if (overdueCount > 0) {
    alerts.push({ key: "overdue", href: links.overdue, icon: AlertTriangle, tone: "warning", title: `Vadesi geçen ${overdueCount} kalem`, text: "Tahsil edilmemiş alacaklar ve ödenmemiş borçlar." });
  }
  if (reviewCount > 0) {
    alerts.push({ key: "review", href: links.review, icon: Inbox, tone: "info", title: `İncelenecek ${reviewCount} kayıt`, text: "Ekstre satırları, onay bekleyen düzenli ödemeler ve eşleşmemiş fişler." });
  }
  if (legacyCount > 0) {
    alerts.push({
      key: "legacy",
      href: links.legacy,
      icon: ArchiveRestore,
      tone: "info",
      title: `Hesaba bağlı olmayan ${legacyCount} eski gider`,
      text: "Bakiyeleri bozmamak için \"Hesapsız\" listelenir. İsterseniz tek tıkla bir hesaba taşıyın.",
    });
  }

  // Sade görünümde ekranda en çok 2 uyarı, kalanı "Tüm uyarılar (n)" altında (plan 2.5).
  const shownAlerts = simple ? alerts.slice(0, 3) : alerts;
  const moreAlerts = simple ? alerts.slice(3) : [];
  const renderAlert = (a: (typeof alerts)[number]) => (
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
  );

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
          {shownAlerts.map(renderAlert)}
        </ul>
      ) : null}
      {moreAlerts.length > 0 ? (
        <details className="group">
          <summary className="focus-ring inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-semibold text-brand-600 select-none [&::-webkit-details-marker]:hidden">
            Tüm uyarılar ({alerts.length})
          </summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">{moreAlerts.map(renderAlert)}</ul>
        </details>
      ) : null}

      <Suspense fallback={null}>
        <AttentionCard today={today} canSalary={props.canSalary} simple={simple} />
      </Suspense>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        {/* Sol sütun: nakit akışı + küçük bilgi kartları (KDV, onay, yönetim ücreti, mülk sahibi ödemesi) — iki sütunun boyu
            dengelenir; sağda yalnız yaklaşanlar ve ay sonu kapanışı kalır (uzun sağ sütun altında boş alan bırakılmaz). */}
        <div className="grid content-start gap-4">
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]" aria-labelledby="fin-forecast">
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="fin-forecast" className="flex items-center gap-1.5 font-display text-base font-bold text-text">
                <Scale className="h-4 w-4 text-accent-text" aria-hidden="true" /> Nakit akışı
              </h2>
              <p className="text-xs text-text-muted">
                {weekly
                  ? "Önümüzdeki 13 hafta: vadesi gelen alacak ve borçlar, kira, tahsil edilmemiş komisyon ve düzenli ödemeler (TL)."
                  : "Gün sonu bakiye (TL). Kesikli kısım tahmindir: açık kalemler, kira, komisyon ve düzenli ödemelerden hesaplanır."}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tahmin süresi">
              <FilterChip href={financeHref("genel", { gun: null })} active={days === 30} scroll={false}>
                30 gün
              </FilterChip>
              <FilterChip href={financeHref("genel", { gun: 90 })} active={days === 90} scroll={false}>
                90 gün
              </FilterChip>
              <FilterChip href={financeHref("genel", { gun: 91 })} active={weekly} scroll={false}>
                13 hafta
              </FilterChip>
            </div>
          </header>
          {insight ? (
            <dl className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {[
                { k: "Bugünkü nakit", v: insight.startBalance },
                { k: "Beklenen giriş", v: insight.totalIn },
                { k: "Beklenen çıkış", v: insight.totalOut },
                { k: `${days} gün sonra`, v: insight.endBalance, bad: insight.endBalance < (minBalance ?? 0) },
              ].map((x) => (
                <div key={x.k} className="rounded-[var(--radius-control)] bg-surface-sunken px-2.5 py-1.5">
                  <dt className="text-text-muted">{x.k}</dt>
                  <dd className={cn("numeric font-display text-sm font-bold", x.bad ? "text-danger-strong" : "text-text")}>
                    <Link href={links.forecastDay} className="hover:underline">
                      {money(x.v)}
                    </Link>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {weekly && weeks.length > 0 ? (
            <WeeklyForecast weeks={weeks} href={links.forecastDay} />
          ) : points.length >= 2 ? (
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
        <div className="grid content-start gap-4 sm:grid-cols-2 [&>*:last-child:nth-child(odd)]:sm:col-span-2">
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

        <div className="grid content-start gap-4">
          <UpcomingList rows={upcoming} today={today} overdueCount={overdueCount} overdueHref={links.overdue} allHref={links.openItems} />

          {props.canEdit ? (
            <Suspense fallback={<SkeletonCard height={260} label="Ay sonu kapanışı yükleniyor" />}>
              <MonthCloseCard today={today} canSalary={props.canSalary} reviewCount={reviewCount} />
            </Suspense>
          ) : null}

        </div>
      </div>
    </div>
  );
}
