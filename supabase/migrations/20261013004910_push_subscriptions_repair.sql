-- push_subscriptions ONARIMI (AD10, canlı hata düzeltmesi).
--
-- NEDEN: 20260722000013_push_subscriptions.sql ledger'da (public.schema_migrations) uygulanmış görünüyor ama canlıda
-- tablo YOK (to_regclass = null, 2026-10-13 salt-okunur yoklama). Bu yüzden web push aboneliği kaydı
-- (savePushSubscription) her seferinde "relation does not exist" ile düşüyor ve anlık bildirim hiç gitmiyor.
-- Uygulanmış dosya forward-only/değişmez olduğu için tablo bu YENİ dosyayla yeniden kurulur.
--
-- NE: 000013 ile aynı tablo/indeks/politika/yetki, tamamı idempotent (tablo varsa dokunulmaz, politika yeniden kurulur).
--     Politika proje kuralıyla kiracıyı public.current_tenant_id() ile (initplan) okur ve açık WITH CHECK taşır.
-- KOD: tablo yokken abonelik kaydı hata mesajı döner (bugünkü durum); /admin/sistem şema denetimi satırı "Uygulanmamış" der.
-- GERİ ALMA: rollbacks/20261013004910_push_subscriptions_repair.rollback.sql (tablo boşsa düşürür).
-- RİSK: düşük; yalnız eksik tablo kurulur, başka nesneye dokunulmaz.

set local lock_timeout = '5s';

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_tenant on public.push_subscriptions(tenant_id, user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_tenant on public.push_subscriptions;
create policy push_subscriptions_tenant on public.push_subscriptions for all
  using (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
  );

revoke all privileges on table public.push_subscriptions from public, anon;
grant select, insert, update, delete on table public.push_subscriptions to authenticated, service_role;

comment on table public.push_subscriptions is
  'PWA web push (VAPID) abonelikleri — bildirim tercihleriyle birlikte kullanılır (20261013004910 onarımı)';

notify pgrst, 'reload schema';
