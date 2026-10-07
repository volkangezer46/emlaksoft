import { ShortcutBar } from "@/components/ui/shortcut-bar";
import { Suspense, type ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { resolveScope, SCOPE_COOKIE } from "@/lib/ui/scope";
import { ChevronDown, ChevronUp } from "lucide-react";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { getRequestSampleScope } from "@/lib/cache/request";
import type { SampleKpiScope } from "@/lib/sample-scope";
import { measure } from "@/lib/server-timing";
import { requireModulePage } from "@/lib/require-module-page";
import { getClosedFeatures } from "@/lib/modules/state";
import type { FeatureKey } from "@/lib/modules/registry";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { DashboardGrid, DashCell, DashboardStack } from "@/components/ui/dashboard-grid";
import { DeferredSection } from "@/components/ui/deferred-section";
// Doğrudan dosyadan: `ui/motion` barrel'ı Reveal/MotionProvider (motion çekirdeği ~19 KB) ile birlikte gelir; FadeSwap 0 KB CSS.
import { FadeSwap } from "@/components/ui/motion/fade-swap";
import { parsePeriod } from "@/components/ui/premium";
import { loadShouldShowWelcome } from "@/lib/welcome-state";
import { DashboardWidgetProvider, Widget } from "./dashboard-widgets";
import { buildHomeBounds, type HomeCtx } from "./_home/data";
import { preloadDashboardSnapshot } from "./_home/data-batch";
import { BlokIskelet, PanelIskelet } from "./_home/ortak";
import { OrnekVeriYenileBandi, HosgeldinKredisi, YetkiUyari } from "./_home/ust-bolum";
import { AnaHero } from "./_home/ana-hero";
import { DurumCubugu } from "./_home/durum-cubugu";
import { KontorBandi } from "./_home/kontor-bandi";
import { BosOfisKapisi, KurulumSeridi } from "./_home/baslayalim";
import { DuyuruSatiri } from "./_home/duyuru-satiri";
import { Gorevler } from "./_home/gorevler";
import { KayipKacak } from "./_home/kayip-kacak";
import { PortfoySagligi } from "./_home/portfoy-sagligi";
import { KiralamaProje } from "./_home/kiralama-proje";
import { PortalSagligi } from "./_home/portal-ekip";
import { CanliAkis } from "./_home/canli-akis";
import { HizliAksiyonlar } from "./_home/musteriler-hizli";
import { PortfoySeridi } from "./_home/portfoy-seridi";
import { KaynakDagilimi } from "./_home/kaynak-dagilimi";
import { Brifing, BrifingIskelet } from "./_home/brifing";
import { Dikkat, DikkatIskelet } from "./_home/dikkat";
import { GelirEgrisi } from "./_home/gelir-egrisi";
import { MetrikSeridi, MetrikSeridiIskelet } from "./_home/metrik-seridi";
import { EkipPerformans, EkipPerformansIskelet } from "./_home/ekip-performans";
import { HuniHedef, HuniHedefIskelet, KisiselHedef } from "./_home/huni-hedef";
import { Program } from "./_home/program";
import { DanismanAra, DanismanAraIskelet } from "./_home/danisman-ara";
import { Tahsilat, TahsilatIskelet } from "./_home/tahsilat";
import { GiderOzeti } from "./_home/gider-ozeti";
import { OfisNabzi } from "./_home/ofis-nabzi";
import { homeHref, type HomeParams } from "./_home/kapsam-anahtari";
import { homeLayoutFor, type MoreBlock } from "./_home/home-layout";

export const metadata = { title: "Ana ekran" };

/**
 * "Bugün" ana ekranı — tasarım sistemi v4 (referans: /admin kontrol paneli). Sayfa yalnız yetki + bağlam + ROL YERLEŞİMİ
 * (`_home/home-layout.ts`, saf) kurar; her blok `_home/*` içinde kendi verisini yükler ve kendi <Suspense> sınırında,
 * içerik yüksekliğinde iskeletle akar (CLS yok).
 *
 * Her rol: DashboardHero (tarih · rol bağlamı, selamlama, tek cümle öncelik, tazelik, dönem/kapsam seçici) → durum çubuğu
 * → KpiGrid (dönem/kapsam değişince FadeSwap). Ardından:
 *  - Yönetim: Dikkat gerektirenler + içgörüler (7) | Komisyon geliri eğrisi (5) → Ekip performansı (7) | Satış hunisi +
 *    ofis hedefi (5) → Program / Görevler / Kaçan komisyon → "Daha fazla" (varsayılan kapalı).
 *  - Danışman: Sıradaki eylem (7) + Bugün ara (5) → Program / Görevler / Kişisel hedef. Takım lideri: + ekip tablosu.
 *  - Muhasebe: Tahsilat odağı + gider özeti. Arama merkezi: Bugün ara + görevler.
 * Ekran altı satırlar DeferredSection ile görünür alana yaklaşınca bağlanır. Reveal (motion `m.*`) burada bilinçli
 * olarak YOK: /app ilk yük bütçesi (≤ 5 KB) motion çekirdeğini (~19 KB) kaldırmaz; giriş CSS'tir (list-stagger, FadeSwap).
 */
export default async function AppHomePage({
  searchParams,
}: {
  searchParams?: Promise<{ tv?: string; donem?: string; kapsam?: string; daha?: string; icgoru?: string }>;
}) {
  // searchParams ile oturum/yetki kapısı birbirinden bağımsız: aynı turda.
  const [sp, gate] = await Promise.all([searchParams, measure("home-gate", () => requireModulePage("dashboard"))]);
  const { tv = "", donem, kapsam, daha, icgoru } = sp ?? {};
  // Eski `/app?tv=1` bağlantıları tek TV rotasına gider (kabuksuz, canlı, tam ekran).
  if (tv === "1") redirect("/app/pano-tv");

  const { tenantId, perms, role, userId } = gate;
  // Anlık görüntü RPC turu (içgörü/metrik/görev) bloklar çizilmeye başlamadan BAŞLAR; bloklar cache'ten okur.
  preloadDashboardSnapshot(tenantId, userId);
  // Hoş geldin kapısı, kapalı modüller, örnek veri kapsamı ve kullanıcı birbirinden bağımsız: TEK turda.
  const [showWelcome, closedFeatures, sample, user] = await measure("home-ctx", () =>
    Promise.all([
      tenantId ? loadShouldShowWelcome(userId, role) : Promise.resolve(false),
      getClosedFeatures(tenantId),
      getRequestSampleScope(tenantId) as Promise<SampleKpiScope>,
      getRequestUser(),
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
  const { scope, explicit: kapsamParam } = resolveScope({ canSwitch: isManagement, param: kapsam, cookie: (await cookies()).get(SCOPE_COOKIE)?.value });
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
    period: parsePeriod(donem),
    fullName,
    firstName: fullName.split(" ")[0] || "hoş geldiniz",
    ...buildHomeBounds(),
  };

  const params: HomeParams = {
    donem: donem && donem !== "30" ? donem : undefined,
    kapsam: kapsamParam ?? undefined,
    daha: daha === "1" ? "1" : undefined,
    icgoru: icgoru === "tum" ? "tum" : undefined,
  };
  const moreOpen = daha === "1";
  const swapKey = `${ctx.period}-${officeView ? "ofis" : "ben"}`;

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
        <Suspense fallback={<MetrikSeridiIskelet rows={layout.metrics.length} caption={isManagement} />}>
          <FadeSwap swapKey={swapKey}>
            <MetrikSeridi ctx={ctx} keys={layout.metrics} />
          </FadeSwap>
        </Suspense>
      </div>
    );
  const dikkat = (
    <div data-tour="brifing" className="h-full">
      <Suspense fallback={<DikkatIskelet />}>
        <FadeSwap swapKey={swapKey} className="h-full">
          <Dikkat ctx={ctx} params={params} />
        </FadeSwap>
      </Suspense>
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
      <Suspense fallback={<BrifingIskelet />}>
        <Brifing ctx={ctx} params={params} eyebrow={eyebrow} maxRows={maxRows} />
      </Suspense>
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
  const risk = (
    <Suspense fallback={<PanelIskelet />}>
      <KayipKacak ctx={ctx} />
    </Suspense>
  );
  const kisiselHedef = (
    <Suspense fallback={<PanelIskelet rows={2} className="min-h-[13rem]" />}>
      <KisiselHedef ctx={ctx} />
    </Suspense>
  );
  const ara = (
    <Suspense fallback={<DanismanAraIskelet />}>
      <DanismanAra ctx={ctx} />
    </Suspense>
  );
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
      case "risk":
        return off("leak") ? null : risk;
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
      <DashboardGrid key={key} className={cls}>
        {cells}
      </DashboardGrid>
    );
  /**
   * Ekran-altı satır: ilk HTML'de aynı ızgarada iskelet; gerçek bloklar görünür alana yaklaşınca bağlanır
   * (DeferredSection). Veri yine sunucuda hazırlanır; yalnız istemci bağlama/hidrasyon maliyeti ertelenir.
   * İskelet hücreleri gerçek hücrelerle aynı span'ı taşır (CLS=0).
   */
  type DeferredItem = { span: 3 | 4 | 5 | 6 | 7 | 8 | 12; node: ReactNode };
  const deferredGrid = (key: string, items: DeferredItem[], cls?: string) => {
    const live = items.filter((it) => it.node !== null && it.node !== undefined);
    if (live.length === 0) return null;
    return (
      <DeferredSection
        key={key}
        label="Ek bloklar"
        fallback={
          <DashboardGrid className={cls}>
            {live.map((it, i) => cell(it.span, <PanelIskelet rows={3} className="min-h-[15rem]" />, `${key}-sk-${i}`))}
          </DashboardGrid>
        }
      >
        <DashboardGrid className={cls}>{live.map((it, i) => cell(it.span, it.node, `${key}-${i}`))}</DashboardGrid>
      </DeferredSection>
    );
  };
  const widgetWrap = (id: string | undefined, node: ReactNode) => (id ? <Widget id={id} className="h-full">{node}</Widget> : node);
  const bottomItems = (span: 4 | 6 | 12): DeferredItem[] =>
    layout.bottom.flatMap((k) => {
      const node = bottomNode(k);
      return node ? [{ span, node: widgetWrap(BOTTOM_WIDGET[k], node) }] : [];
    });

  switch (layout.variant) {
    case "management":
      rows.push(
        grid("r1", gelir ? [cell(7, dikkat, "dikkat"), cell(5, gelir, "gelir", { widget: "gelir" })] : [cell(12, dikkat, "dikkat")]),
        <Suspense key="nabiz" fallback={null}><OfisNabzi ctx={ctx} /></Suspense>,
        deferredGrid("r2", [
          ...(layout.team && !off("team_perf") ? [{ span: 7 as const, node: widgetWrap("ekip-perf", ekip) }] : []),
          ...(layout.funnelTarget && !off("team_perf") ? [{ span: 5 as const, node: widgetWrap("huni-hedef", huniHedef) }] : []),
        ]),
        deferredGrid("r3", bottomItems(4)),
      );
      break;
    case "advisor":
    case "team_lead":
      rows.push(
        grid("r1", [
          cell(7, brifing("Sıradaki eylem", 2), "brifing"),
          ...(layout.callList ? [cell(5, ara, "ara", { widget: "ara" })] : []),
        ]),
        ...(layout.team && !off("team_perf") ? [deferredGrid("rt", [{ span: 12, node: widgetWrap("ekip-perf", ekip) }])] : []),
        deferredGrid("r2", bottomItems(4)),
      );
      break;
    case "accounting":
      rows.push(
        grid("r1", [
          cell(
            12,
            <Suspense fallback={<TahsilatIskelet />}>
              <Tahsilat ctx={ctx} />
            </Suspense>,
            "tahsilat",
          ),
        ]),
        deferredGrid("r2", bottomItems(12)),
      );
      break;
    case "call_center":
      rows.push(grid("r1", [cell(12, ara, "ara", { widget: "ara" })]), deferredGrid("r2", bottomItems(12)));
      break;
  }

  /* ------------------------ "Daha fazla" (varsayılan kapalı) ------------------------ */
  const MORE_SPAN: Record<MoreBlock, 4 | 5 | 7 | 12> = {
    "canli-akis": 7,
    "portal-sagligi": 5,
    "kaynak-dagilimi": 4,
    yetki: 12,
    portfoy: 12,
    kiralama: 12,
    hizli: 12,
  };
  const moreNode = (key: MoreBlock): { node: ReactNode; className?: string } | null => {
    switch (key) {
      case "yetki":
        return { node: <Suspense fallback={null}><YetkiUyari ctx={ctx} /></Suspense>, className: "empty:hidden" };
      case "portfoy":
        return { node: <Suspense fallback={null}><PortfoySeridi ctx={ctx} /></Suspense>, className: "empty:hidden" };
      case "kiralama":
        return { node: <Suspense fallback={null}><KiralamaProje ctx={ctx} /></Suspense>, className: "empty:hidden" };
      case "canli-akis":
        return { node: <Suspense fallback={<BlokIskelet className="h-80" />}><CanliAkis ctx={ctx} auditLink={layout.auditLink} /></Suspense> };
      case "portal-sagligi":
        return off("portals") ? null : { node: <Suspense fallback={<PanelIskelet />}><PortalSagligi ctx={ctx} /></Suspense> };
      case "kaynak-dagilimi":
        return { node: <Suspense fallback={<PanelIskelet />}><KaynakDagilimi ctx={ctx} /></Suspense> };
      case "hizli":
        return { node: <HizliAksiyonlar /> };
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
          {layout.statusBar ? (
            <DurumCubugu>
              <Suspense fallback={null}>
                <OrnekVeriYenileBandi ctx={ctx} />
              </Suspense>
              <Suspense fallback={null}>
                <KontorBandi ctx={ctx} valuationClosed={off("valuation")} />
              </Suspense>
              <Suspense fallback={null}>
                <KurulumSeridi ctx={ctx} />
              </Suspense>
              <Suspense fallback={null}>
                <HosgeldinKredisi ctx={ctx} />
              </Suspense>
              <Suspense fallback={null}>
                <DuyuruSatiri />
              </Suspense>
            </DurumCubugu>
          ) : null}
        </div>

        {/* Müşteri + portföy yokken tüm dolu bloklar yerine tek "Başlayalım" kartı */}
        <Suspense fallback={<PanelIskelet rows={2} />}>
          <BosOfisKapisi ctx={ctx}>
            <div className="flex min-w-0 flex-col gap-5">
              {kpis}
              {rows}
              {off("portals") ? null : <PortfoySagligi ctx={ctx} />}

              {moreCells.length > 0 ? (
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
                        <DashboardGrid>
                          {layout.more.map((k) => cell(MORE_SPAN[k], <PanelIskelet rows={3} className="min-h-[15rem]" />, `m-sk-${k}`))}
                        </DashboardGrid>
                      }
                    >
                      <DashboardGrid>{moreCells}</DashboardGrid>
                    </DeferredSection>
                  ) : null}
                </section>
              ) : null}
            </div>
          </BosOfisKapisi>
        </Suspense>
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
