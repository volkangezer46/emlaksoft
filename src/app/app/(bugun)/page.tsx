import { ShortcutBar } from "@/components/ui/shortcut-bar";
import { Suspense, type ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { resolveScope, SCOPE_COOKIE } from "@/lib/ui/scope";
import { ChevronDown, ChevronUp, Lock } from "lucide-react";
import { moduleLabelFor } from "@/lib/permission-module-labels";
import { navPageLabelFor } from "@/lib/nav-config";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { getRequestIdentity, getRequestSampleScope } from "@/lib/cache/request";
import type { SampleKpiScope } from "@/lib/sample-scope";
import { measure } from "@/lib/server-timing";
import { requireModulePage } from "@/lib/require-module-page";
import { getInvisibleFeatures } from "@/lib/modules/prefs";
import type { FeatureKey } from "@/lib/modules/registry";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { readOwnUiState } from "@/lib/ui-state-server";
import { isWelcomeDone } from "@/lib/welcome-flow";
import { now } from "@/lib/clock";
import { greetingName } from "@/lib/greeting-name";
import { roleLabel } from "@/lib/role-labels";
import { DashboardGrid, DashCell, DashboardStack } from "@/components/ui/dashboard-grid";
import { DeferredSection } from "@/components/ui/deferred-section";
// Doğrudan dosyadan: `ui/motion` barrel'ı Reveal/MotionProvider (motion çekirdeği ~19 KB) ile birlikte gelir; FadeSwap 0 KB CSS.
import { FadeSwap } from "@/components/ui/motion/fade-swap";
import { BugunOfiste } from "../_home/bugun-ofiste";
import { loadShouldShowWelcome } from "@/lib/welcome-state";
import { DashboardWidgetProvider, Widget } from "../dashboard-widgets";
import { buildHomeBounds, loadOnboardingState, loadTenantRow, parseHomePeriod, type HomeCtx } from "../_home/data";
import { preloadDashboardSnapshot } from "../_home/data-batch";
import { BlokIskelet, PanelIskelet } from "../_home/ortak";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { HosgeldinKredisi } from "../_home/hosgeldin-kredisi";
import { AccountingKpiRow, HeroBlock, KpiRow, KpiRowSkeleton, ListingsBlock, SalesBlock, TasksBlock, TimelineBlock, CardSkeleton } from "../_home/kurumsal/blocks";
import { SiradakiEylem, SiradakiEylemIskelet } from "../_home/siradaki-eylem";
import { parseSalesFilter, parseSalesRange } from "../_home/kurumsal/core";
import { warmHomeFirstScreen } from "../_home/data";
import "../_home/kurumsal/home.css";
import { BostaOnyukle } from "../_home/bosta-onyukle";
import { DurumCubugu } from "../_home/durum-cubugu";
import { KontorBandi } from "../_home/kontor-bandi";
import { BosOfisKapisi } from "../_home/bos-ofis-kapisi";
import { BaslangicKarti } from "../_home/baslangic-karti";
import { IlanSagligi } from "../_home/ilan-sagligi";
import { Gorevler } from "../_home/gorevler";
import { KiralamaProje } from "../_home/kiralama-proje";
import { CanliAkis } from "../_home/canli-akis";
import { PortfoySeridi } from "../_home/portfoy-seridi";
import { KaynakDagilimi } from "../_home/kaynak-dagilimi";
import { Brifing, BrifingIskelet } from "../_home/brifing";
import { Dikkat, DikkatIskelet } from "../_home/dikkat";
import { GelirEgrisi } from "../_home/gelir-egrisi";
import { MetrikSeridi, MetrikSeridiIskelet } from "../_home/metrik-seridi";
import { EkipPerformans, EkipPerformansIskelet } from "../_home/ekip-performans";
import { HuniHedef, HuniHedefIskelet, KisiselHedef } from "../_home/huni-hedef";
import { DanismanAra, DanismanAraIskelet } from "../_home/danisman-ara";
import { Tahsilat, TahsilatIskelet } from "../_home/tahsilat";
import { GiderOzeti } from "../_home/gider-ozeti";
import { OfisNabzi } from "../_home/ofis-nabzi";
import { EidsYetkiSagligi } from "../_home/eids-yetki-sagligi";
import { Bugunum } from "../_home/bugunum";
import { SendenBekleyenler } from "../_home/senden-bekleyenler";
import { ParaOzeti, ParaOzetiIskelet } from "../_home/para-ozeti";
import { EkipDurum, EkipDurumIskelet } from "../_home/ekip-durum";
import { YeniOfisHero } from "../_home/yeni-ofis-hero";
import { homeHref, type HomeParams } from "../_home/kapsam-anahtari";
import { homeLayoutFor, isNewOffice, showNewOfficeHero, type MoreBlock } from "../_home/home-layout";

export const metadata = { title: "Ana ekran" };

/**
 * ANA SAYFA — kurumsal referans düzeni (sahip kararı 2026-10-16: tek görünüm, "ultra premium kurumsal"). Sayfa yalnız yetki +
 * bağlam + ROL YERLEŞİMİ (`_home/home-layout.ts`, saf) kurar; her kart kendi verisini kendi Suspense sınırında yükler
 * (iskelet parıltısı → içerik; aynı ölçü, CLS yok).
 *
 * Kahraman (`_home/kurumsal`): tarih + kapsam, selamlama (emoji yok), "Önce bununla başlayın: …" öncelik cümlesi, günün
 * özeti + "Son güncelleme · Taze", "Ne yapmak istiyorsun?" araması (komut paleti), ROL BAZLI hızlı işlemler; yönetimde sağda
 * "Ofis durumu" paneli; zeminde ofisin yayındaki portföy fotoğrafı (yoksa çizim; telefonda ≤ 96 px). Döngü/nokta/ok yok.
 * Ardından (2026-10-16 karşılaştırma raporu P0/P1):
 *  - Yönetim: Dikkat gerektirenler (önem sıralı: geciken kira/görev, onay, riskli anlaşma…) | Bugün ofiste olanlar + Kurulumu
 *    tamamla (<%100) → KPI satırı → Satış performansı | Bugünün programı (Rota) → Son eklenen ilanlar | Yapılacak görevler →
 *    Senden bekleyenler (tek tıkla onay) | Para → (ekran altı) Ekip.
 *  - Danışman / takım lideri: Sıradaki eylem → Bugünüm | Kurulum + Hedefim → Kazancım KPI'ları → İlanlarım (tekrar eden
 *    görev/randevu kartları ve ofis düzeyi "Ofis durumu" yok).
 *  - Muhasebe: Kasa · Bu ay net · Vadesi geçen · İncelenecek → Tahsilat | Giderler. Arama merkezi: Bugün ara + görevler.
 * "Ofis özeti / Özetim" katlıdır (?ozet=1): tüm göstergeler, öneriler, gelir eğrisi, ekip tablosu, huni/hedef, İlan sağlığı,
 * "Daha fazla". Ekran altı satırlar DeferredSection ile ilk boyamadan sonra bağlanır.
 */
export default async function AppHomePage({
  searchParams,
}: {
  searchParams?: Promise<{ donem?: string; kapsam?: string; daha?: string; icgoru?: string; ozet?: string; yetki?: string; sayfa?: string; yol?: string; satis?: string; tur?: string; danisman?: string }>;
}) {
  const { donem, kapsam, daha, icgoru, ozet, yetki, sayfa, yol, satis, tur, danisman } = (await searchParams) ?? {};
  // Yetkisiz sayfadan gelindi (requireModulePage → ?yetki=yok&sayfa=<modül>): YALNIZ hafif yetki kartı (B041). Pano kapısı
  // ve yükleyicileri (izin turu, anlık görüntü RPC'si, hoş geldin kapısı, bloklar) hiç başlamaz; kart kabukla birlikte
  // anında çizilir. Oturum yerel JWT'den (istek-içi önbellekli); "dashboard" izni aranmaz (yoksa kapı kendine yönlenirdi).
  if (yetki === "yok") {
    if (!(await getRequestUser())) redirect("/giris");
    // Gelinen sayfanın menü adı (Belgeler'den gelindiyse "Ofis belgeleri", "Ayarlar" modül adı değil); yoksa modül adı.
    return <YetkiKarti label={navPageLabelFor(yol) ?? moduleLabelFor(sayfa)} />;
  }
  const gate = await measure("home-gate", () => requireModulePage("dashboard"));

  const { tenantId, perms, role, userId } = gate;
  // Anlık görüntü RPC turu (içgörü/metrik/görev) bloklar çizilmeye başlamadan BAŞLAR; bloklar cache'ten okur.
  preloadDashboardSnapshot(tenantId, userId);
  const isManagement = hasOfficeWideDataScope(role);
  // Hoş geldin kapısı, kapalı modüller, örnek veri kapsamı, kullanıcı ve (yönetimde) ofis açılış anı birbirinden
  // bağımsız: TEK turda. Kapsam çerezi de aynı turda okunur (ardışık await yok).
  const [showWelcome, closedFeatures, sample, user, cookieStore, tenantRow] = await measure("home-ctx", () =>
    Promise.all([
      tenantId ? loadShouldShowWelcome(userId, role) : Promise.resolve(false),
      getInvisibleFeatures(tenantId, userId),
      getRequestSampleScope(tenantId) as Promise<SampleKpiScope>,
      getRequestUser(),
      cookies(),
      isManagement && tenantId ? loadTenantRow({ tenantId }).catch(() => null) : Promise.resolve(null),
    ]),
  );
  // Yeni danışman ilk girişinde kısa "Hoş geldin" akışına yönlenir (bir kez; profil tercihi).
  if (showWelcome) redirect("/app/hos-geldin");
  const nowMs = now();
  const newOffice = isManagement && isNewOffice(tenantRow?.created_at, nowMs);
  // Yeni ofisin SAHİBİ ilk girişte bir kez karşılama ekranını görür (C27; tamamlanma profilde, cihazlar arası).
  if (newOffice && role === "owner") {
    const state = await readOwnUiState(userId);
    if (state && !isWelcomeDone(state)) redirect("/app/hos-geldin");
  }
  // Kapalı modüllerin ana ekran blokları çizilmez (tek kapı: lib/modules/state).
  const off = (key: FeatureKey) => closedFeatures.includes(key);
  // Ad soyad: profil satırı (istek-içi TEK okuma; pano kapısı aynı sonucu paylaşır), yoksa oturum metadata'sı.
  const profileName = (await getRequestIdentity(userId)).data?.full_name?.trim();
  const fullName = profileName || ((user?.user_metadata?.full_name as string | undefined) ?? "");

  const layout = homeLayoutFor(role);
  // Kapsam: URL (?kapsam=) > son seçim çerezi > "ben"; yalnız yönetim rolleri ofis geneline açabilir (lib/ui/scope).
  // Sahip/genel müdür için varsayılan "Ofis geneli" (seçim çerezi yoksa); diğer roller "Benim işlerim".
  const scopeCookie = cookieStore.get(SCOPE_COOKIE)?.value;
  const { scope, explicit: kapsamParam } = resolveScope({
    canSwitch: isManagement,
    param: kapsam,
    cookie: scopeCookie ?? (role === "owner" || role === "gm" ? "ofis" : undefined),
  });
  const officeView = scope === "ofis";

  const ctx: HomeCtx = {
    tenantId,
    userId,
    role,
    perms,
    canSeeExpenses: (perms.expenses ?? []).includes("view"),
    isManagement,
    scopeMine: !officeView,
    seeAllEarnings: canSeeAllEarnings(perms),
    canSeeCommissions: (perms.commissions ?? []).includes("view"),
    tvMode: false,
    // Kiralama/proje şeridi yalnız modülü görebilene sorulur.
    canSeeRentals: (perms.rentals ?? []).includes("view") && !off("rentals"),
    canSeeProjects: (perms.projects ?? []).includes("view") && !off("projects"),
    canSeeProperties: (perms.properties ?? []).includes("view"),
    sample,
    period: parseHomePeriod(donem),
    fullName,
    firstName: fullName.split(" ")[0] || "hoş geldiniz",
    ...buildHomeBounds(),
  };
  // Yeni ofis kahramanı: ilk 14 gün içinde ve kurulum bitmeden (kurulum durumu yalnız yeni ofiste okunur).
  const onboarding = newOffice ? await loadOnboardingState(ctx).catch(() => null) : null;
  const heroNewOffice = showNewOfficeHero({ variant: layout.variant, createdAt: tenantRow?.created_at, nowMs, settled: onboarding ? onboarding.settled : null });

  const salesRange = parseSalesRange(satis);
  const salesFilter = parseSalesFilter(tur, isManagement && officeView ? danisman : undefined);
  const params: HomeParams = {
    donem: ctx.period !== 30 ? String(ctx.period) : undefined,
    kapsam: kapsamParam ?? undefined,
    daha: daha === "1" ? "1" : undefined,
    icgoru: icgoru === "tum" ? "tum" : undefined,
    ozet: ozet === "1" ? "1" : undefined,
    satis: salesRange === "ay" ? undefined : salesRange,
    tur: salesFilter.tur,
    danisman: salesFilter.danisman,
  };
  const moreOpen = daha === "1";
  // "Ofis özeti / Özetim" (tüm göstergeler, öneriler, kurulum, ekip tabloları): katlı başlar, ?ozet=1 açar. "Daha fazla"
  // açıksa (içinde olduğu için) her zaman açık. Tek görünüm: görünüm tercihine bağlı değildir.
  const ozetOpen = moreOpen || ozet === "1";
  const ozetToggle = ozetOpen ? undefined : "1";
  const ozetTitle = isManagement ? "Ofis özeti" : "Özetim";
  // En olası sonraki hedefler (yalnız görme yetkisi olunanlar; kapalı modül atlanır). Boşta ısıtılır, en çok 4.
  const prefetchTargets = (
    [
      ["customers", "/app/musteriler"],
      ["properties", "/app/portfoyler"],
      ["tasks", "/app/gorevler"],
      ["appointments", "/app/randevular"],
    ] as const
  )
    .filter(([mod]) => (perms[mod] ?? []).includes("view"))
    .map(([, href]) => href);
  const swapKey = `${ctx.period}-${officeView ? "ofis" : "ben"}`;
  const storageScope = tenantId ? `${tenantId}:${userId}` : userId;
  // İlk ekran yükleyicileri (anlık görüntü RPC'leri, dikkat listesi) bloklar çizilmeden BAŞLAR.
  warmHomeFirstScreen(ctx, layout);

  /** Izgara hücresi; `widget` verilirse "Düzenle" modunda gizlenebilir. */
  const cell = (xl: 3 | 4 | 5 | 6 | 7 | 8 | 12, node: ReactNode, key: string, opts?: { widget?: string; className?: string }) => (
    <DashCell key={key} span={{ md: xl === 12 || xl >= 5 ? 6 : 3, xl }} className={opts?.className}>
      {opts?.widget ? (
        <Widget id={opts.widget} className="h-full">
          {node}
        </Widget>
      ) : (
        node
      )}
    </DashCell>
  );

  /* ------------------------------ Bloklar ------------------------------ */
  // Eski gösterge şeridi (tüm göstergeler): kurumsal düzende KPI satırı ilk ekrandadır; muhasebe / arama merkezinde ilk ekran,
  // yönetim ve danışmanda "Ofis özeti / Özetim" içinde ("Tüm göstergeler").
  const kurumsal = layout.variant === "management" || layout.variant === "advisor" || layout.variant === "team_lead";
  const kpis =
    layout.metrics.length === 0 ? null : (
      <div data-tour="kpi" key="kpis">
        <Suspense key={swapKey} fallback={<MetrikSeridiIskelet rows={layout.metrics.length} caption={isManagement} />}>
          <FadeSwap swapKey={swapKey}>
            <MetrikSeridi ctx={ctx} keys={layout.metrics} capped={!kurumsal} />
          </FadeSwap>
        </Suspense>
      </div>
    );
  const kpisToday = kurumsal ? null : kpis;
  const kpisOzet = kurumsal ? kpis : null;
  const gelir =
    layout.revenueChart && ctx.canSeeCommissions ? (
      <Suspense fallback={<PanelIskelet rows={5} className="h-full min-h-[22rem]" />}>
        <GelirEgrisi ctx={ctx} />
      </Suspense>
    ) : null;
  const ekip = (
    <Suspense fallback={<EkipPerformansIskelet />}>
      <EkipPerformans ctx={ctx} />
    </Suspense>
  );
  const huniHedef = (
    <Suspense fallback={<HuniHedefIskelet />}>
      <HuniHedef ctx={ctx} />
    </Suspense>
  );
  const gorevler = (
    <Suspense fallback={<PanelIskelet />}>
      <Gorevler ctx={ctx} />
    </Suspense>
  );
  const kisiselHedef = (
    <Suspense fallback={<PanelIskelet rows={2} className="min-h-[13rem]" />}>
      <KisiselHedef ctx={ctx} />
    </Suspense>
  );
  const gider = (
    <Suspense fallback={<PanelIskelet rows={4} className="min-h-[14rem]" />}>
      <GiderOzeti ctx={ctx} />
    </Suspense>
  );
  const ekipDurum =
    layout.team && !off("team_perf") ? (
      <Suspense fallback={<EkipDurumIskelet />}>
        <EkipDurum ctx={ctx} />
      </Suspense>
    ) : null;
  // Kurulum: %100 olana dek ilk ekranda kısa kart; kalan ilk işler / örnek veri özet bölümünde (halka tekrarlanmaz).
  // Yeni ofis kahramanı varken ikisi de yok (kahraman zaten "Sıradaki adım"ı gösterir).
  const ozetKurulum = heroNewOffice ? null : (
    <Suspense key="kurulum" fallback={null}>
      <BaslangicKarti ctx={ctx} />
    </Suspense>
  );
  const kurulumKisa = heroNewOffice ? null : (
    <Suspense key="kurulum-kisa" fallback={null}>
      <BaslangicKarti ctx={ctx} compact />
    </Suspense>
  );

  /* ------------- Kurumsal ilk ekran (yönetim + danışman): KPI → satış | para → ilanlar | görevler ------------- */
  const kpiRow = (
    <Suspense key={`kpi-${swapKey}`} fallback={<KpiRowSkeleton />}>
      <KpiRow ctx={ctx} />
    </Suspense>
  );
  const listingsOnly = (
    <div className="kh-row" key="ilanlar">
      <Suspense fallback={<CardSkeleton className="kh-ls-skel" rows={3} />}>
        <ListingsBlock ctx={ctx} scope={storageScope} />
      </Suspense>
    </div>
  );
  const listingsTasks = (
    <div className="kh-row" key="ilan-gorev">
      <Suspense fallback={<CardSkeleton className="kh-ls-skel" rows={3} />}>
        <ListingsBlock ctx={ctx} scope={storageScope} />
      </Suspense>
      <Suspense fallback={<CardSkeleton rows={5} />}>
        <TasksBlock ctx={ctx} />
      </Suspense>
    </div>
  );

  const bottomNode = (key: (typeof layout.bottom)[number]): ReactNode => {
    switch (key) {
      case "gorevler":
        return gorevler;
      case "kisisel-hedef":
        return kisiselHedef;
      case "gider-ozeti":
        return ctx.canSeeExpenses ? gider : null;
    }
  };
  const BOTTOM_WIDGET: Record<string, string | undefined> = { "kisisel-hedef": "kisisel-hedef", "gider-ozeti": "gider" };

  /* ----------------- Ana (varsayılan görünür) satırlar — rol yerleşimi ----------------- */
  const rows: ReactNode[] = [];
  const grid = (key: string, cells: ReactNode[], cls?: string) =>
    cells.length === 0 ? null : (
      <DashboardGrid key={key} className={cls} stagger={false}>
        {cells}
      </DashboardGrid>
    );
  /**
   * Ekran-altı satır: ilk HTML'de aynı ızgarada iskelet; gerçek bloklar görünür alana yaklaşınca bağlanır
   * (DeferredSection). Veri yine sunucuda hazırlanır; yalnız istemci bağlama/hidrasyon maliyeti ertelenir.
   * İskelet hücreleri gerçek hücrelerle aynı span'ı taşır (CLS=0).
   */
  type DeferredItem = { span: 3 | 4 | 5 | 6 | 7 | 8 | 12; node: ReactNode };
  const liveItems = (items: DeferredItem[]) => items.filter((it) => it.node !== null && it.node !== undefined);
  const deferredSkeleton = (key: string, items: DeferredItem[], cls?: string) => {
    const live = liveItems(items);
    if (live.length === 0) return null;
    return (
      <DashboardGrid key={key} className={cls} stagger={false}>
        {live.map((it, i) => cell(it.span, <SessizPanelIskelet />, `${key}-sk-${i}`))}
      </DashboardGrid>
    );
  };
  const deferredGrid = (key: string, items: DeferredItem[], cls?: string) => {
    const live = liveItems(items);
    if (live.length === 0) return null;
    return (
      <DeferredSection key={key} label="Ek bloklar" fallback={deferredSkeleton(`${key}-f`, live, cls)}>
        {/* stagger kapalı: iskelet yerini alan içerik sıfır opaklıktan tekrar belirmez (çift yükleme hissi). */}
        <DashboardGrid className={cls} stagger={false}>{live.map((it, i) => cell(it.span, it.node, `${key}-${i}`))}</DashboardGrid>
      </DeferredSection>
    );
  };
  const widgetWrap = (id: string | undefined, node: ReactNode) => (id ? <Widget id={id} className="h-full">{node}</Widget> : node);

  /** "Bugün" yüzeyinde kalan alt blok (arama merkezinin görevleri); diğerleri Özet bölümüne gider. */
  const TODAY_BOTTOM = new Set<string>(["gorevler"]);
  const bottomItemsBy = (span: 4 | 6 | 12, today: boolean): DeferredItem[] =>
    layout.bottom.flatMap((k) => {
      if (TODAY_BOTTOM.has(k) !== today) return [];
      const node = bottomNode(k);
      return node ? [{ span, node: widgetWrap(BOTTOM_WIDGET[k], node) }] : [];
    });
  const ozetRows: ReactNode[] = [];
  /** Kapı sınırının yedeği: "Bugün" satırlarıyla AYNI düzen (iskelet → içerik düzen sıçraması yok). */
  const skeletonRows: ReactNode[] = [];

  switch (layout.variant) {
    case "management": {
      // KURUMSAL PANO — sakin, net dikey ritim (sahip geri bildirimi 2026-10-16 "yine karışık"):
      // Kahraman → Dikkat gerektirenler | Bugünün programı → KPI satırı → Satış performansı | Para → Son eklenen ilanlar |
      // Görevler → Senden bekleyenler | Bugün ofiste olanlar → (ekran altı) Ekip.
      rows.push(
        grid("gundem", [
          cell(
            7,
            <Suspense fallback={<DikkatIskelet />}>
              <div className="h-full">
                <FadeSwap swapKey={swapKey} className="h-full">
                  <Dikkat ctx={ctx} params={params} maxItems={6} listOnly />
                </FadeSwap>
              </div>
            </Suspense>,
            "dikkat",
          ),
          cell(
            5,
            <div className="flex h-full flex-col gap-4">
              {kurulumKisa}
              <Suspense fallback={<CardSkeleton rows={4} />}>
                <TimelineBlock ctx={ctx} />
              </Suspense>
            </div>,
            "program",
          ),
        ]),
        kpiRow,
        <div className="kh-row" key="satis-para">
          {ctx.canSeeCommissions ? (
            <Suspense key={`satis-${salesRange}-${salesFilter.tur ?? ""}-${salesFilter.danisman ?? ""}-${swapKey}`} fallback={<CardSkeleton className="kh-sales-skel" rows={5} />}>
              <SalesBlock ctx={ctx} range={salesRange} filter={salesFilter} params={params} />
            </Suspense>
          ) : null}
          <Suspense fallback={<ParaOzetiIskelet />}>
            <ParaOzeti ctx={ctx} />
          </Suspense>
        </div>,
        listingsTasks,
        grid("r3", [
          cell(7, <SendenBekleyenler ctx={ctx} params={params} hideSuggestion={heroNewOffice} />, "bekleyen"),
          cell(
            5,
            <Suspense fallback={<PanelIskelet rows={3} className="min-h-[10rem]" />}>
              <BugunOfiste ctx={ctx} params={params} />
            </Suspense>,
            "ofiste",
          ),
        ]),
        deferredGrid("r4", [{ span: 12, node: ekipDurum }]),
      );
      skeletonRows.push(
        grid("gundem-sk", [cell(7, <DikkatIskelet />, "dikkat"), cell(5, <CardSkeleton rows={4} />, "program")]),
        <KpiRowSkeleton key="kpi-sk" />,
        <div className="kh-row" key="r1-sk">
          <CardSkeleton className="kh-sales-skel" rows={5} />
          <ParaOzetiIskelet />
        </div>,
        <div className="kh-row" key="r2-sk">
          <CardSkeleton className="kh-ls-skel" rows={3} />
          <CardSkeleton rows={5} />
        </div>,
      );
      ozetRows.push(
        ozetKurulum,
        <Suspense key="oneriler" fallback={<BrifingIskelet />}>
          <div data-tour="oneriler">
            <Brifing ctx={ctx} params={params} eyebrow="Öneri" maxRows={3} />
          </div>
        </Suspense>,
        kpisOzet,
        <Suspense key="nabiz" fallback={null}><OfisNabzi ctx={ctx} /></Suspense>,
        // EİDS Yetki Sağlığı (yönetim; ofis özeti açıkken). Her sayı kendi kuyruğuna gider.
        !off("portals") ? grid("oe", [cell(12, <Suspense fallback={<PanelIskelet rows={4} />}><EidsYetkiSagligi ctx={ctx} /></Suspense>, "eids-yetki")]) : null,
        gelir ? grid("o1", [cell(12, gelir, "gelir", { widget: "gelir" })]) : null,
        deferredGrid("o2", [
          ...(layout.team && !off("team_perf") ? [{ span: 7 as const, node: widgetWrap("ekip-perf", ekip) }] : []),
          ...(layout.funnelTarget && !off("team_perf") ? [{ span: 5 as const, node: widgetWrap("huni-hedef", huniHedef) }] : []),
        ]),
        deferredGrid("o3", bottomItemsBy(4, false)),
      );
      break;
    }
    case "advisor":
    case "team_lead":
      // DANIŞMAN (kendi kapsamı, P1-11): Sıradaki eylem → Bugünüm (randevu · aranacak · geciken görev; Ara / Yol tarifi /
      // Bitti) | Kurulum + Hedefim → Kazancım KPI'ları → İlanlarım. Görev ve randevu YALNIZ Bugünüm'de (tekrar yok);
      // ofis düzeyi "Ofis durumu" danışmanda çizilmez. Satış performansı Özetim'de.
      rows.push(
        <Suspense key="siradaki" fallback={<SiradakiEylemIskelet />}>
          <SiradakiEylem ctx={ctx} />
        </Suspense>,
        grid("r1", [
          cell(7, <Bugunum ctx={ctx} />, "bugunum"),
          cell(
            5,
            <div className="flex h-full flex-col gap-4">
              {kurulumKisa}
              {layout.bottom.includes("kisisel-hedef") ? widgetWrap("kisisel-hedef", kisiselHedef) : null}
            </div>,
            "hedef",
          ),
        ]),
        <Suspense key={`kpi-${swapKey}`} fallback={<KpiRowSkeleton count={3} />}>
          <KpiRow ctx={ctx} opts={{ hideAppointments: true }} />
        </Suspense>,
        listingsOnly,
      );
      skeletonRows.push(
        <SiradakiEylemIskelet key="siradaki-sk" />,
        grid("r1-sk", [cell(7, <PanelIskelet rows={5} className="min-h-[20rem]" />, "bugunum"), cell(5, <PanelIskelet rows={2} className="min-h-[13rem]" />, "hedef")]),
        <KpiRowSkeleton key="kpi-sk" count={3} />,
      );
      ozetRows.push(
        ozetKurulum,
        ctx.canSeeCommissions ? (
          <div className="kh-row" key="satis-ozet">
            <Suspense key={`satis-${salesRange}-${swapKey}`} fallback={<CardSkeleton className="kh-sales-skel" rows={5} />}>
              <SalesBlock ctx={ctx} range={salesRange} filter={salesFilter} params={params} />
            </Suspense>
          </div>
        ) : null,
        <Suspense key="oneriler" fallback={<BrifingIskelet />}>
          <div data-tour="oneriler">
            <Brifing ctx={ctx} params={params} eyebrow="Öneri" maxRows={2} />
          </div>
        </Suspense>,
        kpisOzet,
        ...(layout.team && !off("team_perf") ? [deferredGrid("ot", [{ span: 12, node: widgetWrap("ekip-perf", ekip) }])] : []),
        deferredGrid("o2", bottomItemsBy(4, false).filter(() => !layout.bottom.includes("kisisel-hedef"))),
      );
      break;
    case "accounting":
      // MUHASEBE (P0-6): Kasa · Bu ay net · Vadesi geçen · İncelenecek → Tahsilat | Giderler. Komisyon göstergeleri Özet'te.
      rows.push(
        <Suspense key="muh-kpi" fallback={<KpiRowSkeleton />}>
          <AccountingKpiRow ctx={ctx} />
        </Suspense>,
        grid("r1", [cell(ctx.canSeeExpenses ? 7 : 12, <Tahsilat ctx={ctx} />, "tahsilat"), ...(ctx.canSeeExpenses ? [cell(5, widgetWrap("gider", gider), "gider")] : [])]),
      );
      skeletonRows.push(<KpiRowSkeleton key="muh-kpi-sk" />, grid("r1-sk", [cell(ctx.canSeeExpenses ? 7 : 12, <TahsilatIskelet />, "tahsilat"), ...(ctx.canSeeExpenses ? [cell(5, <PanelIskelet rows={4} className="min-h-[14rem]" />, "gider")] : [])]));
      ozetRows.push(kpisToday, deferredGrid("o2b", bottomItemsBy(12, true)));
      break;
    case "call_center":
      rows.push(kpisToday, grid("r1", [cell(12, <DanismanAra ctx={ctx} />, "ara", { widget: "ara" })]), deferredGrid("r2", bottomItemsBy(12, true)));
      skeletonRows.push(grid("r1-sk", [cell(12, <DanismanAraIskelet />, "ara")]), deferredSkeleton("r2-sk", bottomItemsBy(12, true)));
      ozetRows.push(kpisOzet, deferredGrid("o2", bottomItemsBy(12, false)));
      break;
  }

  /* ------------------------ "Daha fazla" (varsayılan kapalı) ------------------------ */
  const MORE_SPAN: Record<MoreBlock, 4 | 7 | 12> = {
    "canli-akis": 7,
    "kaynak-dagilimi": 4,
    portfoy: 12,
    kiralama: 12,
  };
  const moreNode = (key: MoreBlock): { node: ReactNode; className?: string } | null => {
    switch (key) {
      case "portfoy":
        return { node: <Suspense fallback={null}><PortfoySeridi ctx={ctx} /></Suspense>, className: "empty:hidden" };
      case "kiralama":
        return { node: <Suspense fallback={null}><KiralamaProje ctx={ctx} /></Suspense>, className: "empty:hidden" };
      case "canli-akis":
        return { node: <Suspense fallback={<BlokIskelet className="h-80" />}><CanliAkis ctx={ctx} auditLink={layout.auditLink} /></Suspense> };
      case "kaynak-dagilimi":
        return { node: <Suspense fallback={<PanelIskelet />}><KaynakDagilimi ctx={ctx} /></Suspense> };
    }
  };
  const moreCells = layout.more.flatMap((k) => {
    const m = moreNode(k);
    return m ? [cell(MORE_SPAN[k], m.node, `m-${k}`, { className: m.className })] : [];
  });

  return (
    <DashboardWidgetProvider>
      <DashboardStack>
        <div className="flex flex-col gap-3">
          <HeroBlock
            ctx={ctx}
            layout={layout}
            params={params}
            officeView={officeView}
            off={(k) => closedFeatures.includes(k as FeatureKey)}
            name={greetingName({ fullName, email: user?.email ?? null, roleTitle: roleLabel(role) })}
          />
          {layout.statusBar ? (
            <DurumCubugu>
              {/* En çok 2 bant, öncelik sırasıyla: analiz bakiyesi (para/engel) > hoş geldin kredisi. */}
              <Suspense fallback={null}>
                <KontorBandi ctx={ctx} valuationClosed={off("valuation")} />
                <HosgeldinKredisi ctx={ctx} />
              </Suspense>
            </DurumCubugu>
          ) : null}
        </div>

        {/* TEK kapı sınırı: yeni ofis kahramanı / boş ofis kartı + boş ofis kapısı. Kartlar kendi sınırlarında akar;
            yedek, gerçek düzenle aynıdır (KPI satırı + iki satır kart iskeleti + özet düğmesi yeri). */}
        <Suspense
          fallback={
            <div className="flex min-w-0 flex-col gap-4">
              <section aria-label="Bugün" className="flex flex-col gap-4">
                <h2 className="sr-only">Bugün</h2>
                {skeletonRows}
              </section>
              <Skeleton className="h-11 w-72 max-w-full rounded-full" />
            </div>
          }
        >
          {/* Yeni ofis: TEK "Sıradaki adım" + 3 kısa yol. Boş (eski) ofis: Başlangıç kartı (veri yokken tek çıkış yolu). */}
          {heroNewOffice ? <YeniOfisHero ctx={ctx} /> : <BaslangicKarti ctx={ctx} onlyEmpty />}
          {/* Müşteri + portföy yokken tüm dolu bloklar gizlenir; yerinde kahraman/Başlangıç kartı ilk adımları gösterir */}
          <BosOfisKapisi ctx={ctx}>
            <div className="flex min-w-0 flex-col gap-5">
              <section aria-label="Bugün" className="flex flex-col gap-4">
                <h2 className="sr-only">Bugün</h2>
                {rows}
              </section>

              {/* Ofis özeti / Özetim: katlı (yalnız açılınca sunucuda çizilir). */}
              <section aria-label={ozetTitle} className="flex flex-col gap-4">
                <Link
                  href={homeHref(params, { ozet: ozetToggle, daha: ozetOpen ? undefined : params.daha })}
                  scroll={false}
                  aria-expanded={ozetOpen}
                  data-ozet-anahtari=""
                  className="focus-ring press inline-flex h-11 items-center gap-2 self-start rounded-full border border-hairline bg-surface-raised px-5 text-sm font-semibold text-text shadow-[var(--elev-1)] transition hover:bg-surface-hover"
                >
                  {ozetOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                  {ozetOpen ? `${ozetTitle} bölümünü kapat` : `${ozetTitle} (tüm göstergeler, öneriler, kurulum)`}
                </Link>
                {ozetOpen ? (
                  <div className="flex min-w-0 flex-col gap-5">
                    {ozetRows}
                    {layout.listingHealth ? <Widget id="ilan-sagligi"><IlanSagligi ctx={ctx} closed={{ portals: off("portals"), leak: off("leak") }} /></Widget> : null}
                  </div>
                ) : null}
              </section>

              {ozetOpen && moreCells.length > 0 ? (
                <section aria-label="Daha fazla" className="flex flex-col gap-4">
                  <Link
                    href={homeHref(params, { daha: moreOpen ? undefined : "1" })}
                    scroll={false}
                    aria-expanded={moreOpen}
                    className="focus-ring press inline-flex h-11 items-center gap-2 self-start rounded-full border border-hairline bg-surface-raised px-4 text-sm font-semibold text-text shadow-[var(--elev-1)] transition hover:bg-surface-hover"
                  >
                    {moreOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                    {moreOpen ? "Daha az göster" : "Daha fazla göster"}
                  </Link>
                  {moreOpen ? (
                    <DeferredSection
                      label="Daha fazla"
                      fallback={
                        <DashboardGrid stagger={false}>
                          {layout.more.map((k) => cell(MORE_SPAN[k], <SessizPanelIskelet />, `m-sk-${k}`))}
                        </DashboardGrid>
                      }
                    >
                      <DashboardGrid stagger={false}>{moreCells}</DashboardGrid>
                    </DeferredSection>
                  ) : null}
                </section>
              ) : null}
            </div>
          </BosOfisKapisi>
        </Suspense>
        <BostaOnyukle hrefs={prefetchTargets} />
        <ShortcutBar
          items={[
            { keys: ["mod", "K"], label: "Ara ve komut" },
            { keys: ["G", "M"], label: "Müşteriler" },
            { keys: ["G", "P"], label: "Portföyler" },
            { keys: ["G", "K"], label: "Komisyon" },
            { keys: ["?"], label: "Tüm kısayollar" },
          ]}
        />
      </DashboardStack>
    </DashboardWidgetProvider>
  );
}

/**
 * Ertelenmiş (ekran altı) satırın yer tutucusu: gerçek panelle aynı ölçü (min-h-[15rem], CLS yok) ama `role="status"` /
 * `aria-busy` TAŞIMAZ (B048): görünmeyen bölge ekran okuyucuya ve ölçüme "yükleniyor" demez; bölüm ilk boyamadan sonra
 * boşta kendiliğinden bağlanır (DeferredSection).
 */
function SessizPanelIskelet() {
  return (
    <div aria-hidden="true" className="min-h-[15rem] space-y-2.5 rounded-[var(--pm-r)] border border-line bg-surface p-5">
      <Skeleton className="h-4 w-1/2" />
      {Array.from({ length: 3 }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

/**
 * Yetkisiz sayfa kartı (B041): `requireModulePage` reddi `/app?yetki=yok&sayfa=<modül>` adresine gelir. Pano çizilmez
 * (eskiden tam "Bugün" panosu yükleniyordu: 0,9-3,8 sn); yalnız neden + çıkış yolu. Sorgu yok, kabukla birlikte anında.
 */
function YetkiKarti({ label }: { label: string | null }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4 py-10">
      <section aria-labelledby="yetki-karti-baslik" className="w-full max-w-md text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-[var(--radius-card)] border border-line bg-surface-raised">
          <Lock className="h-7 w-7 text-text-muted" aria-hidden="true" />
        </div>
        <h1 id="yetki-karti-baslik" className="mt-4 font-display text-lg font-bold text-ink-950">
          {label ? `Bu sayfa rolünüz için kapalı (${label})` : "Bu sayfa rolünüz için kapalı"}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-muted">
          Erişim için ofis yöneticinizden yetki isteyebilirsiniz. Çalışmaya ana ekrandan devam edin.
        </p>
        <div className="mt-6 flex justify-center">
          <Link
            href="/app"
            className="focus-ring press inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-5 text-sm font-semibold text-white transition hover:bg-accent-hover touch:min-h-11"
          >
            Ana ekrana dön
          </Link>
        </div>
      </section>
    </div>
  );
}
