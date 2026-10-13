import { Activity, BarChart3, CreditCard, Megaphone, Target, UserPlus } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatRow } from "@/components/ui/stat-row";
import { FunnelChart, type FunnelStage } from "@/components/ui/viz";
import { now } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { PERIODS, coverageRate, parsePeriod, pctText, periodRange, readGrowthFunnel, type GrowthFunnel } from "@/lib/growth-analytics/funnel";
import { landingTable } from "@/lib/growth-analytics/landing";
import { loadMeasureHealth } from "@/lib/measure/collector";
import { requirePlatformModule } from "@/lib/platform";
import { listNotFound } from "@/lib/seo/store";
import { readSitePageIndex } from "@/lib/site-pages/store";
import { ChannelTable, HealthCard, LandingTable, LostTraffic } from "./_huni/sections";
import { MeasureSettingsForm } from "./_huni/measure-settings-form";

export const metadata = { title: "Huni ve kanallar" };

type SP = { gun?: string };

const EMPTY_TEXT = "Ölçüm 13.10'da başladı; ilk veriler yarın";

/**
 * Huni ve kanallar: ziyaret → kayıt → ilk ilan → ödeme, kanal başına; iniş yolları, kayıp trafik (404), atıf
 * kapsaması, ölçüm sağlığı ve ayarlar. Yalnız toplanmış veriyi okur (tek huni RPC'si + önceki dönem + 404 listesi +
 * sayfa dizini paralel). Modül: şimdilik `seo` (SP5'in `reklam` modülü S1 dikişinde bağlanır).
 */
export default async function AdminFunnelPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const staff = await requirePlatformModule("seo");
  const sp = (await searchParams) ?? {};
  const days = parsePeriod(sp.gun);
  const { cur, prev } = periodRange(days, now());

  const [curRes, prevRes, pages, lost, health] = await Promise.all([
    readGrowthFunnel(cur.from, cur.to),
    readGrowthFunnel(prev.from, prev.to),
    readSitePageIndex().catch(() => []),
    listNotFound(10),
    loadMeasureHealth(),
  ]);
  const funnel: GrowthFunnel | null = curRes.ok ? curRes.data : null;
  const prevFunnel: GrowthFunnel | null = prevRes.ok ? prevRes.data : null;
  const hasData = Boolean(funnel && (funnel.hasPageviews || funnel.totals.signups > 0));
  const coverage = coverageRate(funnel);
  const tenants = `/admin/tenants?yeni=${days}`;

  const stages: FunnelStage[] = funnel
    ? [
        ...(funnel.visitsTotal !== null ? [{ label: "Ziyaret", value: funnel.visitsTotal, href: "#inis-yollari" }] : []),
        { label: "Kayıt", value: funnel.totals.signups, href: tenants },
        { label: "İlk ilan", value: funnel.totals.activated, href: tenants },
        { label: "Ödeyen", value: funnel.totals.paid, href: `${tenants}&durum=active` },
      ]
    : [];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Site, SEO ve Reklam"
        icon={Megaphone}
        title="Huni ve kanallar"
        description="Ziyaretçi nereden geliyor, kaçı kayıt oluyor, kaçı ilk ilanını giriyor ve kaçı ödüyor? Sayaç çerezsizdir; IP ve kişisel veri saklanmaz."
        actions={
          <SegmentedControl
            label="Dönem"
            value={String(days)}
            options={PERIODS.map((d) => ({ value: String(d), label: `${d} gün`, href: `/admin/site/reklam?gun=${d}` }))}
          />
        }
      />

      {!curRes.ok && curRes.reason === "missing" ? (
        <EmptyState
          icon={BarChart3}
          title="Ölçüm henüz kurulmadı"
          description="Huni verisi için sistem güncellemesi (veritabanı) bekleniyor. Kurulunca ziyaret ve kayıt kaynakları burada görünür."
          illustration="start"
        />
      ) : !funnel ? (
        <EmptyState icon={BarChart3} title="Huni verisi okunamadı" description="Birkaç dakika sonra sayfayı yenileyin." illustration="error" />
      ) : !hasData ? (
        <EmptyState icon={BarChart3} title={EMPTY_TEXT} description="Herkese açık sayfaların ziyaretleri ve yeni kayıtların kaynağı ilk tam günün ardından burada görünür." illustration="start" />
      ) : (
        <>
          <StatRow
            label="Dönem özeti"
            items={[
              { label: "Ziyaret", value: funnel.visitsTotal === null ? "—" : funnel.visitsTotal, href: "#inis-yollari", icon: <Activity className="h-4 w-4" aria-hidden />, hint: `son ${days} gün` },
              { label: "Kayıt", value: funnel.totals.signups, href: tenants, icon: <UserPlus className="h-4 w-4" aria-hidden />, hint: `önceki: ${prevFunnel ? prevFunnel.totals.signups : "—"}` },
              { label: "İlk ilan", value: funnel.totals.activated, href: tenants, icon: <Target className="h-4 w-4" aria-hidden />, hint: pctText(funnel.totals.signups ? funnel.totals.activated / funnel.totals.signups : null) },
              { label: "Ödeyen", value: funnel.totals.paid, href: `${tenants}&durum=active`, icon: <CreditCard className="h-4 w-4" aria-hidden />, hint: pctText(funnel.totals.signups ? funnel.totals.paid / funnel.totals.signups : null) },
              { label: "Kaynak kapsaması", value: pctText(coverage), href: "#olcum-ayarlari", attention: coverage !== null && coverage < 0.8, hint: `${funnel.totals.attributed}/${funnel.totals.signups} kayıt` },
            ]}
          />

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Huni</CardTitle>
                <CardDescription>
                  Dönem: {funnel.from} – {funnel.to}. Ziyaret tam sayfa yüklemesidir (site içi geçişler sayılmaz) ve şimdilik yalnız ana sayfa ile araçlar sayılır (fiyatlar, yasal sayfalar ve kayıt henüz sayaçlı değil); aşamalar birbirinin alt kümesi olmadığı için aşama arası yüzde çizilmez.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <FunnelChart stages={stages} ariaLabel="Ziyaretten ödemeye huni" />
            </CardContent>
          </Card>

          <section aria-labelledby="kanallar" className="space-y-3">
            <h2 id="kanallar" className="font-display text-base font-extrabold text-ink-950">Kanal × aşama</h2>
            <ChannelTable funnel={funnel} prev={prevFunnel} days={days} />
            <p className="text-xs text-text-muted">
              Payda sıfırsa oran gösterilmez (—). &quot;Atıfsız kayıt&quot;: kaynak bilgisi taşınmadan açılan ofisler; &quot;Belirsiz&quot;: kaynak etiketi tanınmadı.
            </p>
          </section>

          <section aria-labelledby="inis-yollari-baslik" id="inis-yollari" className="scroll-mt-24 space-y-3">
            <h2 id="inis-yollari-baslik" className="font-display text-base font-extrabold text-ink-950">İniş yolları</h2>
            <LandingTable rows={landingTable(funnel.landings, pages.map((p) => ({ id: p.id, slug: p.slug })))} />
          </section>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <LostTraffic rows={lost.rows} available={lost.available} />
        <HealthCard health={health} />
      </div>

      <Card id="olcum-ayarlari">
        <CardHeader>
          <div>
            <CardTitle>Ölçüm ayarları</CardTitle>
            <CardDescription>Üçüncü taraf betik ve çerez kullanılmaz. Kayıt kaynağı taşıma açılmadan önce aydınlatma metninde kayıt kaynağı maddesi bulunmalıdır.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <MeasureSettingsForm
            value={health.settings}
            canEdit={staff.role === "super_admin"}
            legalAtText={health.settings.attributionLegalAt ? formatDateTimeTr(health.settings.attributionLegalAt) : null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
