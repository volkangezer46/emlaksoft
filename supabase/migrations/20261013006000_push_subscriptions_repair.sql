-- Onarım: push_subscriptions (20260722000013) defterde uygulanmış görünüyor ama tablo canlıda YOK
-- (bulut veritabanında da yoktu; sunucu taşımasıyla aynen geldi). Aynı tanım idempotent olarak yeniden kurulur;
-- tablo varsa hiçbir şey değişmez.
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

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'push_subscriptions_tenant') then
    create policy push_subscriptions_tenant on public.push_subscriptions for all
      using (tenant_id = (select auth.jwt()->>'tenant_id')::uuid and user_id = auth.uid());
  end if;
end $$;

grant all on public.push_subscriptions to authenticated, service_role;

comment on table public.push_subscriptions is
  'PWA web push (VAPID) abonelikleri — bildirim tercihleriyle birlikte kullanılır';
