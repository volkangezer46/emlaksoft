-- K1 / P1-A5: varsayilan deneme suresi platform_settings'ten okunur.
-- Anahtar: platform_settings.key = 'default_trial_days' (1..90, yoksa 14).
-- Kayit (provision_registration) ve demo donusumu (convert_demo_request_to_tenant)
-- sabit "interval '14 days'" yerine bu yardimciyi kullanir. Fonksiyon govdeleri
-- yeniden yazilmaz: mevcut tanim okunur, yalniz sure ifadesi degistirilir
-- (imza, yetki ve diger mantik aynen korunur). Yeniden calistirilabilir.

create or replace function public.platform_default_trial_days()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select least(90, greatest(1, s.value::integer))
      from public.platform_settings s
      where s.key = 'default_trial_days'
        and s.value ~ '^[0-9]{1,3}$'
    ),
    14
  );
$$;

revoke all privileges on function public.platform_default_trial_days() from public, anon, authenticated;
grant execute on function public.platform_default_trial_days() to service_role;

comment on function public.platform_default_trial_days() is
  'Yeni ofis deneme suresi (gun). platform_settings.default_trial_days, 1..90, varsayilan 14.';

do $$
declare
  v_oid oid;
  v_def text;
begin
  for v_oid in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('provision_registration', 'convert_demo_request_to_tenant')
  loop
    v_def := pg_get_functiondef(v_oid);
    if position('interval ''14 days''' in v_def) > 0 then
      execute replace(
        v_def,
        'interval ''14 days''',
        'make_interval(days => public.platform_default_trial_days())'
      );
    end if;
  end loop;
end
$$;

notify pgrst, 'reload schema';
