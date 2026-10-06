import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { createClient } from "@/lib/supabase/server";
import { loadSampleKpiScope } from "@/lib/sample-scope";
import { requireModulePage } from "@/lib/require-module-page";
import { getClosedFeatures } from "@/lib/modules/state";
import type { FeatureKey } from "@/lib/modules/registry";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { DashboardGrid, DashCell, DashboardStack } from "@/components/ui/dashboard-grid";
import { parsePeriod } from "@/components/ui/premium";
import { loadShouldShowWelcome } from "@/lib/welcome-state";
import { DashboardWidgetProvider, Widget } from "./dashboard-widgets";
import { buildHomeBounds, type HomeCtx } from "./_home/data";
import { BlokIskelet, PanelIskelet } from "./_home/ortak";
import { OrnekVeri, OrnekVeriYenileBandi, HosgeldinKredisi, YetkiUyari } from "./_home/ust-bolum";
import { UstSatir } from "./_home/ust-satir";
import { DurumCubugu } from "./_home/durum-cubugu";
import { KontorBandi } from "./_home/kontor-bandi";
import { BosOfisKapisi, KurulumSeridi } from "./_home/baslayalim";
import { DuyuruSatiri } from "./_home/duyuru-satiri";
import { BugunOzet } from "./_home/bugun-ozet";
import { Gorevler } from "./_home/gorevler";
import { KayipKacak } from "./_home/kayip-kacak";
import { KiralamaProje } from "./_home/kiralama-proje";
import { PortalSagligi } from "./_home/portal-ekip";
import { CanliAkis } from "./_home/canli-akis";
import { HizliAksiyonlar } from "./_home/musteriler-hizli";
import { PortfoySeridi } from "./_home/portfoy-seridi";
import { KaynakDagilimi } from "./_home/kaynak-dagilimi";
import { KararBekleyenler, KararBekleyenlerIskelet } from "./_home/karar-bekleyenler";
import { Brifing, BrifingIskelet } from "./_home/brifing";
import { MetrikSeridi, MetrikSeridiIskelet } from "./_home/metrik-seridi";
import { EkipPerformans, EkipPerformansIskelet } from "./_home/ekip-performans";
import { HuniHedef, HuniHedefIskelet, KisiselHedef } from "./_home/huni-hedef";
import { Program } from "./_home/program";
import { DanismanAra, DanismanAraIskelet } from "./_home/danisman-ara";
import { Tahsilat, TahsilatIskelet } from "./_home/tahsilat";
import { GiderOzeti } from "./_home/gider-ozeti";
import { homeHref, type HomeParams } from "./_home/kapsam-anahtari";
import { homeLayoutFor, riskShowsTeyit, type MoreBlock } from "./_home/home-layout";

export const metadata = { title: "Ana ekran" };

/**
 * "Bugün" ana ekranı. Sayfa yalnız yetki + bağlam + ROL YERLEŞİMİ (`_home/home-layout.ts`, saf) kurar; her blok
 * `_home/*` içinde kendi verisini yükler ve kendi <Suspense> sınırında, içerik yüksekliğinde iskeletle akar (CLS yok).
 *
 * Yönetim (xl, 12 kolon): ince başlık satırı -> tek Durum çubuğu -> Brifing odağı (8) + Karar bekleyenler/Metrik şeridi (4)
 * -> Ekip performansı (7) + Huni/Hedef (5) -> Program / Görevler / Kaçan komisyon (4+4+4) -> "Daha fazla" (varsayılan kapalı).
 * Danışman: Sıradaki eylem (7) + Bugün ara (5) -> Program / Görevler / Kişisel hedef -> Metrikler. Takım lideri: + ekip tablosu.
 * Muhasebe: Tahsilat odağı + metrikler + gider özeti. Arama merkezi: Bugün ara + arama/yanıt metrikleri + görevler.
 * İçgörü yoksa brifing kural tabanlı "Sıradaki eylem"e düşer (sahte içgörü üretilmez).
 */
export default async function AppHomePage({
  searchParams,
}: {
  searchParams?: Promise<{ tv?: string; donem?: string; kapsam?: string; daha?: string; icgoru?: string }>;
}) {
  const { tv = "", donem, kapsam, daha, icgoru } = (await searchParams) ?? {};
  // Eski `/app?tv=1` bağlantıları tek TV rotasına gider (kabuksuz, canlı, tam ekran).
  if (tv === "1") redirect("/app/pano-tv");

  const { tenantId, perms, role, userId } = await requireModulePage("dashboard");
  // Yeni danışman ilk girişinde kısa "Hoş geldin" akışına yönlenir (bir kez; çerez tercihi).
  if (tenantId && (await loadShouldShowWelcome(userId, role))) redirect("/app/hos-geldin");
  // Kapalı modüllerin ana ekran blokları çizilmez (tek kapı: lib/modules/state).
  const closedFeatures = await getClosedFeatures(tenantId);
  const off = (key: FeatureKey) => closedFeatures.includes(key);
  const user = await getRequestUser();
  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? "";

  const isManagement = hasOfficeWideDataScope(role);
  const layout = homeLayoutFor(role);
  // Kapsam: varsayılan "ben"; yalnız yönetim rolleri ?kapsam=ofis ile ofis geneline açabilir.
  const officeView = isManagement && kapsam === "ofis";

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
    sample: await loadSampleKpiScope(await createClient(), tenantId),
    period: parsePeriod(donem),
    fullName,
    firstName: fullName.split(" ")[0] || "hoş geldiniz",
    ...buildHomeBounds(),
  };

  const params: HomeParams = {
    donem: donem && donem !== "30" ? donem : undefined,
    kapsam: officeView ? "ofis" : undefined,
    daha: daha === "1" ? "1" : undefined,
    icgoru: icgoru === "tum" ? "tum" : undefined,
  };
  const moreOpen = daha === "1";

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
  const brifing = (eyebrow?: string, maxRows?: number) => (
    <Suspense fallback={<BrifingIskelet />}>
      <Brifing ctx={ctx} params={params} eyebrow={eyebrow} maxRows={maxRows} />
    </Suspense>
  );
  const karar =
    layout.decisions && !(off("approvals") && off("offers")) ? (
      <Suspense fallback={<KararBekleyenlerIskelet />}>
        <KararBekleyenler ctx={ctx} />
      </Suspense>
    ) : null;
  const metrik = (wide = false, title?: string) =>
    layout.metrics.length === 0 ? null : (
      <Suspense fallback={<MetrikSeridiIskelet rows={layout.metrics.length} />}>
        <MetrikSeridi ctx={ctx} keys={layout.metrics} wide={wide} title={title} />
      </Suspense>
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
      <KayipKacak ctx={ctx} showTeyit={riskShowsTeyit(layout)} />
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
  const bottomCells = (span: 4 | 6 | 12) =>
    layout.bottom.flatMap((k) => {
      const node = bottomNode(k);
      return node ? [cell(span, node, `b-${k}`, { widget: BOTTOM_WIDGET[k] })] : [];
    });

  /* ----------------- Ana (varsayılan görünür) satırlar — rol yerleşimi ----------------- */
  const rows: ReactNode[] = [];
  const grid = (key: string, cells: ReactNode[], cls?: string) =>
    cells.length === 0 ? null : (
      <DashboardGrid key={key} className={cls}>
        {cells}
      </DashboardGrid>
    );

  switch (layout.variant) {
    case "management":
      rows.push(
        grid(
          "r1",
          [
            cell(8, brifing(), "brifing"),
            cell(
              4,
              <div className="flex flex-col gap-4">
                {karar}
                {metrik()}
              </div>,
              "karar-metrik",
            ),
          ],
          "items-start",
        ),
        grid("r2", [
          ...(layout.team && !off("team_perf") ? [cell(7, ekip, "ekip", { widget: "ekip-perf" })] : []),
          ...(layout.funnelTarget && !off("team_perf") ? [cell(5, huniHedef, "huni-hedef", { widget: "huni-hedef" })] : []),
        ]),
        grid("r3", bottomCells(4)),
      );
      break;
    case "advisor":
    case "team_lead":
      rows.push(
        grid("r1", [
          cell(7, brifing("Sıradaki eylem", 2), "brifing"),
          ...(layout.callList ? [cell(5, ara, "ara", { widget: "ara" })] : []),
        ]),
        ...(layout.team && !off("team_perf") ? [grid("rt", [cell(12, ekip, "ekip", { widget: "ekip-perf" })])] : []),
        grid("r2", bottomCells(4)),
        grid("r3", [cell(12, metrik(true), "metrik", { widget: "metrik" })]),
      );
      break;
    case "accounting":
      rows.push(
        grid(
          "r1",
          [
            cell(
              8,
              <Suspense fallback={<TahsilatIskelet />}>
                <Tahsilat ctx={ctx} />
              </Suspense>,
              "tahsilat",
            ),
            cell(4, metrik(), "metrik", { widget: "metrik" }),
          ],
          "items-start",
        ),
        grid("r2", bottomCells(6)),
      );
      break;
    case "call_center":
      rows.push(
        grid("r1", [cell(8, ara, "ara", { widget: "ara" }), cell(4, metrik(), "metrik", { widget: "metrik" })], "items-start"),
        grid("r2", bottomCells(12)),
      );
      break;
  }

  /* ------------------------ "Daha fazla" (varsayılan kapalı) ------------------------ */
  const MORE_SPAN: Record<MoreBlock, 4 | 5 | 7 | 12> = {
    kuyruk: 5,
    "canli-akis": 7,
    "portal-sagligi": 4,
    "kaynak-dagilimi": 4,
    yetki: 12,
    portfoy: 12,
    kiralama: 12,
    hizli: 12,
  };
  const moreNode = (key: MoreBlock): { node: ReactNode; className?: string } | null => {
    switch (key) {
      case "kuyruk":
        // AI özet cümlesi (generateBriefingSummary) ve kural tabanlı kuyruk burada; tenant guard bugun-ozet.tsx içinde.
        return { node: <Suspense fallback={<BlokIskelet className="h-[24rem]" />}><BugunOzet ctx={ctx} /></Suspense> };
      case "yetki":
        return { node: <Suspense fallback={null}><YetkiUyari ctx={ctx} /></Suspense>, className: "empty:hidden" };
      case "portfoy":
        return { node: <Suspense fallback={null}><PortfoySeridi ctx={ctx} /></Suspense>, className: "empty:hidden" };
      case "kiralama":
        return { node: <Suspense fallback={null}><KiralamaProje ctx={ctx} /></Suspense>, className: "empty:hidden" };
      case "canli-akis":
        return { node: <Suspense fallback={<BlokIskelet className="h-80" />}><CanliAkis ctx={ctx} /></Suspense> };
      case "portal-sagligi":
        return off("portals") ? null : { node: <Suspense fallback={<PanelIskelet />}><PortalSagligi /></Suspense> };
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
        <div className="flex flex-col">
          <UstSatir ctx={ctx} layout={layout} params={params} officeView={officeView} hasName={Boolean(fullName)} />
          {layout.statusBar ? (
            <DurumCubugu>
              <Suspense fallback={null}>
                <OrnekVeri ctx={ctx} />
              </Suspense>
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
            <div className="flex flex-col gap-6">
              {rows}

              {moreCells.length > 0 ? (
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
                  {moreOpen ? <DashboardGrid>{moreCells}</DashboardGrid> : null}
                </section>
              ) : null}
            </div>
          </BosOfisKapisi>
        </Suspense>
      </DashboardStack>
    </DashboardWidgetProvider>
  );
}
