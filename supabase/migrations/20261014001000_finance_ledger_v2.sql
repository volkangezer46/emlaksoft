-- UYGULANMADI (canlıya henüz uygulanmadı; sahibin onayı + yedek doğrulaması sonrası `npm run db:migrate`).
--
-- Finans v2 (FN1) — 1/3 ŞEMA: Muhasebe ekranı (/app/giderler, modül `expenses`) mini muhasebe programına dönüşür.
-- Tasarım: docs/design/FINANS_KASA_EFATURA_TASARIM_2026-10.md + FN paket sözleşmesi (2026-10-13).
-- İÇERİK:
--   1) Yeni tablolar (hepsinde tenant_id + RLS; okuma `expenses:view`, yazma YALNIZ finance_* RPC'leri):
--      finance_parties (cari), finance_open_items (alacak/borç vade kalemi), finance_attachments (ek + fiş kutusu),
--      finance_categories (ofis kategorileri), finance_rules (otomatik kategori kuralları), finance_period_locks (ay kilidi),
--      finance_budgets (aylık gelir/gider bütçesi), finance_settings (ofis finans ayarı),
--      finance_saved_views (kullanıcıya özel kayıtlı görünüm; tek doğrudan yazılan tablo, user_id = auth.uid()).
--   2) cash_entries'e 9 null'lanabilir kolon (party_id, vat_rate, vat_amount, vat_included, withholding_rate, withholding_amount,
--      property_id, open_item_id) — mevcut satırlar DEĞİŞMEZ (vat_included varsayılanı yalnız yeni satırlara uygulanır).
--      recurring_rules'a 3 null'lanabilir kolon (party_id, vat_rate, withholding_rate).
--   3) Dönem kilidi tetiği: kilitli aya hareket/açık kalem ekleme, tutar/tarih/yön/kategori/KDV değişikliği ve iptal
--      `DONEM_KILITLI` ile reddedilir (mutabakat işareti, cari bağı, not gibi parasal olmayan alanlar serbest).
--   4) Açık kaleme bağlı hareket yazılınca/iptal edilince kalemin ödenen tutarı ve durumu kendiliğinden yeniden hesaplanır.
--   5) Görünümler (security_invoker): finance_ledger_v (hareketler + deftere bağlanmamış eski giderler 'legacy_expense'),
--      finance_open_items_v (elle kalemler + kira tahakkuku + hesaplanmış komisyon + düzenli ödeme + mülk sahibi hakedişi).
--      Komisyon alacağı = gross_amount (KDV dahil brüt; kâr/zarar mantığıyla aynı: gelir = brüt − KDV − paylar) − tahsil edilen.
--   6) supabase_realtime yayınına finance_open_items ve finance_parties eklenir (idempotent).
-- Silme/yeniden adlandırma YOK; eski RPC imzaları ve gövdeleri DEĞİŞMEZ (RPC'ler 20261014001100'de).
-- Bağımlılık: 20261010000600, 20261010000900, 20261011001200, 20261012000400, 20261008001100, 20260816000200.
-- GERİ ALMA: supabase/rollbacks/20261014001000_finance_ledger_v2.rollback.sql (yeni tablo/kolon/görünüm düşer; eski veri kalır).
-- RİSK: düşük-orta (yalnız ekler; tetik yalnız kilitli ay varken etkilidir, kilit tablosu boş doğar).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.finance_accounts') is null
     or pg_catalog.to_regclass('public.cash_entries') is null
     or pg_catalog.to_regclass('public.recurring_rules') is null
     or pg_catalog.to_regclass('public.recurring_occurrences') is null
     or pg_catalog.to_regclass('public.finance_statement_lines') is null
     or pg_catalog.to_regclass('public.expenses') is null
     or pg_catalog.to_regclass('public.expense_budgets') is null
     or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.properties') is null
     or pg_catalog.to_regclass('public.commissions') is null
     or pg_catalog.to_regclass('public.deals') is null
     or pg_catalog.to_regclass('public.rentals') is null
     or pg_catalog.to_regclass('public.rent_charges') is null
     or pg_catalog.to_regclass('public.rent_payments') is null
     or pg_catalog.to_regclass('public.owner_payouts') is null
     or pg_catalog.to_regclass('public.owner_charge_links') is null
     or pg_catalog.to_regclass('public.rental_management_agreements') is null
     or pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null
     or pg_catalog.to_regprocedure('public.finance_is_owner_gm()') is null
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.cash_entries'::regclass and attname = 'is_sample' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.cash_entries'::regclass and attname = 'reconciled_at' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.rent_charges'::regclass and attname = 'paid_amount' and not attisdropped) then
    raise exception '20261014001000: finans/mülk yönetimi önkoşulları eksik (20261010000600, 20261010000900, 20261011001200, 20261012000400, 20261008001100 önce uygulanmalı).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Cari (kişi/firma)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_parties (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  kind        text not null default 'diger' check (kind in ('musteri', 'malik', 'kiraci', 'tedarikci', 'danisman', 'diger')),
  name        text not null check (char_length(name) between 1 and 120),
  tax_id      text check (tax_id is null or tax_id ~ '^[0-9]{10}$'),
  iban_last4  text check (iban_last4 is null or iban_last4 ~ '^[0-9]{4}$'),
  phone       text check (phone is null or phone ~ '^(0[0-9]{10}|\+[1-9][0-9]{6,14})$'),
  email       text check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  customer_id uuid references public.customers(id) on delete set null,
  user_id     uuid references public.profiles(id) on delete set null,
  note        text check (note is null or char_length(note) <= 1000),
  archived_at timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  is_sample   boolean not null default false
);
create unique index if not exists idx_finance_parties_name_unique
  on public.finance_parties (tenant_id, lower(name), kind) where archived_at is null;
create index if not exists idx_finance_parties_tenant on public.finance_parties (tenant_id, kind, name);
create index if not exists idx_finance_parties_customer on public.finance_parties (customer_id) where customer_id is not null;
create index if not exists idx_finance_parties_user on public.finance_parties (user_id) where user_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Açık kalem (alacak / borç, vade)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_open_items (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  direction          text not null check (direction in ('receivable', 'payable')),
  party_id           uuid references public.finance_parties(id) on delete set null,
  title              text not null check (char_length(title) between 1 and 160),
  category           text check (category is null or char_length(category) between 1 and 40),
  amount             numeric(14,2) not null check (amount > 0 and amount <= 9999999999.99),
  currency           text not null default 'TRY' check (currency in ('TRY', 'USD', 'EUR')),
  vat_rate           numeric(5,2) check (vat_rate is null or vat_rate between 0 and 100),
  vat_amount         numeric(14,2) check (vat_amount is null or vat_amount >= 0),
  withholding_amount numeric(14,2) check (withholding_amount is null or withholding_amount >= 0),
  issue_date         date not null check (issue_date between date '2000-01-01' and date '2100-12-31'),
  due_date           date not null check (due_date between date '2000-01-01' and date '2100-12-31'),
  paid_amount        numeric(14,2) not null default 0 check (paid_amount >= 0),
  status             text not null default 'open' check (status in ('open', 'partial', 'paid', 'cancelled')),
  source_type        text check (source_type is null or char_length(source_type) between 1 and 40),
  source_id          uuid,
  property_id        uuid references public.properties(id) on delete set null,
  note               text check (note is null or char_length(note) <= 1000),
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  cancelled_at       timestamptz,
  cancel_reason      text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  is_sample          boolean not null default false,
  constraint finance_open_items_due_after_issue check (due_date >= issue_date),
  constraint finance_open_items_cancel_consistent check ((status = 'cancelled') = (cancelled_at is not null))
);
create index if not exists idx_finance_open_items_open
  on public.finance_open_items (tenant_id, direction, due_date) where status in ('open', 'partial');
create index if not exists idx_finance_open_items_tenant on public.finance_open_items (tenant_id, issue_date desc);
create index if not exists idx_finance_open_items_party on public.finance_open_items (party_id) where party_id is not null;
create index if not exists idx_finance_open_items_source on public.finance_open_items (tenant_id, source_type, source_id) where source_id is not null;

-- ---------------------------------------------------------------------------
-- 3) cash_entries / recurring_rules yeni kolonları (null'lanabilir; mevcut satır değişmez)
-- ---------------------------------------------------------------------------
alter table public.cash_entries add column if not exists party_id uuid references public.finance_parties(id) on delete set null;
alter table public.cash_entries add column if not exists vat_rate numeric(5,2) check (vat_rate is null or vat_rate between 0 and 100);
alter table public.cash_entries add column if not exists vat_amount numeric(14,2) check (vat_amount is null or vat_amount >= 0);
alter table public.cash_entries add column if not exists vat_included boolean;
alter table public.cash_entries alter column vat_included set default true;
alter table public.cash_entries add column if not exists withholding_rate numeric(5,2) check (withholding_rate is null or withholding_rate between 0 and 100);
alter table public.cash_entries add column if not exists withholding_amount numeric(14,2) check (withholding_amount is null or withholding_amount >= 0);
alter table public.cash_entries add column if not exists property_id uuid references public.properties(id) on delete set null;
alter table public.cash_entries add column if not exists open_item_id uuid references public.finance_open_items(id) on delete set null;
create index if not exists idx_cash_entries_party on public.cash_entries (party_id, entry_date) where party_id is not null;
create index if not exists idx_cash_entries_open_item on public.cash_entries (open_item_id) where open_item_id is not null;
create index if not exists idx_cash_entries_property on public.cash_entries (property_id) where property_id is not null;
create index if not exists idx_cash_entries_expense on public.cash_entries (expense_id) where expense_id is not null;

alter table public.recurring_rules add column if not exists party_id uuid references public.finance_parties(id) on delete set null;
alter table public.recurring_rules add column if not exists vat_rate numeric(5,2) check (vat_rate is null or vat_rate between 0 and 100);
alter table public.recurring_rules add column if not exists withholding_rate numeric(5,2) check (withholding_rate is null or withholding_rate between 0 and 100);

-- ---------------------------------------------------------------------------
-- 4) Ekler + fiş kutusu (entry_id ve open_item_id boş = fiş kutusu)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_attachments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  entry_id     uuid references public.cash_entries(id) on delete set null,
  open_item_id uuid references public.finance_open_items(id) on delete set null,
  storage_path text not null check (char_length(storage_path) between 10 and 500),
  file_name    text not null check (char_length(file_name) between 1 and 200),
  file_type    text check (file_type is null or char_length(file_type) <= 100),
  file_size    bigint check (file_size is null or file_size between 0 and 26214400),
  ocr_status   text not null default 'none' check (ocr_status in ('none', 'pending', 'done', 'failed')),
  ocr_json     jsonb,
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint finance_attachments_path_unique unique (tenant_id, storage_path)
);
create index if not exists idx_finance_attachments_inbox
  on public.finance_attachments (tenant_id, created_at desc) where entry_id is null and open_item_id is null;
create index if not exists idx_finance_attachments_entry on public.finance_attachments (entry_id) where entry_id is not null;
create index if not exists idx_finance_attachments_item on public.finance_attachments (open_item_id) where open_item_id is not null;

-- ---------------------------------------------------------------------------
-- 5) Ofis kategorileri (sistem kategorileri kodda: CASH_CATEGORIES) + otomatik kategori kuralları
-- ---------------------------------------------------------------------------
create table if not exists public.finance_categories (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  direction                text not null check (direction in ('in', 'out')),
  key                      text not null check (key ~ '^x_[a-z0-9_]{1,30}$'),
  label                    text not null check (char_length(label) between 1 and 60),
  icon                     text check (icon is null or char_length(icon) <= 40),
  default_vat_rate         numeric(5,2) check (default_vat_rate is null or default_vat_rate between 0 and 100),
  default_withholding_rate numeric(5,2) check (default_withholding_rate is null or default_withholding_rate between 0 and 100),
  expense_category         text check (expense_category is null or char_length(expense_category) between 1 and 40),
  sort                     integer not null default 0,
  archived_at              timestamptz,
  created_at               timestamptz not null default now(),
  constraint finance_categories_key_unique unique (tenant_id, key)
);
create index if not exists idx_finance_categories_tenant on public.finance_categories (tenant_id, direction, sort);

create table if not exists public.finance_rules (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  direction        text check (direction is null or direction in ('in', 'out')),
  match_text       text check (match_text is null or char_length(match_text) between 2 and 100),
  match_iban_last4 text check (match_iban_last4 is null or match_iban_last4 ~ '^[0-9]{4}$'),
  amount_min       numeric(14,2) check (amount_min is null or amount_min >= 0),
  amount_max       numeric(14,2) check (amount_max is null or amount_max >= 0),
  set_category     text not null check (char_length(set_category) between 1 and 40),
  set_party_id     uuid references public.finance_parties(id) on delete set null,
  mode             text not null default 'suggest' check (mode in ('suggest', 'auto')),
  active           boolean not null default true,
  hits             integer not null default 0 check (hits >= 0),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint finance_rules_amount_range check (amount_min is null or amount_max is null or amount_min <= amount_max),
  constraint finance_rules_has_criteria check (match_text is not null or match_iban_last4 is not null or amount_min is not null or amount_max is not null)
);
create index if not exists idx_finance_rules_tenant on public.finance_rules (tenant_id, active);

-- ---------------------------------------------------------------------------
-- 6) Ay kilidi, bütçe, ayar, kayıtlı görünüm
-- ---------------------------------------------------------------------------
create table if not exists public.finance_period_locks (
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  period_month date not null check (extract(day from period_month) = 1),
  locked_at    timestamptz not null default now(),
  locked_by    uuid references public.profiles(id) on delete set null,
  note         text check (note is null or char_length(note) <= 300),
  primary key (tenant_id, period_month)
);

create table if not exists public.finance_budgets (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  period_month date not null check (extract(day from period_month) = 1),
  direction    text not null check (direction in ('in', 'out')),
  category     text not null check (char_length(category) between 1 and 60),
  amount       numeric(14,2) not null check (amount >= 0 and amount <= 9999999999.99),
  created_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now(),
  is_sample    boolean not null default false,
  constraint finance_budgets_unique unique (tenant_id, period_month, direction, category)
);
create index if not exists idx_finance_budgets_tenant on public.finance_budgets (tenant_id, period_month);

create table if not exists public.finance_settings (
  tenant_id            uuid primary key references public.tenants(id) on delete cascade,
  base_currency        text not null default 'TRY' check (base_currency in ('TRY', 'USD', 'EUR')),
  default_vat_rate     numeric(5,2) not null default 20 check (default_vat_rate between 0 and 100),
  vat_included_default boolean not null default true,
  ocr_enabled          boolean not null default false,
  forecast_min_balance numeric(14,2) check (forecast_min_balance is null or abs(forecast_min_balance) <= 9999999999.99),
  updated_by           uuid references public.profiles(id) on delete set null,
  updated_at           timestamptz not null default now()
);

create table if not exists public.finance_saved_views (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  tab        text not null check (tab in ('genel', 'hareketler', 'kasa-banka', 'cari', 'belgeler', 'duzenli', 'butce', 'vergi', 'raporlar', 'ayarlar')),
  name       text not null check (char_length(name) between 1 and 60),
  params     jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object' and pg_column_size(params) <= 4000),
  created_at timestamptz not null default now()
);
create unique index if not exists idx_finance_saved_views_unique on public.finance_saved_views (tenant_id, user_id, tab, lower(name));
create index if not exists idx_finance_saved_views_user on public.finance_saved_views (user_id, tab);

-- ---------------------------------------------------------------------------
-- 7) RLS: okuma tenant + expenses:view (maaş kalemleri yalnız owner/gm); yazma yalnız RPC
-- ---------------------------------------------------------------------------
alter table public.finance_parties enable row level security;
alter table public.finance_open_items enable row level security;
alter table public.finance_attachments enable row level security;
alter table public.finance_categories enable row level security;
alter table public.finance_rules enable row level security;
alter table public.finance_period_locks enable row level security;
alter table public.finance_budgets enable row level security;
alter table public.finance_settings enable row level security;
alter table public.finance_saved_views enable row level security;

drop policy if exists finance_parties_select on public.finance_parties;
create policy finance_parties_select on public.finance_parties
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'view')));

drop policy if exists finance_open_items_select on public.finance_open_items;
create policy finance_open_items_select on public.finance_open_items
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('expenses', 'view'))
    and (category is distinct from 'maas' or (select public.finance_is_owner_gm()))
  );

drop policy if exists finance_attachments_select on public.finance_attachments;
create policy finance_attachments_select on public.finance_attachments
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('expenses', 'view'))
    -- Hareket ekinin görünürlüğü hareketinkiyle aynıdır (maaş / kişisel hesap ekleri sızmaz).
    and (entry_id is null or exists (select 1 from public.cash_entries e where e.id = finance_attachments.entry_id))
  );

drop policy if exists finance_categories_select on public.finance_categories;
create policy finance_categories_select on public.finance_categories
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'view')));

drop policy if exists finance_rules_select on public.finance_rules;
create policy finance_rules_select on public.finance_rules
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'view')));

drop policy if exists finance_period_locks_select on public.finance_period_locks;
create policy finance_period_locks_select on public.finance_period_locks
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'view')));

drop policy if exists finance_budgets_select on public.finance_budgets;
create policy finance_budgets_select on public.finance_budgets
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('expenses', 'view'))
    and (category is distinct from 'maas' or (select public.finance_is_owner_gm()))
  );

drop policy if exists finance_settings_select on public.finance_settings;
create policy finance_settings_select on public.finance_settings
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'view')));

-- Kayıtlı görünüm kullanıcıya özeldir: tenant + kendi satırı + modül erişimi (RPC'siz doğrudan tablo).
drop policy if exists finance_saved_views_select on public.finance_saved_views;
create policy finance_saved_views_select on public.finance_saved_views
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and user_id = (select auth.uid()));
drop policy if exists finance_saved_views_insert on public.finance_saved_views;
create policy finance_saved_views_insert on public.finance_saved_views
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id()) and user_id = (select auth.uid())
    and (select public.has_effective_permission('expenses', 'view'))
  );
drop policy if exists finance_saved_views_update on public.finance_saved_views;
create policy finance_saved_views_update on public.finance_saved_views
  for update to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and user_id = (select auth.uid()))
  with check (tenant_id = (select public.current_active_tenant_id()) and user_id = (select auth.uid()));
drop policy if exists finance_saved_views_delete on public.finance_saved_views;
create policy finance_saved_views_delete on public.finance_saved_views
  for delete to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and user_id = (select auth.uid()));

revoke all on public.finance_parties from public, anon, authenticated;
revoke all on public.finance_open_items from public, anon, authenticated;
revoke all on public.finance_attachments from public, anon, authenticated;
revoke all on public.finance_categories from public, anon, authenticated;
revoke all on public.finance_rules from public, anon, authenticated;
revoke all on public.finance_period_locks from public, anon, authenticated;
revoke all on public.finance_budgets from public, anon, authenticated;
revoke all on public.finance_settings from public, anon, authenticated;
revoke all on public.finance_saved_views from public, anon, authenticated;
grant select on public.finance_parties, public.finance_open_items, public.finance_attachments, public.finance_categories,
  public.finance_rules, public.finance_period_locks, public.finance_budgets, public.finance_settings to authenticated;
grant select, insert, update, delete on public.finance_saved_views to authenticated;
grant all on public.finance_parties, public.finance_open_items, public.finance_attachments, public.finance_categories,
  public.finance_rules, public.finance_period_locks, public.finance_budgets, public.finance_settings,
  public.finance_saved_views to service_role;

-- ---------------------------------------------------------------------------
-- 8) Dönem kilidi tetiği (DONEM_KILITLI)
-- ---------------------------------------------------------------------------
create or replace function public.finance_period_is_locked(p_tenant uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_date is not null and exists (
    select 1 from public.finance_period_locks l
    where l.tenant_id = p_tenant and l.period_month = pg_catalog.date_trunc('month', p_date)::date
  );
$$;

create or replace function public.finance_period_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'cash_entries' then
    if tg_op = 'UPDATE'
       and new.amount is not distinct from old.amount and new.entry_date is not distinct from old.entry_date
       and new.direction is not distinct from old.direction and new.account_id is not distinct from old.account_id
       and new.kind is not distinct from old.kind and new.category is not distinct from old.category
       and new.voided_at is not distinct from old.voided_at and new.expense_id is not distinct from old.expense_id
       and new.vat_rate is not distinct from old.vat_rate and new.vat_amount is not distinct from old.vat_amount
       and new.withholding_amount is not distinct from old.withholding_amount then
      return new; -- parasal olmayan alan (mutabakat, cari bağı, not ...) kilitli ayda da güncellenebilir
    end if;
    if public.finance_period_is_locked(new.tenant_id, new.entry_date)
       or (tg_op = 'UPDATE' and public.finance_period_is_locked(old.tenant_id, old.entry_date)) then
      raise exception 'DONEM_KILITLI' using errcode = 'P0001', hint = 'Bu ay kilitli; önce ay kilidini açın.';
    end if;
  else
    if tg_op = 'UPDATE'
       and new.amount is not distinct from old.amount and new.issue_date is not distinct from old.issue_date
       and new.direction is not distinct from old.direction and new.cancelled_at is not distinct from old.cancelled_at
       and new.vat_amount is not distinct from old.vat_amount and new.withholding_amount is not distinct from old.withholding_amount
       and new.currency is not distinct from old.currency then
      return new; -- ödeme ilerlemesi (paid_amount/status), vade, cari, not serbest
    end if;
    if public.finance_period_is_locked(new.tenant_id, new.issue_date)
       or (tg_op = 'UPDATE' and public.finance_period_is_locked(old.tenant_id, old.issue_date)) then
      raise exception 'DONEM_KILITLI' using errcode = 'P0001', hint = 'Bu ay kilitli; önce ay kilidini açın.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cash_entries_period_lock on public.cash_entries;
create trigger trg_cash_entries_period_lock
  before insert or update on public.cash_entries
  for each row execute function public.finance_period_lock_guard();
drop trigger if exists trg_finance_open_items_period_lock on public.finance_open_items;
create trigger trg_finance_open_items_period_lock
  before insert or update on public.finance_open_items
  for each row execute function public.finance_period_lock_guard();

-- ---------------------------------------------------------------------------
-- 9) Açık kalem ödeme ilerlemesi: bağlı (iptal edilmemiş) hareketlerin tutarı + stopajı = ödenen; durum buna göre
-- ---------------------------------------------------------------------------
create or replace function public.finance_open_item_recompute(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.finance_open_items%rowtype;
  v_paid numeric;
begin
  if p_id is null then return; end if;
  select * into v_item from public.finance_open_items o where o.id = p_id for update;
  if not found then return; end if;
  select coalesce(sum(e.amount + coalesce(e.withholding_amount, 0)), 0) into v_paid
    from public.cash_entries e where e.open_item_id = p_id and e.tenant_id = v_item.tenant_id and e.voided_at is null;
  update public.finance_open_items
     set paid_amount = v_paid,
         status = case when v_item.status = 'cancelled' then 'cancelled'
                       when v_paid >= v_item.amount then 'paid'
                       when v_paid > 0 then 'partial'
                       else 'open' end
   where id = p_id
     and (paid_amount is distinct from v_paid
          or status is distinct from (case when v_item.status = 'cancelled' then 'cancelled'
                                           when v_paid >= v_item.amount then 'paid'
                                           when v_paid > 0 then 'partial' else 'open' end));
end;
$$;

create or replace function public.finance_entry_open_item_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.open_item_id is not null and old.open_item_id is distinct from new.open_item_id then
    perform public.finance_open_item_recompute(old.open_item_id);
  end if;
  if new.open_item_id is not null then
    perform public.finance_open_item_recompute(new.open_item_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_cash_entries_open_item_ins on public.cash_entries;
create trigger trg_cash_entries_open_item_ins
  after insert on public.cash_entries
  for each row when (new.open_item_id is not null)
  execute function public.finance_entry_open_item_sync();
drop trigger if exists trg_cash_entries_open_item_upd on public.cash_entries;
create trigger trg_cash_entries_open_item_upd
  after update of open_item_id, amount, withholding_amount, voided_at on public.cash_entries
  for each row when (new.open_item_id is not null or old.open_item_id is not null)
  execute function public.finance_entry_open_item_sync();

revoke all on function public.finance_period_is_locked(uuid, date) from public, anon, authenticated;
revoke all on function public.finance_period_lock_guard() from public, anon, authenticated;
revoke all on function public.finance_open_item_recompute(uuid) from public, anon, authenticated;
revoke all on function public.finance_entry_open_item_sync() from public, anon, authenticated;
grant execute on function public.finance_period_is_locked(uuid, date) to service_role;
grant execute on function public.finance_open_item_recompute(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10) Birleşik defter görünümü: hareketler + deftere bağlanmamış eski giderler ('Hesapsız'; bakiyeye girmez)
-- ---------------------------------------------------------------------------
create or replace view public.finance_ledger_v
with (security_invoker = true)
as
select e.id,
       'entry'::text as origin,
       e.tenant_id,
       e.account_id,
       e.direction,
       e.amount::numeric as amount,
       e.currency,
       e.entry_date,
       e.kind,
       e.category,
       e.title,
       e.counterparty,
       e.party_id,
       e.vat_rate::numeric as vat_rate,
       e.vat_amount::numeric as vat_amount,
       e.withholding_amount::numeric as withholding_amount,
       e.property_id,
       e.open_item_id,
       e.source_type,
       e.source_id,
       e.expense_id,
       e.reconciled_at,
       e.voided_at,
       (select pg_catalog.count(*)::integer from public.finance_attachments fa where fa.entry_id = e.id) as attachment_count,
       e.is_sample,
       e.note,
       e.created_at
from public.cash_entries e
union all
select x.id,
       'legacy_expense'::text,
       x.tenant_id,
       null::uuid,
       'out'::text,
       x.amount::numeric,
       x.currency,
       x.expense_date,
       'expense'::text,
       x.category::text,
       x.title,
       null::text,
       null::uuid,
       null::numeric,
       null::numeric,
       null::numeric,
       x.property_id,
       null::uuid,
       'legacy'::text,
       null::uuid,
       x.id,
       null::timestamptz,
       null::timestamptz,
       (case when x.receipt_url is not null then 1 else 0 end)::integer,
       x.is_sample,
       x.notes,
       x.created_at
from public.expenses x
where not exists (select 1 from public.cash_entries c where c.expense_id = x.id and c.voided_at is null);

-- ---------------------------------------------------------------------------
-- 11) Açık kalem görünümü (tahmin/yaşlandırma/yaklaşanlar okur; veri kopyalanmaz)
-- ---------------------------------------------------------------------------
create or replace view public.finance_open_items_v
with (security_invoker = true)
as
select 'manual:' || o.id::text as key,
       'manual'::text as source,
       o.id as source_id,
       o.tenant_id,
       o.direction,
       o.party_id,
       coalesce(p.name, '')::text as party_label,
       o.title,
       o.category,
       (o.amount - o.paid_amount)::numeric as amount_open,
       o.currency,
       o.due_date,
       ('/app/giderler?sekme=cari&kalem=' || o.id::text)::text as href
from public.finance_open_items o
left join public.finance_parties p on p.id = o.party_id
where o.status in ('open', 'partial') and o.amount > o.paid_amount
union all
select 'rent:' || c.id::text,
       'rent',
       c.id,
       c.tenant_id,
       'receivable',
       null::uuid,
       coalesce(cu.full_name, '')::text,
       ('Kira ' || pg_catalog.to_char(c.period, 'MM.YYYY'))::text,
       'kira_tahsilat'::text,
       (c.amount - coalesce(c.paid_amount, 0))::numeric,
       'TRY'::text,
       (c.period + (least(greatest(coalesce(r.due_day, 1), 1), 28) - 1))::date,
       ('/app/kiralama/' || r.id::text)::text
from public.rent_charges c
join public.rentals r on r.id = c.rental_id and r.tenant_id = c.tenant_id
left join public.customers cu on cu.id = r.renter_customer_id
where c.status <> 'paid' and c.amount > coalesce(c.paid_amount, 0)
union all
select 'commission:' || m.id::text,
       'commission',
       m.id,
       m.tenant_id,
       'receivable',
       null::uuid,
       coalesce(cu.full_name, '')::text,
       'Komisyon'::text,
       'komisyon'::text,
       (m.gross_amount
         - coalesce((select sum(e.amount) from public.cash_entries e
                      where e.tenant_id = m.tenant_id and e.source_type = 'commission' and e.source_id = m.id and e.voided_at is null), 0))::numeric,
       'TRY'::text,
       (m.created_at at time zone 'Europe/Istanbul')::date,
       ('/app/anlasmalar/' || m.deal_id::text)::text
from public.commissions m
left join public.deals d on d.id = m.deal_id
left join public.customers cu on cu.id = d.customer_id
where m.status = 'calculated' and m.is_sample = false
  and m.gross_amount
      > coalesce((select sum(e.amount) from public.cash_entries e
                   where e.tenant_id = m.tenant_id and e.source_type = 'commission' and e.source_id = m.id and e.voided_at is null), 0)
union all
select 'recurring:' || rr.id::text,
       'recurring',
       rr.id,
       rr.tenant_id,
       case when rr.direction = 'in' then 'receivable' else 'payable' end,
       rr.party_id,
       coalesce(p.name, '')::text,
       rr.title,
       rr.category,
       rr.amount::numeric,
       a.currency,
       rr.next_due,
       '/app/giderler?sekme=duzenli'::text
from public.recurring_rules rr
join public.finance_accounts a on a.id = rr.account_id and a.tenant_id = rr.tenant_id
left join public.finance_parties p on p.id = rr.party_id
where rr.active and rr.next_due is not null and rr.scope = 'office'
union all
select 'owner_payout:' || ag.rental_id::text,
       'owner_payout',
       ag.rental_id,
       ag.tenant_id,
       'payable',
       null::uuid,
       coalesce(pr.title, '')::text,
       'Mülk sahibi hakediş ödemesi'::text,
       'mulk_sahibi_odeme'::text,
       bal.payable::numeric,
       'TRY'::text,
       (pg_catalog.date_trunc('month', (pg_catalog.now() at time zone 'Europe/Istanbul'))::date + (ag.payout_day - 1))::date,
       ('/app/kiralama/' || ag.rental_id::text)::text
from public.rental_management_agreements ag
join public.rentals r on r.id = ag.rental_id and r.tenant_id = ag.tenant_id
left join public.properties pr on pr.id = r.property_id
cross join lateral (
  select coalesce((select sum(rp.amount - coalesce(rp.management_fee, 0)) from public.rent_payments rp
                    where rp.rental_id = ag.rental_id and rp.tenant_id = ag.tenant_id and rp.voided_at is null), 0)
       - coalesce((select sum(l.amount) from public.owner_charge_links l
                    where l.rental_id = ag.rental_id and l.tenant_id = ag.tenant_id), 0)
       - coalesce((select sum(op.amount) from public.owner_payouts op
                    where op.rental_id = ag.rental_id and op.tenant_id = ag.tenant_id and op.voided_at is null), 0) as payable
) bal
where ag.managed and bal.payable > 0;

revoke all on public.finance_ledger_v from public, anon, authenticated;
revoke all on public.finance_open_items_v from public, anon, authenticated;
grant select on public.finance_ledger_v, public.finance_open_items_v to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12) Realtime yayını (Hareketler/Cari ekranı başka oturumun yazmasıyla tazelenir)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime yayını yok; atlandı';
    return;
  end if;
  foreach t in array array['finance_open_items', 'finance_parties'] loop
    if not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute pg_catalog.format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

comment on table public.finance_parties is 'Cari (kişi/firma). Yazma yalnız finance_party_* RPC. Telefon parsePhoneStrict biçiminde saklanır; tax_id yalnız VKN.';
comment on table public.finance_open_items is 'Alacak/borç vade kalemi (KDV dahil brüt). paid_amount/status bağlı hareketlerden tetikle türer; yazma yalnız RPC.';
comment on table public.finance_attachments is 'Hareket/kalem eki; ikisi de boşsa fiş kutusu. Dosya expense-receipts kovasında {tenant_id}/ledger/... yolunda.';
comment on table public.finance_period_locks is 'Kapanmış ay: bu aya düşen hareket/kalem ekleme, parasal değişiklik ve iptal DONEM_KILITLI ile reddedilir.';
comment on view public.finance_ledger_v is 'Birleşik defter: cash_entries + deftere bağlanmamış eski giderler (origin=legacy_expense, account_id null; bakiyeye girmez).';
comment on view public.finance_open_items_v is 'Açık alacak/borç birleşimi: manual, rent, commission, recurring, owner_payout. Her satır href taşır.';

notify pgrst, 'reload schema';
