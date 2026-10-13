-- AD8 (2026-10-13): Duyuru, mesaj ve "Yenilikler" merkezi.
--
-- NE:
--  (1) platform_announcements genişler: kanal listesi (uygulama içi / e-posta / push), segment tanımı (segment_json),
--      zamanlanmış gönderim (scheduled_at), bitiş (expires_at), kuyruk durumu (status), bağlantı, ticari ileti bayrağı
--      (İYS: yalnız açık izin verenlere), doğrudan mesaj hedefi (target_user_id) ve okunma/tıklama sayaçları.
--      Eski satırlar status='sent' olarak kalır (davranış değişmez). audience listesine 'segment' ve 'user' eklenir.
--  (2) platform_announcement_deliveries: alıcı (kullanıcı) x kanal başına teslim satırı; durum, deneme, hata,
--      okundu/tıklandı zamanı. Gönderim KUYRUKTA yapılır (campaign-delivery cron'unun ayrık adımı + gönderim anında
--      after()); satır sahiplenme FOR UPDATE SKIP LOCKED ile (aynı alıcıya çift gönderim yok).
--  (3) notifications okunduğunda (meta.pad = teslim id) teslim satırı ve duyuru okunma sayacı güncellenir (tetikleyici).
--  (4) platform_banners + platform_banner_dismissals: ofis paneline tarihli banner/modal (bilgi/uyarı/kritik),
--      kapatılabilir ya da kapatılamaz; hedef ofis listesi kayıt anında segmentten çözülür (NULL = tüm ofisler).
--  (5) changelog_entries + changelog_reads: "Yenilikler" çekmecesi ve okunmamış rozeti.
--  (6) office_broadcast_state(): ofis kabuğu için TEK tur okuma (banner'lar + okunmamış yenilik sayısı), INVOKER (RLS).
-- KOD: tablolar/RPC yokken admin ekranı "kurulum bekliyor" der, ofis kabuğu banner/yenilik göstermez, eski toplu duyuru
--      formu (anında, uygulama içi) çalışmaya devam eder.
-- GERİ ALMA: rollbacks/20261013004700_platform_announcement_center.rollback.sql (yeni tablolar ve sütunlar silinir).
-- RİSK: düşük; mevcut tabloya yalnız varsayılanlı sütun + notifications üzerinde dar WHEN koşullu tetikleyici
--       (yalnız meta'sında 'pad' olan duyuru satırları için çalışır).

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- (1) platform_announcements genişlemesi
-- ---------------------------------------------------------------------------
alter table public.platform_announcements
  add column if not exists channels text[] not null default array['in_app']::text[],
  add column if not exists segment_json jsonb not null default '{}'::jsonb,
  add column if not exists scheduled_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists status text not null default 'sent',
  add column if not exists href text,
  add column if not exists commercial boolean not null default false,
  add column if not exists target_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists recipient_count integer not null default 0,
  add column if not exists delivered_count integer not null default 0,
  add column if not exists failed_count integer not null default 0,
  add column if not exists read_count integer not null default 0,
  add column if not exists click_count integer not null default 0,
  add column if not exists stats jsonb not null default '{}'::jsonb,
  add column if not exists materialized_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.platform_announcements drop constraint if exists platform_announcements_audience_check;
alter table public.platform_announcements add constraint platform_announcements_audience_check
  check (audience in ('all', 'active', 'trial', 'specific', 'segment', 'user'));

alter table public.platform_announcements drop constraint if exists platform_announcements_status_check;
alter table public.platform_announcements add constraint platform_announcements_status_check
  check (status in ('scheduled', 'sending', 'sent', 'partial', 'cancelled', 'expired'));

alter table public.platform_announcements drop constraint if exists platform_announcements_channels_check;
alter table public.platform_announcements add constraint platform_announcements_channels_check
  check (cardinality(channels) between 1 and 3 and channels <@ array['in_app', 'email', 'push']::text[]);

alter table public.platform_announcements drop constraint if exists platform_announcements_window_check;
alter table public.platform_announcements add constraint platform_announcements_window_check
  check (expires_at is null or scheduled_at is null or expires_at > scheduled_at);

alter table public.platform_announcements drop constraint if exists platform_announcements_href_check;
alter table public.platform_announcements add constraint platform_announcements_href_check
  check (href is null or (char_length(href) <= 500 and (href ~ '^/[^/\\]' or href ~ '^https://')));

-- Kuyruk taraması: yalnız bekleyen/gönderilen duyurular (küçük kısmi indeks).
create index if not exists idx_platform_announcements_due
  on public.platform_announcements (scheduled_at)
  where status in ('scheduled', 'sending');

-- ---------------------------------------------------------------------------
-- (2) Teslim satırları
-- ---------------------------------------------------------------------------
create table if not exists public.platform_announcement_deliveries (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.platform_announcements(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  channel         text not null check (channel in ('in_app', 'email', 'push')),
  status          text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped', 'expired')),
  attempts        integer not null default 0,
  error           text check (error is null or char_length(error) <= 300),
  notification_id uuid,
  provider_id     text check (provider_id is null or char_length(provider_id) <= 200),
  locked_at       timestamptz,
  -- Geçici hata (sağlayıcı hız sınırı 429 / 5xx / bağlantı) sonrası bu ana kadar yeniden alınmaz (geri çekilme).
  not_before      timestamptz,
  sent_at         timestamptz,
  read_at         timestamptz,
  clicked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (announcement_id, channel, user_id)
);

create index if not exists idx_pad_announcement_status
  on public.platform_announcement_deliveries (announcement_id, status);
create index if not exists idx_pad_pending
  on public.platform_announcement_deliveries (created_at)
  where status in ('pending', 'sending');
create index if not exists idx_pad_tenant
  on public.platform_announcement_deliveries (tenant_id);
create index if not exists idx_pad_user
  on public.platform_announcement_deliveries (user_id);

alter table public.platform_announcement_deliveries enable row level security;

drop policy if exists platform_announcement_deliveries_staff_read on public.platform_announcement_deliveries;
create policy platform_announcement_deliveries_staff_read on public.platform_announcement_deliveries
  for select
  using ((select public.is_platform_staff()));

revoke all on public.platform_announcement_deliveries from anon, authenticated;
grant select on public.platform_announcement_deliveries to authenticated;
grant all on public.platform_announcement_deliveries to service_role;

comment on table public.platform_announcement_deliveries is
  'Duyuru teslimleri: alici (kullanici) x kanal basina tek satir; kuyruk durumu, okunma ve tiklama.';

-- Sahiplenme: bekleyen (ya da 10 dk'dan uzun "sending"te kalmış) satırları kilitleyip "sending" yapar.
-- Eşzamanlı iki çalıştırma (cron + gönderim anındaki after()) aynı satırı ALAMAZ (SKIP LOCKED).
create or replace function public.platform_announcement_claim(p_limit integer, p_announcement uuid default null)
returns setof public.platform_announcement_deliveries
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select d.id
    from public.platform_announcement_deliveries d
    where (d.status = 'pending' or (d.status = 'sending' and d.locked_at < now() - interval '10 minutes'))
      and (d.not_before is null or d.not_before <= now())
      and (p_announcement is null or d.announcement_id = p_announcement)
    order by d.created_at
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
    for update skip locked
  )
  update public.platform_announcement_deliveries d
     set status = 'sending', attempts = d.attempts + 1, locked_at = now(), updated_at = now()
    from picked
   where d.id = picked.id
  returning d.*;
end;
$$;

revoke all on function public.platform_announcement_claim(integer, uuid) from public, anon, authenticated;
grant execute on function public.platform_announcement_claim(integer, uuid) to service_role;

-- E-posta adresleri parti başına TEK sorguda (kullanıcı başına auth.admin.getUserById yerine). Yalnız service_role.
create or replace function public.platform_announcement_recipient_emails(p_users uuid[])
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text
    from auth.users u
   where u.id = any(p_users)
     and u.email is not null;
$$;

revoke all on function public.platform_announcement_recipient_emails(uuid[]) from public, anon, authenticated;
grant execute on function public.platform_announcement_recipient_emails(uuid[]) to service_role;

-- Segment "son giriş" ölçütü: verilen tarihten beri başarılı girişi olan ofisler (ofis başına tek satır).
-- Ofis başına idx_login_events_tenant_created üzerinde tek EXISTS araması; giriş satırı sayısından bağımsız.
-- PostgREST satır sınırı (1000) nedeniyle çağıran sayfalı okur (order tenant_id + range).
create or replace function public.platform_announcement_login_tenants(p_since timestamptz)
returns table (tenant_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
    from public.tenants t
   where t.status <> 'cancelled'
     and exists (
       select 1 from public.login_events e
        where e.tenant_id = t.id and e.created_at >= p_since and e.result = 'success'
     );
$$;

revoke all on function public.platform_announcement_login_tenants(timestamptz) from public, anon, authenticated;
grant execute on function public.platform_announcement_login_tenants(timestamptz) to service_role;

-- Tıklama: ilk tıklamada teslim satırını işaretler, duyuru sayacını artırır; yönlendirme adresini döndürür.
-- E-postadan gelen tıklama aynı zamanda "okundu" sayılır (düz metin e-postada açılma ölçümü yok).
create or replace function public.platform_announcement_track_click(p_delivery uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ann uuid;
  v_href text;
  v_first boolean := false;
  v_first_read boolean := false;
begin
  select d.announcement_id, d.clicked_at is null, d.read_at is null
    into v_ann, v_first, v_first_read
    from public.platform_announcement_deliveries d
   where d.id = p_delivery;
  if v_ann is null then
    return null;
  end if;
  if v_first then
    update public.platform_announcement_deliveries
       set clicked_at = now(), read_at = coalesce(read_at, now()), updated_at = now()
     where id = p_delivery and clicked_at is null;
    if found then
      update public.platform_announcements
         set click_count = click_count + 1,
             read_count = read_count + case when v_first_read then 1 else 0 end
       where id = v_ann;
    end if;
  end if;
  select a.href into v_href from public.platform_announcements a where a.id = v_ann;
  return v_href;
end;
$$;

revoke all on function public.platform_announcement_track_click(uuid) from public, anon, authenticated;
grant execute on function public.platform_announcement_track_click(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- (3) Okundu eşitlemesi: yalnız duyuru bildirimleri (meta ? 'pad') için çalışır.
-- ---------------------------------------------------------------------------
create or replace function public.platform_announcement_mark_read()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery uuid;
  v_ann uuid;
begin
  begin
    v_delivery := (new.meta ->> 'pad')::uuid;
  exception when others then
    return null;
  end;
  update public.platform_announcement_deliveries d
     set read_at = new.read_at, updated_at = now()
   where d.id = v_delivery and d.read_at is null
  returning d.announcement_id into v_ann;
  if v_ann is not null then
    update public.platform_announcements set read_count = read_count + 1 where id = v_ann;
  end if;
  return null;
end;
$$;

revoke all on function public.platform_announcement_mark_read() from public, anon, authenticated;

drop trigger if exists trg_notifications_announcement_read on public.notifications;
create trigger trg_notifications_announcement_read
  after update of read_at on public.notifications
  for each row
  when (old.read_at is null and new.read_at is not null and new.meta ? 'pad')
  execute function public.platform_announcement_mark_read();

-- ---------------------------------------------------------------------------
-- (4) Banner / modal
-- ---------------------------------------------------------------------------
create table if not exists public.platform_banners (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 120),
  body         text check (body is null or char_length(body) <= 600),
  level        text not null default 'info' check (level in ('info', 'warning', 'critical')),
  display      text not null default 'banner' check (display in ('banner', 'modal')),
  dismissible  boolean not null default true,
  href         text check (href is null or (char_length(href) <= 500 and (href ~ '^/[^/\\]' or href ~ '^https://'))),
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz,
  -- NULL = tüm ofisler; dolu = yalnız bu ofisler (kayıt anında segmentten çözülür).
  tenant_ids   uuid[],
  segment_json jsonb not null default '{}'::jsonb,
  is_active    boolean not null default true,
  created_by   uuid references public.platform_staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (tenant_ids is null or cardinality(tenant_ids) between 1 and 5000)
);

create index if not exists idx_platform_banners_live
  on public.platform_banners (starts_at desc)
  where is_active;

alter table public.platform_banners enable row level security;

drop policy if exists platform_banners_staff_read on public.platform_banners;
create policy platform_banners_staff_read on public.platform_banners
  for select
  using ((select public.is_platform_staff()));

drop policy if exists platform_banners_office_read on public.platform_banners;
create policy platform_banners_office_read on public.platform_banners
  for select
  to authenticated
  using (
    is_active
    and starts_at <= now()
    and (ends_at is null or ends_at > now())
    and (tenant_ids is null or (select public.current_tenant_id()) = any (tenant_ids))
  );

revoke all on public.platform_banners from anon, authenticated;
grant select on public.platform_banners to authenticated;
grant all on public.platform_banners to service_role;

create table if not exists public.platform_banner_dismissals (
  banner_id    uuid not null references public.platform_banners(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (banner_id, user_id)
);

create index if not exists idx_platform_banner_dismissals_user on public.platform_banner_dismissals (user_id);

alter table public.platform_banner_dismissals enable row level security;

drop policy if exists platform_banner_dismissals_own_read on public.platform_banner_dismissals;
create policy platform_banner_dismissals_own_read on public.platform_banner_dismissals
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Yalnız kapatılabilir ve kullanıcıya görünen banner kapatılabilir (kapatılamaz banner'ı istemci gizleyemez).
drop policy if exists platform_banner_dismissals_own_insert on public.platform_banner_dismissals;
create policy platform_banner_dismissals_own_insert on public.platform_banner_dismissals
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.platform_banners b where b.id = banner_id and b.dismissible)
  );

revoke all on public.platform_banner_dismissals from anon, authenticated;
grant select, insert on public.platform_banner_dismissals to authenticated;
grant all on public.platform_banner_dismissals to service_role;

-- ---------------------------------------------------------------------------
-- (5) Yenilikler (changelog)
-- ---------------------------------------------------------------------------
create table if not exists public.changelog_entries (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 140),
  body         text check (body is null or char_length(body) <= 4000),
  category     text not null default 'yeni' check (category in ('yeni', 'iyilestirme', 'duzeltme')),
  href         text check (href is null or (char_length(href) <= 500 and (href ~ '^/[^/\\]' or href ~ '^https://'))),
  -- NULL = taslak; ileri tarih = o anda yayına girer.
  published_at timestamptz,
  created_by   uuid references public.platform_staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_changelog_entries_published
  on public.changelog_entries (published_at desc)
  where published_at is not null;

alter table public.changelog_entries enable row level security;

drop policy if exists changelog_entries_staff_read on public.changelog_entries;
create policy changelog_entries_staff_read on public.changelog_entries
  for select
  using ((select public.is_platform_staff()));

drop policy if exists changelog_entries_published_read on public.changelog_entries;
create policy changelog_entries_published_read on public.changelog_entries
  for select
  to authenticated
  using (published_at is not null and published_at <= now());

revoke all on public.changelog_entries from anon, authenticated;
grant select on public.changelog_entries to authenticated;
grant all on public.changelog_entries to service_role;

create table if not exists public.changelog_reads (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table public.changelog_reads enable row level security;

drop policy if exists changelog_reads_own_read on public.changelog_reads;
create policy changelog_reads_own_read on public.changelog_reads
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists changelog_reads_own_insert on public.changelog_reads;
create policy changelog_reads_own_insert on public.changelog_reads
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists changelog_reads_own_update on public.changelog_reads;
create policy changelog_reads_own_update on public.changelog_reads
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.changelog_reads from anon, authenticated;
grant select, insert, update on public.changelog_reads to authenticated;
grant all on public.changelog_reads to service_role;

-- ---------------------------------------------------------------------------
-- (6) Ofis kabuğu: tek tur okuma (RLS ile; SECURITY INVOKER)
-- ---------------------------------------------------------------------------
create or replace function public.office_broadcast_state()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'banners', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.rank, x.starts_at desc)
      from (
        select b.id, b.title, b.body, b.level, b.display, b.dismissible, b.href, b.starts_at, b.ends_at,
               case b.level when 'critical' then 0 when 'warning' then 1 else 2 end as rank
        from public.platform_banners b
        where b.is_active
          and b.starts_at <= now()
          and (b.ends_at is null or b.ends_at > now())
          and not (b.dismissible and exists (
            select 1 from public.platform_banner_dismissals d
            where d.banner_id = b.id and d.user_id = (select auth.uid())
          ))
        order by rank, b.starts_at desc
        limit 3
      ) x
    ), '[]'::jsonb),
    'changelog_unread', (
      select count(*)::int from (
        select 1 from public.changelog_entries c
        where c.published_at is not null
          and c.published_at <= now()
          and c.published_at > coalesce(
            (select r.last_seen_at from public.changelog_reads r where r.user_id = (select auth.uid())),
            now() - interval '30 days')
        limit 99
      ) u
    )
  );
$$;

revoke all on function public.office_broadcast_state() from public, anon;
grant execute on function public.office_broadcast_state() to authenticated, service_role;

notify pgrst, 'reload schema';
