-- MIGRATION 20261018070001_message_sequences.sql
-- COM-05: Takip dizileri (drip / Action Plan). Bir müşteri diziye kaydedilir; adımlar (SMS, onaylı WhatsApp şablonu,
-- e-posta, görev) kayıttan itibaren göreli gün gecikmesiyle sırayla çalışır. Müşteri yanıt verince (gelen WhatsApp/SMS)
-- dizi durur. Çalıştırıcı: mevcut gorev-hatirlat cron adımı (src/lib/automation/sequence-runner.ts), 2 saatte bir, 09:00-20:00 TR.
-- İDEMPOTENT ÇALIŞMA: message_sequence_step_runs (enrollment_id, step_index) UNIQUE; adım önce "claimed" satırıyla
-- sahiplenilir, sonra gönderilir. Aynı adım iki kez gönderilmez (eşzamanlı iki cron dahil).
-- Yetki: dizi tanımı settings:edit (otomasyon ekranıyla aynı), kayıt/durdurma customers:edit; adım sonucu yalnız
-- sunucu (service_role) yazar. Bağımlılık: tenants, profiles(id, tenant_id), customers(id, tenant_id),
-- current_tenant_id(), has_effective_permission(text,text). Geri alma: supabase/rollbacks/20261018070001_*.

set local lock_timeout = '5s';

create table if not exists public.message_sequences (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  name           text        not null check (char_length(btrim(name)) between 1 and 120),
  description    text        check (description is null or char_length(description) <= 300),
  is_active      boolean     not null default false,
  stop_on_reply  boolean     not null default true,
  daily_cap      integer     not null default 200 check (daily_cap between 1 and 2000),
  created_by     uuid        references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists idx_message_sequences_id_tenant on public.message_sequences(id, tenant_id);
create index if not exists idx_message_sequences_tenant on public.message_sequences(tenant_id, updated_at desc);

comment on table public.message_sequences is
  'Takip dizisi: müşteriye göreli gün gecikmeli, sıralı mesaj/görev adımları; yanıt gelince durur (COM-05).';

create table if not exists public.message_sequence_steps (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  sequence_id  uuid        not null,
  sort_order   integer     not null check (sort_order between 0 and 19),
  delay_days   integer     not null default 0 check (delay_days between 0 and 365),
  step_type    text        not null check (step_type in ('task', 'sms', 'whatsapp_template', 'email')),
  config       jsonb       not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at   timestamptz not null default now(),
  constraint message_sequence_steps_sequence_tenant_fkey
    foreign key (sequence_id, tenant_id) references public.message_sequences(id, tenant_id) on delete cascade
);
create unique index if not exists idx_message_sequence_steps_order on public.message_sequence_steps(sequence_id, sort_order);
create index if not exists idx_message_sequence_steps_tenant on public.message_sequence_steps(tenant_id);

comment on column public.message_sequence_steps.delay_days is
  'Bir önceki adımdan (ilk adımda kayıttan) kaç gün sonra çalışır; 0 = hemen (bir sonraki uygun saatte).';

create table if not exists public.message_sequence_enrollments (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  sequence_id   uuid        not null,
  customer_id   uuid        not null,
  status        text        not null default 'active' check (status in ('active', 'completed', 'stopped')),
  next_step     integer     not null default 0 check (next_step >= 0),
  next_due_at   timestamptz,
  enrolled_by   uuid        references public.profiles(id) on delete set null,
  enrolled_at   timestamptz not null default now(),
  finished_at   timestamptz,
  stop_reason   text        check (stop_reason is null or stop_reason in ('reply', 'manual', 'sequence_inactive', 'customer_removed', 'completed')),
  last_result   jsonb,
  updated_at    timestamptz not null default now(),
  constraint message_sequence_enrollments_sequence_tenant_fkey
    foreign key (sequence_id, tenant_id) references public.message_sequences(id, tenant_id) on delete cascade,
  constraint message_sequence_enrollments_customer_tenant_fkey
    foreign key (customer_id, tenant_id) references public.customers(id, tenant_id) on delete cascade,
  constraint message_sequence_enrollments_state_check check (
    (status = 'active' and finished_at is null and stop_reason is null)
    or (status <> 'active' and finished_at is not null)
  )
);
-- Aynı müşteri aynı diziye aynı anda yalnız bir kez aktif kayıtlı olabilir.
create unique index if not exists idx_message_sequence_enrollments_active
  on public.message_sequence_enrollments(sequence_id, customer_id) where status = 'active';
-- Çalıştırıcının sıcak sorgusu: vadesi gelen aktif kayıtlar.
create index if not exists idx_message_sequence_enrollments_due
  on public.message_sequence_enrollments(next_due_at) where status = 'active';
-- "Yanıt gelince dur" ve müşteri kartı: müşterinin aktif kayıtları.
create index if not exists idx_message_sequence_enrollments_customer
  on public.message_sequence_enrollments(tenant_id, customer_id) where status = 'active';
create index if not exists idx_message_sequence_enrollments_sequence
  on public.message_sequence_enrollments(sequence_id, enrolled_at desc);

create table if not exists public.message_sequence_step_runs (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  enrollment_id  uuid        not null references public.message_sequence_enrollments(id) on delete cascade,
  step_index     integer     not null check (step_index >= 0),
  step_type      text        not null,
  result         text        not null check (result in ('claimed', 'ok', 'skip', 'error')),
  detail         text        check (detail is null or char_length(detail) <= 300),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- İdempotent çalışmanın duvarı: bir kaydın bir adımı yalnız bir kez sahiplenilir.
create unique index if not exists idx_message_sequence_step_runs_once
  on public.message_sequence_step_runs(enrollment_id, step_index);
create index if not exists idx_message_sequence_step_runs_tenant
  on public.message_sequence_step_runs(tenant_id, created_at desc);

-- ------------------------------------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------------------------------------
alter table public.message_sequences            enable row level security;
alter table public.message_sequence_steps       enable row level security;
alter table public.message_sequence_enrollments enable row level security;
alter table public.message_sequence_step_runs   enable row level security;

drop policy if exists message_sequences_select on public.message_sequences;
create policy message_sequences_select on public.message_sequences
  for select using (tenant_id = (select public.current_tenant_id()));
drop policy if exists message_sequences_write on public.message_sequences;
create policy message_sequences_write on public.message_sequences
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

drop policy if exists message_sequence_steps_select on public.message_sequence_steps;
create policy message_sequence_steps_select on public.message_sequence_steps
  for select using (tenant_id = (select public.current_tenant_id()));
drop policy if exists message_sequence_steps_write on public.message_sequence_steps;
create policy message_sequence_steps_write on public.message_sequence_steps
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

drop policy if exists message_sequence_enrollments_select on public.message_sequence_enrollments;
create policy message_sequence_enrollments_select on public.message_sequence_enrollments
  for select using (tenant_id = (select public.current_tenant_id()));
drop policy if exists message_sequence_enrollments_insert on public.message_sequence_enrollments;
create policy message_sequence_enrollments_insert on public.message_sequence_enrollments
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('customers', 'edit')));
drop policy if exists message_sequence_enrollments_update on public.message_sequence_enrollments;
create policy message_sequence_enrollments_update on public.message_sequence_enrollments
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('customers', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('customers', 'edit')));
revoke delete on public.message_sequence_enrollments from anon, authenticated;

drop policy if exists message_sequence_step_runs_select on public.message_sequence_step_runs;
create policy message_sequence_step_runs_select on public.message_sequence_step_runs
  for select using (tenant_id = (select public.current_tenant_id()));
-- Adım sonucu yalnız çalıştırıcı (service_role) yazar.
revoke insert, update, delete on public.message_sequence_step_runs from anon, authenticated;

revoke all on public.message_sequences, public.message_sequence_steps, public.message_sequence_enrollments,
  public.message_sequence_step_runs from anon;
grant select, insert, update, delete on public.message_sequences, public.message_sequence_steps to authenticated;
grant select, insert, update on public.message_sequence_enrollments to authenticated;
grant select on public.message_sequence_step_runs to authenticated;
grant all on public.message_sequences, public.message_sequence_steps, public.message_sequence_enrollments,
  public.message_sequence_step_runs to service_role;
