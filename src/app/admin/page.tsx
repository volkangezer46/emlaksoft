import { Suspense } from "react";
import Link from "@/components/ui/smart-link";
import { BarChart3 } from "lucide-react";
import { requirePlatformStaff } from "@/lib/platform";
import { now } from "@/lib/clock";
import { DataFreshness } from "@/components/ui/data-freshness";
import { PERIODS, parsePeriod, periodHref } from "@/components/ui/premium";
import { KpiGridSkeleton } from "@/components/ui/kpi-card";
import { DashboardHero } from "@/components/ui/dashboard-hero";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { FadeSwap } from "@/components/ui/motion/fade-swap";
import { SkeletonCard } from "@/components/ui/viz";
import { homeVariantFor } from "@/lib/admin/dashboard-layout";
import { platformCanAccess } from "@/lib/platform-access";
import { BillingHome } from "./_dashboards/billing-home";
import { SupportHome } from "./_dashboards/support-home";
import { adminEyebrow, adminGreeting, firstNameOf } from "./_dashboards/shared";
import { AttentionSection, HeroSummary, KpiStrip } from "./_dashboards/platform-sections";

export const metadata = { title: "Kontrol paneli" };

/**
 * Kontrol paneli: YALNIZ dikkat kuyruğu (rol filtreli iş listesi + platform içgörüleri) ve 4 özet gösterge. Analiz
 * bölümleri (MRR, churn, aktivasyon, birim ekonomisi, tüketim, iptal nedenleri, büyüme, gelir kompozisyonu) Raporlar
 * sekmesindedir; sistem sağlığı üst çubuktaki çipte ve Sistem durumu'nda, aktivite Aktivite'de, coğrafya Coğrafya'da.
 * Departman rolleri (muhasebe, destek) aynı adreste kendi panelini görür.
 */
export default async function AdminHomePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePlatformStaff();

  const variant = homeVariantFor(staff);
  if (variant === "billing") return <BillingHome staffName={staff.full_name} />;
  if (variant === "support") return <SupportHome staffName={staff.full_name} />;

  const sp = (await searchParams) ?? {};
  const period = parsePeriod(sp.donem);
  const params: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) params[k] = Array.isArray(v) ? v[0] : v;
  const nowMs = now();
  const firstName = firstNameOf(staff.full_name);
  const canReports = platformCanAccess(staff, "reports");

  return (
    <div className="space-y-5">
      <DashboardHero
        eyebrow={adminEyebrow(nowMs)}
        title={`${adminGreeting(nowMs)}${firstName ? `, ${firstName}` : ""}`}
        summary={
          <Suspense fallback={<p>Platform özeti hazırlanıyor…</p>}>
            <HeroSummary period={period} role={staff} />
          </Suspense>
        }
        freshness={<DataFreshness asOf={nowMs} />}
        aside={
          <SegmentedControl
            label="Özet dönemi"
            value={String(period)}
            options={PERIODS.map((p) => ({ value: String(p), label: `${p} gün`, href: periodHref("/admin", params, p) }))}
          />
        }
      />

      <Suspense fallback={<KpiGridSkeleton count={4} label="Özet göstergeler yükleniyor" />}>
        <FadeSwap swapKey={period}>
          <KpiStrip period={period} />
        </FadeSwap>
      </Suspense>
      {canReports ? (
        <p className="text-sm text-text-muted">
          <Link href={`/admin/raporlar?donem=${period}#analiz`} className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline">
            <BarChart3 className="h-4 w-4" aria-hidden /> Gelir, churn, aktivasyon ve tüketim analizi: Raporlar →
          </Link>
        </p>
      ) : null}

      <Suspense fallback={<SkeletonCard height={360} label="Dikkat kuyruğu yükleniyor" />}>
        <AttentionSection period={period} role={staff} />
      </Suspense>
    </div>
  );
}
