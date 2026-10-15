-- MIGRATION 20261016050000_notification_reads.sql
-- SK5 (2026-10-16): bildirim okunma durumu KİŞİ BAŞINA tek tabloda (notification_reads); okunmamış sayısı tek kaynaktan.
-- Geri alma: supabase/rollbacks/20261016050000_notification_reads.rollback.sql
--
-- SORUN (B079/B078/B167, canlı ölçüm 2026-10-15):
--   * Ofis geneli bildirim (user_id NULL) TEK satır, okunma bilgisi o satırın read_at'i: biri okuyunca herkeste okunmuş
--     görünüyordu ("Tümünü oku" ofisteki herkes için kapatıyordu). notifications_tenant_update politikası ortak satırın
--     her sütununu (title/href/user_id dahil) authenticated'a açıyordu.
--   * Salt okunur kullanıcı (trg_block_readonly_identity_writes) read_at yazamıyordu; hata yutuluyordu.
--   * Zil okunmamışı son 30 satırdan sayıyordu (29), sayfa gerçek sayımdan (153).
-- ÇÖZÜM:
--   (1) public.notification_reads(tenant_id, notification_id, user_id, read_at; PK(notification_id, user_id)).
--       RLS: kullanıcı yalnız KENDİ satırını görür/ekler ve yalnız görebildiği bildirimi okundu yapabilir.
--       Salt okunur engelleyici tetikleyici bu tabloya BAĞLANMAZ (kendi okuma durumu uygulama verisi değildir).
--   (2) Kişisel bildirimlerin mevcut read_at'i tabloya kopyalanır; ortak satırlarda kimin okuduğu bilinmediği için
--       kopyalanmaz (o satırlar herkese bir kez okunmamış görünür).
--   (3) authenticated'ın notifications üzerindeki UPDATE yetkisi (tablo + sütun) REVOKE edilir ve
--       notifications_tenant_update politikası kaldırılır: href/title/user_id artık istemciden değişmez.
--   (4) my_notification_counts(): okunmamış/toplam/son 7 gün/tür sayıları TEK turda (INVOKER, RLS geçerli).
--       mark_my_notifications_read(p_ids): verilen (NULL = tüm okunmamış) bildirimleri tek turda okundu yazar.
--   (5) notification_reads INSERT → 'reads:<uid>' özel Broadcast konusu (yük: {ids ≤50, n}; PII yok) ve
--       realtime.messages'a yalnız kendi konusunu okuma politikası; ikinci cihazdaki zil okumayı <1 sn'de yansıtır.
--       Platform duyurusu teslim satırları (meta.pad) için eski read_at tetikleyicisinin işi burada da yapılır.
-- ETKİ: yeni tablo + 2 RPC + tetikleyici; notifications'ta yetki daralır (yazan tek istemci yolu eski okundu eylemiydi,
--   kod bu tabloya geçti). Kod tablo/RPC yokken eski sorguya düşer (src/app/actions/notifications.ts).
-- İdempotent: if not exists / create or replace / drop ... if exists.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.notifications') is null or pg_catalog.to_regclass('public.profiles') is null then
    raise exception 'public.notifications / public.profiles yok.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- (1) Tablo + RLS
-- ---------------------------------------------------------------------------
create table if not exists public.notification_reads (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists idx_notification_reads_user on public.notification_reads (user_id, read_at desc);

comment on table public.notification_reads is
  'SK5: bildirim okunma durumu, kişi başına tek kaynak (kişisel + ofis geneli bildirimler). notifications.read_at artık okunmaz.';

alter table public.notification_reads enable row level security;

drop policy if exists notification_reads_select_own on public.notification_reads;
create policy notification_reads_select_own on public.notification_reads
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and tenant_id = (select public.current_tenant_id())
  );

drop policy if exists notification_reads_insert_own on public.notification_reads;
create policy notification_reads_insert_own on public.notification_reads
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.notifications n
      where n.id = notification_reads.notification_id
        and n.tenant_id = notification_reads.tenant_id
        and (n.user_id is null or n.user_id = (select auth.uid()))
    )
  );

revoke all on table public.notification_reads from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.notification_reads from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.notification_reads from authenticated';
    execute 'grant select, insert on table public.notification_reads to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on table public.notification_reads to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- (2) Kişisel bildirimlerin mevcut okunma bilgisi (ortak satırlar kopyalanmaz). Tetikleyiciden ÖNCE: yayın gitmez.
-- ---------------------------------------------------------------------------
insert into public.notification_reads (tenant_id, notification_id, user_id, read_at)
select n.tenant_id, n.id, n.user_id, n.read_at
from public.notifications n
join public.profiles p on p.id = n.user_id and p.tenant_id = n.tenant_id
where n.user_id is not null
  and n.read_at is not null
on conflict (notification_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- (3) notifications: istemci güncellemesi kapanır (tablo + sütun düzeyi), ortak satırı açan politika kalkar.
-- ---------------------------------------------------------------------------
drop policy if exists notifications_tenant_update on public.notifications;

do $$
declare
  v_col text;
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke update on table public.notifications from authenticated';
    for v_col in
      select a.attname
      from pg_attribute a
      where a.attrelid = 'public.notifications'::regclass and a.attnum > 0 and not a.attisdropped
    loop
      execute format('revoke update (%I) on table public.notifications from authenticated', v_col);
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- (4) RPC'ler
-- ---------------------------------------------------------------------------
create or replace function public.my_notification_counts()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with mine as (
    select n.kind, n.created_at, (r.notification_id is null) as unread
    from public.notifications n
    left join public.notification_reads r
      on r.notification_id = n.id and r.user_id = (select auth.uid())
    where n.tenant_id = (select public.current_tenant_id())
      and (n.user_id is null or n.user_id = (select auth.uid()))
  )
  select jsonb_build_object(
    'unread', count(*) filter (where unread),
    'total', count(*),
    'week', count(*) filter (where created_at >= now() - interval '7 days'),
    'kinds', coalesce(
      (select jsonb_object_agg(k.kind, k.c) from (select kind, count(*) as c from mine group by kind) k),
      '{}'::jsonb
    )
  )
  from mine;
$$;

comment on function public.my_notification_counts() is
  'SK5: oturumdaki kullanıcının bildirim sayıları (okunmamış/toplam/son 7 gün/tür); zil ve /app/bildirimler tek kaynak.';

-- p_ids NULL → görebildiği tüm okunmamışlar; dizi → yalnız o kimlikler (en çok 500). Dönen: yeni yazılan okuma sayısı.
create or replace function public.mark_my_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_n integer;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'notification_read_requires_tenant_session' using errcode = '42501';
  end if;
  if p_ids is not null and cardinality(p_ids) > 500 then
    raise exception 'notification_read_too_many_ids' using errcode = '22023';
  end if;

  insert into public.notification_reads (tenant_id, notification_id, user_id, read_at)
  select n.tenant_id, n.id, v_uid, now()
  from public.notifications n
  where n.tenant_id = v_tenant
    and (n.user_id is null or n.user_id = v_uid)
    and (p_ids is null or n.id = any (p_ids))
    and not exists (
      select 1 from public.notification_reads r where r.notification_id = n.id and r.user_id = v_uid
    )
  on conflict (notification_id, user_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.mark_my_notifications_read(uuid[]) is
  'SK5: oturumdaki kullanıcı için bildirim(ler)i okundu yazar (NULL = tüm okunmamışlar); salt okunur dahil herkes.';

revoke all on function public.my_notification_counts() from public;
revoke all on function public.mark_my_notifications_read(uuid[]) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.my_notification_counts() from anon';
    execute 'revoke all on function public.mark_my_notifications_read(uuid[]) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.my_notification_counts() to authenticated';
    execute 'grant execute on function public.mark_my_notifications_read(uuid[]) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.my_notification_counts() to service_role';
    execute 'grant execute on function public.mark_my_notifications_read(uuid[]) to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- (5) Okuma sonrası: 'reads:<uid>' yayını + platform duyurusu teslim satırı (meta.pad). Deyim düzeyinde, tek mesaj/kişi.
-- ---------------------------------------------------------------------------
create or replace function public.notification_reads_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  -- Platform duyurusu: teslim satırı ilk okunuşta okundu, duyuru sayacı bir kez artar (eski read_at tetikleyicisiyle aynı iş).
  if pg_catalog.to_regclass('public.platform_announcement_deliveries') is not null then
    with hit as (
      update public.platform_announcement_deliveries d
         set read_at = x.read_at, updated_at = now()
        from (
          select (n.meta ->> 'pad')::uuid as delivery_id, min(nr.read_at) as read_at
          from new_reads nr
          join public.notifications n on n.id = nr.notification_id
          where n.meta ? 'pad'
            and (n.meta ->> 'pad') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          group by 1
        ) x
       where d.id = x.delivery_id and d.read_at is null
      returning d.announcement_id
    )
    update public.platform_announcements a
       set read_count = a.read_count + h.c
      from (select announcement_id, count(*)::int as c from hit group by announcement_id) h
     where a.id = h.announcement_id;
  end if;

  -- Yayın: kullanıcı başına tek mesaj; yalnız kimlikler (en çok 50) ve toplam sayı. Realtime yoksa okuma yine yazılır.
  if pg_catalog.to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    for r in
      select nr.user_id,
             count(*)::int as n,
             (array_agg(nr.notification_id order by nr.read_at desc, nr.notification_id))[1:50] as ids
      from new_reads nr
      group by nr.user_id
    loop
      begin
        perform realtime.send(
          pg_catalog.jsonb_build_object('ids', pg_catalog.to_jsonb(r.ids), 'n', r.n),
          'read',
          'reads:' || r.user_id::text,
          true
        );
      exception when others then
        null;
      end;
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function public.notification_reads_after_insert() from public;

drop trigger if exists trg_notification_reads_after_insert on public.notification_reads;
create trigger trg_notification_reads_after_insert
  after insert on public.notification_reads
  referencing new table as new_reads
  for each statement
  execute function public.notification_reads_after_insert();

-- Kişiye özel okuma konusu: yalnız kendi 'reads:<uid>' konusunu dinleyebilir (Broadcast yetkilendirmesi).
do $$
begin
  if pg_catalog.to_regclass('realtime.messages') is not null
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'drop policy if exists notification_reads_topic_select on realtime.messages';
    execute $p$
      create policy notification_reads_topic_select on realtime.messages
        for select to authenticated
        using (
          extension = 'broadcast'
          and (select realtime.topic()) = 'reads:' || (select auth.uid())::text
        )
    $p$;
  end if;
end $$;
