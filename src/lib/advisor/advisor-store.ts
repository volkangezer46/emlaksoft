import { createClient } from "@/lib/supabase/server";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import {
  collectDocAlerts,
  type AllowedSpecialtyValues,
  type DocAlert,
  type PrivateSummary,
  type RegionRow,
  type RegionView,
  type SpecialtyOptions,
  type SpecialtyRow,
  type SpecialtyView,
  type WorkProfileRow,
} from "./advisor-profile";

/**
 * Danışman profili okuyucuları (SUNUCUYA ÖZEL). Kullanıcı oturumlu istemci kullanılır: yetki sınırını RLS çizer
 * (advisor_profiles: kendisi + team:view; advisor_private: yalnız owner/gm + kendisi; uzmanlık/bölge: ofis içi).
 * Şema henüz uygulanmamışsa (migration 20260816001300/001400) hiçbir okuyucu fırlatmaz: `available: false` döner ve
 * çağıran ekranlar "bu özellik henüz etkin değil" boş durumunu gösterir (kvkk_requests deseni).
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

const MISSING = /advisor_profiles|advisor_private|advisor_specialties|advisor_regions|schema cache|does not exist|PGRST205|42P01/i;

export function isAdvisorSchemaMissing(error: { message?: string; code?: string } | null | undefined): boolean {
  return !!error && (MISSING.test(error.message ?? "") || error.code === "42P01" || error.code === "PGRST205");
}

export type Availability<T> = { available: true; data: T } | { available: false; data: null };

const off = <T>(): Availability<T> => ({ available: false, data: null });

const WORK_COLS =
  "profile_id, employment_type, hired_at, left_at, authority_cert_no, authority_cert_expires_on, spk_cert_no, spk_cert_expires_on, max_active_listings, max_active_demands, work_days, work_start, work_end, accepts_pool, pool_paused_until";

/** İş profili tablosu uygulanmış mı? (ilk sorgu hatasına dayalı; to_regclass gerekmez) */
export async function probeAdvisorWorkSchema(supabase: Supabase): Promise<boolean> {
  const { error } = await supabase.from("advisor_profiles").select("profile_id", { head: true, count: "exact" }).limit(1);
  return !error;
}

export async function probeAdvisorSpecialtySchema(supabase: Supabase): Promise<boolean> {
  const { error } = await supabase.from("advisor_specialties").select("id", { head: true, count: "exact" }).limit(1);
  return !error;
}

export async function probeAdvisorPrivateSchema(supabase: Supabase): Promise<boolean> {
  const { error } = await supabase.from("advisor_private").select("profile_id", { head: true, count: "exact" }).limit(1);
  return !error;
}

export async function loadWorkProfile(
  supabase: Supabase,
  tenantId: string,
  profileId: string,
): Promise<Availability<WorkProfileRow | null>> {
  const { data, error } = await supabase
    .from("advisor_profiles")
    .select(WORK_COLS)
    .eq("tenant_id", tenantId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) {
    if (!isAdvisorSchemaMissing(error)) console.error("loadWorkProfile", error.message);
    return off();
  }
  return { available: true, data: (data as WorkProfileRow | null) ?? null };
}

const PRIVATE_COLS =
  "national_id_last4, iban_last4, birth_date, address_line, province_id, district_id, emergency_name, emergency_phone, emergency_relation, bank_name, iban_holder";

export async function loadPrivateSummary(
  supabase: Supabase,
  tenantId: string,
  profileId: string,
): Promise<Availability<PrivateSummary | null>> {
  const { data, error } = await supabase
    .from("advisor_private")
    .select(PRIVATE_COLS)
    .eq("tenant_id", tenantId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) {
    if (!isAdvisorSchemaMissing(error)) console.error("loadPrivateSummary", error.message);
    return off();
  }
  return { available: true, data: (data as PrivateSummary | null) ?? null };
}

export async function loadSpecialties(
  supabase: Supabase,
  tenantId: string,
  profileId: string,
): Promise<Availability<SpecialtyView[]>> {
  const { data, error } = await supabase
    .from("advisor_specialties")
    .select("id, kind, value, transaction_type, level, price_min, price_max, experience_years")
    .eq("tenant_id", tenantId)
    .eq("profile_id", profileId)
    .order("kind")
    .order("value");
  if (error) {
    if (!isAdvisorSchemaMissing(error)) console.error("loadSpecialties", error.message);
    return off();
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    kind: r.kind as SpecialtyRow["kind"],
    value: r.value as string,
    transaction_type: (r.transaction_type as SpecialtyRow["transaction_type"]) ?? null,
    level: Number(r.level) as SpecialtyRow["level"],
    price_min: r.price_min === null ? null : Number(r.price_min),
    price_max: r.price_max === null ? null : Number(r.price_max),
    experience_years: r.experience_years === null ? null : Number(r.experience_years),
  }));
  return { available: true, data: rows };
}

type NameRel = { name?: string | null } | { name?: string | null }[] | null;
const relName = (v: NameRel) => (Array.isArray(v) ? v[0]?.name : v?.name) ?? null;

export async function loadRegions(
  supabase: Supabase,
  tenantId: string,
  profileId: string,
): Promise<Availability<RegionView[]>> {
  const { data, error } = await supabase
    .from("advisor_regions")
    .select(
      "id, province_id, district_id, neighborhood_id, weight, province:geo_provinces!advisor_regions_province_id_fkey(name), district:geo_districts!advisor_regions_district_id_fkey(name), neighborhood:geo_neighborhoods!advisor_regions_neighborhood_id_fkey(name)",
    )
    .eq("tenant_id", tenantId)
    .eq("profile_id", profileId)
    .order("weight", { ascending: false });
  if (error) {
    if (!isAdvisorSchemaMissing(error)) console.error("loadRegions", error.message);
    return off();
  }
  const rows = ((data ?? []) as unknown as (Record<string, unknown> & { province: NameRel; district: NameRel; neighborhood: NameRel })[]).map((r) => ({
    id: r.id as string,
    province_id: r.province_id as string,
    district_id: (r.district_id as string | null) ?? null,
    neighborhood_id: (r.neighborhood_id as string | null) ?? null,
    weight: Number(r.weight) as RegionRow["weight"],
    province_name: relName(r.province),
    district_name: relName(r.district),
    neighborhood_name: relName(r.neighborhood),
  }));
  return { available: true, data: rows };
}

export async function loadSpecialtyOptions(): Promise<SpecialtyOptions> {
  const [types, segments] = await Promise.all([
    getDefinitionsOrDefault("property_type"),
    getDefinitionsOrDefault("advisor_segment"),
  ]);
  return {
    propertyTypes: types.map((t) => ({ value: t.value, label: t.label })),
    segments: segments.map((t) => ({ value: t.value, label: t.label })),
  };
}

export function allowedFromOptions(o: SpecialtyOptions): AllowedSpecialtyValues {
  return {
    property_type: new Set(o.propertyTypes.map((x) => x.value)),
    segment: new Set(o.segments.map((x) => x.value)),
  };
}

export type OfficeDocAlert = DocAlert & { fullName: string };

/**
 * Ofis genelinde belge bitiş uyarıları (süresi dolmuş + 30 gün içinde bitenler; aktif, ayrılmamış danışmanlar).
 * `todayKey`: `trDayKey(now())`. Şema yoksa available:false.
 */
export async function loadOfficeDocAlerts(
  supabase: Supabase,
  tenantId: string,
  todayKey: string,
): Promise<Availability<OfficeDocAlert[]>> {
  const { data, error } = await supabase
    .from("advisor_profiles")
    .select("profile_id, authority_cert_expires_on, spk_cert_expires_on, left_at")
    .eq("tenant_id", tenantId)
    .is("left_at", null)
    .or("authority_cert_expires_on.not.is.null,spk_cert_expires_on.not.is.null")
    .limit(2000);
  if (error) {
    if (!isAdvisorSchemaMissing(error)) console.error("loadOfficeDocAlerts", error.message);
    return off();
  }
  const rows = (data ?? []) as { profile_id: string; authority_cert_expires_on: string | null; spk_cert_expires_on: string | null }[];
  const alerts = collectDocAlerts(rows, todayKey);
  if (alerts.length === 0) return { available: true, data: [] };
  const ids = [...new Set(alerts.map((a) => a.profileId))];
  const { data: names } = await supabase
    .from("profiles")
    .select("id, full_name, is_active")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  const nameMap = new Map(((names ?? []) as { id: string; full_name: string; is_active: boolean }[]).filter((p) => p.is_active).map((p) => [p.id, p.full_name]));
  return {
    available: true,
    data: alerts.filter((a) => nameMap.has(a.profileId)).map((a) => ({ ...a, fullName: nameMap.get(a.profileId) ?? "" })),
  };
}
