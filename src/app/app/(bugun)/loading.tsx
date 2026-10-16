import { Skeleton } from "@/components/ui/skeleton";
import { DashboardGrid, DashCell, DashboardStack } from "@/components/ui/dashboard-grid";
import { CardSkeleton, KpiRowSkeleton } from "../_home/kurumsal/blocks";
import "../_home/kurumsal/home.css";

/**
 * Ana ekran yüklenirken gösterilen iskelet: gerçek v4 ana ekranla AYNI şekil ve ölçüler (kahraman bandı → KPI satırı →
 * 7/5 ızgarada Dikkat | Kurulum). Rol henüz bilinmediği için yönetim düzeni çizilir; sayfanın kendi kapı sınırı rolün gerçek
 * ızgarasını çizer (page.tsx `skeletonRows`). Rota grubu `(bugun)` içindedir (B023): yalnız ana ekranı sarar.
 */
export default function BugunLoading() {
  return (
    <DashboardStack role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Ana ekran yükleniyor</span>
      <section className="ds-hero kh-hero kh-skel" aria-hidden="true">
        <div className="kh-hero-art">
          <span className="skeleton absolute inset-0 block" />
        </div>
        <div className="kh-hero-body flex flex-col gap-3">
          <Skeleton className="h-10 w-72 max-w-full rounded-xl" />
          <Skeleton className="h-10 w-96 max-w-full" />
          <Skeleton className="h-4 w-full max-w-md" />
          <Skeleton className="h-14 w-full max-w-[44rem] rounded-2xl" />
          <Skeleton className="h-12 w-full max-w-lg rounded-xl" />
        </div>
      </section>
      <div className="flex min-w-0 flex-col gap-4" aria-hidden="true">
        <KpiRowSkeleton />
        <DashboardGrid stagger={false}>
          <DashCell span={{ md: 6, xl: 7 }}>
            <CardSkeleton className="kh-attn-skel" rows={5} />
          </DashCell>
          <DashCell span={{ md: 6, xl: 5 }}>
            <CardSkeleton className="kh-setup-skel" rows={3} />
          </DashCell>
        </DashboardGrid>
      </div>
    </DashboardStack>
  );
}
