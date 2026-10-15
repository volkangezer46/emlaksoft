import { ShortcutBar } from "@/components/ui/shortcut-bar";
import { Suspense, type ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { resolveScope, SCOPE_COOKIE } from "@/lib/ui/scope";
import { ChevronDown, ChevronUp, Lock } from "lucide-react";
import { moduleLabelFor } from "@/lib/permission-module-labels";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { getRequestSampleScope } from "@/lib/cache/request";
import type { SampleKpiScope } from "@/lib/sample-scope";
import { measure } from "@/lib/server-timing";
import { requireModulePage } from "@/lib/require-module-page";
import { getInvisibleFeatures } from "@/lib/modules/prefs";
import type { FeatureKey } from "@/lib/modules/registry";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { DashboardGrid, DashCell, DashboardStack } from "@/components/ui/dashboard-grid";
import { DeferredSection } from "@/components/ui/deferred-section";
// Doğrudan dosyadan: `ui/motion` barrel'ı Reveal/MotionProvider (motion çekirdeği ~19 KB) ile birlikte gelir; FadeSwap 0 KB CSS.
import { FadeSwap } from "@/components/ui/motion/fade-swap";
import { NeYapmak } from "../_home/ne-yapmak";
import { neYapmakChips } from "../_home/ne-yapmak-chips";
import { BugunKisayol, BugunKisayolIskelet } from "../_home/bugun-kisayol";
import { BugunOfiste } from "../_home/bugun-ofiste";
import { loadShouldShowWelcome } from "@/lib/welcome-state";
import { DashboardWidgetProvider, Widget } from "../dashboard-widgets";
import { buildHomeBounds, parseHomePeriod, type HomeCtx } from "../_home/data";
import { preloadDashboardSnapshot } from "../_home/data-batch";
import { BlokIskelet, PanelIskelet } from "../_home/ortak";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { HosgeldinKredisi } from "../_home/hosgeldin-kredisi";
import { AnaHero } from "../_home/ana-hero";
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
import { Program } from "../_home/program";
import { DanismanAra, DanismanAraIskelet } from "../_home/danisman-ara";
import { Tahsilat, TahsilatIskelet } from "../_home/tahsilat";
import { GiderOzeti } from "../_home/gider-ozeti";
import { OfisNabzi } from "../_home/ofis-nabzi";
import { EidsYetkiSagligi } from "../_home/eids-yetki-sagligi";
import { homeHref, type HomeParams } from "../_home/kapsam-anahtari";
import { homeLayoutFor, type MoreBlock } from "../_home/home-layout";

export const metadata = { title: "Ana ekran" };

/**
 * "Bugün" ana ekranı — tasarım sistemi v4 (referans: /admin kontrol paneli). Sayfa yalnız yetki + bağlam + ROL YERLEŞİMİ
 * (`_home/home-layout.ts`, saf) kurar; her blok `_home/*` içinde kendi verisini yükler. Sınır sayısı azdır (B021): ilk ekran
 * blokları (Başlangıç kartı + boş ofis kapısı + "Bugün" satırı) TEK <Suspense>'te, gerçek düzenle aynı iskeletle birlikte
 * açılır; yalnız varsayılan kapalı "Ofis özeti" / "Daha fazla" blokları kendi sınırlarında akar (CLS yok).
 *
 * Her rol: DashboardHero (tarih · rol bağlamı, selamlama, tek cümle öncelik, tazelik, dönem/kapsam seçici) → durum çubuğu
 * → KpiGrid (dönem/kapsam değişince FadeSwap). Ardından:
 *  - Yönetim: Dikkat gerektirenler + içgörüler (7) | Komisyon geliri eğrisi (5) → Ekip performansı (7) | Satış hunisi +
 *    ofis hedefi (5) → Program / Görevler → tek İlan sağlığı bloğu → "Daha fazla" (varsayılan kapalı). Üstte tek Başlangıç kartı + en çok 2 bant.
 *  - Danışman: Sıradaki eylem (7) + Bugün ara (5) → Program / Görevler / Kişisel hedef. Takım lideri: + ekip tablosu.
 *  - Muhasebe: Tahsilat odağı + gider özeti. Arama merkezi: Bugün ara + görevler.
 * Ekran altı satırlar DeferredSection ile ilk boyamadan sonra boşta (ya da görünür alana yaklaşınca) bağlanır. Reveal
 * (motion `m.*`) burada bilinçli olarak YOK: /app ilk yük bütçesi motion çekirdeğini (~19 KB) kaldırmaz; ilk açılışta giriş
 * animasyonu da yoktur (içerik geldiği karede tam opak; B027), dönem/kapsam değişimi FadeSwap'tır.
 */
export default async function AppHomePage({
  searchParams,
}: {
  searchParams?: Promise<{ donem?: string; kapsam?: string; daha?: string; icgoru?: string; ozet?: string; yetki?: string; sayfa?: string }>;
}) {
  const { donem, kapsam, daha, icgoru, ozet, yetki, sayfa } = (await searchParams) ?? {};
  // Yetkisiz sayfadan gelindi (requireModulePage → ?yetki=yok&sayfa=<modül>): YALNIZ hafif yetki kartı (B041). Pano kapısı
  // ve yükleyicileri (izin turu, anlık görüntü RPC'si, hoş geldin kapısı, bloklar) hiç başlamaz; kart kabukla birlikte
  // anında çizilir. Oturum yerel JWT'den (istek-içi önbellekli); "dashboard" izni aranmaz (yoksa kapı kendine yönlenirdi).
  if (yetki === "yok") {
    if (!(await getRequestUser())) redirect("/giris");
    return <YetkiKarti label={moduleLabelFor(sayfa)} />;
  }
  const gate = await measure("home-gate", () => requireModulePage("dashboard"));

  const { tenantId, perms, role, userId } = gate;
  // Anlık görüntü RPC turu (içgörü/metrik/görev) bloklar çizilmeye başlamadan BAŞLAR; bloklar cache'ten okur.
  preloadDashboardSnapshot(tenantId, userId);
  // Hoş geldin kapısı, kapalı modüller, örnek veri kapsamı ve kullanıcı birbirinden bağımsız: TEK turda.
  // Kapsam çerezi de aynı turda okunur (ardışık await yok).
  const [showWelcome, closedFeatures, sample, user, cookieStore] = await measure("home-ctx", () =>
    Promise.all([
      tenantId ? loadShouldShowWelcome(userId, role) : Promise.resolve(false),
      getInvisibleFeatures(tenantId, userId),
      getRequestSampleScope(tenantId) as Promise<SampleKpiScope>,
      getRequestUser(),
      cookies(),
    ]),
  );
  // Yeni danışman ilk girişinde kısa "Hoş geldin" akışına yönlenir (bir kez; çerez tercihi).
  if (showWelcome) redirect("/app/hos-geldin");
  // Kapalı modüllerin ana ekran blokları çizilmez (tek kapı: lib/modules/state).
  const off = (key: FeatureKey) => closedFeatures.includes(key);
  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? "";

  const isManagement = hasOfficeWideDataScope(role);
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

  const params: HomeParams = {
    donem: ctx.period !== 30 ? String(ctx.period) : undefined,
    kapsam: kapsamParam ?? undefined,
    daha: daha === "1" ? "1" : undefined,
    icgoru: icgoru === "tum" ? "tum" : undefined,
    ozet: ozet === "1" ? "1" : undefined,
  };
  const moreOpen = daha === "1";
  // "Ofis özeti" bölümü: ?ozet=1 ya da "Daha fazla" açıksa (içinde olduğu için) açık.
  const ozetOpen = ozet === "1" || moreOpen;
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
  const swapKey =`${ctx.period}-${officeView ? "ofis" : "ben"}`;

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
  const kpis =
    layout.metrics.length === 0 ? null : (
      <div data-tour="kpi">
        <Suspense key={swapKey} fallback={<MetrikSeridiIskelet rows={layout.metrics.length} caption={isManagement} />}>
          <FadeSwap swapKey={swapKey}>
            <MetrikSeridi ctx={ctx} keys={layout.metrics} />
          </FadeSwap>
        </Suspense>
      </div>
    );
  // İlk ekran blokları (dikkat / sıradaki eylem / kısayollar / tahsilat / bugün ara) AYRI Suspense taşımaz: hepsi
  // `BosOfisKapisi` ile aynı TEK sınırda, birlikte ve tek seferde açılır (B021: sınır sayısı ↓, tek gösterim turu).
  // Verileri kapı beklenmeden başlar (`warmHomeFirstScreen`, `preloadDashboardSnapshot`). Dönem/kapsam değişiminde eski
  // içerik yenisi gelene dek kalır (geçiş), sonra FadeSwap ile yer değiştirir; iskelet yanıp sönmez.
  const dikkat = (
    <div data-tour="brifing" className="h-full">
      <FadeSwap swapKey={swapKey} className="h-full">
        <Dikkat ctx={ctx} params={params} maxItems={5} />
      </FadeSwap>
    </div>
  );
  const gelir =
    layout.revenueChart && ctx.canSeeCommissions ? (
      <Suspense fallback={<PanelIskelet rows={5} className="h-full min-h-[22rem]" />}>
        <GelirEgrisi ctx={ctx} />
      </Suspense>
    ) : null;
  const brifing = (eyebrow?: string, maxRows?: number) => (
    <div data-tour="brifing" className="h-full">
      <Brifing ctx={ctx} params={params} eyebrow={eyebrow} maxRows={maxRows} />
    </div>
  );
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
  const program = (
    <Suspense fallback={<PanelIskelet rows={3} className="min-h-[15rem]" />}>
      <Program ctx={ctx} />
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
  // "Bugün ara" iki yerde: arama merkezinin ilk ekranı (kapı sınırında) ve danışmanın "Özetim" bölümü (kendi sınırı).
  const araNode = <DanismanAra ctx={ctx} />;
  const ara = <Suspense fallback={<DanismanAraIskelet />}>{araNode}</Suspense>;
  const gider = (
    <Suspense fallback={<PanelIskelet rows={4} className="min-h-[14rem]" />}>
      <GiderOzeti ctx={ctx} />
    </Suspense>
  );

  const bottomNode = (key: (typeof layout.bottom)[number]): ReactNode => {
    switch (key) {
      case "program":
        return program;
      case "gorevler":
        return gorevler;
      case "kisisel-hedef":
        return kisiselHedef;
      case "gider-ozeti":
        return ctx.canSeeExpenses ? gider : null;
    }
  };
  const BOTTOM_WIDGET: Record<string, string | undefined> = { program: "program", "kisisel-hedef": "kisisel-hedef", "gider-ozeti": "gider" };

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
  /** Ertelenmiş satırın yer tutucusu (aynı ızgara + span; `aria-busy` taşımaz). Kapı sınırının yedeği de bunu kullanır. */
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
      <DeferredSection
        key={key}
        label="Ek bloklar"
        fallback={deferredSkeleton(`${key}-f`, live, cls)}
      >
        {/* stagger kapalı: iskelet yerini alan içerik sıfır opaklıktan tekrar belirmez (çift yükleme hissi). */}
        <DashboardGrid className={cls} stagger={false}>{live.map((it, i) => cell(it.span, it.node, `${key}-${i}`))}</DashboardGrid>
      </DeferredSection>
    );
  };
  const widgetWrap = (id: string | undefined, node: ReactNode) => (id ? <Widget id={id} className="h-full">{node}</Widget> : node);

  /** "Bugün" yüzeyinde kalan alt bloklar (program, görevler); kişisel hedef ve gider özeti "Ofis özeti"ne gider. */
  const TODAY_BOTTOM = new Set<string>(["program", "gorevler"]);
  const bottomItemsBy = (span: 4 | 6 | 12, today: boolean): DeferredItem[] =>
    layout.bottom.flatMap((k) => {
      if (TODAY_BOTTOM.has(k) !== today) return [];
      const node = bottomNode(k);
      return node ? [{ span, node: widgetWrap(BOTTOM_WIDGET[k], node) }] : [];
    });
  /** Sağ sütun: büyük kısayol kartları (+ yönetimde "Bugün ofiste olanlar"). */
  const side = (
    <div className="flex h-full flex-col gap-4">
      <div data-tour="kisayollar">
        <BugunKisayol ctx={ctx} />
      </div>
      {layout.variant === "management" ? <BugunOfiste ctx={ctx} params={params} /> : null}
    </div>
  );
  const sideSkeleton = (
    <div className="flex h-full flex-col gap-4">
      <BugunKisayolIskelet />
      {layout.variant === "management" ? <PanelIskelet rows={3} className="min-h-[10rem]" /> : null}
    </div>
  );
  // "Ofis özeti" (varsayılan kapalı): KPI, gelir eğrisi, ekip, huni, ilan sağlığı ve "Daha fazla" blokları.
  const ozetRows: ReactNode[] = [];
  /** Kapı sınırının yedeği: "Bugün" satırlarıyla AYNI ızgara ve span'lar (iskelet → içerik düzen sıçraması yok). */
  const skeletonRows: ReactNode[] = [];

  switch (layout.variant) {
    case "management":
      rows.push(grid("r1", [cell(7, dikkat, "dikkat"), cell(5, side, "side")]), deferredGrid("r2", bottomItemsBy(6, true)));
      skeletonRows.push(grid("r1-sk", [cell(7, <DikkatIskelet />, "dikkat"), cell(5, sideSkeleton, "side")]), deferredSkeleton("r2-sk", bottomItemsBy(6, true)));
      ozetRows.push(
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
    case "advisor":
    case "team_lead":
      rows.push(grid("r1", [cell(7, brifing("Sıradaki eylem", 2), "brifing"), cell(5, side, "side")]), deferredGrid("r2", bottomItemsBy(6, true)));
      skeletonRows.push(grid("r1-sk", [cell(7, <BrifingIskelet />, "brifing"), cell(5, sideSkeleton, "side")]), deferredSkeleton("r2-sk", bottomItemsBy(6, true)));
      ozetRows.push(
        layout.callList ? grid("o1", [cell(12, ara, "ara", { widget: "ara" })]) : null,
        ...(layout.team && !off("team_perf") ? [deferredGrid("ot", [{ span: 12, node: widgetWrap("ekip-perf", ekip) }])] : []),
        deferredGrid("o2", bottomItemsBy(4, false)),
      );
      break;
    case "accounting":
      rows.push(grid("r1", [cell(12, <Tahsilat ctx={ctx} />, "tahsilat")]));
      skeletonRows.push(grid("r1-sk", [cell(12, <TahsilatIskelet />, "tahsilat")]));
      ozetRows.push(deferredGrid("o2", bottomItemsBy(12, false)), deferredGrid("o2b", bottomItemsBy(12, true)));
      break;
    case "call_center":
      rows.push(grid("r1", [cell(12, araNode, "ara", { widget: "ara" })]));
      skeletonRows.push(grid("r1-sk", [cell(12, <DanismanAraIskelet />, "ara")]));
      ozetRows.push(deferredGrid("o2", bottomItemsBy(12, false)), deferredGrid("o2b", bottomItemsBy(12, true)));
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
          <AnaHero ctx={ctx} layout={layout} params={params} officeView={officeView} hasName={Boolean(fullName)} />
          <NeYapmak chips={neYapmakChips(layout.variant, role === "owner")} />
          {layout.statusBar ? (
            <DurumCubugu>
              {/* En çok 2 bant, öncelik sırasıyla: analiz bakiyesi (para/engel) > hoş geldin kredisi. Kurulum, profil, örnek veri ve duyurular
                  burada DEĞİL: Başlangıç kartı / Bildirimler > Duyurular. */}
              <Suspense fallback={null}>
                <KontorBandi ctx={ctx} valuationClosed={off("valuation")} />
                <HosgeldinKredisi ctx={ctx} />
              </Suspense>
            </DurumCubugu>
          ) : null}
        </div>

        {/* TEK sınır: Başlangıç kartı + boş ofis kapısı + "Bugün" ilk ekran blokları birlikte açılır. Yedek, gerçek düzenle
            aynıdır ("Bugün" başlığı metin olarak + aynı ızgarada blok iskeletleri + özet düğmesi yeri). */}
        <Suspense
          fallback={
            <div className="flex min-w-0 flex-col gap-5">
              <section aria-label="Bugün" className="flex flex-col gap-3">
                <h2 className="font-display text-lg font-bold text-text">Bugün</h2>
                {skeletonRows}
              </section>
              <Skeleton className="h-11 w-72 max-w-full rounded-full" />
            </div>
          }
        >
          {/* Tek "Başlangıç" kartı: ofis profili + örnek veri durumu + ilk adımlar; tamamlanınca kaybolur */}
          <BaslangicKarti ctx={ctx} />
          {/* Müşteri + portföy yokken tüm dolu bloklar gizlenir; yerinde Başlangıç kartı ilk adımları gösterir */}
          <BosOfisKapisi ctx={ctx}>
            <div className="flex min-w-0 flex-col gap-5">
              <section aria-label="Bugün" className="flex flex-col gap-3">
                <h2 className="font-display text-lg font-bold text-text">Bugün</h2>
                {rows}
              </section>

              {/* Ofis özeti: KPI, gelir eğrisi, ekip, huni — varsayılan kapalı (yalnız açılınca sunucuda çizilir). */}
              <section aria-label={ozetTitle} className="flex flex-col gap-4">
                <Link
                  href={homeHref(params, { ozet: ozetOpen ? undefined : "1", daha: ozetOpen ? undefined : params.daha })}
                  scroll={false}
                  aria-expanded={ozetOpen}
                  className="focus-ring press inline-flex h-11 items-center gap-2 self-start rounded-full border border-hairline bg-surface-raised px-5 text-sm font-semibold text-text shadow-[var(--elev-1)] transition hover:bg-surface-hover"
                >
                  {ozetOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                  {ozetOpen ? `${ozetTitle} bölümünü kapat` : `${ozetTitle} (rakamlar, gelir, ekip)`}
                </Link>
                {ozetOpen ? (
                  <div className="flex min-w-0 flex-col gap-5">
                    {kpis}
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
                    className="focus-ring press inline-flex h-10 touch:h-11 items-center gap-2 self-start rounded-full border border-hairline bg-surface-raised px-4 text-sm font-semibold text-text shadow-[var(--elev-1)] transition hover:bg-surface-hover"
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
