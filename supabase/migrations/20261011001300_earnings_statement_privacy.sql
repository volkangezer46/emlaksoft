-- Kazanç gizliliği (toplulaştırma RPC'leri) + ekstre satırı maaş/hesap gizliliği.
--
-- BULGU (Konsey Tur 2 #38+#39):
--  * tenant_commission_aggregates() ve tenant_reporting_aggregates() SECURITY DEFINER olduğundan commissions RLS'ini (kazanç gizliliği,
--    20260816000500) atlıyordu: commissions:view/reports:view sahibi her danışman, earnings_all:view OLMASA bile ofis toplamını ve
--    TÜM danışmanların payını (advisors dağılımı) okuyabiliyordu.
--  * finance_statement_lines_select yalnız hesap varlığına bakıyordu: maaş ödemesine bağlı (eşleşen/onaylanan) satır ve ham banka
--    açıklaması taşıyan bekleyen satırlar, hareket politikasındaki maaş süzgecini atlayarak muhasebe rolüne açıktı.
-- ÇÖZÜM:
--  1) Her iki fonksiyon: earnings_all:view yoksa komisyon verisi yalnız kullanıcının KENDİ kayıtlarıyla sınırlıdır (atanan danışman veya
--     commission_splits payı; can_view_commission_earnings ile aynı anlam); tenant_commission_aggregates advisors=[] döner.
--     Gövdeler son tanımdan alınmıştır (tenant_commission_aggregates = 20261011001000, tenant_reporting_aggregates = 20261006000710;
--     imza/ACL aynı, yalnız kapı eklendi). Uygulamadan önce canlı pg_get_functiondef ile karşılaştırın.
--  2) finance_statement_lines_select: hesap görünürlüğü + bekleyen/atlanan satır yalnız expenses:create sahibine + onaylanan/eşleşen
--     satır bağlı hareket maaşsa yalnız owner/gm. imports/mappings: finance_account_access(...,'view') ile açık hesap görünürlüğü
--     (davranış aynı; meta veri, maaş içermez).
-- Yazma yolları (RPC'ler) DEĞİŞMEZ. GERİ ALMA: supabase/rollbacks/20261011001300_earnings_statement_privacy.rollback.sql
-- BAĞIMLILIK: 20260816000200 (commission_splits), 20261010000600, 20261011001200. RİSK: orta (danışman/muhasebe ekranları daralır).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.commission_splits') is null
     or pg_catalog.to_regclass('public.finance_statement_lines') is null
     or pg_catalog.to_regprocedure('public.finance_account_access(uuid,text)') is null
     or pg_catalog.to_regprocedure('public.finance_is_owner_gm()') is null then
    raise exception '20261011001300: commission_splits veya 20261011001200 (finance_statement_lines) yok.';
  end if;
end $$;

create or replace function public.tenant_commission_aggregates(
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
  v_all boolean;
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_tenant is null or not public.has_effective_permission('commissions', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Kazanç gizliliği: earnings_all:view yoksa yalnız KENDİ kayıtları (atanan danışman veya payı olan) toplanır; dağılım boş döner.
  v_all := public.has_effective_permission('earnings_all', 'view');

  -- Ornek veri kapsami (src/lib/sample-scope.ts includeSample ile ayni).
  select count(*) into v_real_customers from public.customers c
   where c.tenant_id = v_tenant and c.is_sample = false and c.deleted_at is null;
  select count(*) into v_real_properties from public.properties p
   where p.tenant_id = v_tenant and p.is_sample = false and p.deleted_at is null;
  v_include := (v_real_customers < v_threshold and v_real_properties < v_threshold);

  with bounds as (
    -- Ay siniri Istanbul yerel saatine gore (bkz. 20260802000340).
    select date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' as month_start
  ),
  scoped as (
    select c.* from public.commissions c
    where c.tenant_id = v_tenant and (v_include or c.is_sample = false)
      and (v_all
           or exists (select 1 from public.deals d where d.id = c.deal_id and d.tenant_id = c.tenant_id and d.assigned_to = v_uid)
           or exists (select 1 from public.commission_splits cs where cs.commission_id = c.id and cs.tenant_id = c.tenant_id and cs.profile_id = v_uid))
  ),
  totals as (
    select
      coalesce(sum(c.gross_amount), 0) as total,
      coalesce(sum(c.gross_amount) filter (where c.status in ('paid', 'collected')), 0) as paid,
      count(*) as record_count
    from scoped c
  ),
  current_month as (
    select
      coalesce(sum(c.gross_amount), 0) as total,
      coalesce(sum(c.gross_amount) filter (where c.status in ('paid', 'collected')), 0) as paid,
      count(*) as record_count
    from scoped c, bounds b
    where c.created_at >= b.month_start
      and c.created_at < b.month_start + interval '1 month'
  ),
  month_axis as (
    select generate_series(
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' - interval '5 months',
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul',
      interval '1 month'
    ) as month_start
  ),
  monthly as (
    select
      m.month_start,
      coalesce(sum(c.gross_amount), 0) as accrued,
      coalesce(sum(c.gross_amount) filter (where c.status in ('paid', 'collected')), 0) as paid
    from month_axis m
    left join scoped c
      on c.created_at >= m.month_start
     and c.created_at < m.month_start + interval '1 month'
    group by m.month_start
    order by m.month_start
  ),
  split_rows as (
    select
      nullif(s.item ->> 'profile_id', '')::uuid as profile_id,
      btrim(s.item ->> 'label') as label,
      coalesce((s.item ->> 'unresolved')::boolean, false) as unresolved,
      c.id,
      c.gross_amount *
        case
          when coalesce(s.item ->> 'rate', '') ~ '^[0-9]+([.][0-9]+)?$'
            then (s.item ->> 'rate')::numeric / 100
          else 0
        end as pay
    from scoped c
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.splits) = 'array' then c.splits else '[]'::jsonb end
    ) as s(item)
    where nullif(btrim(s.item ->> 'label'), '') is not null
  ),
  -- Taraf kimliği profile_id'dir (Konsey #0+#8): aynı etiketli iki kişi birleşmez; profil adı güncel adı gösterir.
  advisors as (
    select coalesce(max(p.full_name), max(r.label)) as label,
           r.profile_id,
           bool_or(r.unresolved) as unresolved,
           coalesce(sum(r.pay), 0) as pay,
           count(distinct r.id) as record_count
    from split_rows r
    left join public.profiles p on p.id = r.profile_id and p.tenant_id = v_tenant
    where r.pay > 0 and v_all
    group by coalesce(r.profile_id::text, r.label), r.profile_id
    order by pay desc, 1
    limit 8
  )
  select jsonb_build_object(
    'total', t.total,
    'paid', t.paid,
    'pending', t.total - t.paid,
    'record_count', t.record_count,
    'month_total', cm.total,
    'month_paid', cm.paid,
    'month_pending', cm.total - cm.paid,
    'month_record_count', cm.record_count,
    'monthly', coalesce((select jsonb_agg(to_jsonb(m) order by m.month_start) from monthly m), '[]'::jsonb),
    'advisors', coalesce((select jsonb_agg(to_jsonb(a) order by a.pay desc, a.label) from advisors a), '[]'::jsonb),
    'sample_included', v_include
  ) into v_result
  from totals t cross join current_month cm;

  return v_result;
end;
$$;

create or replace function public.tenant_reporting_aggregates(
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
  v_all boolean;
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_tenant is null or not public.has_effective_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Kazanç gizliliği: earnings_all:view yoksa komisyon toplamları yalnız KENDİ kayıtlarını içerir (ofis toplamı sızmaz).
  v_all := public.has_effective_permission('earnings_all', 'view');

  -- Ornek veri kapsami (src/lib/sample-scope.ts includeSample ile ayni).
  select count(*) into v_real_customers from public.customers c
   where c.tenant_id = v_tenant and c.is_sample = false and c.deleted_at is null;
  select count(*) into v_real_properties from public.properties p
   where p.tenant_id = v_tenant and p.is_sample = false and p.deleted_at is null;
  v_include := (v_real_customers < v_threshold and v_real_properties < v_threshold);

  with bounds as (
    -- Ay siniri Istanbul yerel saatine gore - bkz. tenant_commission_aggregates.
    select
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' as month_start,
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' - interval '1 month' as prev_month_start,
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' - interval '11 months' as trend_start,
      p_as_of - interval '7 days' as seven_days_ago,
      p_as_of - interval '30 days' as thirty_days_ago
  ),
  summary as (
    select
      (select count(*) from public.customers c where c.tenant_id = v_tenant and c.deleted_at is null and (v_include or c.is_sample = false)) as customers,
      (select count(*) from public.customer_demands d where d.tenant_id = v_tenant and d.status in ('new','active','matched') and (v_include or d.is_sample = false)) as demands,
      (select count(*) from public.properties p where p.tenant_id = v_tenant and p.deleted_at is null and (v_include or p.is_sample = false)) as properties,
      (select count(*) from public.portal_listings p where p.tenant_id = v_tenant and p.status = 'live') as live_portals,
      (select count(*) from public.portal_listings p, bounds b where p.tenant_id = v_tenant and p.status = 'live' and (p.last_confirmed_at is null or p.last_confirmed_at < b.seven_days_ago)) as overdue_confirmations,
      (select coalesce(sum(c.gross_amount), 0) from public.commissions c, bounds b where c.tenant_id = v_tenant and c.created_at >= b.month_start and c.created_at < b.month_start + interval '1 month' and (v_include or c.is_sample = false) and (v_all
               or exists (select 1 from public.deals dd where dd.id = c.deal_id and dd.tenant_id = c.tenant_id and dd.assigned_to = v_uid)
               or exists (select 1 from public.commission_splits cs where cs.commission_id = c.id and cs.tenant_id = c.tenant_id and cs.profile_id = v_uid))) as month_commission,
      (select coalesce(sum(l.estimated_lost_commission), 0) from public.listing_closures l, bounds b where l.tenant_id = v_tenant and l.created_at >= b.month_start and l.created_at < b.month_start + interval '1 month') as month_lost,
      (select coalesce(sum(l.estimated_lost_commission), 0) from public.listing_closures l, bounds b where l.tenant_id = v_tenant and l.created_at >= b.prev_month_start and l.created_at < b.month_start) as prev_month_lost,
      (select count(*) from public.customer_demands d, bounds b where d.tenant_id = v_tenant and d.created_at >= b.month_start and d.created_at < b.month_start + interval '1 month' and (v_include or d.is_sample = false)) as month_new_demands,
      (select count(*) from public.customer_demands d, bounds b where d.tenant_id = v_tenant and d.created_at >= b.prev_month_start and d.created_at < b.month_start and (v_include or d.is_sample = false)) as prev_month_new_demands,
      (select count(*) from public.listing_closures l, bounds b where l.tenant_id = v_tenant and l.created_at >= b.thirty_days_ago) as closures_30d,
      (select count(*) from public.appointments a, bounds b where a.tenant_id = v_tenant and a.scheduled_at >= b.seven_days_ago and a.scheduled_at <= p_as_of and (v_include or a.is_sample = false)) as appointments_7d,
      (select count(*) from public.calls c, bounds b where c.tenant_id = v_tenant and c.started_at >= b.seven_days_ago and c.started_at <= p_as_of and (v_include or c.is_sample = false)) as calls_7d
  ),
  customer_sources as (
    select coalesce(nullif(btrim(c.source), ''), 'Belirtilmedi') as source, count(*) as customer_count
    from public.customers c
    where c.tenant_id = v_tenant and c.deleted_at is null and (v_include or c.is_sample = false)
    group by 1
  ),
  lost_reasons as (
    select coalesce(nullif(btrim(d.loss_reason), ''), 'Belirtilmedi') as reason,
           count(*) as deal_count, coalesce(sum(d.deal_value), 0) as deal_value
    from public.deals d
    where d.tenant_id = v_tenant and d.stage = 'lost' and (v_include or d.is_sample = false)
    group by 1
  ),
  won_sources as (
    select coalesce(nullif(btrim(c.source), ''), 'Belirtilmedi') as source,
           count(*) as won_count, coalesce(sum(d.deal_value), 0) as won_value
    from public.deals d
    join public.customers c on c.id = d.customer_id and c.tenant_id = d.tenant_id
    where d.tenant_id = v_tenant and d.stage = 'won' and (v_include or d.is_sample = false)
    group by 1
  ),
  roi as (
    select coalesce(cs.source, ws.source) as source,
           coalesce(cs.customer_count, 0) as customers,
           coalesce(ws.won_count, 0) as won_count,
           coalesce(ws.won_value, 0) as won_value
    from customer_sources cs
    full join won_sources ws using (source)
  ),
  month_axis as (
    select generate_series(
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' - interval '11 months',
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul',
      interval '1 month'
    ) as month_start
  ),
  monthly as (
    select m.month_start,
      coalesce((select sum(c.gross_amount) from public.commissions c where c.tenant_id = v_tenant and c.created_at >= m.month_start and c.created_at < m.month_start + interval '1 month' and (v_include or c.is_sample = false) and (v_all
               or exists (select 1 from public.deals dd where dd.id = c.deal_id and dd.tenant_id = c.tenant_id and dd.assigned_to = v_uid)
               or exists (select 1 from public.commission_splits cs where cs.commission_id = c.id and cs.tenant_id = c.tenant_id and cs.profile_id = v_uid))), 0) as income,
      coalesce((select sum(e.amount) from public.expenses e where e.tenant_id = v_tenant and e.expense_date >= m.month_start::date and e.expense_date < (m.month_start + interval '1 month')::date and (v_include or e.is_sample = false)), 0) as expense
    from month_axis m
  )
  select jsonb_build_object(
    'summary', to_jsonb(s),
    'customer_sources', coalesce((select jsonb_agg(to_jsonb(x) order by x.customer_count desc, x.source) from customer_sources x), '[]'::jsonb),
    'loss_reasons', coalesce((select jsonb_agg(to_jsonb(x) order by x.deal_count desc, x.deal_value desc, x.reason) from lost_reasons x), '[]'::jsonb),
    'roi', coalesce((select jsonb_agg(to_jsonb(x) order by x.won_value desc, x.won_count desc, x.customers desc, x.source) from roi x), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(to_jsonb(x) order by x.month_start) from monthly x), '[]'::jsonb),
    'sample_included', v_include
  ) into v_result
  from summary s;

  return v_result;
end;
$$;

revoke all on function public.tenant_commission_aggregates(timestamptz, integer) from public, anon;
grant execute on function public.tenant_commission_aggregates(timestamptz, integer) to authenticated;
revoke all on function public.tenant_reporting_aggregates(timestamptz, integer) from public, anon;
grant execute on function public.tenant_reporting_aggregates(timestamptz, integer) to authenticated;

-- Ekstre okuma politikaları: hesap görünürlüğü + maaş/bekleyen satır süzgeci.
--  * Kişisel hesap: yalnız sahibi (her satır).
--  * Ofis hesabı: expenses:view şart; BEKLEYEN/ATLANAN satır (ham banka açıklaması, maaş içerebilir) yalnız expenses:create sahibine;
--    onaylanan/eşleşen satır bağlı hareket maaş (category='maas') ise yalnız owner/gm'ye, bağlı hareket yoksa kimseye (service_role hariç).
drop policy if exists finance_statement_imports_select on public.finance_statement_imports;
create policy finance_statement_imports_select on public.finance_statement_imports
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.finance_account_access(finance_statement_imports.account_id, 'view'))
  );

drop policy if exists finance_statement_lines_select on public.finance_statement_lines;
create policy finance_statement_lines_select on public.finance_statement_lines
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and exists (
      select 1 from public.finance_accounts a
      where a.id = finance_statement_lines.account_id and a.tenant_id = finance_statement_lines.tenant_id
        and (
          (a.owner_scope = 'user' and a.owner_user_id = (select auth.uid()))
          or (
            a.owner_scope = 'office'
            and (select public.has_effective_permission('expenses', 'view'))
            and (
              (finance_statement_lines.status in ('pending', 'skipped') and (select public.has_effective_permission('expenses', 'create')))
              or (
                finance_statement_lines.status in ('posted', 'matched')
                and exists (
                  select 1 from public.cash_entries e
                  where e.id = finance_statement_lines.entry_id and e.tenant_id = finance_statement_lines.tenant_id
                    and (e.category is distinct from 'maas' or (select public.finance_is_owner_gm()))
                )
              )
            )
          )
        )
    )
  );

-- Eşleme (sütun haritası) kişisel veri taşımaz; yine de hesap görünürlüğü açık yardımcıyla uygulanır.
drop policy if exists finance_statement_mappings_select on public.finance_statement_mappings;
create policy finance_statement_mappings_select on public.finance_statement_mappings
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.finance_account_access(finance_statement_mappings.account_id, 'view'))
  );

notify pgrst, 'reload schema';
