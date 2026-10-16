import { Skeleton } from "@/components/ui/skeleton";
import { DashboardGrid, DashCell, DashboardStack } from "@/components/ui/dashboard-grid";
import { BugunumIskelet } from "../_home/bugunum";

/**
 * "Bugün" ana ekranı yüklenirken gösterilen iskelet: gerçek ana ekranla AYNI kabuk ve ölçüler (hero bandı → 7/5 ızgarada
 * ilk ekran blokları: "Bugünüm" / "Senden bekleyenler" | kısayollar / "Para" → özet düğmesi). Rol henüz bilinmediği için
 * iki sütun da liste iskeletidir. Sayfanın kendi kapı sınırı rolün gerçek ızgarasını çizer (page.tsx `skeletonRows`).
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
            </div>
            <Skeleton className="hidden h-24 w-72 shrink-0 sm:block" />
          </div>
        </section>
      </div>
      <div className="flex min-w-0 flex-col gap-5" aria-hidden="true">
        <section className="flex flex-col gap-3">
          <DashboardGrid stagger={false}>
            <DashCell span={{ md: 6, xl: 7 }}>
              <BugunumIskelet />
            </DashCell>
            <DashCell span={{ md: 6, xl: 5 }}>
              <Skeleton className="h-40 w-full" />
            </DashCell>
          </DashboardGrid>
        </section>
        <Skeleton className="h-11 w-72 max-w-full rounded-full" />
      </div>
    </DashboardStack>
  );
}
