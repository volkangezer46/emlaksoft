import { Skeleton } from "@/components/ui/skeleton";
import { DashboardGrid, DashCell, DashboardStack } from "@/components/ui/dashboard-grid";
import { BugunKisayolIskelet } from "../_home/bugun-kisayol";
import { DikkatIskelet } from "../_home/dikkat";

/**
 * "Bugün" ana ekranı yüklenirken gösterilen iskelet: gerçek ana ekranla AYNI kabuk ve ölçüler (hero bandı → "Ne yapmak
 * istiyorsun?" kutusu + çipler → "Bugün" başlığı + 7/5 ızgarada ilk ekran blokları → özet düğmesi). Sayfanın kendi kapı
 * sınırı da aynı ızgarayı çizer (page.tsx `skeletonRows`); iskelet → içerik düzen sıçraması yok.
 * Rota grubu `(bugun)` içindedir (B023): yalnız ana ekranı sarar. Eskiden /app/loading.tsx idi ve /app altındaki TÜM
 * rotaları sardığı için önyüklenmemiş kardeş sayfaya geçerken önce "Ana ekran yükleniyor" iskeleti görünüyordu.
 */
export default function BugunLoading() {
  return (
    <DashboardStack role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Ana ekran yükleniyor</span>
      <div className="flex flex-col gap-3">
        <section className="ds-hero" aria-hidden="true">
          <div className="ds-hero-row">
            <div className="ds-hero-body flex flex-col gap-2">
              <Skeleton className="h-3 w-44" />
              <Skeleton className="h-8 w-64 max-w-full" />
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="mt-2 h-3 w-36" />
            </div>
            <Skeleton className="hidden h-24 w-72 shrink-0 sm:block" />
          </div>
        </section>
        <section className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-14 w-full rounded-full" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-20 rounded-full" />
            <Skeleton className="h-9 w-28 rounded-full" />
            <Skeleton className="h-9 w-24 rounded-full" />
            <Skeleton className="h-9 w-20 rounded-full" />
          </div>
        </section>
      </div>
      <div className="flex min-w-0 flex-col gap-5" aria-hidden="true">
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-bold text-text">Bugün</h2>
          <DashboardGrid stagger={false}>
            <DashCell span={{ md: 6, xl: 7 }}>
              <DikkatIskelet />
            </DashCell>
            <DashCell span={{ md: 6, xl: 5 }}>
              <BugunKisayolIskelet />
            </DashCell>
          </DashboardGrid>
        </section>
        <Skeleton className="h-11 w-72 max-w-full rounded-full" />
      </div>
    </DashboardStack>
  );
}
