import Link from "next/link";
import { requirePlatformModule } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui/page-header";
import { getPlanCatalog, getPlanDefinitions, getSeatSettings } from "@/lib/billing/plan-definitions";
import { computeSeatAnalytics } from "@/lib/billing/seat-analytics";
import { findSeatCrossovers, validateSeatCatalog } from "@/lib/billing/seat-pricing";
import { warnRatioOf } from "@/lib/billing/seat-settings";
import { planLabel } from "@/lib/billing/plans";
import { getFoundersStatus, getPlanSupport } from "@/lib/billing/plan-support";
import { BillingNav } from "../billing-nav";
import { ApplyRecommended } from "./apply-recommended";
import { CampaignForm, PlanEditor } from "./plan-editor";
import { PriceSimulator } from "./price-simulator";
import { SeatAnalyticsPanel, type SeatListKey } from "./seat-analytics-panel";
import { loadSeatSubscriberRows } from "./seat-data";
import { SeatSettingsForm } from "./seat-settings-form";

export const metadata = { title: "Plan tanımları" };

const SECTIONS = [
  { id: "planlar", label: "Plan tanımları" },
  { id: "simulator", label: "Fiyat simülatörü" },
  { id: "analitik", label: "Gelir analitiği" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export default async function PlansAdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ sekme?: string; liste?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const section: SectionId = SECTIONS.some((x) => x.id === sp.sekme) ? (sp.sekme as SectionId) : "planlar";
  const list: SeatListKey | null = sp.liste === "uyari" || sp.liste === "dolu" || sp.liste === "genisleme" ? sp.liste : null;
  const staff = await requirePlatformModule("billing");
  const isSuper = staff.role === "super_admin";
  const [defs, catalog, support] = await Promise.all([getPlanDefinitions(), getPlanCatalog(), getPlanSupport()]);
  const founders = await getFoundersStatus(catalog.campaign);
  const seatSettings = await getSeatSettings();

  const admin = createAdminClient();
  const { data: subs } = await admin.from("subscriptions").select("plan").limit(5000);
  const counts = new Map<string, number>();
  for (const s of subs ?? []) counts.set(String(s.plan), (counts.get(String(s.plan)) ?? 0) + 1);

  const seatData = section === "planlar" ? null : await loadSeatSubscriberRows(admin);
  const seatReport = validateSeatCatalog(defs);
  const crossovers = findSeatCrossovers(defs);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Faturalama"
        title="Plan tanımları"
        description="Fiyat, limit, kota ve özellik listesi buradan düzenlenir; kayıt, fiyat sayfası ve yeni ödemeler bu tanımlardan beslenir. Mevcut abonelikler kendi tutarını korur."
        breadcrumbs={[{ label: "Faturalama", href: "/admin/billing" }, { label: "Planlar" }]}
        actions={isSuper ? <ApplyRecommended /> : undefined}
      />
      <BillingNav active="planlar" />
      {!isSuper ? (
        <p role="note" className="rounded-[var(--radius-card)] border border-line bg-surface p-3 text-sm text-text-muted">
          Paket tanımlarını yalnız süper admin değiştirir; bu sayfa salt okunurdur.
        </p>
      ) : null}
      <nav aria-label="Plan sayfası bölümleri" className="flex flex-wrap gap-1 rounded-[var(--radius-card)] border border-line bg-surface p-1">
        {SECTIONS.map((x) => (
          <Link
            key={x.id}
            href={x.id === "planlar" ? "/admin/billing/planlar" : `/admin/billing/planlar?sekme=${x.id}`}
            aria-current={section === x.id ? "page" : undefined}
            className={`focus-ring min-h-9 rounded-[var(--radius-control)] px-3.5 py-1.5 text-sm font-semibold transition ${
              section === x.id ? "bg-ink-950 text-white" : "text-text-muted hover:bg-canvas hover:text-ink-950"
            }`}
          >
            {x.label}
          </Link>
        ))}
      </nav>
      {section === "planlar" ? (
        <>
          <section aria-label="Ek kullanıcı çapraz noktaları" className="space-y-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
            <h2 className="font-display text-sm font-bold text-ink-950">Ek kullanıcı çapraz noktaları</h2>
            <ul className="space-y-1 text-xs text-text-muted">
              {crossovers.map((c) => (
                <li key={`${c.fromPlanId}-${c.toPlanId}`}>
                  {planLabel(c.fromPlanId)} &rarr; {planLabel(c.toPlanId)}:{" "}
                  {c.seat === null ? (
                    <span className="font-semibold text-warn-600">çapraz nokta yok (yükseltme önerisi tetiklenmez)</span>
                  ) : (
                    <span>
                      <strong className="text-ink-950">{c.seat}</strong> kullanıcıdan itibaren üst paket daha ucuz; sistem {planLabel(c.toPlanId)} önerir
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {seatReport.errors.length > 0 ? (
              <ul role="alert" className="space-y-1 text-xs font-semibold text-danger-600">
                {seatReport.errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            ) : null}
            {seatReport.warnings.length > 0 ? (
              <ul className="space-y-1 text-xs text-warn-600">
                {seatReport.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            ) : null}
          </section>
          <div className="space-y-3">
            {defs.map((plan) => (
              <PlanEditor
                key={plan.id}
                plan={plan}
                plans={defs}
                customized={Boolean(catalog.overrides[plan.id])}
                subscribers={counts.get(plan.id) ?? 0}
                businessReady={support.businessPlan}
              />
            ))}
          </div>
        </>
      ) : null}
      {section === "simulator" && seatData ? (
        <section aria-label="Fiyat simülatörü" className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <div>
            <h2 className="font-display font-bold text-ink-950">Fiyat simülatörü</h2>
            <p className="text-xs text-text-muted">
              Yeni taban fiyat ve kademeleri girin; mevcut abone dağılımı ({seatData.rows.filter((r) => r.status === "active").length} aktif abone,{" "}
              {seatData.rows.filter((r) => r.locked).length} kilitli) üzerinde MRR/ARPA değişimini kaydetmeden önizleyin. Kilitli tutarlar değişmez.
              {!seatData.extraSeatsEnabled ? " Ek kullanıcı sütunu yok: yeniden fiyatlama yalnız taban fiyat farkıyla hesaplanır." : ""}
            </p>
          </div>
          <PriceSimulator
            plans={defs}
            subscribers={seatData.rows.map((r) => ({
              plan: r.plan,
              status: r.status,
              cycle: r.cycle,
              amountTry: r.amountTry,
              extraSeats: r.extraSeats,
              locked: r.locked,
            }))}
            canWrite={isSuper}
          />
        </section>
      ) : null}
      {section === "analitik" && seatData ? (
        <div className="space-y-4">
          <SeatAnalyticsPanel
            data={computeSeatAnalytics(seatData.rows, defs, warnRatioOf(seatSettings), seatData.extraSeatsEnabled)}
            warnPercent={seatSettings.warnPercent}
            list={list}
            expansionRows={seatData.rows.filter((r) => r.status === "active" && (r.extraSeats ?? 0) > 0)}
          />
          {isSuper ? <SeatSettingsForm warnPercent={seatSettings.warnPercent} /> : null}
        </div>
      ) : null}
      {section === "planlar" && isSuper ? (
        <CampaignForm
          campaign={catalog.campaign}
          trialDays={support.trialDays}
          founders={founders}
          trialEffective={support.trialSetting}
          priceLockReady={support.priceLock}
        />
      ) : null}
    </div>
  );
}
