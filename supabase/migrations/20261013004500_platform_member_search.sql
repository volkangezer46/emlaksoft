-- AD6: Platform üye araması tek turda (salt okunur; tablo/politika/veri DEĞİŞMEZ).
-- Güvenlik modeli platform_growth_funnel ile aynı: SECURITY DEFINER, search_path boş, YALNIZ service_role
-- (çağıran personel kapısını uygulama katmanında geçer: requirePlatformModule("members")).
--
-- NEDEN: destek ekibi üyeyi çoğu zaman E-POSTA ile arar; e-posta ve son giriş auth.users'tadır ve PostgREST
--   auth şemasını açmaz. Önceki yol (profil sorgusu + satır başına getUserById) e-postayla arayamıyor,
--   "hiç giriş yapmadı / 30+ gün" süzgeci kuramıyordu. Bu fonksiyon profil + ofis + şube + auth.users'ı tek
--   sorguda birleştirir; sayfalama ve toplam sayı (count(*) over ()) aynı turda döner.
-- Süzgeçler (hepsi isteğe bağlı, null = süzme yok):
--   p_q          ad soyad / e-posta / telefon içinde arar (LIKE jokerleri kaçışlanır; telefonda yalnız rakamlar da eşleşir)
--   p_tenant     ofis, p_branch şube, p_role rol, p_active aktif/pasif, p_two_factor SMS 2FA açık/kapalı
--   p_login      'never' (hiç giriş yok) | 'recent' (son 7 gün) | 'stale' (30+ gündür giriş yok, hiç girmeyenler dahil değil)
--   p_ids        yalnız bu kimlikler (rapor zenginleştirme)
-- Sınırlar: p_limit 1..200, p_offset >= 0.
-- KOD: fonksiyon yokken üye listesi eski profil sorgusuna düşer (e-posta araması ve giriş/2FA süzgeçleri "kurulum bekliyor").
-- GERİ ALMA: supabase/rollbacks/20261013004500_platform_member_search.rollback.sql (yalnız fonksiyon düşer).

create or replace function public.platform_member_search(
  p_q text default null,
  p_tenant uuid default null,
  p_active boolean default null,
  p_role text default null,
  p_branch uuid default null,
  p_two_factor boolean default null,
  p_login text default null,
  p_ids uuid[] default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  full_name text,
  phone text,
  role text,
  is_active boolean,
  created_at timestamptz,
  tenant_id uuid,
  tenant_name text,
  branch_id uuid,
  branch_name text,
  email text,
  last_sign_in_at timestamptz,
  two_factor_sms boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_q text := nullif(pg_catalog.btrim(coalesce(p_q, '')), '');
  v_like text;
  v_digits text;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_login is not null and p_login not in ('never', 'recent', 'stale') then
    raise exception 'invalid_login_filter' using errcode = '22023';
  end if;

  if v_q is not null then
    v_q := pg_catalog.left(v_q, 80);
    v_like := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := pg_catalog.regexp_replace(v_q, '\D', '', 'g');
    if pg_catalog.length(v_digits) < 4 then
      v_digits := null;
    end if;
  end if;

  return query
  select
    p.id,
    p.full_name::text,
    p.phone::text,
    p.role::text,
    p.is_active,
    p.created_at,
    p.tenant_id,
    t.name::text,
    p.branch_id,
    b.name::text,
    u.email::text,
    u.last_sign_in_at,
    coalesce(p.two_factor_sms, false),
    pg_catalog.count(*) over ()
  from public.profiles p
  left join public.tenants t on t.id = p.tenant_id
  left join public.branches b on b.id = p.branch_id
  left join auth.users u on u.id = p.id
  where (p_tenant is null or p.tenant_id = p_tenant)
    and (p_branch is null or p.branch_id = p_branch)
    and (p_role is null or p.role::text = p_role)
    and (p_active is null or p.is_active = p_active)
    and (p_two_factor is null or coalesce(p.two_factor_sms, false) = p_two_factor)
    and (p_ids is null or p.id = any (p_ids))
    and (
      p_login is null
      or (p_login = 'never' and u.last_sign_in_at is null)
      or (p_login = 'recent' and u.last_sign_in_at >= pg_catalog.now() - interval '7 days')
      or (p_login = 'stale' and u.last_sign_in_at < pg_catalog.now() - interval '30 days')
    )
    and (
      v_q is null
      or p.full_name ilike v_like
      or u.email ilike v_like
      or p.phone ilike v_like
      or (v_digits is not null and pg_catalog.regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || v_digits || '%')
    )
  order by p.created_at desc, p.id
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.platform_member_search(text, uuid, boolean, text, uuid, boolean, text, uuid[], integer, integer)
  from public, anon, authenticated;
grant execute on function public.platform_member_search(text, uuid, boolean, text, uuid, boolean, text, uuid[], integer, integer)
  to service_role;

comment on function public.platform_member_search(text, uuid, boolean, text, uuid, boolean, text, uuid[], integer, integer) is
  'Service-role-only: platform üye listesi (profil + ofis + şube + auth e-posta/son giriş), süzgeç + sayfalama tek turda.';

notify pgrst, 'reload schema';
