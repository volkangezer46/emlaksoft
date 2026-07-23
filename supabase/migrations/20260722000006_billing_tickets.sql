-- Billing skeleton + support tickets (platform ops)

-- ========== SUBSCRIPTIONS ==========
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  plan text not null default 'office'
    check (plan in ('advisor','office','professional','enterprise')),
  status text not null default 'trialing'
    check (status in ('trialing','active','past_due','cancelled','paused')),
  billing_cycle text not null default 'monthly'
    check (billing_cycle in ('monthly','yearly')),
  amount_try numeric not null default 0,
  currency text not null default 'TRY',
  iyzico_subscription_ref text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_subscriptions_status on public.subscriptions(status);

-- ========== INVOICES ==========
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  invoice_no text not null,
  status text not null default 'draft'
    check (status in ('draft','open','paid','void','uncollectible')),
  amount_try numeric not null default 0,
  tax_try numeric not null default 0,
  total_try numeric not null default 0,
  currency text not null default 'TRY',
  period_start timestamptz,
  period_end timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  iyzico_payment_id text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (tenant_id, invoice_no)
);
create index if not exists idx_invoices_tenant on public.invoices(tenant_id, created_at desc);

-- ========== SUPPORT TICKETS ==========
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  assigned_to uuid references public.platform_staff(id) on delete set null,
  subject text not null,
  body text not null,
  category text not null default 'general'
    check (category in ('general','billing','bug','feature','compliance','onboarding')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  status text not null default 'open'
    check (status in ('open','in_progress','waiting','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_tickets_tenant on public.support_tickets(tenant_id, created_at desc);
create index if not exists idx_tickets_status on public.support_tickets(status, priority);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_user_id uuid,
  author_kind text not null default 'tenant'
    check (author_kind in ('tenant','staff','system')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ticket_messages on public.support_ticket_messages(ticket_id, created_at);

-- ========== RLS ==========
alter table public.subscriptions enable row level security;
alter table public.invoices enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

drop policy if exists subscriptions_tenant_select on public.subscriptions;
create policy subscriptions_tenant_select on public.subscriptions for select
  using (tenant_id = public.current_tenant_id() or public.is_platform_staff());

drop policy if exists invoices_tenant_select on public.invoices;
create policy invoices_tenant_select on public.invoices for select
  using (tenant_id = public.current_tenant_id() or public.is_platform_staff());

drop policy if exists tickets_tenant_all on public.support_tickets;
create policy tickets_tenant_all on public.support_tickets for all
  using (tenant_id = public.current_tenant_id() or public.is_platform_staff())
  with check (tenant_id = public.current_tenant_id() or public.is_platform_staff());

drop policy if exists ticket_messages_access on public.support_ticket_messages;
create policy ticket_messages_access on public.support_ticket_messages for all
  using (
    exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id
        and (t.tenant_id = public.current_tenant_id() or public.is_platform_staff())
    )
  )
  with check (
    exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id
        and (t.tenant_id = public.current_tenant_id() or public.is_platform_staff())
    )
  );

-- Platform staff write on billing via service_role in server actions; also allow update for staff
drop policy if exists subscriptions_staff_update on public.subscriptions;
create policy subscriptions_staff_update on public.subscriptions for update
  using (public.is_platform_staff()) with check (public.is_platform_staff());

drop policy if exists invoices_staff_all on public.invoices;
create policy invoices_staff_all on public.invoices for all
  using (public.is_platform_staff()) with check (public.is_platform_staff());

grant select on public.subscriptions to authenticated;
grant select on public.invoices to authenticated;
grant all on public.support_tickets to authenticated;
grant all on public.support_ticket_messages to authenticated;
grant all on public.subscriptions, public.invoices, public.support_tickets, public.support_ticket_messages to service_role;

-- Seed subscription rows for existing tenants (idempotent)
insert into public.subscriptions (tenant_id, plan, status, billing_cycle, amount_try, trial_ends_at, current_period_start)
select
  t.id,
  t.plan,
  case when t.status = 'trial' then 'trialing'
       when t.status = 'active' then 'active'
       when t.status = 'past_due' then 'past_due'
       when t.status = 'cancelled' then 'cancelled'
       else 'paused' end,
  'monthly',
  case t.plan
    when 'advisor' then 990
    when 'office' then 2490
    when 'professional' then 5990
    when 'enterprise' then 12900
    else 2490 end,
  t.trial_ends_at,
  t.created_at
from public.tenants t
on conflict (tenant_id) do nothing;
