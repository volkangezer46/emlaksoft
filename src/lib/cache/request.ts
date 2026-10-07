import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { buildSampleKpiScope, getSampleScope, type SampleKpiScope } from "@/lib/sample-scope";

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
  return {
    plan: data?.plan ?? null,
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
