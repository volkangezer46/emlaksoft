-- MIGRATION 20261018060000_campaign_report_rpc.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Geri alma: supabase/rollbacks/20261018060000_campaign_report_rpc.rollback.sql (iki fonksiyon duser).
-- BAGIMLILIK: public.campaigns, campaign_recipients, communications, calls, appointments, iys_consents, customers.
--
-- AMAC (COM-08 / COM-09): kampanya detayi alicilari 500 satirda kesip KPI'lari bellekte sayiyordu; buyuk kampanyada
--   sayilar yanlisti ve kampanyanin sonucu (yanit, randevu, ret) hic olculmuyordu.
--  1) campaign_report(p_campaign_id, p_window_days): durum bazinda gercek sayilar + en sik 10 hata nedeni + atif penceresi
--     (varsayilan 7 gun) icindeki sonuclar: yanit veren (ayni musteriden gelen mesaj ya da arama), randevuya donen
--     (pencerede olusturulan randevu), ret eden (pencerede kampanya kanalinda izni geri cekilen).
--  2) campaign_recipient_page(p_campaign_id, p_durum, p_window_days, p_limit, p_offset): ayni suzgecle sunucu sayfalamasi
--     (durum: '' | ulasan | pending | failed | opted_out | yanit | randevu | ret) + toplam satir.
-- GUVENLIK: SECURITY INVOKER (cagiranin RLS'i gecerli) + search_path='' + acik kiraci kosulu
--   (campaigns.tenant_id = current_tenant_id()). Yalniz authenticated calistirir.
-- ETKI: ek (yalniz yeni fonksiyon; tablo/veri/politika degismez).
set local lock_timeout = '5s';

create or replace function public.campaign_report(p_campaign_id uuid, p_window_days integer default 7)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with camp as (
    select c.id, c.channel::text as channel
    from public.campaigns c
    where c.id = p_campaign_id
      and c.tenant_id = (select public.current_tenant_id())
  ),
  win as (
    select greatest(1, least(coalesce(p_window_days, 7), 30)) as days
  ),
  rcp as (
    select r.id, r.customer_id, r.status::text as status, r.error_msg, r.sent_at
    from public.campaign_recipients r
    join camp on camp.id = r.campaign_id
  ),
  reached as (
    select r.customer_id, min(r.sent_at) as sent_at
    from rcp r
    where r.status in ('sent', 'delivered') and r.customer_id is not null and r.sent_at is not null
    group by r.customer_id
  ),
  replied as (
    select x.customer_id
    from reached x, win
    where exists (
        select 1 from public.communications m
        where m.customer_id = x.customer_id and m.direction = 'inbound'
          and m.created_at >= x.sent_at and m.created_at < x.sent_at + make_interval(days => win.days)
      )
      or exists (
        select 1 from public.calls a
        where a.customer_id = x.customer_id and a.direction in ('inbound', 'missed')
          and a.started_at >= x.sent_at and a.started_at < x.sent_at + make_interval(days => win.days)
      )
  ),
  booked as (
    select x.customer_id
    from reached x, win
    where exists (
      select 1 from public.appointments ap
      where ap.customer_id = x.customer_id
        and ap.created_at >= x.sent_at and ap.created_at < x.sent_at + make_interval(days => win.days)
    )
  ),
  opted as (
    select x.customer_id
    from reached x, win, camp
    where exists (
      select 1 from public.iys_consents ic
      where ic.customer_id = x.customer_id and ic.channel = camp.channel and ic.status = 'denied'
        and ic.revoked_at >= x.sent_at and ic.revoked_at < x.sent_at + make_interval(days => win.days)
    )
  ),
  errs as (
    select coalesce(nullif(btrim(r.error_msg), ''), 'Neden belirtilmedi') as msg, count(*) as n
    from rcp r where r.status = 'failed'
    group by 1 order by 2 desc, 1 limit 10
  )
  select case when not exists (select 1 from camp) then null else jsonb_build_object(
    'total', (select count(*) from rcp),
    'sent', (select count(*) from rcp where status = 'sent'),
    'delivered', (select count(*) from rcp where status = 'delivered'),
    'failed', (select count(*) from rcp where status = 'failed'),
    'pending', (select count(*) from rcp where status = 'pending'),
    'opted_out', (select count(*) from rcp where status = 'opted_out'),
    'errors', coalesce((select jsonb_agg(jsonb_build_object('msg', e.msg, 'count', e.n)) from errs e), '[]'::jsonb),
    'window_days', (select days from win),
    'reached_customers', (select count(*) from reached),
    'replied', (select count(*) from replied),
    'booked', (select count(*) from booked),
    'unsubscribed', (select count(*) from opted)
  ) end;
$$;

create or replace function public.campaign_recipient_page(
  p_campaign_id uuid,
  p_durum text default '',
  p_window_days integer default 7,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  customer_id uuid,
  full_name text,
  phone text,
  status text,
  error_msg text,
  sent_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with camp as (
    select c.id, c.channel::text as channel
    from public.campaigns c
    where c.id = p_campaign_id
      and c.tenant_id = (select public.current_tenant_id())
  ),
  win as (
    select greatest(1, least(coalesce(p_window_days, 7), 30)) as days
  ),
  rcp as (
    select r.id, r.customer_id, r.full_name, r.phone, r.status::text as status, r.error_msg, r.sent_at
    from public.campaign_recipients r
    join camp on camp.id = r.campaign_id
  ),
  filtered as (
    select r.*
    from rcp r, win, camp
    where case coalesce(p_durum, '')
      when '' then true
      when 'ulasan' then r.status in ('sent', 'delivered')
      when 'pending' then r.status = 'pending'
      when 'failed' then r.status = 'failed'
      when 'opted_out' then r.status = 'opted_out'
      when 'yanit' then r.status in ('sent', 'delivered') and r.customer_id is not null and r.sent_at is not null and (
        exists (
          select 1 from public.communications m
          where m.customer_id = r.customer_id and m.direction = 'inbound'
            and m.created_at >= r.sent_at and m.created_at < r.sent_at + make_interval(days => win.days)
        ) or exists (
          select 1 from public.calls a
          where a.customer_id = r.customer_id and a.direction in ('inbound', 'missed')
            and a.started_at >= r.sent_at and a.started_at < r.sent_at + make_interval(days => win.days)
        ))
      when 'randevu' then r.status in ('sent', 'delivered') and r.customer_id is not null and r.sent_at is not null and exists (
          select 1 from public.appointments ap
          where ap.customer_id = r.customer_id
            and ap.created_at >= r.sent_at and ap.created_at < r.sent_at + make_interval(days => win.days)
        )
      when 'ret' then r.status in ('sent', 'delivered') and r.customer_id is not null and r.sent_at is not null and exists (
          select 1 from public.iys_consents ic
          where ic.customer_id = r.customer_id and ic.channel = camp.channel and ic.status = 'denied'
            and ic.revoked_at >= r.sent_at and ic.revoked_at < r.sent_at + make_interval(days => win.days)
        )
      else false
    end
  )
  select f.id, f.customer_id, f.full_name, f.phone, f.status, f.error_msg, f.sent_at, count(*) over () as total_count
  from filtered f
  order by
    case f.status when 'failed' then 0 when 'pending' then 1 when 'opted_out' then 3 else 2 end,
    f.full_name nulls last,
    f.id
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.campaign_report(uuid, integer) from public, anon;
revoke all on function public.campaign_recipient_page(uuid, text, integer, integer, integer) from public, anon;
grant execute on function public.campaign_report(uuid, integer) to authenticated;
grant execute on function public.campaign_recipient_page(uuid, text, integer, integer, integer) to authenticated;
