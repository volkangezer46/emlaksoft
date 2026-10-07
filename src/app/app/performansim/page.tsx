import { Suspense } from "react";
import Link from "@/components/ui/smart-link";
import { Target } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { now, trParts } from "@/lib/clock";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { AdvisorDetailView } from "@/app/app/ekip/[id]/advisor-view";
import { DashboardHero } from "@/components/ui/dashboard-hero";
import { DataFreshness } from "@/components/ui/data-freshness";
import { SkeletonCard } from "@/components/ui/viz";
import { CoachInsightSlot } from "@/app/app/danisman-kpi/coach-insight-slot";
import { greetingFor } from "@/app/app/_home/helpers";
import { PersonalGoal } from "./personal-goal";
import { Son30Gun } from "./son-30-gun";
import { Komisyonum } from "./komisyonum";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";

export const metadata = { title: "Performansım" };

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

/**
 * Performansım (tasarım sistemi v4): DashboardHero → kişisel hedef halkası + son 30 gün aktivite eğrisi → sıradaki en
 * iyi eylem (kişinin GERÇEK içgörüleri; yoksa çizilmez) → Danışman 360 gövdesi (`/app/ekip/[id]` ile ortak; aylık
 * KPI'lar "Özet" sekmesinde KpiTile ızgarası olarak). Paket kapısı yok; başkasının verisi sunucudan hiç çekilmez.
 */
export default async function PerformansimPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [auth, sp, user] = await Promise.all([requireModulePage("dashboard"), searchParams, getRequestUser()]);
  const nowMs = now();
  const p = trParts(nowMs);
  const firstName = ((user?.user_metadata?.full_name as string | undefined) ?? "").trim().split(/\s+/)[0] ?? "";
  const canTargets = effectiveCanAccessModule(auth.perms, "targets");
  return (
    <div className="space-y-5">
      <DashboardHero
        eyebrow={`${p.day} ${MONTHS[p.month]} ${WEEKDAYS[p.weekday]} · Performansım`.toLocaleUpperCase("tr-TR")}
        title={`${greetingFor(p.hour)}${firstName ? `, ${firstName}` : ""}`}
        summary={<p>Bu ayın karnesi, hedef ilerlemen ve verinden çıkan sıradaki en iyi eylem tek ekranda.</p>}
        freshness={<DataFreshness asOf={nowMs} />}
        aside={
          canTargets ? (
            <Link
              href="/app/hedefler"
              className="focus-ring press inline-flex h-9 touch:h-11 items-center gap-1.5 rounded-full border border-hairline bg-surface-raised px-4 text-sm font-semibold text-text shadow-[var(--elev-1)] transition hover:bg-surface-hover"
            >
              <Target className="h-4 w-4" aria-hidden="true" /> Hedefler
            </Link>
          ) : undefined
        }
      />
      {/* Hedef tanımlı değilse halka hiç çizilmez (kap `empty:hidden`), eğri tüm genişliği alır. */}
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 empty:hidden lg:w-5/12 lg:shrink-0">
          <Suspense fallback={<SkeletonCard height={168} label="Hedef yükleniyor" />}>
            <PersonalGoal userId={auth.userId} role={auth.role} tenantId={auth.tenantId} perms={auth.perms} />
          </Suspense>
        </div>
        <div className="min-w-0 flex-1">
          <Suspense fallback={<SkeletonCard height={260} label="Aktivite yükleniyor" />}>
            <Son30Gun userId={auth.userId} />
          </Suspense>
        </div>
      </div>
      {/* Komisyonum: yalnız kendi payı (kazanç gizliliği); Komisyon modülü yetkisi yoksa çizilmez. */}
      {effectiveCanAccessModule(auth.perms, "commissions") ? (
        <Suspense fallback={<SkeletonCard height={150} label="Komisyon yükleniyor" />}>
          <Komisyonum userId={auth.userId} tenantId={auth.tenantId} officeWide={hasOfficeWideDataScope(auth.role)} />
        </Suspense>
      ) : null}
      <Suspense fallback={null}>
        <CoachInsightSlot tenantId={auth.tenantId} userId={auth.userId} role={auth.role} perms={auth.perms} />
      </Suspense>
      <AdvisorDetailView memberId={auth.userId} basePath="/app/performansim" searchParams={sp ?? {}} auth={auth} headingAs="h2" />
    </div>
  );
}
