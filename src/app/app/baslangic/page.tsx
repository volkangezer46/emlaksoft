import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { buildOnboarding } from "@/lib/onboarding-checklist";
import { SetupWizard } from "./setup-wizard";

export const metadata = { title: "Ofis kurulumu" };

/** Kurulum sihirbazı: mevcut tablolardan salt sayımla ilerleme hesaplar. Tüm paketlerde açık. */
export default async function OnboardingPage() {
  const { tenantId, perms } = await requireModulePage("dashboard");
  if (!tenantId) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="Ofis kurulumu" breadcrumbs={[{ label: "Ana ekran", href: "/app" }, { label: "Kurulum" }]} />
        <Alert tone="info">Kurulum adımları bir ofis hesabı içinde görünür.</Alert>
      </div>
    );
  }

  const supabase = await createClient();
  const [tenantRes, customersRes, propertiesRes, membersRes, integrationsRes, sampleCustomersRes, wonDealsRes] = await Promise.all([
    supabase.from("tenants").select("phone, city, license_no, sample_seeded_at").eq("id", tenantId).maybeSingle(),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("is_sample", false),
    supabase.from("properties").select("id", { count: "exact", head: true }).eq("is_sample", false),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase
      .from("tenant_integrations")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .in("provider", ["netgsm", "whatsapp"]),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("is_sample", true),
    supabase.from("deals").select("id", { count: "exact", head: true }).eq("stage", "won").eq("is_sample", false),
  ]);

  const tenant = tenantRes.data as {
    phone: string | null;
    city: string | null;
    license_no: string | null;
    sample_seeded_at: string | null;
  } | null;

  const customers = customersRes.count ?? 0;
  const properties = propertiesRes.count ?? 0;
  const state = buildOnboarding({
    profileFilled: {
      phone: Boolean(tenant?.phone),
      city: Boolean(tenant?.city),
      licenseNo: Boolean(tenant?.license_no),
    },
    customers,
    properties,
    wonDeals: wonDealsRes.count ?? 0,
    members: membersRes.count ?? 0,
    activeIntegrations: integrationsRes.count ?? 0,
  });

  const showSampleData =
    customers === 0 && properties === 0 && !tenant?.sample_seeded_at && (sampleCustomersRes.count ?? 0) === 0;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow="Başlangıç"
        title="Ofis kurulumu"
        description="Altı kısa adımda ofisinizi çalışır hale getirin. Dilediğiniz adımı sonraya bırakabilirsiniz."
        breadcrumbs={[{ label: "Ana ekran", href: "/app" }, { label: "Kurulum" }]}
      />
      <SetupWizard
        steps={state.steps}
        doneCount={state.doneCount}
        total={state.total}
        percent={state.percent}
        complete={state.complete}
        canEdit={effectiveHasPermission(perms, "settings", "edit")}
        showSampleData={showSampleData}
        profile={{ phone: tenant?.phone ?? "", city: tenant?.city ?? "", licenseNo: tenant?.license_no ?? "" }}
      />
    </div>
  );
}
