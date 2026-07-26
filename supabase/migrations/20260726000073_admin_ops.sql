-- Admin operasyonları: ticket atama, hazır yanıt makroları, dunning sayaçları

-- ========== TICKET ATAMA ==========
-- Not: eski `assigned_to` kolonu duruyor (yanıtlarda otomatik set ediliyor);
-- `assigned_staff_id` manuel atama içindir ve UI bu kolonu okur.
alter table public.support_tickets
  add column if not exists assigned_staff_id uuid references public.platform_staff(id) on delete set null;

create index if not exists idx_tickets_assigned_staff
  on public.support_tickets(assigned_staff_id)
  where assigned_staff_id is not null;

-- ========== HAZIR YANIT MAKROLARI (platform geneli) ==========
create table if not exists public.ticket_macros (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  created_by uuid references public.platform_staff(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.ticket_macros enable row level security;

-- Tüm aktif personel okuyabilir; yazma işlemleri server action'da
-- süper admin kontrolüyle service_role üzerinden yapılır.
drop policy if exists ticket_macros_staff_select on public.ticket_macros;
create policy ticket_macros_staff_select on public.ticket_macros
  for select using (public.is_platform_staff());

grant select on public.ticket_macros to authenticated;
grant all on public.ticket_macros to service_role;

-- ========== DUNNING SAYAÇLARI ==========
alter table public.invoices
  add column if not exists reminder_count int not null default 0,
  add column if not exists last_reminder_at timestamptz;

-- Dunning cron'u gecikmiş açık faturaları tarar
create index if not exists idx_invoices_overdue
  on public.invoices(status, due_at)
  where status = 'open';
