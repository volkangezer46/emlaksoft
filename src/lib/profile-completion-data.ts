import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { computeProfileCompletion, type ProfileCompletion, type ProfileFacts } from "@/lib/profile-completion";

export type ProfileSnapshot = {
  facts: ProfileFacts;
  completion: ProfileCompletion;
  /** Sihirbaz formları için mevcut değerler. */
  office: { name: string; taxOffice: string | null; slug: string | null };
};

/**
 * Ofis profili durumunun TEK okuyucusu (oturum istemcisi, RLS). Ana ekran kartı ve sihirbaz sayfası aynı sorguyu paylaşır
 * (istek içi cache). Genişletme sütunları ayrı sorguda okunur: sütun yoksa yalnız o üç madde devre dışı kalır.
 * Temel okuma hata verirse null döner (sahte ilerleme gösterilmez).
 */
export const loadProfileSnapshot = cache(async (tenantId: string): Promise<ProfileSnapshot | null> => {
  const supabase = await createClient();
  const [base, ext, members] = await Promise.all([
    supabase
      .from("tenants")
      .select("name, slug, province_id, district_id, address_line, phone, license_no, tax_number, tax_office, logo_url, brand_color")
      .eq("id", tenantId)
      .maybeSingle(),
    supabase.from("tenants").select("office_type, focus_segments, work_district_ids").eq("id", tenantId).maybeSingle(),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
  ]);
  if (base.error || !base.data || members.error) return null;
  const t = base.data as Record<string, string | null>;
  const e = ext.error ? null : (ext.data as { office_type: string | null; focus_segments: string[] | null; work_district_ids: string[] | null } | null);
  const facts: ProfileFacts = {
    provinceId: t.province_id ?? null,
    districtId: t.district_id ?? null,
    addressLine: t.address_line ?? null,
    phone: t.phone ?? null,
    licenseNo: t.license_no ?? null,
    taxNumber: t.tax_number ?? null,
    logoUrl: t.logo_url ?? null,
    brandColor: t.brand_color ?? null,
    extAvailable: e !== null,
    officeType: e?.office_type ?? null,
    focusSegments: e?.focus_segments ?? null,
    workDistrictIds: e?.work_district_ids ?? null,
    memberCount: members.count ?? 1,
  };
  return {
    facts,
    completion: computeProfileCompletion(facts),
    office: { name: t.name ?? "", taxOffice: t.tax_office ?? null, slug: t.slug ?? null },
  };
});
