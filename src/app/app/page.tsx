import { Suspense } from "react";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { requireModulePage } from "@/lib/require-module-page";
import { SkeletonCard } from "@/components/app/skeleton";
import { ProductTour } from "./product-tour";
import { DashboardWidgetProvider } from "./dashboard-widgets";
import { buildHomeBounds, type HomeCtx } from "./_home/data";
import { BlokIskelet, PanelIskelet } from "./_home/ortak";
import { SayfaBasligi, TvUst, OrnekVeri, YetkiUyari } from "./_home/ust-bolum";
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
import { Huni } from "./_home/huni";
import { PortalSagligi, Ekip } from "./_home/portal-ekip";
import { CanliAkis } from "./_home/canli-akis";
import { HizliAksiyonlar, SonMusteriler } from "./_home/musteriler-hizli";

/**
 * "Bugün" ana ekranı. Sayfa yalnız iskelet + yetki + bağlamı kurar; her bölüm
 * `_home/*` içinde kendi verisini yükler ve <Suspense> ile akar: önce "bugünün
 * işleri" (görev/randevu/sıcak müşteri), ağır grafikler ve listeler sonra gelir.
 * Aynı istekteki ortak sorgular `_home/data.ts` içinde `cache()` ile tekilleşir.
 */
export default async function AppHomePage({
  searchParams,
}: {
  searchParams?: Promise<{ tv?: string }>;
}) {
  const { tv = "" } = (await searchParams) ?? {};
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
            <SayfaBasligi firstName={ctx.firstName} hasName={Boolean(fullName)} />
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
        {/* Ürün turu hedefi: bugünün işleri */}
        <div data-tour="brifing">
          <Suspense fallback={<PanelIskelet rows={2} />}>
            <BugunOzet ctx={ctx} />
          </Suspense>
        </div>

        {/* Çalışma verisi: görev + randevu + kayıp-kaçak (ilk ekran) */}
        <div data-tour="aksiyonlar" className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <Suspense fallback={<PanelIskelet />}>
            <Gorevler ctx={ctx} />
          </Suspense>
          <Suspense fallback={<PanelIskelet />}>
            <Randevular ctx={ctx} />
          </Suspense>
          <Suspense fallback={<PanelIskelet />}>
            <KayipKacak ctx={ctx} />
          </Suspense>
        </div>

        <div data-tour="kpi">
          <Suspense
            fallback={
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            }
          >
            <KpiSatiri ctx={ctx} />
          </Suspense>
        </div>

        <Suspense fallback={null}>
          <HedefKarti ctx={ctx} />
        </Suspense>

        <Suspense fallback={null}>
          <KiralamaProje ctx={ctx} />
        </Suspense>

        <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
          <Suspense fallback={<BlokIskelet className="h-80" />}>
            <KomisyonAkisi ctx={ctx} />
          </Suspense>
          <Suspense fallback={<BlokIskelet className="h-80" />}>
            <Huni />
          </Suspense>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Suspense fallback={<PanelIskelet />}>
            <PortalSagligi />
          </Suspense>
          <Suspense fallback={<PanelIskelet />}>
            <Ekip ctx={ctx} />
          </Suspense>
          <Suspense fallback={<PanelIskelet />}>
            <CanliAkis ctx={ctx} />
          </Suspense>
        </div>

        {!tvMode && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Suspense fallback={<PanelIskelet />}>
              <SonMusteriler />
            </Suspense>
            <HizliAksiyonlar />
          </div>
        )}
        {tvMode && (
          <Suspense fallback={<PanelIskelet />}>
            <SonMusteriler />
          </Suspense>
        )}
          </BosOfisKapisi>
        </Suspense>
      </div>
    </DashboardWidgetProvider>
  );
}
