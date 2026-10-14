-- DG4 Rapor merkezi: kayitli rapor gorunumleri + zamanlanmis rapor abonelikleri (ofis ve admin).
--
-- Tablolar:
--   report_saved_views         : rapor + filtre seti (ad verilir; istege bagli paylasim). Ofis satiri tenant_id + user_id,
--                                platform satiri staff_id (tenant_id null) tasir.
--   report_subscriptions       : rapor + filtre + bicim (xlsx/pdf/csv) + siklik (gunluk/haftalik/aylik) + alicilar
--                                (ofis: ayni ofisin kullanicilari, platform: personel; kimlik listesi, adres SAKLANMAZ).
--                                Teslim mevcut `gunluk-ozet` cron'unun ayrik adimidir (yeni cron YOK); next_run_at gelen
--                                satirlar islenir, her alici raporu KENDI yetkisi/kapsamiyla alir.
--   report_subscription_runs   : teslim gunlugu (abonelik x donem tekil -> ayni donem ikinci kez gonderilmez).
-- RLS: ofis kullanicisi YALNIZ kendi ofisinin satirlarini gorur; kendi gorunum/aboneligini yazar; paylasilan gorunumu
--   (shared) ofisteki herkes okur. Platform satirlarinda tenant_id null oldugundan hicbir authenticated politika eslesmez
--   (yalniz service_role, platform kapisindan sonra). Calistirma gunlugune yalniz service_role yazar.
-- KOD DAVRANISI: tablolar yokken rapor merkezi "kurulum bekliyor" der, cron adimi 'skipped' gecer (hata yok).
-- GERI ALMA: supabase/rollbacks/20261014004000_report_subscriptions.rollback.sql
-- RISK: dusuk (yeni nesneler; mevcut tablo/politika/veri degismez; FK'ler tenants, profiles ve platform_staff'a).

create table if not exists public.report_saved_views (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('tenant', 'platform')),
  tenant_id uuid references public.tenants(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  staff_id uuid references public.platform_staff(id) on delete cascade,
  report_id text not null check (report_id ~ '^[a-z0-9-]{1,80}$'),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_saved_views_owner_chk check (
    (scope = 'tenant' and tenant_id is not null and user_id is not null and staff_id is null)
    or (scope = 'platform' and tenant_id is null and user_id is null and staff_id is not null)
  )
);
create unique index if not exists report_saved_views_tenant_name_uidx
  on public.report_saved_views (tenant_id, user_id, report_id, lower(btrim(name))) where scope = 'tenant';
create unique index if not exists report_saved_views_platform_name_uidx
  on public.report_saved_views (staff_id, report_id, lower(btrim(name))) where scope = 'platform';
create index if not exists report_saved_views_tenant_report_idx on public.report_saved_views (tenant_id, report_id) where scope = 'tenant';
create index if not exists report_saved_views_user_idx on public.report_saved_views (user_id) where user_id is not null;
create index if not exists report_saved_views_staff_idx on public.report_saved_views (staff_id) where staff_id is not null;

create table if not exists public.report_subscriptions (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('tenant', 'platform')),
  tenant_id uuid references public.tenants(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  staff_id uuid references public.platform_staff(id) on delete cascade,
  report_id text not null check (report_id ~ '^[a-z0-9-]{1,80}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  -- true: tarih filtresi her gonderimde donemle (dun / son 7 gun / gecen ay) yeniden kurulur.
  relative_range boolean not null default true,
  format text not null check (format in ('xlsx', 'pdf', 'csv')),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  weekday smallint check (weekday between 1 and 7),
  month_day smallint check (month_day between 1 and 28),
  recipient_ids uuid[] not null check (cardinality(recipient_ids) between 1 and 10),
  active boolean not null default true,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  last_status text check (last_status is null or last_status in ('sent', 'partial', 'channel_disabled', 'failed', 'skipped')),
  last_error text check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_subscriptions_owner_chk check (
    (scope = 'tenant' and tenant_id is not null and user_id is not null and staff_id is null)
    or (scope = 'platform' and tenant_id is null and user_id is null and staff_id is not null)
  ),
  constraint report_subscriptions_schedule_chk check (
    (frequency = 'daily' and weekday is null and month_day is null)
    or (frequency = 'weekly' and weekday is not null and month_day is null)
    or (frequency = 'monthly' and month_day is not null and weekday is null)
  )
);
create index if not exists report_subscriptions_due_idx on public.report_subscriptions (next_run_at) where active;
create index if not exists report_subscriptions_tenant_idx on public.report_subscriptions (tenant_id, user_id) where tenant_id is not null;
create index if not exists report_subscriptions_user_idx on public.report_subscriptions (user_id) where user_id is not null;
create index if not exists report_subscriptions_staff_idx on public.report_subscriptions (staff_id) where staff_id is not null;

create table if not exists public.report_subscription_runs (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.report_subscriptions(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  period_key text not null check (period_key ~ '^\d{4}-\d{2}-\d{2}$'),
  status text not null default 'running' check (status in ('running', 'sent', 'partial', 'channel_disabled', 'failed', 'skipped')),
  recipients smallint not null default 0,
  sent smallint not null default 0,
  row_count integer not null default 0,
  error text check (error is null or char_length(error) <= 300),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (subscription_id, period_key)
);
create index if not exists report_subscription_runs_tenant_idx on public.report_subscription_runs (tenant_id, created_at desc) where tenant_id is not null;

alter table public.report_saved_views enable row level security;
alter table public.report_subscriptions enable row level security;
alter table public.report_subscription_runs enable row level security;

-- Kayitli gorunum: kendi + ofiste paylasilan okunur; yalniz kendi satiri yazilir.
drop policy if exists report_saved_views_select on public.report_saved_views;
create policy report_saved_views_select on public.report_saved_views
  for select to authenticated
  using (
    scope = 'tenant'
    and tenant_id = (select public.current_tenant_id())
    and (user_id = (select auth.uid()) or shared)
  );
drop policy if exists report_saved_views_write on public.report_saved_views;
create policy report_saved_views_write on public.report_saved_views
  for all to authenticated
  using (scope = 'tenant' and tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()))
  with check (scope = 'tenant' and tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()) and staff_id is null);

-- Abonelik: yalniz sahibi (ayni ofis) okur/yazar. Alicilarin ayni ofisten olmasi teslimde ayrica dogrulanir.
drop policy if exists report_subscriptions_own on public.report_subscriptions;
create policy report_subscriptions_own on public.report_subscriptions
  for all to authenticated
  using (scope = 'tenant' and tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()))
  with check (scope = 'tenant' and tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()) and staff_id is null);

-- Calistirma gunlugu: abonelik sahibi kendi aboneliginin satirlarini okur; yazma yalniz service_role.
drop policy if exists report_subscription_runs_select on public.report_subscription_runs;
create policy report_subscription_runs_select on public.report_subscription_runs
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.report_subscriptions s
      where s.id = report_subscription_runs.subscription_id and s.user_id = (select auth.uid())
    )
  );

revoke all privileges on table public.report_saved_views, public.report_subscriptions, public.report_subscription_runs from public, anon;
grant select, insert, update, delete on table public.report_saved_views, public.report_subscriptions to authenticated;
grant select on table public.report_subscription_runs to authenticated;
grant select, insert, update, delete on table public.report_saved_views, public.report_subscriptions, public.report_subscription_runs to service_role;

comment on table public.report_saved_views is 'DG4: rapor merkezi kayitli gorunumleri (rapor + filtre seti; ofiste paylasilabilir).';
comment on table public.report_subscriptions is 'DG4: zamanlanmis rapor abonelikleri (gunluk/haftalik/aylik e-posta eki; teslim gunluk-ozet cron adimi).';
comment on table public.report_subscription_runs is 'DG4: zamanlanmis rapor teslim gunlugu (abonelik x donem tekil).';

notify pgrst, 'reload schema';
