import { StaffNoTenantNotice } from "@/components/app/staff-no-tenant-notice";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { loadOnboardingSnapshot } from "@/lib/onboarding-state";
import { resolveWizardStep } from "@/lib/onboarding-checklist";
import { resolveLegacyStep } from "@/lib/onboarding-steps";
import { createClient } from "@/lib/supabase/server";
import { SetupWizard } from "./setup-wizard";

export const metadata = { title: "Kurulum" };

/** Kurulum sihirbazı: durum gerçek veriden hesaplanır (lib/onboarding-state), ana ekran şeridiyle aynı kaynak. */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ adim?: string }>;
}) {
  const { tenantId, perms, userId, role } = await requireModulePage("dashboard");
  const crumbs = [{ label: "Ana ekran", href: "/app" }, { label: "Kurulum" }];
  if (!tenantId) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="Kurulum" breadcrumbs={crumbs} />
        <StaffNoTenantNotice feature="Kurulum" />
      </div>
    );
  }

  const [snap, { adim }, { data: ownRow }] = await Promise.all([
    loadOnboardingSnapshot(tenantId),
    searchParams,
    (await createClient()).from("profiles").select("title").eq("id", userId).maybeSingle(),
  ]);
  if (!snap) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="Kurulum" breadcrumbs={crumbs} />
        <Alert tone="danger">Kurulum durumu okunamadı. Sayfayı yenileyip tekrar deneyin.</Alert>
      </div>
    );
  }

  const { state, skipped, tenant, counts } = snap;
  // Eski bağlantılar (profil-tamamla adımları, kaldırılan sihirbaz adımları) yeni adıma eşlenir.
  const current = resolveWizardStep(resolveLegacyStep(adim) ?? undefined, state);
  const showSampleData =
    counts.customers === 0 && counts.properties === 0 && !tenant?.sample_seeded_at && counts.sampleCustomers === 0;
  // Demo yükleme yetkisi: seedSampleData ile aynı altı modülde oluşturma (actions/sample-data.ts).
  const canSeedSample = (["customers", "properties", "demands", "tasks", "appointments", "commissions"] as const).every((m) =>
    effectiveHasPermission(perms, m, "create"),
  );
  // Başlangıç tercihi paneli: yalnız boş ofiste ve henüz ofis tipi/tanım girilmemişken.
  const showStartChoice = showSampleData && !snap.firstTasks.find((t) => t.id === "defs")?.done;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow="Başlangıç"
        title="Kurulum"
        description="Üyeliğin hazır; ayrıntıları buradan tamamla. Her adımı atlayabilir, istediğin an çıkıp sonra kaldığın yerden devam edebilirsin."
        breadcrumbs={crumbs}
      />
      <SetupWizard
        state={state}
        skipped={skipped}
        current={current}
        canEditSettings={effectiveHasPermission(perms, "settings", "edit")}
        showSampleData={showSampleData}
        showStartChoice={showStartChoice}
        canSeedSample={canSeedSample}
        firstTasks={snap.firstTasks}
        sampleCustomers={counts.sampleCustomers}
        body={{
          tenantId,
          userId,
          role,
          canEditSettings: effectiveHasPermission(perms, "settings", "edit"),
          canInvite: effectiveHasPermission(perms, "team", "create"),
          canManageBilling: effectiveHasPermission(perms, "billing", "view"),
          profile: snap.profile,
          vitrinHref: tenant?.slug ? `/vitrin/${tenant.slug}` : null,
          ownTitle: String((ownRow as { title?: string | null } | null)?.title ?? ""),
        }}
      />
    </div>
  );
}
