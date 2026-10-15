-- 20261016050000 geri alma: kişi başı okunma tablosu, RPC'ler, yayın tetikleyicisi ve 'reads:' politikası kaldırılır;
-- notifications üzerindeki eski güncelleme yetkisi ve notifications_tenant_update politikası geri gelir.
-- VERİ: notification_reads'teki okumalar silinir. Geri dönmeden önce kişisel bildirimlerin okunma zamanı read_at'e
-- yazılır (ortak bildirimlerde kişi başı bilgi tek sütuna sığmaz; ortak satırların read_at'i olduğu gibi kalır).
-- Kod tablo/RPC yokken eski sorgu yoluna düşer (src/app/actions/notifications.ts).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.notification_reads') is not null then
    update public.notifications n
       set read_at = r.read_at
      from public.notification_reads r
     where r.notification_id = n.id
       and n.user_id is not null
       and r.user_id = n.user_id
       and n.read_at is null;
  end if;
end $$;

do $$
begin
  if pg_catalog.to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists notification_reads_topic_select on realtime.messages';
  end if;
end $$;

drop trigger if exists trg_notification_reads_after_insert on public.notification_reads;
drop function if exists public.notification_reads_after_insert();
drop function if exists public.mark_my_notifications_read(uuid[]);
drop function if exists public.my_notification_counts();
drop table if exists public.notification_reads;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant update on table public.notifications to authenticated';
  end if;
end $$;

drop policy if exists notifications_tenant_update on public.notifications;
create policy notifications_tenant_update on public.notifications
  for update
  using (
    tenant_id = (select public.current_tenant_id())
    and (user_id is null or user_id = (select auth.uid()))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (user_id is null or user_id = (select auth.uid()))
  );
