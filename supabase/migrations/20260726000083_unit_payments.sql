-- Proje satışında ödeme planı + vade takibi — unit_payments
--
-- Neden:
--  * Kaporalı/satılan dairelerde peşinat + taksit + ara ödeme planı sistemde
--    izlenemiyordu; vizyondaki "ödeme planları / taksit / vade takibi" bacağı.
--  * Plan satırları uygulama tarafında üretilir (createPaymentPlan — liste
--    fiyatından peşinat %'si + kalan eşit taksit); DB yalnız değer kümesini korur.
--  * Vadesi geçen 'pending' satırları /api/cron/proje-vade günlük 'overdue'
--    yapar ve tenant'a tek bildirim yazar.
--
-- Tasarım kararları:
--  * kind kapalı liste: pesinat | taksit | ara_odeme; seq taksit sırasıdır
--    (peşinat 0, taksitler 1..N, ara ödemeler ay ofseti).
--  * unit_id → project_units on delete cascade: daire silinirse/serbest
--    bırakılıp silinirse plan satırları da düşer.
--  * RLS: rent_charges ile aynı desen — current_tenant_id().

create table if not exists public.unit_payments (
  id         uuid          primary key default gen_random_uuid(),
  tenant_id  uuid          not null references public.tenants(id)        on delete cascade,
  unit_id    uuid          not null references public.project_units(id)  on delete cascade,
  kind       text          not null check (kind in ('pesinat', 'taksit', 'ara_odeme')),
  seq        int           not null default 0,
  due_date   date          not null,
  amount     numeric(14,2) not null check (amount > 0),
  status     text          not null default 'pending' check (status in ('pending', 'paid', 'overdue')),
  paid_at    timestamptz,
  notes      text,
  created_by uuid          references public.profiles(id) on delete set null,
  created_at timestamptz   not null default now()
);

comment on table  public.unit_payments          is 'Proje daire ödeme planı satırları — peşinat/taksit/ara ödeme + vade takibi';
comment on column public.unit_payments.kind     is 'pesinat: peşinat | taksit: eşit taksit | ara_odeme: ara ödeme (balon)';
comment on column public.unit_payments.seq      is 'Sıra — peşinat 0, taksitler 1..N, ara ödemeler ay ofseti';
comment on column public.unit_payments.status   is 'pending → paid (elle) | pending → overdue (cron: /api/cron/proje-vade, vade geçince)';
comment on column public.unit_payments.due_date is 'Vade — taksitlerde plan başlangıç günü korunur (28''e kırpılır)';

create index if not exists idx_unit_payments_tenant_unit
  on public.unit_payments (tenant_id, unit_id);

create index if not exists idx_unit_payments_tenant_status_due
  on public.unit_payments (tenant_id, status, due_date);

-- ============================================================
-- RLS — tenant izolasyonu (rent_charges ile aynı desen)
-- ============================================================
alter table public.unit_payments enable row level security;

drop policy if exists unit_payments_tenant        on public.unit_payments;
drop policy if exists unit_payments_tenant_insert on public.unit_payments;

create policy unit_payments_tenant on public.unit_payments
  using (tenant_id = public.current_tenant_id());

create policy unit_payments_tenant_insert on public.unit_payments for insert
  with check (tenant_id = public.current_tenant_id());

grant all on public.unit_payments to authenticated, service_role;
