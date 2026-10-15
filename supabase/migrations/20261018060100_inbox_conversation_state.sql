-- MIGRATION 20261018060100_inbox_conversation_state.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Geri alma: supabase/rollbacks/20261018060100_inbox_conversation_state.rollback.sql
-- BAGIMLILIK: public.communications (contact_address: 20260731000132), public.calls, public.customers.
--
-- AMAC (COM-01, gelen kutusu v2): gelen kutusu bir kayit akisiydi; danisman hangi kisinin yanitsiz kaldigini, kimin
--   ilgilendigini goremiyor ve bir konusmayi "bitti" diye kapatamiyordu.
--  1) communications.resolved_at / resolved_by ve calls.resolved_at / resolved_by: "Tamamlandi" isareti (gelen mesaj ya da
--     cevapsiz arama icin). calls.handled_by zaten "aramayi karsilayan" anlamindadir; karismasin diye ayri ad.
--  2) inbox_conversations(...): son 90 gunun kayitlarini kisi bazinda (musteri ya da eslesmemis numaranin son 10 hanesi)
--     konusmalara toplar. "Yanit bekliyor" = son temastan (giden mesaj/arama ya da karsilanan gelen arama) SONRA gelen,
--     tamamlandi isaretlenmemis WhatsApp/SMS/e-posta mesaji ya da cevapsiz arama. Giden yanit konusmayi kendiliginden
--     kapatir (tetik gerekmez). Suzgec: durum (bekliyor | tumu | kapanan), sorumlu danisman, arama (ad, numara, mesaj).
-- GUVENLIK: fonksiyon SECURITY INVOKER (cagiranin RLS'i) + search_path='' + acik kiraci kosulu; yalniz authenticated.
--   Yeni kolonlar mevcut RLS politikalariyla korunur (tablo politikasi degismez).
-- ETKI: ek (iki nullable kolon ciftine yazilmadikca davranis ayni; yeni fonksiyon).
set local lock_timeout = '5s';

alter table public.communications
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null;

alter table public.calls
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null;

comment on column public.communications.resolved_at is 'Gelen kutusu: gelen mesaj "tamamlandi" isaretlendi (yanit gerekmiyor).';
comment on column public.calls.resolved_at is 'Gelen kutusu: cevapsiz arama "tamamlandi" isaretlendi.';

create or replace function public.inbox_conversations(
  p_state text default 'bekliyor',
  p_assignee uuid default null,
  p_q text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  contact_key text,
  customer_id uuid,
  customer_name text,
  assigned_to uuid,
  phone text,
  last_at timestamptz,
  last_channel text,
  last_direction text,
  last_body text,
  waiting_since timestamptz,
  waiting_count integer,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select
      case when m.customer_id is not null then 'c:' || m.customer_id::text
           else 't:' || right(regexp_replace(coalesce(m.contact_address, ''), '\D', '', 'g'), 10) end as k,
      m.customer_id,
      m.contact_address as phone,
      m.created_at as at,
      m.channel::text as channel,
      m.direction::text as direction,
      coalesce(nullif(m.body, ''), m.subject) as body,
      (m.direction = 'inbound' and m.channel in ('whatsapp', 'sms', 'email')) as needs_reply,
      (m.direction = 'outbound') as contact_made,
      m.resolved_at
    from public.communications m
    where m.tenant_id = (select public.current_tenant_id())
      and m.created_at >= now() - interval '90 days'
      and m.direction <> 'internal'
      and m.channel <> 'note'
      and (m.customer_id is not null or length(regexp_replace(coalesce(m.contact_address, ''), '\D', '', 'g')) >= 7)
    union all
    select
      case when a.customer_id is not null then 'c:' || a.customer_id::text
           else 't:' || right(regexp_replace(a.phone, '\D', '', 'g'), 10) end,
      a.customer_id,
      a.phone,
      a.started_at,
      'call',
      a.direction,
      a.notes,
      (a.direction = 'missed'),
      (a.direction in ('outbound', 'inbound')),
      a.resolved_at
    from public.calls a
    where a.tenant_id = (select public.current_tenant_id())
      and a.started_at >= now() - interval '90 days'
      and (a.customer_id is not null or length(regexp_replace(a.phone, '\D', '', 'g')) >= 7)
  ),
  agg as (
    select
      e.k,
      (array_agg(e.customer_id) filter (where e.customer_id is not null))[1] as customer_id,
      (array_agg(e.phone order by e.at desc) filter (where e.phone is not null))[1] as phone,
      max(e.at) as last_at,
      max(e.at) filter (where e.contact_made) as last_contact_at
    from ev e
    group by e.k
  ),
  waiting as (
    select e.k, min(e.at) as waiting_since, count(*)::integer as waiting_count
    from ev e
    join agg g on g.k = e.k
    where e.needs_reply
      and e.resolved_at is null
      and e.at > coalesce(g.last_contact_at, '-infinity'::timestamptz)
    group by e.k
  ),
  last_ev as (
    select distinct on (e.k) e.k, e.channel, e.direction, e.body
    from ev e
    order by e.k, e.at desc
  ),
  q as (
    select
      nullif(btrim(coalesce(p_q, '')), '') as term,
      regexp_replace(coalesce(p_q, ''), '\D', '', 'g') as digits
  ),
  conv as (
    select
      g.k,
      g.customer_id,
      cu.full_name,
      cu.assigned_to,
      coalesce(cu.phone, g.phone) as phone,
      g.last_at,
      l.channel,
      l.direction,
      l.body,
      w.waiting_since,
      coalesce(w.waiting_count, 0) as waiting_count
    from agg g
    join last_ev l on l.k = g.k
    left join waiting w on w.k = g.k
    left join public.customers cu on cu.id = g.customer_id
    cross join q
    where (
        coalesce(p_state, 'bekliyor') = 'tumu'
        or (coalesce(p_state, 'bekliyor') = 'bekliyor' and w.k is not null)
        or (p_state = 'kapanan' and w.k is null)
      )
      and (p_assignee is null or cu.assigned_to = p_assignee)
      and (
        q.term is null
        or cu.full_name ilike '%' || q.term || '%'
        or (length(q.digits) >= 4 and regexp_replace(coalesce(cu.phone, g.phone, ''), '\D', '', 'g') like '%' || right(ltrim(q.digits, '0'), 10) || '%')
        or exists (select 1 from ev e2 where e2.k = g.k and e2.body ilike '%' || q.term || '%')
      )
  )
  select
    r.k, r.customer_id, r.full_name, r.assigned_to, r.phone, r.last_at, r.channel, r.direction, r.body,
    r.waiting_since, r.waiting_count, count(*) over () as total_count
  from conv r
  order by r.last_at desc, r.k
  limit greatest(1, least(coalesce(p_limit, 30), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.inbox_conversations(text, uuid, text, integer, integer) from public, anon;
grant execute on function public.inbox_conversations(text, uuid, text, integer, integer) to authenticated;
