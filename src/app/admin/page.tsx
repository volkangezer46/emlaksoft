import { Suspense } from "react";
import Link from "@/components/ui/smart-link";
import { BarChart3, ShieldOff } from "lucide-react";
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
import { platformCanAccess, platformRoleLabel, type PlatformModule } from "@/lib/platform-access";
import { EmptyState } from "@/components/ui/empty-state";
import { PLATFORM_MODULE_LABELS } from "./personel/staff-model";
import { BillingHome } from "./_dashboards/billing-home";
import { SupportHome } from "./_dashboards/support-home";
import { adminEyebrow, adminGreeting, greetingNameOf } from "./_dashboards/shared";
import { AttentionSection, HeroSummary, KpiStrip, MrrSection } from "./_dashboards/platform-sections";

export const metadata = { title: "Kontrol paneli" };

/**
 * Kontrol paneli (referans tasarım): özet göstergeler, dikkat kuyruğu (rol filtreli iş listesi + platform içgörüleri) ve
 * yanında aylık yinelenen gelir kartı (yalnız gelir yetkisi olana). Diğer analiz bölümleri (churn, aktivasyon, birim
 * ekonomisi, tüketim, iptal nedenleri, büyüme, gelir kompozisyonu) Raporlar sekmesindedir; sistem sağlığı üst çubuktaki çipte ve Sistem durumu'nda, aktivite Aktivite'de, coğrafya Coğrafya'da.
 * Departman rolleri (muhasebe, destek) aynı adreste kendi panelini görür.
 */
export default async function AdminHomePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const [staff, sp] = await Promise.all([
    requirePlatformStaff(),
    (searchParams ?? Promise.resolve(undefined)).then((v): Record<string, string | string[] | undefined> => v ?? {}),
  ]);

  // SK1/B122 + B041: yetkisiz sayfadan gelindi (proxy 307 ya da requirePlatformModule): ağır pano ÇİZİLMEZ; hangi sayfanın
  // kapalı olduğunu ve yetkinin kimden isteneceğini anlatan hafif kart (pano sorguları hiç çalışmaz).
  if (first(sp.yetki) === "yok") return <AccessDeniedCard module={first(sp.sayfa)} roleLabel={platformRoleLabel(staff)} />;

  const variant = homeVariantFor(staff);
  if (variant === "billing") return <BillingHome staffName={staff.full_name} />;
  if (variant === "support") return <SupportHome staffName={staff.full_name} />;

  const period = parsePeriod(sp.donem);
  const params: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) params[k] = Array.isArray(v) ? v[0] : v;
  const nowMs = now();
  const firstName = greetingNameOf(staff.full_name);
  const canReports = platformCanAccess(staff, "reports");
  const canBilling = platformCanAccess(staff, "billing");

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

      <Suspense fallback={<KpiGridSkeleton count={6} label="Özet göstergeler yükleniyor" />}>
        <FadeSwap swapKey={period}>
          <KpiStrip period={period} role={staff} />
        </FadeSwap>
      </Suspense>
      <div className={canBilling ? "grid gap-5 xl:grid-cols-12 xl:items-stretch" : undefined}>
        <div className={canBilling ? "min-w-0 xl:col-span-7" : undefined}>
          <Suspense fallback={<SkeletonCard height={360} label="Dikkat kuyruğu yükleniyor" />}>
            <AttentionSection period={period} role={staff} />
          </Suspense>
        </div>
        {canBilling ? (
          <div className="min-w-0 xl:col-span-5">
            <Suspense fallback={<SkeletonCard height={360} label="Gelir eğrisi yükleniyor" />}>
              <MrrSection period={period} />
            </Suspense>
          </div>
        ) : null}
      </div>

      {canReports ? (
        <p className="text-sm text-text-muted">
          <Link href={`/admin/raporlar?donem=${period}#analiz`} className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-sm font-semibold text-brand-600 hover:underline">
            <BarChart3 className="h-4 w-4" aria-hidden /> Churn, aktivasyon, büyüme ve tüketim analizi: Raporlar →
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Kapalı sayfanın adı (bilinmeyen modül adı gösterilmez); "(ops: salt okunur)" gibi rol notları atılır. */
function deniedPageLabel(module: string | undefined): string | null {
  if (!module || !Object.prototype.hasOwnProperty.call(PLATFORM_MODULE_LABELS, module)) return null;
  return PLATFORM_MODULE_LABELS[module as PlatformModule].replace(/\s*\(.*\)\s*$/, "");
}

function AccessDeniedCard({ module, roleLabel }: { module: string | undefined; roleLabel: string }) {
  const label = deniedPageLabel(module);
  return (
    <EmptyState
      icon={ShieldOff}
      tone="amber"
      title={label ? `${label} sayfası rolünüz için kapalı` : "Bu sayfa rolünüz için kapalı"}
      description={`Rolünüz (${roleLabel}) bu sayfayı açma yetkisi taşımıyor. Erişim gerekiyorsa süper admin'den isteyin: rolünüze bu sayfa Personel yönetimi › Roller ekranından eklenir.`}
      action={{ href: "/admin", label: "Kontrol paneline dön" }}
    />
  );
}
