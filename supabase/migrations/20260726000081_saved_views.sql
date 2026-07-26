-- Kayıtlı görünümler: kullanıcı bir liste sayfasındaki filtre kombinasyonunu
-- adlandırıp kaydeder, tek tıkla geri döner (/app/musteriler, /app/portfoyler,
-- /app/komisyon, /app/gelen-kutusu).
--
-- Tasarım kararları:
--  * params jsonb: yalnız beyaz-listeli query anahtarları yazılır — doğrulama
--    server action katmanında (src/app/actions/saved-views.ts), DB serbest
--    bırakılır ki yeni sayfa/param eklemek migration gerektirmesin.
--  * unique(user_id, route, name): aynı sayfada aynı adla ikinci kayıt yok.
--  * Görünümler KİŞİSELDİR: RLS tenant izolasyonuna ek user_id = auth.uid()
--    şartı koyar — ekip arkadaşının görünümleri görünmez.

create table if not exists public.saved_views (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references public.tenants(id)  on delete cascade,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  route      text        not null,
  name       text        not null,
  params     jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, route, name)
);

comment on table  public.saved_views is
  'Kullanıcının adlandırıp kaydettiği liste filtre kombinasyonları (kişisel, sayfa başına)';
comment on column public.saved_views.route is
  'Uygulama içi sayfa yolu, ör. /app/musteriler — izinli değerler action katmanında sabittir';
comment on column public.saved_views.params is
  'Beyaz-listeli query paramları ({"q":"...","type":"..."}); sayfa (sayfalama) hiçbir zaman yazılmaz';

create index if not exists idx_saved_views_user_route
  on public.saved_views(user_id, route);

-- ============================================================
-- RLS — kiracı izolasyonu + sahiplik (bkz. 20260725000054: helper kullan,
-- JWT claim ifadesini satır içi kopyalama)
-- ============================================================
alter table public.saved_views enable row level security;

drop policy if exists saved_views_own on public.saved_views;

create policy saved_views_own on public.saved_views
  for all
  using (tenant_id = public.current_tenant_id() and user_id = auth.uid())
  with check (tenant_id = public.current_tenant_id() and user_id = auth.uid());

comment on policy saved_views_own on public.saved_views is
  'Kişisel kayıtlar: kiracı izolasyonu + user_id = auth.uid(). current_tenant_id() kullanır (bkz. 20260725000054).';

grant all on public.saved_views to authenticated, service_role;
