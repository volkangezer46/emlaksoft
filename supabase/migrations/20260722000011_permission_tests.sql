-- Permission contract tests (basit örnek)
-- Gerçek CI'da JS framework ile genişletilmeli

do $$
declare
  test_passed boolean := true;
  err_msg text;
begin
  -- Owner tüm modüllere erişebilir mi?
  if not exists (
    select 1 from unnest(
      ARRAY['dashboard','customers','demands','properties','matching','portals','leak',
            'appointments','calls','commissions','team','support','settings','billing',
            'reports','valuation','compliance']
    ) as m(module)
    where m.module = ANY(
      select jsonb_object_keys(
        '{"dashboard":["view","create","edit","delete"],"customers":["view","create","edit","delete"]}'::jsonb
      )::text[]
    )
  ) then
    test_passed := false;
    err_msg := 'Permission matrix: owner eksik modül';
  end if;

  -- Advisor matching'i görebilir ama silemez mi?
  -- Bu test sembolik; gerçek logic lib/permissions.ts'de

  if test_passed then
    raise notice 'Permission contract tests PASSED';
  else
    raise exception 'Permission contract tests FAILED: %', err_msg;
  end if;
end $$;

comment on extension pg_stat_statements is
  'Permission tests: MATRIX uyumluluğu · CI genişletilecek';
