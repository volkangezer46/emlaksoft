import { Suspense } from "react";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { requireModulePage } from "@/lib/require-module-page";
import { SkeletonCard } from "@/components/app/skeleton";
import { ProductTour } from "./product-tour";
import { DashboardWidgetProvider } from "./dashboard-widgets";
import { buildHomeBounds, type HomeCtx } from "./_home/data";
import { BlokIskelet, PanelIskelet } from "./_home/ortak";
import { TvUst, OrnekVeri, YetkiUyari } from "./_home/ust-bolum";
import { AnaHero } from "./_home/hero";
import { parsePeriod } from "@/components/ui/premium";
import { BosOfisKapisi, KurulumSeridi } from "./_home/baslayalim";
import { DuyuruSatiri } from "./_home/duyuru-satiri";
import { BugunOzet } from "./_home/bugun-ozet";
import { Gorevler } from "./_home/gorevler";
import { Randevular } from "./_home/randevular";
import { KayipKacak } from "./_home/kayip-kacak";
import { KpiSatiri } from "./_home/kpi-satiri";
import { HedefKarti } from "./_home/hedef-karti";
import { KiralamaProje } from "./_home/kiralama-proje";
import { KomisyonAkisi } from "./_home/komisyon-akisi";
import { DonemTrend } from "./_home/donem-trend";
import { Huni } from "./_home/huni";
import { PortalSagligi, Ekip } from "./_home/portal-ekip";
import { CanliAkis } from "./_home/canli-akis";
import { HizliAksiyonlar } from "./_home/musteriler-hizli";
import { PortfoySeridi } from "./_home/portfoy-seridi";
import { KaynakDagilimi } from "./_home/kaynak-dagilimi";

/**
 * "Bugün" ana ekranı. Sayfa yalnız iskelet + yetki + bağlamı kurar; her bölüm
 * `_home/*` içinde kendi verisini yükler ve <Suspense> ile akar: önce "bugünün
 * işleri" (görev/randevu/sıcak müşteri), ağır grafikler ve listeler sonra gelir.
 * Aynı istekteki ortak sorgular `_home/data.ts` içinde `cache()` ile tekilleşir.
 */
export default async function AppHomePage({
  searchParams,
}: {
  searchParams?: Promise<{ tv?: string; donem?: string }>;
}) {
  const { tv = "", donem } = (await searchParams) ?? {};
  const tvMode = tv === "1";

  const { tenantId, perms } = await requireModulePage("dashboard");
  const user = await getRequestUser();
  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? "";

  const ctx: HomeCtx = {
    tenantId,
    tvMode,
    // Kiralama/proje şeridi yalnız modülü görebilene sorulur.
    canSeeRentals: (perms.rentals ?? []).includes("view"),
    canSeeProjects: (perms.projects ?? []).includes("view"),
    canSeeProperties: (perms.properties ?? []).includes("view"),
    period: parsePeriod(donem),
    fullName,
    firstName: fullName.split(" ")[0] || "hoş geldiniz",
    ...buildHomeBounds(),
  };

  return (
    <DashboardWidgetProvider>
      <div className={tvMode ? "tv-zoom space-y-6" : "space-y-6"}>
        {/* İlk giriş ürün turu — TV modunda hiç mount edilmez (bileşen içinde de kontrol var) */}
        {!tvMode && <ProductTour />}

        {tvMode ? (
          <Suspense fallback={<BlokIskelet className="h-16" />}>
            <TvUst ctx={ctx} />
          </Suspense>
        ) : (
          <>
            <AnaHero ctx={ctx} hasName={Boolean(fullName)} params={{}} />
            <Suspense fallback={null}>
              <OrnekVeri ctx={ctx} />
            </Suspense>
          </>
        )}

        <Suspense fallback={null}>
          <YetkiUyari />
        </Suspense>

        {/* Duyurular tek satır — okunmamış yoksa görünmez */}
        {!tvMode && (
          <Suspense fallback={null}>
            <DuyuruSatiri />
          </Suspense>
        )}

        {/* Kurulum tamamlanana kadar ilerleme şeridi (TV modunda yok) */}
        <Suspense fallback={null}>
          <KurulumSeridi ctx={ctx} />
        </Suspense>

        {/* Müşteri + portföy yokken tüm dolu bloklar yerine tek "Başlayalım" kartı */}
        <Suspense fallback={<PanelIskelet rows={2} />}>
          <BosOfisKapisi ctx={ctx}>
        {/* BENTO (xl 12 sütun / md 6 / mobil 1). Sıra önem sırasıdır: bugün kuyruğu → para →
            KPI → trend/hedef → çalışma blokları → hat/akış → ekip/müşteri. */}
        <div className="pm-bento">
          {/* Ürün turu hedefi: bugünün işleri */}
          <div data-tour="brifing" className="md:col-span-6 xl:col-span-5">
            <Suspense fallback={<BlokIskelet className="h-[24rem]" />}>
              <BugunOzet ctx={ctx} />
            </Suspense>
          </div>
          <div className="md:col-span-6 xl:col-span-7">
            <Suspense fallback={<BlokIskelet className="h-[24rem]" />}>
              <KomisyonAkisi ctx={ctx} />
            </Suspense>
          </div>

          <div data-tour="kpi" className="md:col-span-6 xl:col-span-12">
            <Suspense
              fallback={
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <SkeletonCard key={i} />
                  ))}
                </div>
              }
            >
              <KpiSatiri ctx={ctx} />
            </Suspense>
          </div>

          <div className="md:col-span-6 xl:col-span-8">
            <Suspense fallback={<BlokIskelet className="h-[21rem]" />}>
              <DonemTrend ctx={ctx} />
            </Suspense>
          </div>
          <div className="md:col-span-6 xl:col-span-4">
            <Suspense fallback={<BlokIskelet className="h-[21rem]" />}>
              <HedefKarti ctx={ctx} />
            </Suspense>
          </div>

          {/* Çalışma verisi: randevu + görev + kayıp-kaçak */}
          <>
            <div data-tour="aksiyonlar" className="md:col-span-3 xl:col-span-4">
              <Suspense fallback={<PanelIskelet />}>
                <Randevular ctx={ctx} />
              </Suspense>
            </div>
            <div className="md:col-span-3 xl:col-span-4">
              <Suspense fallback={<PanelIskelet />}>
                <Gorevler ctx={ctx} />
              </Suspense>
            </div>
            <div className="md:col-span-6 xl:col-span-4">
              <Suspense fallback={<PanelIskelet />}>
                <KayipKacak ctx={ctx} />
              </Suspense>
            </div>
          </>

          <div className="md:col-span-6 xl:col-span-12 empty:hidden">
            <Suspense fallback={null}>
              <PortfoySeridi ctx={ctx} />
            </Suspense>
          </div>

          <div className="md:col-span-6 xl:col-span-12 empty:hidden">
            <Suspense fallback={null}>
              <KiralamaProje ctx={ctx} />
            </Suspense>
          </div>

          <div className="md:col-span-6 xl:col-span-5">
            <Suspense fallback={<BlokIskelet className="h-80" />}>
              <Huni />
            </Suspense>
          </div>
          <div className="md:col-span-6 xl:col-span-7">
            <Suspense fallback={<BlokIskelet className="h-80" />}>
              <CanliAkis ctx={ctx} />
            </Suspense>
          </div>

          <div className="md:col-span-3 xl:col-span-4">
            <Suspense fallback={<PanelIskelet />}>
              <PortalSagligi />
            </Suspense>
          </div>
          <div className="md:col-span-3 xl:col-span-4">
            <Suspense fallback={<PanelIskelet />}>
              <Ekip ctx={ctx} />
            </Suspense>
          </div>
          <div className="md:col-span-6 xl:col-span-4">
            <Suspense fallback={<PanelIskelet />}>
              <KaynakDagilimi />
            </Suspense>
          </div>
          {!tvMode && (
            <div className="md:col-span-6 xl:col-span-12">
              <HizliAksiyonlar />
            </div>
          )}
        </div>
          </BosOfisKapisi>
        </Suspense>
      </div>
    </DashboardWidgetProvider>
  );
}
