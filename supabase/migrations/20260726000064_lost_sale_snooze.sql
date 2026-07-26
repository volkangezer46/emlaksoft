-- Kayıp satış dedektörü: "Arandı" / "1 hafta ertele" (snooze) kayıtları
--
-- /app/kayip-satis her açılışta riskleri yeniden hesaplar; danışman bir
-- müşteriyi aradıysa veya bilinçli ertelediyse kart listeden düşmeli.
--
-- Tasarım kararları:
--  * unique(tenant_id, customer_id): müşteri başına tek satır — yeni
--    "Arandı"/"Ertele" aksiyonu upsert ile önceki kaydın üzerine yazar.
--  * reason: 'called' = arandı (30 gün gizle), 'snoozed' = ertelendi
--    (dismissed_until tarihine kadar gizle).
--  * dismissed_until null olabilir: 'called' kayıtları created_at + 30 gün
--    kuralıyla da düşürülebilir (sayfa her iki koşulu da uygular).

create table if not exists public.lost_sale_dismissals (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references public.tenants(id)   on delete cascade,
  customer_id     uuid        not null references public.customers(id) on delete cascade,
  dismissed_until timestamptz,
  reason          text        not null check (reason in ('called', 'snoozed')),
  created_by      uuid        references public.profiles(id),
  created_at      timestamptz not null default now(),
  unique (tenant_id, customer_id)
);

comment on table  public.lost_sale_dismissals is
  'Kayıp satış dedektöründen düşürülen müşteriler: arandı / ertelendi';
comment on column public.lost_sale_dismissals.reason is
  'called = arandı (30 gün listeden düşer), snoozed = dismissed_until tarihine kadar ertelendi';

create index if not exists idx_lsd_tenant_until
  on public.lost_sale_dismissals(tenant_id, dismissed_until);

-- ============================================================
-- RLS — kiracı izolasyonu (bkz. 20260725000054: helper kullan,
-- JWT claim ifadesini satır içi kopyalama)
-- ============================================================
alter table public.lost_sale_dismissals enable row level security;

drop policy if exists lsd_tenant on public.lost_sale_dismissals;

create policy lsd_tenant on public.lost_sale_dismissals
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on policy lsd_tenant on public.lost_sale_dismissals is
  'Kiracı izolasyonu. current_tenant_id() kullanır — JWT claim ifadesini satır içi kopyalamayın (bkz. 20260725000054).';

grant all on public.lost_sale_dismissals to authenticated, service_role;
