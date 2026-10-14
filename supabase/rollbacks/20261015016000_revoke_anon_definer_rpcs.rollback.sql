-- 20261015016000 geri alma: geri alinan EXECUTE yetkileri CANLIDAKI onceki haline doner (2026-10-15 salt-okunur proacl):
--   aidat_kpi()                  : PUBLIC (=X) + authenticated   -> PUBLIC geri verilir (anon PUBLIC uzerinden)
--   tcmb_rate_on(date)           : PUBLIC (=X) + authenticated + service_role -> PUBLIC geri verilir
--   log_property_price_change()  : PUBLIC + anon + authenticated + service_role -> PUBLIC + anon geri verilir
--   rls_auto_enable()            : PUBLIC + anon + authenticated + service_role -> PUBLIC + anon geri verilir (varsa)
--   increment_template_usage(uuid): canlida anon/PUBLIC zaten YOKTU -> dokunulmaz (gölge zincirindeki anon izni geri acilmaz)
-- NOT: geri alma uygulanirsa scripts/function-acl-allowlist.ts'e aidat_kpi / tcmb_rate_on girisleri de geri eklenmeli
--   (aksi halde check:acl anon-izin hatasi verir).
set local lock_timeout = '5s';

do $$
declare
  f text;
begin
  foreach f in array array['public.aidat_kpi()', 'public.tcmb_rate_on(date)'] loop
    if pg_catalog.to_regprocedure(f) is not null then
      execute format('grant execute on function %s to public', f);
    end if;
  end loop;
  foreach f in array array['public.log_property_price_change()', 'public.rls_auto_enable()'] loop
    if pg_catalog.to_regprocedure(f) is not null then
      execute format('grant execute on function %s to public, anon', f);
    end if;
  end loop;
end $$;
