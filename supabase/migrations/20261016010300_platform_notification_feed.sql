-- MIGRATION 20261016010300_platform_notification_feed.sql
-- SK1 / B040 (2026-10-16): admin bildirim zili (/api/admin/notifications) tek sorgu.
-- Geri alma: supabase/rollbacks/20261016010300_platform_notification_feed.rollback.sql
--
-- NEDEN: zil rotası her açılışta İKİ service_role PostgREST isteği atıyordu (son 15 bildirim + okunmamış sayısı).
--   Asıl gecikme (medyan 441 ms; DB işi 0,13 ms) B019 auth turlarıydı (proxy yerel doğrulamaya geçti); kalan iki tur tek
--   fonksiyona iner.
-- NE YAPAR: public.platform_notification_feed(p_limit int) -> jsonb {items:[...], unread:n} — ÇAĞIRANIN (auth.uid())
--   bildirimleri. SECURITY INVOKER: platform_notifications_self RLS politikası (staff_id = auth.uid()) aynen geçerli;
--   service_role GEREKMEZ (rota personelin kendi oturum istemcisiyle çağırır). Liste idx_platform_notifications_staff
--   (staff_id, created_at desc), sayım idx_platform_notifications_unread (kısmi) indeksini kullanır. Limit 1..50.
-- KOD UYUMU: rota fonksiyon yokken (PGRST202/42883) eski iki sorguya düşer (rpc-probe, 60 sn atlama). Sıra serbest.
-- VERİ: değişiklik yok. IDEMPOTENT: create or replace.

set local lock_timeout = '5s';

create or replace function public.platform_notification_feed(p_limit integer default 15)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(n) order by n.created_at desc)
      from (
        select x.id, x.title, x.body, x.href, x.kind, x.read_at, x.created_at
        from public.platform_notifications x
        where x.staff_id = (select auth.uid())
        order by x.created_at desc
        limit least(greatest(coalesce(p_limit, 15), 1), 50)
      ) n
    ), '[]'::jsonb),
    'unread', (
      select pg_catalog.count(*)
      from public.platform_notifications u
      where u.staff_id = (select auth.uid()) and u.read_at is null
    )
  );
$$;

revoke all on function public.platform_notification_feed(integer) from public, anon;
grant execute on function public.platform_notification_feed(integer) to authenticated;

comment on function public.platform_notification_feed(integer) is
  'SK1/B040: admin bildirim zili tek tur (cagiranin son bildirimleri + okunmamis sayisi). SECURITY INVOKER, RLS gecerli.';
