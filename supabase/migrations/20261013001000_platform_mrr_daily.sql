-- Platform MRR gunluk anlik goruntusu: her ofis icin gunde bir satir (abonelik-kontrol cron'u, 03:00 TR).
-- Amac: gelir egrisi gecmis aylar icin UYDURULMAZ; anlik goruntu oncesi aylar "veri yok" kalir.
-- Yeni tablo; mevcut tablo/politika/yetkilere dokunmaz. Kod tablo yokken "veri yok" davranir.
-- Okuma: yalniz platform personelinin billing/reports modulune sahip rolleri (super_admin, ops, billing;
--   bkz. src/lib/platform-access.ts PLATFORM_ROLE_MODULES). Yazma: yalniz service_role (cron upsert).
create table if not exists public.platform_mrr_daily (
  day date not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid null,
  plan_id text null,
  mrr_try numeric(12,2) not null default 0,
  status text not null,
  captured_at timestamptz not null default now(),
  primary key (day, tenant_id)
);

-- Trend okumasi gun araligiyla yapilir (ay sonu degerleri); PK (day, tenant_id) zaten day ile baslar,
-- ayri indeks tenant bazli silme/okuma icindir.
create index if not exists platform_mrr_daily_tenant_idx on public.platform_mrr_daily (tenant_id);

alter table public.platform_mrr_daily enable row level security;
alter table public.platform_mrr_daily force row level security;

drop policy if exists platform_mrr_daily_staff_select on public.platform_mrr_daily;
create policy platform_mrr_daily_staff_select on public.platform_mrr_daily
  for select to authenticated
  using (
    (select public.is_platform_staff())
    and exists (
      select 1 from public.platform_staff ps
      where ps.id = (select auth.uid())
        and ps.is_active = true
        and ps.role in ('super_admin', 'ops', 'billing')
    )
  );

revoke all privileges on table public.platform_mrr_daily from public, anon, authenticated, service_role;
grant select on table public.platform_mrr_daily to authenticated;
grant select, insert, update, delete on table public.platform_mrr_daily to service_role;

notify pgrst, 'reload schema';
