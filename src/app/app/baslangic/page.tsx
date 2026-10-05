import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { loadOnboardingSnapshot } from "@/lib/onboarding-state";
import { resolveWizardStep } from "@/lib/onboarding-checklist";
import { getLossReasonOptions, getStageLabels } from "@/lib/definitions";
import { createClient } from "@/lib/supabase/server";
import { getProvinceOptions } from "@/lib/geo/reader";
import { SetupWizard } from "./setup-wizard";

export const metadata = { title: "Ofis kurulumu" };

/** Kurulum sihirbazı: durum gerçek veriden hesaplanır (lib/onboarding-state), ana ekran şeridiyle aynı kaynak. */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ adim?: string }>;
}) {
  const { tenantId, perms } = await requireModulePage("dashboard");
  const crumbs = [{ label: "Ana ekran", href: "/app" }, { label: "Kurulum" }];
  if (!tenantId) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="Ofis kurulumu" breadcrumbs={crumbs} />
        <Alert tone="info">Kurulum adımları bir ofis hesabı içinde görünür.</Alert>
      </div>
    );
  }

  const supabase = await createClient();
  const [snap, { adim }, lossReasons, stageLabels, provinces, { data: geoRow }] = await Promise.all([
    loadOnboardingSnapshot(tenantId),
    searchParams,
    getLossReasonOptions(),
    getStageLabels(),
    getProvinceOptions(),
    supabase.from("tenants").select("province_id, district_id, tax_number").eq("id", tenantId).maybeSingle(),
  ]);
  if (!snap) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="Ofis kurulumu" breadcrumbs={crumbs} />
        <Alert tone="danger">Kurulum durumu okunamadı. Sayfayı yenileyip tekrar deneyin.</Alert>
      </div>
    );
  }

  const { state, skipped, tenant, counts } = snap;
  const current = resolveWizardStep(adim, state);
  const showSampleData =
    counts.customers === 0 && counts.properties === 0 && !tenant?.sample_seeded_at && counts.sampleCustomers === 0;
  // Demo yükleme yetkisi: seedSampleData ile aynı altı modülde oluşturma (actions/sample-data.ts).
  const canSeedSample = (["customers", "properties", "demands", "tasks", "appointments", "commissions"] as const).every((m) =>
    effectiveHasPermission(perms, m, "create"),
  );
  // Başlangıç tercihi paneli: yalnız boş ofiste ve henüz ofis tipi/tanım girilmemişken.
  const showStartChoice = showSampleData && !state.steps.find((st) => st.id === "defs")?.done;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow="Başlangıç"
        title="Ofis kurulumu"
        description="Önce ofis tipinizi seçip örnek veriyle ya da boş başlayın; sonra sekiz kısa adımda ofisinizi çalışır hale getirin. Her adımı atlayabilir, istediğiniz zaman geri dönebilirsiniz."
        breadcrumbs={crumbs}
      />
      <SetupWizard
        state={state}
        skipped={skipped}
        current={current}
        canEditSettings={effectiveHasPermission(perms, "settings", "edit")}
        canInvite={effectiveHasPermission(perms, "team", "create")}
        showSampleData={showSampleData}
        showStartChoice={showStartChoice}
        canSeedSample={canSeedSample}
        office={{
          name: tenant?.name ?? "",
          phone: tenant?.phone ?? "",
          city: tenant?.city ?? "",
          provinceId: (geoRow?.province_id as string | null) ?? null,
          districtId: (geoRow?.district_id as string | null) ?? null,
          addressLine: tenant?.address_line ?? "",
          licenseNo: tenant?.license_no ?? "",
          taxNumber: (geoRow?.tax_number as string | null) ?? "",
          logoUrl: tenant?.logo_url ?? null,
        }}
        lossReasons={lossReasons.map((r) => ({ value: r.value, label: r.label }))}
        stageLabels={Object.entries(stageLabels).map(([key, v]) => ({ key, label: v.label }))}
        customers={counts.customers}
        properties={counts.properties}
        vitrinHref={tenant?.slug ? `/vitrin/${tenant.slug}` : null}
        provinces={provinces}
      />
    </div>
  );
}
