import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { buildSampleKpiScope, getSampleScope, type SampleKpiScope } from "@/lib/sample-scope";
import { getPlanTier } from "@/lib/billing/plan-definitions";
import { getOfficeScoreCached } from "@/lib/office-score";

/**
 * İstek-içi (React `cache()`) tekilleştirme yardımcıları. Süreçler/istekler
 * ARASI paylaşım YOKTUR: değerler istek bitince atılır, bu yüzden rol/plan
 * değişikliği bir sonraki istekte hemen yansır (yetki eskimesi riski sıfır).
 * Çağrılar RLS'li kullanıcı client'ı ile yapılır (admin client yok).
 *
 * TEK KİMLİK OKUMASI (`getRequestIdentity`): bir /app isteğinde profil eskiden 4-5, tenant 4+ kez ayrı sorgulanıyordu
 * (kabuk, sayfa kapısı, requireActiveTenant, hoş geldin, örnek veri kapsamı, paket kapısı). Artık oturumdaki kullanıcının
 * profil satırı + kendi tenant'ı TEK sorguda (gömme) okunur; diğer yardımcılar bundan türetilir. Güvenlik kontrolleri
 * (aktiflik, claim eşleşmesi, 2FA, askıya alma) çağıranlarda AYNEN durur; burada yalnız okuma birleştirilir.
 */

export type RequestTenantRow = {
  name: string | null;
  plan: string | null;
  status: string | null;
  brand_color: string | null;
  created_at: string | null;
  slug: string | null;
  trial_ends_at: string | null;
  sample_seeded_at: string | null;
};

export type RequestIdentity = {
  /** Şemada NOT NULL. */
  tenant_id: string;
  /** Şemada NOT NULL (CHECK ile rol listesi). */
  role: string;
  full_name: string | null;
  is_active: boolean | null;
  created_at: string | null;
  two_factor_sms: boolean | null;
  two_factor_version: number | null;
  /** Profilin kendi tenant'ı (RLS görünürse); impersonation'da hedef tenant DEĞİLDİR. */
  tenant: RequestTenantRow | null;
};

export type RequestIdentityResult = { data: RequestIdentity | null; error: { code?: string; message?: string } | null };

const IDENTITY_SELECT =
  "tenant_id, role, full_name, is_active, created_at, two_factor_sms, two_factor_version, tenants!profiles_tenant_id_fkey(name, plan, status, brand_color, created_at, slug, trial_ends_at, sample_seeded_at)";

/** Oturumdaki kullanıcının profil + kendi tenant satırı — istek başına TEK sorgu. Hata çağırana aynen döner (fail-closed kararı orada). */
export const getRequestIdentity = cache(async (userId: string): Promise<RequestIdentityResult> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select(IDENTITY_SELECT).eq("id", userId).maybeSingle();
  if (error) return { data: null, error: { code: error.code, message: error.message } };
  if (!data) return { data: null, error: null };
  const raw = data as Record<string, unknown>;
  const t = raw.tenants as RequestTenantRow | RequestTenantRow[] | null | undefined;
  const tenant = (Array.isArray(t) ? t[0] : t) ?? null;
  return {
    data: {
      tenant_id: raw.tenant_id as string,
      role: raw.role as string,
      full_name: (raw.full_name as string | null) ?? null,
      is_active: (raw.is_active as boolean | null) ?? null,
      created_at: (raw.created_at as string | null) ?? null,
      two_factor_sms: (raw.two_factor_sms as boolean | null) ?? null,
      two_factor_version: (raw.two_factor_version as number | null) ?? null,
      tenant,
    },
    error: null,
  };
});

/** Oturumdaki kullanıcının profil satırı (rol + tenant) — `getRequestIdentity`'den, ek sorgu yok. */
export const getRequestProfile = cache(async (userId: string) => {
  const { data } = await getRequestIdentity(userId);
  return data ? { role: data.role, tenant_id: data.tenant_id } : null;
});

/** Oturumun kendi tenant satırı (verilen tenantId ile eşleşiyorsa); eşleşmiyorsa null → çağıran kendi sorgusunu atar. */
async function ownTenantRow(tenantId: string): Promise<RequestTenantRow | null> {
  const user = await getRequestUser();
  if (!user) return null;
  const { data } = await getRequestIdentity(user.id);
  return data && data.tenant_id === tenantId ? data.tenant : null;
}

/** Tenant'ın paket ve deneme bilgisi — oturumun kendi tenant'ıysa kimlik okumasından, değilse tek sorgu. */
export const getTenantGateContext = cache(async (tenantId: string) => {
  const own = await ownTenantRow(tenantId);
  const data = own
    ? own
    : ((await (await createClient()).from("tenants").select("plan, status, created_at").eq("id", tenantId).maybeSingle()).data as
        | Pick<RequestTenantRow, "plan" | "status" | "created_at">
        | null);
  const plan = data?.plan ?? null;
  return {
    plan,
    // Adminden eklenen pakette modül kademesi katalogdan (taban kimlikte katalog okunmaz).
    tier: await getPlanTier(plan),
    trial: data?.status === "trial",
    tenantCreatedAt: data?.created_at ?? null,
  };
});

/**
 * Sayfa render'ı için örnek veri KPI kapsamı (istek başına bir kez). Kural tek kaynakta (`sample-scope.ts`
 * `getSampleScope` + `buildSampleKpiScope`); burada yalnız `sample_seeded_at` kimlik okumasından alınır (ek tenant sorgusu yok).
 */
export const getRequestSampleScope = cache(async (tenantId: string | null): Promise<SampleKpiScope> => {
  const supabase = await createClient();
  const own = tenantId ? await ownTenantRow(tenantId) : null;
  const seedPromise = own
    ? Promise.resolve(own.sample_seeded_at)
    : tenantId
      ? Promise.resolve(supabase.from("tenants").select("sample_seeded_at").eq("id", tenantId).maybeSingle()).then(
          (r) => ((r.data as { sample_seeded_at?: string | null } | null)?.sample_seeded_at ?? null),
        )
      : Promise.resolve(null);
  const [{ counts }, seededAt] = await Promise.all([getSampleScope(supabase, tenantId ?? undefined), seedPromise]);
  return buildSampleKpiScope(counts, Boolean(seededAt));
});

/**
 * OFİS SATIRI — istek başına TEK okuma (PERF-6). Ana ekran görünümünde `tenants` eskiden 5 ayrı yerden (ofis kartı, ana
 * ekran tenant satırı, havuz anahtarı, profil tamamlama ×2, kurulum durumu) farklı kolonlarla okunuyordu. Kolonların
 * birleşimi burada tek sorguda okunur; çağıranlar alt kümeyi kullanır. Genişletme kolonları (`office_type`,
 * `focus_segments`, `work_district_ids`) şemada yoksa (42703) temel kolonlarla tekrar okunur ve `extAvailable=false` döner.
 * Hata → `{ data: null, error }` (fail-closed kararı çağıranda). RLS'li oturum istemcisi.
 */
export type TenantRow = {
  id: string;
  name: string | null;
  slug: string | null;
  city: string | null;
  logo_url: string | null;
  brand_color: string | null;
  province_id: string | null;
  district_id: string | null;
  address_line: string | null;
  phone: string | null;
  license_no: string | null;
  tax_number: string | null;
  tax_office: string | null;
  sample_seeded_at: string | null;
  created_at: string | null;
  listing_pool_enabled: boolean | null;
  vitrin_seo_optin: boolean | null;
  province: { name: string | null; lat: number | null; lng: number | null } | null;
  extAvailable: boolean;
  office_type: string | null;
  focus_segments: string[] | null;
  work_district_ids: string[] | null;
};

const TENANT_BASE_COLUMNS =
  "id, name, slug, city, logo_url, brand_color, province_id, district_id, address_line, phone, license_no, tax_number, tax_office, sample_seeded_at, created_at, listing_pool_enabled, vitrin_seo_optin, province:geo_provinces(name, lat, lng)";
const TENANT_EXT_COLUMNS = "office_type, focus_segments, work_district_ids";

export const getTenantRow = cache(async (tenantId: string): Promise<{ data: TenantRow | null; error: { code?: string; message?: string } | null }> => {
  const supabase = await createClient();
  let ext = true;
  let res = await supabase.from("tenants").select(`${TENANT_BASE_COLUMNS}, ${TENANT_EXT_COLUMNS}`).eq("id", tenantId).maybeSingle();
  if (res.error?.code === "42703") {
    ext = false;
    res = await supabase.from("tenants").select(TENANT_BASE_COLUMNS).eq("id", tenantId).maybeSingle();
  }
  if (res.error) return { data: null, error: { code: res.error.code, message: res.error.message } };
  if (!res.data) return { data: null, error: null };
  const raw = res.data as unknown as Record<string, unknown>;
  const prov = raw.province as TenantRow["province"] | TenantRow["province"][] | null | undefined;
  const s = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
  const b = (k: string) => (typeof raw[k] === "boolean" ? (raw[k] as boolean) : null);
  return {
    data: {
      id: String(raw.id),
      name: s("name"),
      slug: s("slug"),
      city: s("city"),
      logo_url: s("logo_url"),
      brand_color: s("brand_color"),
      province_id: raw.province_id == null ? null : String(raw.province_id),
      district_id: raw.district_id == null ? null : String(raw.district_id),
      address_line: s("address_line"),
      phone: s("phone"),
      license_no: s("license_no"),
      tax_number: s("tax_number"),
      tax_office: s("tax_office"),
      sample_seeded_at: s("sample_seeded_at"),
      created_at: s("created_at"),
      listing_pool_enabled: b("listing_pool_enabled"),
      vitrin_seo_optin: b("vitrin_seo_optin"),
      province: (Array.isArray(prov) ? (prov[0] ?? null) : (prov ?? null)) as TenantRow["province"],
      extAvailable: ext,
      office_type: ext ? s("office_type") : null,
      focus_segments: ext && Array.isArray(raw.focus_segments) ? (raw.focus_segments as string[]) : null,
      work_district_ids: ext && Array.isArray(raw.work_district_ids) ? (raw.work_district_ids as string[]) : null,
    },
    error: null,
  };
});

/**
 * OFİS SKORU — istek başına TEK değer (F8). Yan menü ofis kartı ve ana ekran "Ofis durumu" paneli aynı istekte ayrı ayrı
 * `getOfficeScoreCached` (3 dk süreçler arası önbellek) çağırınca, önbellek tazelenirken biri eski biri yeni değeri
 * görebiliyordu (Skor 62 ↔ 58). React `cache()` aynı istekte tek sonuç paylaştırır.
 */
export const getRequestOfficeScore = cache((tenantId: string) => getOfficeScoreCached(tenantId));
