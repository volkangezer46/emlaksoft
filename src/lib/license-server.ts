import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { licenseStatus, type LicenseStatus } from "@/lib/license";
import { now, trDayKey } from "@/lib/clock";

export type TenantLicense = {
  licenseNo: string | null;
  licenseTitle: string | null;
  validUntil: string | null;
  /** license_title/license_valid_until sütunları (migration 20260826001800) okunabildi mi. */
  extendedColumns: boolean;
};

/**
 * Oturumlu ofisin yetki belgesi bilgileri (RLS'li client; service_role YOK).
 * Migration 20260826001800 uygulanmamışsa genişletilmiş sütunlar okunamaz: yalnız license_no ile devam edilir.
 * İstek-içi tek okuma (React `cache`): ayarlar sayfası ve lisans kartı aynı sonucu paylaşır.
 */
export const loadTenantLicense = cache(async (): Promise<TenantLicense> => {
  const supabase = await createClient();
  const full = await supabase.from("tenants").select("license_no, license_title, license_valid_until").limit(1).maybeSingle();
  if (!full.error) {
    return {
      licenseNo: (full.data?.license_no as string | null) ?? null,
      licenseTitle: (full.data?.license_title as string | null) ?? null,
      validUntil: (full.data?.license_valid_until as string | null) ?? null,
      extendedColumns: true,
    };
  }
  const base = await supabase.from("tenants").select("license_no").limit(1).maybeSingle();
  return { licenseNo: (base.data?.license_no as string | null) ?? null, licenseTitle: null, validUntil: null, extendedColumns: false };
});

export function tenantLicenseStatus(l: Pick<TenantLicense, "licenseNo" | "validUntil">): LicenseStatus {
  return licenseStatus({ licenseNo: l.licenseNo, validUntil: l.validUntil }, trDayKey(now()));
}
