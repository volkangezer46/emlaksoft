-- /admin kontrol paneli toplulaştırmaları (2026-10-08).
-- Önceden panel; audit_logs (14 gün), tenants (aktivasyon, deneme), subscriptions (ücretli, iptal nedeni) ve
-- account_credit_ledger (6 ay) satırlarını sayfalı çekip JS'te sayıyordu (PostgREST 1000 satır sınırı + ağ yükü).
-- Bu fonksiyon aynı sayıları tek sunucu turunda SQL toplulaştırmasıyla döndürür. YALNIZ service_role çağırır
-- (platform_reporting_aggregates ile aynı desen); tablo/politika/veri DEĞİŞMEZ, salt okunur.
create or replace function public.platform_dashboard_rollups(
  p_from timestamptz,
  p_now timestamptz default now(),
  p_activity_from timestamptz default (now() - interval '14 days'),
  p_ledger_from timestamptz default (now() - interval '6 months'),
  p_units text[] default array['ai','valuation','ef']
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    -- ofis başına son 14 gün denetim hareketi (sayı + son zaman)
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object('tenant_id', a.tenant_id, 'events', a.events, 'last_at', a.last_at))
      from (
        select l.tenant_id, count(*)::int as events, max(l.created_at) as last_at
        from public.audit_logs l
        where l.tenant_id is not null and l.created_at >= p_activity_from
        group by l.tenant_id
      ) a
    ), '[]'::jsonb),
    -- gün x etkin ofis sayısı (aynı pencere; ofis başına tekilleştirilmiş)
    'activity_days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'events', d.events, 'tenants', d.tenants) order by d.day)
      from (
        select to_char(l.created_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD') as day,
               count(*)::int as events,
               count(distinct l.tenant_id)::int as tenants
        from public.audit_logs l
        where l.tenant_id is not null and l.created_at >= p_activity_from
        group by 1
      ) d
    ), '[]'::jsonb),
    -- aktivasyon hunisi: dönemde kayıt olan ofisler (örnek veri hariç gerçek portföy/anlaşma)
    'funnel', (
      select jsonb_build_object(
        'registered', count(*)::int,
        'with_property', count(*) filter (where p.cnt > 0)::int,
        'with_deal', count(*) filter (where p.cnt > 0 and d.cnt > 0)::int
      )
      from public.tenants t
      cross join lateral (
        select count(*) as cnt from public.properties x where x.tenant_id = t.id and x.is_sample = false
      ) p
      cross join lateral (
        select count(*) as cnt from public.deals x where x.tenant_id = t.id and x.is_sample = false
      ) d
      where t.created_at >= p_from
    ),
    -- deneme -> ücretli: dönemde denemesi biten ofisler; bugün ücretli aktif aboneliği olanlar
    'trial', (
      select jsonb_build_object(
        'ended', count(*)::int,
        'converted', count(*) filter (
          where t.status = 'active'
            and exists (
              select 1 from public.subscriptions s
              where s.tenant_id = t.id and s.status = 'active' and s.amount_try > 0
            )
        )::int
      )
      from public.tenants t
      where t.trial_ends_at >= p_from and t.trial_ends_at <= p_now
    ),
    -- iptal nedenleri: boşluk/büyük-küçük harf birleştirilmiş gruplar (en çok 20)
    'cancel_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('reason', g.reason, 'count', g.cnt) order by g.cnt desc, g.reason)
      from (
        select min(coalesce(nullif(btrim(regexp_replace(s.cancel_reason, '\s+', ' ', 'g')), ''), 'Neden belirtilmedi')) as reason,
               count(*)::int as cnt
        from public.subscriptions s
        where s.cancel_requested_at is not null
        group by lower(coalesce(nullif(btrim(regexp_replace(s.cancel_reason, '\s+', ' ', 'g')), ''), 'Neden belirtilmedi'))
        order by count(*) desc
        limit 20
      ) g
    ), '[]'::jsonb),
    -- aylık tüketim (TR takvim ayı x birim): harcama kayıtlarının mutlak toplamı
    'ledger_months', coalesce((
      select jsonb_agg(jsonb_build_object('unit', m.unit, 'month', m.month, 'total', m.total))
      from (
        select c.unit,
               to_char(c.available_at at time zone 'Europe/Istanbul', 'YYYY-MM') as month,
               sum(abs(c.amount))::numeric(18,2) as total
        from public.account_credit_ledger c
        where c.entry_type = 'spend' and c.unit = any(p_units) and c.available_at >= p_ledger_from
        group by 1, 2
      ) m
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.platform_dashboard_rollups(timestamptz, timestamptz, timestamptz, timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.platform_dashboard_rollups(timestamptz, timestamptz, timestamptz, timestamptz, text[]) to service_role;

notify pgrst, 'reload schema';
