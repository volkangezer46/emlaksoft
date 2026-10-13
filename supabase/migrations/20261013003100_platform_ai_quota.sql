-- SP2: platform AI kotasi (G9). Kiraci kredisi KULLANMAYAN platform cagrilarinin (SEO AI onerisi "seo.ai",
--   platform danismani "advisor.ai") aylik sayaci. Kisisel veri YOK: yalniz anahtar, donem ve sayac.
-- Tenant verisi DEGILDIR: RLS acik, politika yok -> yalniz service_role (RPC) erisir (seo_404_hits deseni).
-- platform_ai_quota_take(p_key, p_limit): TEK UPDATE ... WHERE used < p_limit RETURNING ile ATOMIK artis; ay degisince
--   (Europe/Istanbul) sayac 1'den baslar. Limit doluysa false. Esanli cagrilar satir kilidinde siralanir, limit asilmaz.
-- KOD DAVRANISI: tablo/RPC yoksa AI onerisi "kota kurulmadi" der ve KAPALI kalir (fail-closed); danisman limit ayari
--   yoksa kotaya hic bakmaz (mevcut davranis).
-- GERI ALMA: supabase/rollbacks/20261013003100_platform_ai_quota.rollback.sql
-- RISK: dusuk (yeni tablo + tek fonksiyon; mevcut nesnelere dokunmaz).

create table if not exists public.platform_ai_quota (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{1,40}$'),
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now()
);

alter table public.platform_ai_quota enable row level security;
-- Politika bilerek yok: anon/authenticated hicbir sey goremez; service_role RLS'i atlar.
revoke all on public.platform_ai_quota from anon, authenticated;
grant all on public.platform_ai_quota to service_role;

create or replace function public.platform_ai_quota_take(p_key text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text := to_char(now() at time zone 'Europe/Istanbul', 'YYYY-MM');
  v_ok boolean;
begin
  if p_key is null or p_key !~ '^[a-z][a-z0-9_.]{1,40}$' or p_limit is null or p_limit < 1 then
    return false;
  end if;
  insert into public.platform_ai_quota (key, period, used)
  values (p_key, v_period, 0)
  on conflict (key) do nothing;

  update public.platform_ai_quota
     set used = case when period = v_period then used + 1 else 1 end,
         period = v_period,
         updated_at = now()
   where key = p_key
     and (period <> v_period or used < p_limit)
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

revoke all on function public.platform_ai_quota_take(text, integer) from public, anon, authenticated;
grant execute on function public.platform_ai_quota_take(text, integer) to service_role;

comment on table public.platform_ai_quota is 'Platform AI cagrilarinin aylik sayaci (kiraci kredisi disi; SEO AI onerisi, platform danismani).';

notify pgrst, 'reload schema';
