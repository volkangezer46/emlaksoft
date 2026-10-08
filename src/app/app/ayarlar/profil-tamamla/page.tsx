import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { StaffNoTenantNotice } from "@/components/app/staff-no-tenant-notice";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { getProvinceOptions } from "@/lib/geo/reader";
import { loadProfileSnapshot } from "@/lib/profile-completion-data";
import { PROFILE_WIZARD_HREF, resolveProfileStep } from "@/lib/profile-completion";
import { ProfileWizard } from "./profil-sihirbaz";

export const metadata = { title: "Ofis profilini tamamla" };

/**
 * Kısa kayıtta sorulmayan ofis bilgileri burada adım adım tamamlanır (kaydet-ve-devam). Durum gerçek tenants alanlarından
 * hesaplanır (`lib/profile-completion`); ana ekrandaki "Ofis profilini tamamla" kartı her eksik maddeyi ilgili adıma bağlar.
 * Yazma yetkisi `settings.edit` (action'lar ayrıca doğrular); ekip daveti `team.create`.
 */
export default async function ProfileCompletePage({ searchParams }: { searchParams: Promise<{ adim?: string }> }) {
  const { tenantId, perms } = await requireModulePage("settings", PROFILE_WIZARD_HREF);
  const crumbs = [{ label: "Ayarlar", href: "/app/ayarlar" }, { label: "Ofis profilini tamamla" }];
  if (!tenantId) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="Ofis profilini tamamla" breadcrumbs={crumbs} />
        <StaffNoTenantNotice feature="Ofis profili" />
      </div>
    );
  }
  const [snap, { adim }, provinces] = await Promise.all([loadProfileSnapshot(tenantId), searchParams, getProvinceOptions()]);
  if (!snap) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="Ofis profilini tamamla" breadcrumbs={crumbs} />
        <Alert tone="danger">Ofis bilgileri okunamadı. Sayfayı yenileyip tekrar deneyin.</Alert>
      </div>
    );
  }
  const step = resolveProfileStep(adim, snap.completion);
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow="Ayarlar"
        title="Ofis profilini tamamla"
        description="Kayıt sırasında sormadığımız bilgileri buradan, adım adım ve istediğin sırayla ekle. Her adım tek başına kaydedilir; demo verilerin etkilenmez."
        breadcrumbs={crumbs}
      />
      <ProfileWizard
        step={step}
        completion={snap.completion}
        facts={snap.facts}
        officeName={snap.office.name}
        provinces={provinces}
        canEdit={effectiveHasPermission(perms, "settings", "edit")}
        canInvite={effectiveHasPermission(perms, "team", "create")}
      />
    </div>
  );
}
