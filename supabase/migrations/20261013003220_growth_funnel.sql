-- SP3: "Huni ve kanallar" ekranının tek turluk SQL toplulaştırması (salt okunur; tablo/politika/veri DEĞİŞMEZ).
-- Güvenlik modeli platform_dashboard_rollups ile aynı: SECURITY DEFINER, search_path boş, YALNIZ service_role.
--
-- Kanal başına: ziyaret (public_pageviews_daily, TR günü), kayıt (dönemde açılan ofisler; atıf satırı olmayan
--   ofis 'bilinmiyor', eski atıf satırında kanal boşsa 'unknown'), aktivasyon (ilk gerçek ilan: dashboard-rollups
--   with_property tanımı — örnek veri hariç en az bir portföy), ödeme (bugün aktif ücretli abonelik: status='active'
--   ve amount_try > 0), ilk ödemeye medyan gün (kayıttan ilk ödenmiş faturaya).
-- Bozuk veri null olur, sıfır uydurulmaz: ödeme zamanı kayıttan önceyse örnek dışı kalır; geçerli örnek yoksa medyan
--   null; dönemde hiç sayaç satırı yoksa ziyaret null ("ölçüm yok", 0 değil).
-- Bağımlılık: 20261013003200 (public_pageviews_daily) ve 20261013003210 (signup_attributions.channel) SONRASI.
-- GERİ ALMA: supabase/rollbacks/20261013003220_growth_funnel.rollback.sql (yalnız fonksiyon düşer).

create or replace function public.platform_growth_funnel(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_has_pv boolean;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  -- TR takvim günü sınırları (yarı açık aralık).
  v_from := p_from::timestamp at time zone 'Europe/Istanbul';
  v_to := (p_to + 1)::timestamp at time zone 'Europe/Istanbul';
  v_has_pv := exists (select 1 from public.public_pageviews_daily d where d.day between p_from and p_to);

  with signups as (
    select t.id,
           t.created_at,
           case when sa.tenant_id is null then 'bilinmiyor' else coalesce(sa.channel, 'unknown') end as channel,
           sa.landing_path,
           exists (select 1 from public.properties x where x.tenant_id = t.id and x.is_sample = false) as activated,
           exists (
             select 1 from public.subscriptions s
             where s.tenant_id = t.id and s.status = 'active' and coalesce(s.amount_try, 0) > 0
           ) as paid,
           (
             select min(i.paid_at) from public.invoices i
             where i.tenant_id = t.id and i.status = 'paid' and i.paid_at is not null
               and coalesce(i.total_try, i.amount_try, 0) > 0
           ) as first_paid_at
    from public.tenants t
    left join public.signup_attributions sa on sa.tenant_id = t.id
    where t.created_at >= v_from and t.created_at < v_to
  ),
  per_signup as (
    select s.channel,
           count(*)::int as signups,
           count(*) filter (where s.activated)::int as activated,
           count(*) filter (where s.paid)::int as paid,
           count(*) filter (where s.first_paid_at is not null and s.first_paid_at >= s.created_at)::int as paid_samples,
           percentile_cont(0.5) within group (order by extract(epoch from (s.first_paid_at - s.created_at)) / 86400.0)
             filter (where s.first_paid_at is not null and s.first_paid_at >= s.created_at) as median_days
    from signups s
    group by s.channel
  ),
  per_visit as (
    select d.channel, sum(d.n)::bigint as visits
    from public.public_pageviews_daily d
    where d.day between p_from and p_to
    group by d.channel
  ),
  merged as (
    select coalesce(ps.channel, pv.channel) as channel,
           case when coalesce(ps.channel, pv.channel) = 'bilinmiyor' or not v_has_pv then null else coalesce(pv.visits, 0) end as visits,
           coalesce(ps.signups, 0) as signups,
           coalesce(ps.activated, 0) as activated,
           coalesce(ps.paid, 0) as paid,
           coalesce(ps.paid_samples, 0) as paid_samples,
           case when ps.median_days is null then null else round(ps.median_days::numeric, 1) end as median_days
    from per_signup ps
    full outer join per_visit pv on pv.channel = ps.channel
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'has_pageviews', v_has_pv,
    'measure_started', (select min(d.day) from public.public_pageviews_daily d),
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel', m.channel,
        'visits', m.visits,
        'signups', m.signups,
        'activated', m.activated,
        'paid', m.paid,
        'paid_samples', m.paid_samples,
        'median_days_to_paid', m.median_days
      ) order by m.signups desc, m.visits desc nulls last, m.channel)
      from merged m
    ), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
        'signups', count(*)::int,
        'attributed', count(*) filter (where s.channel not in ('bilinmiyor', 'unknown'))::int,
        'activated', count(*) filter (where s.activated)::int,
        'paid', count(*) filter (where s.paid)::int
      )
      from signups s
    ),
    -- İniş yolları: dönemin en çok ziyaret alan 50 yol şablonu + iniş yolu kayıtlı kayıtların yolları (kayıt/ödeme).
    'landings', coalesce((
      select jsonb_agg(jsonb_build_object('path', l.path, 'visits', l.visits, 'signups', l.signups, 'paid', l.paid)
                       order by l.visits desc nulls last, l.signups desc, l.path)
      from (
        select coalesce(v.path, g.path) as path,
               case when v_has_pv then coalesce(v.visits, 0) else null end as visits,
               coalesce(g.signups, 0) as signups,
               coalesce(g.paid, 0) as paid
        from (
          select d.path_tpl as path, sum(d.n)::bigint as visits
          from public.public_pageviews_daily d
          where d.day between p_from and p_to
          group by d.path_tpl
          order by sum(d.n) desc, d.path_tpl
          limit 50
        ) v
        full outer join (
          select s.landing_path as path, count(*)::int as signups, count(*) filter (where s.paid)::int as paid
          from signups s
          where s.landing_path is not null
          group by s.landing_path
        ) g on g.path = v.path
        limit 80
      ) l
    ), '[]'::jsonb),
    'visits_total', case when v_has_pv then (
      select coalesce(sum(d.n), 0)::bigint from public.public_pageviews_daily d where d.day between p_from and p_to
    ) else null end
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.platform_growth_funnel(date, date) from public, anon, authenticated;
grant execute on function public.platform_growth_funnel(date, date) to service_role;

notify pgrst, 'reload schema';
