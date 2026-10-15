-- MIGRATION 20261018050000_notifications_topic.sql
-- GA-08 (2026-10-18): bildirim KONUSU (Randevu/Gorev/Atama/Musteri/Portfoy/Finans/Sistem) + konu sayaclari.
-- Geri alma: supabase/rollbacks/20261018050000_notifications_topic.rollback.sql (konu kolonu, tetikleyici ve yardimci
--   fonksiyon kalkar; my_notification_counts eski govdesine doner; kod kolon yokken konu ciplerini gizler).
-- BAGIMLILIK: 20261016050000_notification_reads.sql (my_notification_counts ve notification_reads) ONCE uygulanmis olmali.
--
-- NE: (1) notifications.topic text NULL + CHECK (7 deger). (2) notification_topic_from_href(text): yol oneki -> konu
--   (src/lib/notification-topics.ts TOPIC_HREF_PREFIXES ile ayni sira; sozlesme testi birebir karsilastirir).
--   (3) BEFORE INSERT tetikleyicisi: konu verilmemisse baglantidan turetir (cron/toplu/platform yazimlari dahil tum yollar).
--   (4) Gecmis satirlar baglantidan geri doldurulur. (5) (tenant_id, user_id, topic, created_at) indeksi.
--   (6) my_notification_counts(): mevcut alanlara ek 'topics' kirilimi (INVOKER, RLS gecerli; ayni tek tur).
-- GUVENLIK: yeni yetki/politika yok; fonksiyonlar INVOKER ve search_path ''. notifications RLS'i degismez.
-- ETKI: ek (nullable kolon + tetikleyici + RPC govdesine yeni anahtar). Idempotent.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.notifications') is null or pg_catalog.to_regclass('public.notification_reads') is null then
    raise exception 'public.notifications / public.notification_reads yok (20261016050000 once uygulanmali).';
  end if;
end $$;

alter table public.notifications add column if not exists topic text;

alter table public.notifications drop constraint if exists notifications_topic_check;
alter table public.notifications
  add constraint notifications_topic_check
  check (topic is null or topic in ('randevu', 'gorev', 'atama', 'musteri', 'portfoy', 'finans', 'sistem')) not valid;

comment on column public.notifications.topic is
  'GA-08: bildirim konusu (randevu/gorev/atama/musteri/portfoy/finans/sistem); bos ise tetikleyici baglantidan turetir.';

create or replace function public.notification_topic_from_href(p_href text)
returns text
language sql
immutable
set search_path = ''
as $$
  select t.topic
  from (values
    (1, '/app/randevular', 'randevu'),
    (2, '/app/gorevler', 'gorev'),
    (3, '/app/musteriler', 'musteri'),
    (4, '/app/talepler', 'musteri'),
    (5, '/app/gelen-kutusu', 'musteri'),
    (6, '/app/anketler', 'musteri'),
    (7, '/app/portfoyler', 'portfoy'),
    (8, '/app/ilan-kontrol', 'portfoy'),
    (9, '/app/ilan-havuzu', 'portfoy'),
    (10, '/app/portfoy-avi', 'portfoy'),
    (11, '/app/komisyon', 'finans'),
    (12, '/app/anlasmalar', 'finans'),
    (13, '/app/kiralama', 'finans'),
    (14, '/app/kira-artis', 'finans'),
    (15, '/app/aidat', 'finans'),
    (16, '/app/giderler', 'finans'),
    (17, '/app/cuzdan', 'finans'),
    (18, '/app/abonelik', 'finans'),
    (19, '/app/teklifler', 'finans')
  ) as t(ord, prefix, topic)
  where p_href is not null
    and pg_catalog.left(p_href, 1) = '/'
    and (
      pg_catalog.split_part(pg_catalog.split_part(p_href, '?', 1), '#', 1) = t.prefix
      or pg_catalog.starts_with(pg_catalog.split_part(pg_catalog.split_part(p_href, '?', 1), '#', 1), t.prefix || '/')
    )
  order by t.ord
  limit 1
$$;

comment on function public.notification_topic_from_href(text) is
  'GA-08: bildirim baglantisindan konu (src/lib/notification-topics.ts TOPIC_HREF_PREFIXES kopyasi); eslesme yoksa NULL.';

create or replace function public.notifications_set_topic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.topic is null then
    new.topic := coalesce(public.notification_topic_from_href(new.href), 'sistem');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notifications_set_topic on public.notifications;
create trigger trg_notifications_set_topic
  before insert on public.notifications
  for each row execute function public.notifications_set_topic();

-- Gecmis satirlar: konu baglantidan (atamalar baglantidan ayirt edilemez; musteri/portfoy konusuna duser).
update public.notifications
   set topic = coalesce(public.notification_topic_from_href(href), 'sistem')
 where topic is null;

alter table public.notifications validate constraint notifications_topic_check;

create index if not exists idx_notifications_tenant_user_topic
  on public.notifications (tenant_id, user_id, topic, created_at desc);

create or replace function public.my_notification_counts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with mine as (
    select n.kind, n.topic, n.created_at, (r.notification_id is null) as unread
    from public.notifications n
    left join public.notification_reads r
      on r.notification_id = n.id and r.user_id = (select auth.uid())
    where n.tenant_id = (select public.current_tenant_id())
      and (n.user_id is null or n.user_id = (select auth.uid()))
  )
  select pg_catalog.jsonb_build_object(
    'unread', count(*) filter (where unread),
    'total', count(*),
    'week', count(*) filter (where created_at >= pg_catalog.now() - interval '7 days'),
    'kinds', coalesce(
      (select pg_catalog.jsonb_object_agg(k.kind, k.c) from (select kind, count(*) as c from mine group by kind) k),
      '{}'::jsonb
    ),
    'topics', coalesce(
      (select pg_catalog.jsonb_object_agg(t.topic, t.c)
         from (select coalesce(topic, 'sistem') as topic, count(*) as c from mine group by 1) t),
      '{}'::jsonb
    )
  )
  from mine;
$$;

comment on function public.my_notification_counts() is
  'SK5 + GA-08: oturumdaki kullanicinin bildirim sayilari (okunmamis/toplam/son 7 gun/tur/konu); zil ve /app/bildirimler tek kaynak.';
