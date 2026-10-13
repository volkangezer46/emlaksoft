import { LicenseStatusCard } from "@/components/app/license-status-card";
import { loadTenantLicense, tenantLicenseStatus } from "@/lib/license-server";
import { getProvinceOptions } from "@/lib/geo/reader";
import { getSetting } from "@/lib/settings/read";
import { OFFICE_GOOGLE_REVIEW_URL } from "@/lib/settings/registry/tenant";
import { CompanyForm } from "../company-form";
import { LogoUploadForm } from "../logo-upload-form";
import { ReadOnlyGate } from "../read-only-gate";
import { GoogleReviewField } from "./google-review-field";
import type { SettingsTenant } from "./types";

/** Sekme: Marka ve kimlik (logo + ofis bilgileri + yetki belgesi). Varsayılan sekme; `#marka-kimlik` çapası burada. */
export async function KimlikTab({ tenant, tenantId, canEdit }: { tenant: SettingsTenant; tenantId?: string | null; canEdit: boolean }) {
  const [provinces, tenantLicense, googleReviewUrl] = await Promise.all([
    getProvinceOptions(),
    loadTenantLicense(),
    tenantId ? getSetting<string>(OFFICE_GOOGLE_REVIEW_URL, { tenantId }).catch(() => "") : Promise.resolve(""),
  ]);
  const licenseStatus = tenantLicenseStatus(tenantLicense);
  return (
    <>
      <LicenseStatusCard />
      <section id="marka-kimlik" className="dashboard-panel scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <div>
            <h2 className="font-display font-bold text-ink-950">Marka & kimlik</h2>
            <p className="text-xs text-text-muted">Logo, ofis adı ve iletişim bilgileri</p>
          </div>
        </div>
        <ReadOnlyGate canEdit={canEdit}>
          <div className="mt-5 border-b border-line pb-5">
            <LogoUploadForm currentUrl={tenant.logo_url ?? null} officeName={tenant.name || "Ofis"} />
          </div>
          <CompanyForm
            tenant={{ ...tenant, license_title: tenantLicense.licenseTitle, license_valid_until: tenantLicense.validUntil }}
            provinces={provinces}
            licenseBadge={{ label: licenseStatus.label, tone: licenseStatus.tone }}
            licenseColumnsReady={tenantLicense.extendedColumns}
          />
          {tenantId ? <GoogleReviewField settingKey={OFFICE_GOOGLE_REVIEW_URL} value={googleReviewUrl || ""} canEdit={canEdit} /> : null}
        </ReadOnlyGate>
      </section>
    </>
  );
}
