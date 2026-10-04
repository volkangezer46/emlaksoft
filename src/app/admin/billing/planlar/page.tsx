import { requirePlatformModule } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui/page-header";
import { getPlanCatalog, getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { getFoundersStatus, getPlanSupport } from "@/lib/billing/plan-support";
import { BillingNav } from "../billing-nav";
import { ApplyRecommended } from "./apply-recommended";
import { CampaignForm, PlanEditor } from "./plan-editor";

export const metadata = { title: "Plan tanımları" };

export default async function PlansAdminPage() {
  const staff = await requirePlatformModule("billing");
  const isSuper = staff.role === "super_admin";
  const [defs, catalog, support] = await Promise.all([getPlanDefinitions(), getPlanCatalog(), getPlanSupport()]);
  const founders = await getFoundersStatus(catalog.campaign);

  const admin = createAdminClient();
  const { data: subs } = await admin.from("subscriptions").select("plan").limit(5000);
  const counts = new Map<string, number>();
  for (const s of subs ?? []) counts.set(String(s.plan), (counts.get(String(s.plan)) ?? 0) + 1);

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
      <div className="space-y-3">
        {defs.map((plan) => (
          <PlanEditor
            key={plan.id}
            plan={plan}
            customized={Boolean(catalog.overrides[plan.id])}
            subscribers={counts.get(plan.id) ?? 0}
            businessReady={support.businessPlan}
          />
        ))}
      </div>
      {isSuper ? (
        <CampaignForm
          campaign={catalog.campaign}
          trialDays={catalog.trialDays}
          founders={founders}
          trialEffective={support.trialSetting}
          priceLockReady={support.priceLock}
        />
      ) : null}
    </div>
  );
}
