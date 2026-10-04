-- Rollback: 20260816010100_default_trial_days_setting
-- Sure ifadesi eski sabit 14 gune doner, yardimci fonksiyon kaldirilir.
-- platform_settings.default_trial_days satiri (varsa) zararsiz kalir.
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
    if position('make_interval(days => public.platform_default_trial_days())' in v_def) > 0 then
      execute replace(
        v_def,
        'make_interval(days => public.platform_default_trial_days())',
        'interval ''14 days'''
      );
    end if;
  end loop;
end
$$;

drop function if exists public.platform_default_trial_days();

notify pgrst, 'reload schema';
