import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { requireModulePage } from "@/lib/require-module-page";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { DashboardGrid, DashCell, DashboardStack, KpiGrid } from "@/components/ui/dashboard-grid";
import { Skeleton } from "@/components/app/skeleton";
import { loadShouldShowWelcome } from "@/lib/welcome-state";
import { ProductTourLazy } from "./product-tour-lazy";
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
import { SiradakiEylem, SiradakiEylemIskelet } from "./_home/siradaki-eylem";
import { KararBekleyenler, KararBekleyenlerIskelet } from "./_home/karar-bekleyenler";
import { Aranacaklar } from "./_home/aranacaklar";
import { KapsamAnahtari, homeHref, type HomeParams } from "./_home/kapsam-anahtari";

export const metadata = { title: "Ana ekran" };

/**
 * "Bugün" ana ekranı. Sayfa yalnız iskelet + yetki + bağlamı kurar; her bölüm
 * `_home/*` içinde kendi verisini yükler ve <Suspense> ile akar. Aynı istekteki ortak
 * sorgular `_home/data.ts` içinde `cache()` ile tekilleşir.
 *
 * ROL BAZLI YERLEŞİM (tek yerleşim sistemi: DashboardGrid / DashCell / KpiGrid):
 *  - Danışman (ve ofis geneli olmayan roller): en üstte "Sıradaki en iyi eylem", ardından yalnız
 *    kendi kayıtları (assigned_to = ben). En çok 8 blok; ofis geneli bloklar gizli.
 *  - Yönetim (owner/gm/branch_manager): en üstte "Bugün karar bekleyenler". En çok 10 blok.
 *    "Ofis görünümü" anahtarı (?kapsam=ofis) görev/randevu/müşteri/portföyü ofis geneline açar.
 *  - Kalan bloklar "Daha fazla" bölümünde (?daha=1) — sorguları yalnız açılınca çalışır; hiçbir
 *    blok/veri silinmedi.
 */
export default async function AppHomePage({
  searchParams,
}: {
  searchParams?: Promise<{ tv?: string; donem?: string; kapsam?: string; daha?: string }>;
}) {
  const { tv = "", donem, kapsam, daha } = (await searchParams) ?? {};
  // Eski `/app?tv=1` bağlantıları tek TV rotasına gider (kabuksuz, canlı, tam ekran).
  if (tv === "1") redirect("/app/pano-tv");
  const tvMode = false;

  const { tenantId, perms, role, userId } = await requireModulePage("dashboard");
  // Yeni danışman ilk girişinde kısa "Hoş geldin" akışına yönlenir (bir kez; çerez tercihi).
  if (!tvMode && tenantId && (await loadShouldShowWelcome(userId, role))) redirect("/app/hos-geldin");
  const user = await getRequestUser();
  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? "";

  const isManagement = hasOfficeWideDataScope(role);
  // Kapsam: varsayılan "ben"; yalnız yönetim rolleri ?kapsam=ofis ile ofis geneline açabilir.
  // TV modu ofis ekranıdır (süzgeçsiz).
  const officeView = tvMode || (isManagement && kapsam === "ofis");

  const ctx: HomeCtx = {
    tenantId,
    userId,
    role,
    isManagement,
    scopeMine: !officeView,
    seeAllEarnings: canSeeAllEarnings(perms),
    canSeeCommissions: (perms.commissions ?? []).includes("view"),
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

  const params: HomeParams = {
    donem: donem && donem !== "30" ? donem : undefined,
    kapsam: officeView && !tvMode ? "ofis" : undefined,
    daha: daha === "1" ? "1" : undefined,
  };
  const moreOpen = tvMode || daha === "1";

  /* ------------------------------ Bloklar ------------------------------ */
  const bugun = (
    <div data-tour="brifing" className="flex min-w-0 flex-1 flex-col [&>*]:flex-1">
      <Suspense fallback={<BlokIskelet className="h-[24rem]" />}>
        <BugunOzet ctx={ctx} />
      </Suspense>
    </div>
  );
  const komisyon = (
    <Suspense fallback={<BlokIskelet className="h-[24rem]" />}>
      <KomisyonAkisi ctx={ctx} />
    </Suspense>
  );
  const kpi = (
    <div data-tour="kpi" className="min-w-0">
      <Suspense
        fallback={
          <KpiGrid count={4}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} role="status" aria-busy="true" className="pm-card pm-card-inline h-full">
                <span className="sr-only">Yükleniyor</span>
                <Skeleton className="h-12 w-12 shrink-0 rounded-[0.9rem]" />
                <span className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-7 w-1/3" />
                  <Skeleton className="h-4 w-1/2" />
                </span>
              </div>
            ))}
          </KpiGrid>
        }
      >
        <KpiSatiri ctx={ctx} />
      </Suspense>
    </div>
  );
  const trend = (
    <Suspense fallback={<BlokIskelet className="h-[21rem]" />}>
      <DonemTrend ctx={ctx} />
    </Suspense>
  );
  const hedef = (
    <Suspense fallback={<BlokIskelet className="h-[21rem]" />}>
      <HedefKarti ctx={ctx} />
    </Suspense>
  );
  const randevu = (
    <div data-tour="aksiyonlar" className="flex min-w-0 flex-1 flex-col [&>*]:flex-1">
      <Suspense fallback={<PanelIskelet />}>
        <Randevular ctx={ctx} />
      </Suspense>
    </div>
  );
  const gorev = (
    <Suspense fallback={<PanelIskelet />}>
      <Gorevler ctx={ctx} />
    </Suspense>
  );
  const kayip = (
    <Suspense fallback={<PanelIskelet />}>
      <KayipKacak ctx={ctx} />
    </Suspense>
  );
  const aranacak = (
    <Suspense fallback={<PanelIskelet rows={4} />}>
      <Aranacaklar ctx={ctx} />
    </Suspense>
  );

  const cell = (xl: 3 | 4 | 5 | 6 | 7 | 8 | 12, node: ReactNode, key: string, className?: string) => {
    const mdSpan = xl === 12 || xl >= 5 ? 6 : 3;
    return (
      <DashCell key={key} span={{ md: mdSpan as 3 | 6, xl }} className={className}>
        {node}
      </DashCell>
    );
  };

  /* Ana (varsayılan görünür) bloklar */
  const mainBlocks: ReactNode[] = isManagement || tvMode
    ? [
        cell(5, bugun, "bugun"),
        cell(7, komisyon, "komisyon"),
        cell(12, kpi, "kpi"),
        cell(8, trend, "trend"),
        cell(4, hedef, "hedef"),
        cell(4, randevu, "randevu"),
        cell(4, gorev, "gorev"),
        cell(4, kayip, "kayip"),
      ]
    : [
        cell(6, bugun, "bugun"),
        cell(6, aranacak, "aranacak"),
        cell(6, randevu, "randevu"),
        cell(6, gorev, "gorev"),
        cell(12, kpi, "kpi"),
        ...(tvMode ? [] : [cell(12, <HizliAksiyonlar />, "hizli")]),
      ];

  /* "Daha fazla" bloklar (ofis geneli olanlar danışmanda hiç çizilmez) */
  const moreBlocks: ReactNode[] = isManagement || tvMode
    ? [
        cell(
          12,
          <Suspense fallback={null}>
            <YetkiUyari ctx={ctx} />
          </Suspense>,
          "yetki",
          "empty:hidden",
        ),
        cell(12, <Suspense fallback={null}><PortfoySeridi ctx={ctx} /></Suspense>, "portfoy", "empty:hidden"),
        cell(12, <Suspense fallback={null}><KiralamaProje ctx={ctx} /></Suspense>, "kiralama", "empty:hidden"),
        cell(5, <Suspense fallback={<BlokIskelet className="h-80" />}><Huni /></Suspense>, "huni"),
        cell(7, <Suspense fallback={<BlokIskelet className="h-80" />}><CanliAkis ctx={ctx} /></Suspense>, "canli"),
        cell(4, <Suspense fallback={<PanelIskelet />}><PortalSagligi /></Suspense>, "portal"),
        cell(4, <Suspense fallback={<PanelIskelet />}><Ekip ctx={ctx} /></Suspense>, "ekip"),
        cell(4, <Suspense fallback={<PanelIskelet />}><KaynakDagilimi /></Suspense>, "kaynak"),
        ...(tvMode ? [] : [cell(12, <HizliAksiyonlar />, "hizli")]),
      ]
    : [
        cell(
          12,
          <Suspense fallback={null}>
            <YetkiUyari ctx={ctx} />
          </Suspense>,
          "yetki",
          "empty:hidden",
        ),
        cell(7, komisyon, "komisyon"),
        cell(5, trend, "trend"),
        cell(12, <Suspense fallback={null}><PortfoySeridi ctx={ctx} /></Suspense>, "portfoy", "empty:hidden"),
        cell(12, <Suspense fallback={null}><KiralamaProje ctx={ctx} /></Suspense>, "kiralama", "empty:hidden"),
        cell(12, <Suspense fallback={<BlokIskelet className="h-80" />}><CanliAkis ctx={ctx} /></Suspense>, "canli"),
      ];

  return (
    <DashboardWidgetProvider>
      <DashboardStack className={tvMode ? "tv-zoom" : undefined}>
        {/* İlk giriş ürün turu — TV modunda hiç mount edilmez (bileşen içinde de kontrol var) */}
        {!tvMode && <ProductTourLazy />}

        {/* Rol bazlı ilk blok: yönetimde "Bugün karar bekleyenler", diğerlerinde "Sıradaki en iyi eylem". */}
        {!tvMode &&
          (isManagement ? (
            <Suspense fallback={<KararBekleyenlerIskelet />}>
              <KararBekleyenler ctx={ctx} />
            </Suspense>
          ) : (
            <Suspense fallback={<SiradakiEylemIskelet />}>
              <SiradakiEylem ctx={ctx} />
            </Suspense>
          ))}

        {tvMode ? (
          <Suspense fallback={<BlokIskelet className="h-16" />}>
            <TvUst ctx={ctx} />
          </Suspense>
        ) : (
          <>
            <AnaHero ctx={ctx} hasName={Boolean(fullName)} params={{ kapsam: params.kapsam, daha: params.daha }} />
            <Suspense fallback={null}>
              <OrnekVeri ctx={ctx} />
            </Suspense>
            {isManagement ? <KapsamAnahtari params={params} ofis={officeView} /> : null}
          </>
        )}

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
            <div className="flex flex-col gap-6">
              <DashboardGrid>{mainBlocks}</DashboardGrid>

              {!tvMode ? (
                <section aria-label="Daha fazla" className="flex flex-col gap-4">
                  <Link
                    href={homeHref(params, { daha: moreOpen ? undefined : "1" })}
                    scroll={false}
                    aria-expanded={moreOpen}
                    className="focus-ring press inline-flex h-10 items-center gap-2 self-start rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold text-ink-950 transition hover:bg-canvas"
                  >
                    {moreOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                    {moreOpen ? "Daha az göster" : "Daha fazla göster"}
                  </Link>
                  {moreOpen ? <DashboardGrid>{moreBlocks}</DashboardGrid> : null}
                </section>
              ) : (
                <DashboardGrid>{moreBlocks}</DashboardGrid>
              )}
            </div>
          </BosOfisKapisi>
        </Suspense>
      </DashboardStack>
    </DashboardWidgetProvider>
  );
}
