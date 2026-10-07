-- MIGRATION 20261007000810_expense_aggregates_sample_scope.sql (PB53)
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261007000810_expense_aggregates_sample_scope.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261007000810_expense_aggregates_sample_scope.rollback.sql (20260802000440 govdesi aynen).
--
-- NEDEN: Giderler sayfasi (/app/giderler) KPI/kirilim/trend rakamlarini tenant_expense_aggregates'ten alir (20260802000440).
--   Bu fonksiyon is_sample SUZMUYORDU: ofis gercek kullanima gectikten sonra da ornek (demo) giderler toplamlara
--   karisiyordu. Raporlar ve Komisyon toplulastirmalari (20261006000710) ayni esik kuralina baglanmisti; bu dosya
--   Giderler'i AYNI kurala baglar.
--
-- KURAL (src/lib/sample-scope.ts includeSample ile BIREBIR, 20261006000710 ile ayni): ofiste gercek (is_sample = false,
--   silinmemis) musteri VE portfoy sayisi esigin ALTINDAYSA ornek kayitlar dahil, degilse dislanir. Esik parametredir:
--   p_sample_threshold (varsayilan 5 = SAMPLE_KPI_THRESHOLD; null -> 5, negatif -> 0 = her zaman dislanir). Karar
--   donuste 'sample_included' olarak yer alir (UI etiketi buna bakar).
--
-- IMZA: (date, date, timestamptz) -> (date, date, timestamptz, integer default 5). Iki varsayilanli overload belirsizlik
--   yaratacagindan eski imza DUSURULUR ve yenisi olusturulur (ayni transaction). Mevcut cagiranlar degismeden calisir.
--   Yetki/tenant kapisi, sonuc anahtarlari ve hesaplar AYNEN korunur; yalniz is_sample kosulu ve sample_included eklenir.
-- BAGIMLILIK: 20260802000440 (fonksiyon), expenses.is_sample (20260816001600; CANLIDA).

set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  foreach t in array array['customers', 'properties', 'expenses']
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'is_sample'
    ) then
      raise exception '20261007000810: %.is_sample yok; once 20260726000086/096 ve 20260816001600 uygulanmali.', t;
    end if;
  end loop;
  if to_regprocedure('public.current_active_tenant_id()') is null
     or to_regprocedure('public.has_effective_permission(text, text)') is null then
    raise exception '20261007000810: current_active_tenant_id / has_effective_permission yok.';
  end if;
end
$$;

drop function if exists public.tenant_expense_aggregates(date, date, timestamptz);

create or replace function public.tenant_expense_aggregates(
  p_from date default null,
  p_to date default null,
  p_as_of timestamptz default now(),
  p_sample_threshold integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_active_tenant_id();
  v_threshold integer := greatest(coalesce(p_sample_threshold, 5), 0);
  v_real_customers bigint;
  v_real_properties bigint;
  v_include boolean;
  v_result jsonb;
begin
  if v_tenant is null or not public.has_effective_permission('expenses', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Ornek veri kapsami (src/lib/sample-scope.ts includeSample ile ayni).
  select count(*) into v_real_customers from public.customers c
   where c.tenant_id = v_tenant and c.is_sample = false and c.deleted_at is null;
  select count(*) into v_real_properties from public.properties p
   where p.tenant_id = v_tenant and p.is_sample = false and p.deleted_at is null;
  v_include := (v_real_customers < v_threshold and v_real_properties < v_threshold);

  with bounds as (
    select date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' as month_start
  ),
  scoped as (
    -- ?from=/?to= tarih araligi — sayfadaki "Toplam gider"/"Kayit"/kategori kirilimi bu araliga saygilidir
    select e.*
    from public.expenses e
    where e.tenant_id = v_tenant
      and (v_include or e.is_sample = false)
      and (p_from is null or e.expense_date >= p_from)
      and (p_to is null or e.expense_date <= p_to)
  ),
  totals as (
    select coalesce(sum(amount), 0) as total, count(*) as record_count
    from scoped
  ),
  by_category as (
    select category, coalesce(sum(amount), 0) as total
    from scoped
    group by category
  ),
  month_axis as (
    -- Son 6 ay trendi — ?from=/?to= filtresinden BAGIMSIZ (sayfadaki mevcut sozlesme)
    select generate_series(
      (select month_start from bounds) - interval '5 months',
      (select month_start from bounds),
      interval '1 month'
    ) as month_start
  ),
  monthly as (
    select m.month_start,
      coalesce((
        select sum(e.amount) from public.expenses e
        where e.tenant_id = v_tenant
          and (v_include or e.is_sample = false)
          and e.expense_date >= m.month_start::date
          and e.expense_date < (m.month_start + interval '1 month')::date
      ), 0) as total
    from month_axis m
  )
  select jsonb_build_object(
    'total', t.total,
    'record_count', t.record_count,
    'by_category', coalesce((select jsonb_agg(to_jsonb(bc) order by bc.total desc, bc.category) from by_category bc), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(to_jsonb(m) order by m.month_start) from monthly m), '[]'::jsonb),
    'sample_included', v_include
  ) into v_result
  from totals t;

  return v_result;
end;
$$;

revoke all on function public.tenant_expense_aggregates(date, date, timestamptz, integer) from public, anon;
grant execute on function public.tenant_expense_aggregates(date, date, timestamptz, integer) to authenticated;

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur, uygulamadan SONRA):
-- select pg_get_function_identity_arguments(p.oid) from pg_catalog.pg_proc p
-- join pg_catalog.pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'tenant_expense_aggregates';
-- BEKLENEN: tek satir, p_from date, p_to date, p_as_of timestamp with time zone, p_sample_threshold integer.
