import { Skeleton } from "@/components/ui/skeleton";
import { DashboardStack } from "@/components/ui/dashboard-grid";
import { PanelIskelet } from "./_home/ortak";

/**
 * /app (Bugün) yüklenirken gösterilen iskelet: gerçek ana ekranla AYNI kabuk ve ölçüler (hero bandı → "Ne yapmak
 * istiyorsun?" kutusu + çipler → tek panel). Eskiden burada genel "kontrol paneli" iskeleti (6 kartlık ızgara) vardı;
 * sayfa gelince bambaşka bir düzene dönüşüyordu → kullanıcı "ana sayfa 2 kez yükleniyor" görüyordu (iskelet → gerçek
 * düzen → blok iskeletleri → içerik). Şimdi gerçek hero, iskeletin yerine oturur; sıçrama ve yeniden çizim yok.
 * Not: /app altındaki her sayfanın kendi loading.tsx'i vardır; bu dosya yalnız ana ekran içindir.
 */
export default function AppLoading() {
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
      <PanelIskelet rows={2} className="min-h-[24rem]" />
    </DashboardStack>
  );
}
