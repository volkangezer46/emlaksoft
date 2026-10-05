-- MIGRATION 20260826001100_ef_plan_credit_values.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826001100_ef_plan_credit_values.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826001100_ef_plan_credit_values.rollback.sql
-- BAGIMLILIK: platform_settings (000800 seed'i 'billing.plan_definitions' kaydini yazmis olabilir). SEMA DEGISMEZ (yalniz veri).
--
-- AMAC (WP3, sahip karari): plan kontor sayilarini kodla tutarli hale getirmek.
--   Ek kullanici basi aylik kontor (efCreditsPerExtraSeat): Danisman 5, Ofis 6, Profesyonel 6, Kurumsal 6.
--   Business (gizli) aylik hak 300 -> 240. Danisman/Ofis/Profesyonel/Kurumsal aylik haklari AYNI (10/40/120/400).
--   Tarife (arsa 5, konut 5, ilk PDF 2, detay 0) ve paket fiyatlari (299/990/2490/6900) DEGISMEZ.
-- "DOKUNULMAMIS" TANIMI: kayitta ilgili alan YOKSA (kod varsayilanina duser) ya da kodun ESKI varsayilanina esitse
--   (efCreditsMonthly: yalniz business 300; efCreditsPerExtraSeat: eski varsayilan yoktu -> alan yoksa) onerilene cekilir.
--   Admin baska bir deger (null dahil) girdiyse KORUNUR. Plan anahtari kayitta yoksa dokunulmaz (kod varsayilani zaten yeni).
--   Kayit yok/bos/gecersiz JSON ise hicbir sey yapilmaz. Ikinci calistirma hicbir satiri degistirmez (idempotent).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.platform_settings') is null then
    raise exception 'platform_settings tablosu yok; once temel migrationlar uygulanmali.';
  end if;
end $$;

do $$
declare
  v text;
  j jsonb;
  plans jsonb;
  p jsonb;
  k text;
  want_seat jsonb := '{"advisor":5,"office":6,"professional":6,"enterprise":6}'::jsonb;
  old_monthly jsonb := '{"business":300}'::jsonb;
  new_monthly jsonb := '{"business":240}'::jsonb;
begin
  select value into v from public.platform_settings where key = 'billing.plan_definitions';
  if v is null or nullif(btrim(v), '') is null then
    return;
  end if;
  begin
    j := v::jsonb;
  exception when others then
    return;
  end;
  if jsonb_typeof(j -> 'plans') is distinct from 'object' then
    return;
  end if;
  plans := j -> 'plans';

  for k in select jsonb_object_keys(plans) loop
    p := plans -> k;
    if jsonb_typeof(p) is distinct from 'object' then
      continue;
    end if;
    -- ek kullanici basi kontor: alan yoksa onerilen deger
    if want_seat ? k and not (p ? 'efCreditsPerExtraSeat') then
      p := jsonb_set(p, '{efCreditsPerExtraSeat}', want_seat -> k);
    end if;
    -- aylik hak: eski kod varsayilanina esitse yeni deger
    if old_monthly ? k and (p -> 'efCreditsMonthly') = (old_monthly -> k) then
      p := jsonb_set(p, '{efCreditsMonthly}', new_monthly -> k);
    end if;
    plans := jsonb_set(plans, array[k], p);
  end loop;

  if plans is distinct from (j -> 'plans') then
    update public.platform_settings
       set value = jsonb_set(j, '{plans}', plans)::text, updated_at = now()
     where key = 'billing.plan_definitions';
  end if;
end $$;