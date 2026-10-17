import { StaffNoTenantNotice } from "@/components/app/staff-no-tenant-notice";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { loadOnboardingSnapshot, withFirstTaskFacts } from "@/lib/onboarding-state";
import { resolveWizardStep, scopeOnboardingToPermissions, visibleFirstTasks } from "@/lib/onboarding-checklist";
import { createClient } from "@/lib/supabase/server";
import { isSampleLocked, loadSampleLockState } from "@/lib/sample-data/lock";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { SetupWizard } from "./setup-wizard";

export const metadata = { title: "Kurulum" };

/**
 * Kurulum sihirbazı (sadeleştirme planı C27): ofis sahibi için 4 adım (Ofis · Ne iş yapıyorsunuz · Verileri taşı · Ekibi davet
 * et), "Adım x / 4" ilerlemesi, ODAK MODU (sihirbaz açıkken yan menü, üst çubuk ve alt çubuk gizli; tek çıkış "Kurulumdan çık").
 * Diğer ayarlar (yetki belgesi, portföy dağıtımı, ilan siteleri, giderler, paket…) özetteki "İsteğe bağlı ayarlar" listesindedir.
 * Durum gerçek veriden hesaplanır (lib/onboarding-state), ana ekran kartıyla AYNI kaynak ve AYNI
 * yetki süzgeci (`scopeOnboardingToPermissions`): danışmanın kart sayacı ile sihirbaz sayacı aynıdır, yapamayacağı adım
 * (ofis bilgileri, giderler, havuz…) şeritte görünmez. İlk işler de izinle süzülür.
 */
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

  const [snap, { adim }, { data: ownRow }, user] = await Promise.all([
    loadOnboardingSnapshot(tenantId),
    searchParams,
    (await createClient()).from("profiles").select("title").eq("id", userId).maybeSingle(),
    getRequestUser(),
  ]);
  if (!snap) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="Kurulum" breadcrumbs={crumbs} />
        <Alert tone="danger">Kurulum durumu okunamadı. Sayfayı yenileyip tekrar deneyin.</Alert>
      </div>
    );
  }

  const { skipped, tenant, counts } = snap;
  const state = scopeOnboardingToPermissions(snap.state, perms, skipped);
  // Yalnız gerçek (ve yetkili) adım kimliği; bilinmeyen değer ilk eksik adıma düşer.
  const current = resolveWizardStep(adim ?? undefined, state);
  const firstTasks = await withFirstTaskFacts(visibleFirstTasks(snap.firstTasks, perms), tenantId);
  const sampleCandidate =
    counts.customers === 0 && counts.properties === 0 && !tenant?.sample_seeded_at && counts.sampleCustomers === 0;
  // Kilit: gerçek kullanıma geçmiş ofiste örnek veri adımı hiç gösterilmez (sunucu ve DB de reddeder).
  const showSampleData = sampleCandidate && !isSampleLocked(await loadSampleLockState(await createClient(), tenantId));
  // Demo yükleme yetkisi: seedSampleData ile aynı altı modülde oluşturma (actions/sample-data.ts).
  const canSeedSample = (["customers", "properties", "demands", "tasks", "appointments", "commissions"] as const).every((m) =>
    effectiveHasPermission(perms, m, "create"),
  );

  return (
    <div className="mx-auto w-full max-w-3xl">
      <SetupWizard
        state={state}
        skipped={skipped}
        current={current}
        firstTasks={firstTasks}
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
          canImport: effectiveHasPermission(perms, "customers", "create"),
          showSampleData,
          canSeedSample,
          impersonating: user?.app_metadata?.impersonating === true,
        }}
      />
    </div>
  );
}
