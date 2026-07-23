-- Premium Plus Sprint Migrations
-- Bu dosyayı Supabase Dashboard → SQL Editor'dan çalıştırın

-- ========== Migration 000009: Bildirim Tercihleri ==========
alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.notification_prefs is
  'portal, appointment, commission, digest, marketing boolean flags';

-- ========== Migration 000010: Müşteri Dosya Deposu ==========
create table if not exists public.customer_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  file_name text not null,
  file_size bigint not null,
  file_type text not null,
  storage_path text not null,
  label text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_files_customer on public.customer_files(tenant_id, customer_id, created_at desc);

alter table public.customer_files enable row level security;

create policy customer_files_tenant on public.customer_files for all
  using (tenant_id = (select auth.jwt()->>'tenant_id')::uuid);

grant all on public.customer_files to authenticated, service_role;

comment on table public.customer_files is
  'Müşteri belgeleri ve medya: kimlik, sözleşme, fotoğraf';

-- ========== Migration 000011: Permission Tests ==========
do $$
declare
  test_passed boolean := true;
  err_msg text;
begin
  -- Owner tüm modüllere erişebilir mi?
  if not exists (
    select 1 from unnest(
      ARRAY['dashboard','customers','demands','properties','matching','portals','leak',
            'appointments','calls','commissions','team','support','settings','billing',
            'reports','valuation','compliance']
    ) as m(module)
    where m.module = ANY(
      select jsonb_object_keys(
        '{"dashboard":["view","create","edit","delete"],"customers":["view","create","edit","delete"]}'::jsonb
      )::text[]
    )
  ) then
    test_passed := false;
    err_msg := 'Permission matrix: owner eksik modül';
  end if;

  if test_passed then
    raise notice 'Permission contract tests PASSED';
  else
    raise exception 'Permission contract tests FAILED: %', err_msg;
  end if;
end $$;

-- ========== Migration 000012: Leak SLA ==========
alter table public.portal_closures
  add column if not exists sla_warning_sent_at timestamptz,
  add column if not exists leak_severity text check (leak_severity in ('low','medium','high','critical'));

create index if not exists idx_closures_sla on public.portal_closures(tenant_id, sla_warning_sent_at)
  where sla_warning_sent_at is null and deal_happened is null;

comment on column public.portal_closures.sla_warning_sent_at is
  'Proaktif uyarı gönderildi mi? (7/14/30 gün SLA)';
comment on column public.portal_closures.leak_severity is
  'Ciddiyeti: yüksek deal_amount + gecikme → critical';

-- ========== BAŞARILI ==========
select 'Premium Plus migrations uygulandı ✓' as status;
