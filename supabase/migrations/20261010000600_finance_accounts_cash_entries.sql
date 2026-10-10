-- Finans (Paket A): hesap (kasa/banka/kart) + para hareket defteri.
--
-- NEDEN: Ofis yalnız gider kaydı tutuyordu; paranın hangi kasadan/bankadan girip çıktığı, hesap bakiyesi ve danışmanın kendi
--   kasası yoktu. Tasarım: docs/design/FINANS_KASA_EFATURA_TASARIM_2026-10.md (b).
-- İÇERİK:
--   1) finance_accounts: owner_scope 'office' (ofis kasası/bankası, `expenses` yetkisine bağlı) | 'user' (danışmanın KİŞİSEL hesabı:
--      yalnız sahibi görür/yazar; ofis sahibi dahil kimse göremez, ofis kâr-zararına girmez). Açılış bakiyesi + tarihi; arşivleme.
--   2) cash_entries: gelir/gider/transfer bacağı/düzeltme. Bakiye SAKLANMAZ: açılış + Σ(giriş - çıkış) (finance_account_balances).
--      source_type/source_id ile komisyon/kira/aidat tahsilatına bağ; aynı kaynak aynı hesaba iki kez hareket üretmez (kısmi benzersiz indeks).
--      expense_id: ofis giderine bağ (expenses gider gerçeğinin tek kaynağı olarak KALIR; çift sayım yok).
--   3) Yazma YALNIZ RPC (SECURITY DEFINER, search_path=''): finance_account_create/update/set_archived, finance_record_entry,
--      finance_update_entry, finance_void_entry, finance_void_source_entries, finance_transfer (iki bacak tek transaction).
--      Tablolara doğrudan INSERT/UPDATE/DELETE yetkisi YOK.
--   4) Maaş kategorisi (category='maas') hareketleri ofis hesaplarında YALNIZ owner/gm tarafından okunur/yazılır (RLS + RPC).
--   5) finance_account_balances(): görünür hesapların bakiyesi (maaş satırları dahil doğru bakiye); finance_cash_summary(): RLS'li özet.
-- Yeni izin modülü YOK: ofis hesapları `expenses` yetkisine, kişisel hesaplar oturum sahibine bağlıdır.
-- Bağımlılıklar: 20261008001100 (rent_payments), 20261008001700 (building_payments), commissions, expenses, audit_logs.
-- GERİ ALMA: rollbacks/20261010000600_finance_accounts_cash_entries.rollback.sql (hareket defteri KAYBOLUR; expenses etkilenmez).
-- RİSK: düşük (yalnız yeni tablolar/fonksiyonlar; mevcut davranış ve veri değişmez). Kod tablolar yokken eski Giderler akışına düşer.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.tenants') is null
     or pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.expenses') is null
     or pg_catalog.to_regclass('public.commissions') is null
     or pg_catalog.to_regclass('public.rent_payments') is null
     or pg_catalog.to_regclass('public.building_payments') is null
     or pg_catalog.to_regclass('public.audit_logs') is null
     or pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.current_profile_role()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null then
    raise exception '20261010000600: 20261008001100 / 20261008001700 (kira ve bina tahsilat tablolari) veya yetki yardimcilari yok.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Hesaplar
-- ---------------------------------------------------------------------------
create table if not exists public.finance_accounts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  owner_scope     text not null default 'office' check (owner_scope in ('office', 'user')),
  owner_user_id   uuid references public.profiles(id) on delete cascade,
  kind            text not null check (kind in ('cash', 'bank', 'card')),
  name            text not null check (char_length(name) between 1 and 80),
  iban_last4      text check (iban_last4 is null or iban_last4 ~ '^[0-9]{4}$'),
  currency        text not null default 'TRY' check (currency in ('TRY', 'USD', 'EUR')),
  opening_balance numeric(14,2) not null default 0 check (abs(opening_balance) <= 9999999999.99),
  opening_date    date not null check (opening_date between date '2000-01-01' and date '2100-12-31'),
  archived_at     timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint finance_accounts_scope_owner check (
    (owner_scope = 'office' and owner_user_id is null) or (owner_scope = 'user' and owner_user_id is not null)
  )
);

create unique index if not exists idx_finance_accounts_id_tenant_unique on public.finance_accounts (id, tenant_id);
create unique index if not exists idx_finance_accounts_name_unique
  on public.finance_accounts (tenant_id, coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where archived_at is null;
create index if not exists idx_finance_accounts_tenant on public.finance_accounts (tenant_id, owner_scope, created_at);
create index if not exists idx_finance_accounts_owner on public.finance_accounts (owner_user_id) where owner_user_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Para hareketleri
-- ---------------------------------------------------------------------------
create table if not exists public.cash_entries (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  account_id        uuid not null,
  direction         text not null check (direction in ('in', 'out')),
  amount            numeric(14,2) not null check (amount > 0 and amount <= 9999999999.99),
  currency          text not null check (currency in ('TRY', 'USD', 'EUR')),
  entry_date        date not null check (entry_date between date '2000-01-01' and date '2100-12-31'),
  kind              text not null check (kind in ('income', 'expense', 'transfer', 'adjust')),
  category          text check (category is null or char_length(category) between 1 and 40),
  title             text not null check (char_length(title) between 1 and 160),
  counterparty      text check (counterparty is null or char_length(counterparty) <= 120),
  document_url      text check (document_url is null or (char_length(document_url) <= 500 and document_url ~ '^https://')),
  note              text check (note is null or char_length(note) <= 1000),
  transfer_group_id uuid,
  expense_id        uuid references public.expenses(id) on delete set null,
  created_expense   boolean not null default false,
  source_type       text not null default 'manual' check (source_type in ('manual', 'commission', 'rent', 'due', 'building', 'recurring', 'import')),
  source_id         uuid,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  voided_at         timestamptz,
  voided_by         uuid references public.profiles(id) on delete set null,
  void_reason       text check (void_reason is null or char_length(void_reason) <= 300),
  constraint cash_entries_account_fk foreign key (account_id, tenant_id)
    references public.finance_accounts (id, tenant_id) on delete cascade,
  constraint cash_entries_kind_direction check (
    (kind = 'income' and direction = 'in') or (kind = 'expense' and direction = 'out') or kind in ('transfer', 'adjust')
  ),
  constraint cash_entries_transfer_group check (kind <> 'transfer' or transfer_group_id is not null)
);

create index if not exists idx_cash_entries_account_date on public.cash_entries (tenant_id, account_id, entry_date desc, created_at desc) where voided_at is null;
create index if not exists idx_cash_entries_tenant_date on public.cash_entries (tenant_id, entry_date desc) where voided_at is null;
create index if not exists idx_cash_entries_transfer_group on public.cash_entries (transfer_group_id) where transfer_group_id is not null;
-- Aynı kaynak (komisyon/kira/aidat tahsilatı) aynı hesaba iki kez hareket üretmez; iptal edilen yeniden yazılabilir.
create unique index if not exists idx_cash_entries_source_unique
  on public.cash_entries (tenant_id, source_type, source_id, account_id)
  where source_id is not null and voided_at is null;
-- Bir gider kaydı en çok bir etkin hareketle ilişkilenir.
create unique index if not exists idx_cash_entries_expense_unique
  on public.cash_entries (expense_id) where expense_id is not null and voided_at is null;

-- ---------------------------------------------------------------------------
-- Yardımcılar
-- ---------------------------------------------------------------------------
create or replace function public.finance_is_owner_gm()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_profile_role() in ('owner', 'gm'), false);
$$;

-- p_level: view | create | edit | delete. Ofis hesabı = expenses yetkisi; kişisel hesap = yalnız sahibi (readonly hariç yazma).
create or replace function public.finance_account_access(p_account_id uuid, p_level text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (a.owner_scope = 'user' and a.owner_user_id = auth.uid() and (p_level = 'view' or public.current_profile_role() <> 'readonly'))
        or (a.owner_scope = 'office' and public.has_effective_permission('expenses', p_level))
    from public.finance_accounts a
    where a.id = p_account_id and a.tenant_id = public.current_active_tenant_id()
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- RLS (okuma); yazma yalnız RPC
-- ---------------------------------------------------------------------------
alter table public.finance_accounts enable row level security;
alter table public.cash_entries enable row level security;

drop policy if exists finance_accounts_select on public.finance_accounts;
create policy finance_accounts_select on public.finance_accounts
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (
      (owner_scope = 'user' and owner_user_id = (select auth.uid()))
      or (owner_scope = 'office' and (select public.has_effective_permission('expenses', 'view')))
    )
  );

drop policy if exists cash_entries_select on public.cash_entries;
create policy cash_entries_select on public.cash_entries
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and exists (
      select 1 from public.finance_accounts a
      where a.id = cash_entries.account_id and a.tenant_id = cash_entries.tenant_id
        and (a.owner_scope = 'user' or cash_entries.category is distinct from 'maas' or (select public.finance_is_owner_gm()))
    )
  );

revoke all on public.finance_accounts from public, anon, authenticated;
revoke all on public.cash_entries from public, anon, authenticated;
grant select on public.finance_accounts to authenticated;
grant select on public.cash_entries to authenticated;
grant all on public.finance_accounts to service_role;
grant all on public.cash_entries to service_role;

-- ---------------------------------------------------------------------------
-- RPC: hesap aç
-- ---------------------------------------------------------------------------
create or replace function public.finance_account_create(
  p_scope text, p_kind text, p_name text, p_iban_last4 text default null, p_currency text default 'TRY',
  p_opening_balance numeric default 0, p_opening_date date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_date date := coalesce(p_opening_date, v_today);
  v_bal numeric := coalesce(p_opening_balance, 0);
  v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if public.current_profile_role() = 'readonly' then return jsonb_build_object('outcome', 'forbidden'); end if;
  if p_scope not in ('office', 'user') then return jsonb_build_object('outcome', 'invalid_input'); end if;
  if p_scope = 'office' and not public.has_effective_permission('expenses', 'create') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_kind not in ('cash', 'bank', 'card')
     or char_length(v_name) not between 1 and 80
     or p_currency not in ('TRY', 'USD', 'EUR')
     or (p_iban_last4 is not null and p_iban_last4 !~ '^[0-9]{4}$')
     or abs(v_bal) > 9999999999.99 or pg_catalog.round(v_bal, 2) <> v_bal
     or v_date < date '2000-01-01' or v_date > v_today then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if (select pg_catalog.count(*) from public.finance_accounts a
       where a.tenant_id = v_tenant and a.archived_at is null
         and ((p_scope = 'office' and a.owner_scope = 'office') or (p_scope = 'user' and a.owner_user_id = v_uid))) >= 50 then
    return jsonb_build_object('outcome', 'limit_reached');
  end if;

  begin
    insert into public.finance_accounts (tenant_id, owner_scope, owner_user_id, kind, name, iban_last4, currency, opening_balance, opening_date, created_by)
    values (v_tenant, p_scope, case when p_scope = 'user' then v_uid end, p_kind, v_name, p_iban_last4, p_currency, v_bal, v_date, v_uid)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('outcome', 'duplicate_name');
  end;

  if p_scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (v_tenant, v_uid, 'finance_account.create', 'finance_account', v_id,
      jsonb_build_object('kind', p_kind, 'name', v_name, 'currency', p_currency, 'opening_balance', v_bal));
  end if;
  return jsonb_build_object('outcome', 'created', 'account_id', v_id);
end;
$$;

-- RPC: hesap düzenle (ad, IBAN son 4, açılış bakiyesi/tarihi)
create or replace function public.finance_account_update(
  p_account_id uuid, p_name text, p_iban_last4 text, p_opening_balance numeric, p_opening_date date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_acc public.finance_accounts%rowtype;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if not public.finance_account_access(p_account_id, 'edit') then return jsonb_build_object('outcome', 'forbidden'); end if;
  if char_length(v_name) not between 1 and 80
     or (p_iban_last4 is not null and p_iban_last4 !~ '^[0-9]{4}$')
     or p_opening_balance is null or abs(p_opening_balance) > 9999999999.99 or pg_catalog.round(p_opening_balance, 2) <> p_opening_balance
     or p_opening_date is null or p_opening_date < date '2000-01-01' or p_opening_date > v_today then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  select * into v_acc from public.finance_accounts a where a.id = p_account_id and a.tenant_id = v_tenant for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if exists (select 1 from public.cash_entries e where e.account_id = p_account_id and e.tenant_id = v_tenant and e.voided_at is null and e.entry_date < p_opening_date) then
    return jsonb_build_object('outcome', 'entries_before_opening');
  end if;
  begin
    update public.finance_accounts set name = v_name, iban_last4 = p_iban_last4, opening_balance = p_opening_balance,
      opening_date = p_opening_date, updated_at = pg_catalog.now()
    where id = p_account_id and tenant_id = v_tenant;
  exception when unique_violation then
    return jsonb_build_object('outcome', 'duplicate_name');
  end;
  if v_acc.owner_scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (v_tenant, v_uid, 'finance_account.update', 'finance_account', p_account_id,
      jsonb_build_object('name', v_acc.name, 'opening_balance', v_acc.opening_balance, 'opening_date', v_acc.opening_date),
      jsonb_build_object('name', v_name, 'opening_balance', p_opening_balance, 'opening_date', p_opening_date));
  end if;
  return jsonb_build_object('outcome', 'updated');
end;
$$;

-- RPC: arşivle / geri al
create or replace function public.finance_account_set_archived(p_account_id uuid, p_archived boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_scope text;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if p_account_id is null or p_archived is null then return jsonb_build_object('outcome', 'invalid_input'); end if;
  if not public.finance_account_access(p_account_id, 'edit') then return jsonb_build_object('outcome', 'forbidden'); end if;
  begin
    update public.finance_accounts set archived_at = case when p_archived then pg_catalog.now() end, updated_at = pg_catalog.now()
    where id = p_account_id and tenant_id = v_tenant returning owner_scope into v_scope;
  exception when unique_violation then
    return jsonb_build_object('outcome', 'duplicate_name');
  end;
  if v_scope is null then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (v_tenant, v_uid, case when p_archived then 'finance_account.archive' else 'finance_account.unarchive' end, 'finance_account', p_account_id, '{}'::jsonb);
  end if;
  return jsonb_build_object('outcome', case when p_archived then 'archived' else 'unarchived' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: hareket yaz (gelir/gider; kaynak bağlı tahsilat dahil)
-- ---------------------------------------------------------------------------
create or replace function public.finance_record_entry(
  p_account_id uuid, p_direction text, p_amount numeric, p_entry_date date, p_category text, p_title text,
  p_counterparty text default null, p_document_url text default null, p_note text default null,
  p_source_type text default 'manual', p_source_id uuid default null,
  p_create_expense boolean default false, p_expense_category text default null, p_expense_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_cat text := nullif(pg_catalog.btrim(coalesce(p_category, '')), '');
  v_acc public.finance_accounts%rowtype;
  v_exp uuid;
  v_created boolean := false;
  v_id uuid;
  v_dup uuid;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if public.current_profile_role() = 'readonly' then return jsonb_build_object('outcome', 'forbidden'); end if;

  if p_account_id is null or p_direction not in ('in', 'out')
     or p_amount is null or p_amount < 0.01 or p_amount > 9999999999.99 or pg_catalog.round(p_amount, 2) <> p_amount
     or p_entry_date is null or p_entry_date > v_today or p_entry_date < date '2000-01-01'
     or char_length(v_title) not between 1 and 160
     or (v_cat is not null and char_length(v_cat) > 40)
     or char_length(coalesce(p_counterparty, '')) > 120
     or char_length(coalesce(p_note, '')) > 1000
     or (p_document_url is not null and (char_length(p_document_url) > 500 or p_document_url !~ '^https://'))
     or p_source_type not in ('manual', 'commission', 'rent', 'building')
     or (p_source_type <> 'manual' and p_source_id is null)
     or (p_source_type = 'manual' and p_source_id is not null) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select * into v_acc from public.finance_accounts a where a.id = p_account_id and a.tenant_id = v_tenant for share;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_acc.archived_at is not null then return jsonb_build_object('outcome', 'archived'); end if;
  if p_entry_date < v_acc.opening_date then return jsonb_build_object('outcome', 'before_opening', 'opening_date', v_acc.opening_date); end if;

  if p_source_type = 'manual' then
    if not public.finance_account_access(p_account_id, 'create') then return jsonb_build_object('outcome', 'forbidden'); end if;
  else
    -- Tahsilat bağlı hareket yalnız ofis hesabına GİRİŞ olur; yetki tahsilatı yapan modülün düzenleme yetkisidir.
    if v_acc.owner_scope <> 'office' or p_direction <> 'in' then return jsonb_build_object('outcome', 'invalid_input'); end if;
    if not (case p_source_type
              when 'commission' then public.has_effective_permission('commissions', 'edit')
              when 'rent' then public.has_effective_permission('rentals', 'edit')
              else public.has_effective_permission('expenses', 'edit') end) then
      return jsonb_build_object('outcome', 'forbidden');
    end if;
    if not (case p_source_type
              when 'commission' then exists (select 1 from public.commissions c where c.id = p_source_id and c.tenant_id = v_tenant)
              when 'rent' then exists (select 1 from public.rent_payments r where r.id = p_source_id and r.tenant_id = v_tenant and r.voided_at is null)
              else exists (select 1 from public.building_payments b where b.id = p_source_id and b.tenant_id = v_tenant and b.voided_at is null) end) then
      return jsonb_build_object('outcome', 'source_not_found');
    end if;
    select e.id into v_dup from public.cash_entries e
     where e.tenant_id = v_tenant and e.source_type = p_source_type and e.source_id = p_source_id and e.account_id = p_account_id and e.voided_at is null;
    if v_dup is not null then return jsonb_build_object('outcome', 'duplicate', 'entry_id', v_dup); end if;
  end if;

  if v_cat = 'maas' and v_acc.owner_scope = 'office' and not public.finance_is_owner_gm() then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  -- Var olan bir gider kaydına bağlama (Giderler'deki ayrıntılı gider formu): aynı ofisin, henüz hareketi olmayan gideri.
  if p_expense_id is not null then
    if p_direction <> 'out' or p_source_type <> 'manual' or v_acc.owner_scope <> 'office'
       or not exists (select 1 from public.expenses x where x.id = p_expense_id and x.tenant_id = v_tenant) then
      return jsonb_build_object('outcome', 'invalid_input');
    end if;
    if exists (select 1 from public.cash_entries e where e.expense_id = p_expense_id and e.voided_at is null) then
      return jsonb_build_object('outcome', 'duplicate');
    end if;
    v_exp := p_expense_id;
  end if;

  -- Ofis gideri: TL ofis hesabından çıkan, maaş olmayan elle gider isteğe bağlı expenses kaydı üretir (aynı transaction).
  if v_exp is null and p_create_expense and p_direction = 'out' and p_source_type = 'manual' and v_acc.owner_scope = 'office'
     and v_acc.currency = 'TRY' and v_cat is distinct from 'maas' then
    insert into public.expenses (tenant_id, created_by, category, title, amount, currency, expense_date, notes, receipt_url)
    values (v_tenant, v_uid, coalesce(nullif(pg_catalog.btrim(coalesce(p_expense_category, '')), ''), 'diger'), v_title, p_amount, 'TRY',
            p_entry_date, nullif(pg_catalog.btrim(coalesce(p_note, '')), ''), p_document_url)
    returning id into v_exp;
    v_created := true;
  end if;

  begin
    insert into public.cash_entries (tenant_id, account_id, direction, amount, currency, entry_date, kind, category, title, counterparty,
      document_url, note, expense_id, created_expense, source_type, source_id, created_by)
    values (v_tenant, p_account_id, p_direction, p_amount, v_acc.currency, p_entry_date,
      case when p_direction = 'in' then 'income' else 'expense' end, v_cat, v_title,
      nullif(pg_catalog.btrim(coalesce(p_counterparty, '')), ''), p_document_url, nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
      v_exp, v_created, p_source_type, p_source_id, v_uid)
    returning id into v_id;
  exception when unique_violation then
    if p_expense_id is not null then return jsonb_build_object('outcome', 'duplicate'); end if;
    select e.id into v_dup from public.cash_entries e
     where e.tenant_id = v_tenant and e.source_type = p_source_type and e.source_id = p_source_id and e.account_id = p_account_id and e.voided_at is null;
    if v_dup is not null then return jsonb_build_object('outcome', 'duplicate', 'entry_id', v_dup); end if;
    raise;
  end;

  if v_acc.owner_scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (v_tenant, v_uid, 'cash_entry.record', 'cash_entry', v_id,
      jsonb_build_object('account_id', p_account_id, 'direction', p_direction, 'amount', p_amount, 'source_type', p_source_type, 'expense_id', v_exp));
  end if;
  return jsonb_build_object('outcome', 'recorded', 'entry_id', v_id, 'expense_id', v_exp);
end;
$$;

-- RPC: hareket düzenle (yalnız elle girilen gelir/gider; kaynak bağlı ve transfer kilitli)
create or replace function public.finance_update_entry(
  p_entry_id uuid, p_amount numeric, p_entry_date date, p_category text, p_title text,
  p_counterparty text default null, p_document_url text default null, p_note text default null, p_expense_category text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_cat text := nullif(pg_catalog.btrim(coalesce(p_category, '')), '');
  v_e public.cash_entries%rowtype;
  v_acc public.finance_accounts%rowtype;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if p_entry_id is null
     or p_amount is null or p_amount < 0.01 or p_amount > 9999999999.99 or pg_catalog.round(p_amount, 2) <> p_amount
     or p_entry_date is null or p_entry_date > v_today or p_entry_date < date '2000-01-01'
     or char_length(v_title) not between 1 and 160 or (v_cat is not null and char_length(v_cat) > 40)
     or char_length(coalesce(p_counterparty, '')) > 120 or char_length(coalesce(p_note, '')) > 1000
     or (p_document_url is not null and (char_length(p_document_url) > 500 or p_document_url !~ '^https://')) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  select * into v_e from public.cash_entries e where e.id = p_entry_id and e.tenant_id = v_tenant for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_e.voided_at is not null then return jsonb_build_object('outcome', 'already_voided'); end if;
  if not public.finance_account_access(v_e.account_id, 'edit') then return jsonb_build_object('outcome', 'forbidden'); end if;
  if v_e.source_type <> 'manual' or v_e.kind not in ('income', 'expense') then return jsonb_build_object('outcome', 'locked'); end if;
  select * into v_acc from public.finance_accounts a where a.id = v_e.account_id and a.tenant_id = v_tenant;
  if p_entry_date < v_acc.opening_date then return jsonb_build_object('outcome', 'before_opening', 'opening_date', v_acc.opening_date); end if;
  if v_acc.owner_scope = 'office' and (v_cat = 'maas' or v_e.category = 'maas') and not public.finance_is_owner_gm() then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  update public.cash_entries set amount = p_amount, entry_date = p_entry_date, category = v_cat, title = v_title,
    counterparty = nullif(pg_catalog.btrim(coalesce(p_counterparty, '')), ''), document_url = p_document_url,
    note = nullif(pg_catalog.btrim(coalesce(p_note, '')), '')
  where id = p_entry_id and tenant_id = v_tenant;

  if v_e.expense_id is not null and v_e.created_expense then
    update public.expenses set title = v_title, amount = p_amount, expense_date = p_entry_date,
      notes = nullif(pg_catalog.btrim(coalesce(p_note, '')), ''), receipt_url = p_document_url,
      category = coalesce(nullif(pg_catalog.btrim(coalesce(p_expense_category, '')), ''), category)
    where id = v_e.expense_id and tenant_id = v_tenant;
  end if;
  if v_acc.owner_scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (v_tenant, v_uid, 'cash_entry.update', 'cash_entry', p_entry_id,
      jsonb_build_object('amount', v_e.amount, 'entry_date', v_e.entry_date), jsonb_build_object('amount', p_amount, 'entry_date', p_entry_date));
  end if;
  return jsonb_build_object('outcome', 'updated');
end;
$$;

-- RPC: hareket iptal (silinmez; transfer iki bacağı birlikte; RPC'nin ürettiği gider kaydı da kalkar)
create or replace function public.finance_void_entry(p_entry_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_e public.cash_entries%rowtype;
  v_acc public.finance_accounts%rowtype;
  r public.cash_entries%rowtype;
  v_count integer := 0;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if p_entry_id is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then return jsonb_build_object('outcome', 'invalid_input'); end if;
  select * into v_e from public.cash_entries e where e.id = p_entry_id and e.tenant_id = v_tenant for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_e.voided_at is not null then return jsonb_build_object('outcome', 'already_voided'); end if;
  select * into v_acc from public.finance_accounts a where a.id = v_e.account_id and a.tenant_id = v_tenant;
  if not public.finance_account_access(v_e.account_id, 'delete') then return jsonb_build_object('outcome', 'forbidden'); end if;
  if v_acc.owner_scope = 'office' and v_e.category = 'maas' and not public.finance_is_owner_gm() then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  for r in
    select * from public.cash_entries e
    where e.tenant_id = v_tenant and e.voided_at is null
      and (e.id = p_entry_id or (v_e.transfer_group_id is not null and e.transfer_group_id = v_e.transfer_group_id))
    for update
  loop
    -- Transferin diğer bacağı başka (yazma yetkisi olmayan) hesapta olabilir: iptal için iki hesapta da yetki gerekir.
    if r.id <> p_entry_id and not public.finance_account_access(r.account_id, 'delete') then
      raise exception 'finance_forbidden_leg' using errcode = 'P0001';
    end if;
    update public.cash_entries set voided_at = pg_catalog.now(), voided_by = v_uid, void_reason = v_reason where id = r.id;
    if r.expense_id is not null and r.created_expense then
      delete from public.expenses where id = r.expense_id and tenant_id = v_tenant;
    end if;
    v_count := v_count + 1;
  end loop;

  if v_acc.owner_scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (v_tenant, v_uid, 'cash_entry.void', 'cash_entry', p_entry_id,
      jsonb_build_object('amount', v_e.amount, 'account_id', v_e.account_id), jsonb_build_object('reason', v_reason, 'legs', v_count));
  end if;
  return jsonb_build_object('outcome', 'voided', 'count', v_count);
exception when others then
  if sqlerrm = 'finance_forbidden_leg' then return jsonb_build_object('outcome', 'forbidden'); end if;
  raise;
end;
$$;

-- RPC: tahsilat geri alınınca bağlı ofis hareketini iptal et (komisyon/kira/aidat ekranları çağırır; yetki kaynak modülündendir)
create or replace function public.finance_void_source_entries(p_source_type text, p_source_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_n integer;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if p_source_type not in ('commission', 'rent', 'building') or p_source_id is null then return jsonb_build_object('outcome', 'invalid_input'); end if;
  if not (case p_source_type
            when 'commission' then public.has_effective_permission('commissions', 'edit')
            when 'rent' then public.has_effective_permission('rentals', 'delete')
            else public.has_effective_permission('expenses', 'edit') end) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  update public.cash_entries e set voided_at = pg_catalog.now(), voided_by = v_uid,
    void_reason = pg_catalog.left(coalesce(nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''), 'Tahsilat geri alındı'), 300)
  from public.finance_accounts a
  where e.tenant_id = v_tenant and e.source_type = p_source_type and e.source_id = p_source_id and e.voided_at is null
    and a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office';
  get diagnostics v_n = row_count;
  return jsonb_build_object('outcome', 'voided', 'count', v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: transfer (iki bacak, tek transaction)
-- ---------------------------------------------------------------------------
create or replace function public.finance_transfer(
  p_from_account uuid, p_to_account uuid, p_amount numeric, p_entry_date date, p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_from public.finance_accounts%rowtype;
  v_to public.finance_accounts%rowtype;
  v_group uuid := gen_random_uuid();
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if public.current_profile_role() = 'readonly' then return jsonb_build_object('outcome', 'forbidden'); end if;
  if p_from_account is null or p_to_account is null or p_from_account = p_to_account
     or p_amount is null or p_amount < 0.01 or p_amount > 9999999999.99 or pg_catalog.round(p_amount, 2) <> p_amount
     or p_entry_date is null or p_entry_date > v_today or p_entry_date < date '2000-01-01'
     or char_length(coalesce(p_note, '')) > 1000 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if not public.finance_account_access(p_from_account, 'create') or not public.finance_account_access(p_to_account, 'create') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  select * into v_from from public.finance_accounts a where a.id = p_from_account and a.tenant_id = v_tenant for share;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  select * into v_to from public.finance_accounts a where a.id = p_to_account and a.tenant_id = v_tenant for share;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_from.archived_at is not null or v_to.archived_at is not null then return jsonb_build_object('outcome', 'archived'); end if;
  if v_from.currency <> v_to.currency then return jsonb_build_object('outcome', 'currency_mismatch'); end if;
  if p_entry_date < v_from.opening_date or p_entry_date < v_to.opening_date then
    return jsonb_build_object('outcome', 'before_opening');
  end if;

  insert into public.cash_entries (tenant_id, account_id, direction, amount, currency, entry_date, kind, category, title, note, transfer_group_id, created_by)
  values
    (v_tenant, p_from_account, 'out', p_amount, v_from.currency, p_entry_date, 'transfer', 'transfer', pg_catalog.left('Transfer: ' || v_to.name, 160),
     nullif(pg_catalog.btrim(coalesce(p_note, '')), ''), v_group, v_uid),
    (v_tenant, p_to_account, 'in', p_amount, v_to.currency, p_entry_date, 'transfer', 'transfer', pg_catalog.left('Transfer: ' || v_from.name, 160),
     nullif(pg_catalog.btrim(coalesce(p_note, '')), ''), v_group, v_uid);

  if v_from.owner_scope = 'office' or v_to.owner_scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (v_tenant, v_uid, 'cash_entry.transfer', 'cash_transfer', v_group,
      jsonb_build_object('from', p_from_account, 'to', p_to_account, 'amount', p_amount));
  end if;
  return jsonb_build_object('outcome', 'transferred', 'transfer_group_id', v_group);
end;
$$;

-- ---------------------------------------------------------------------------
-- Okuma: bakiye (DEFINER: maaş satırları gizli olsa da bakiye doğru; yalnız görünür hesaplar) ve özet (INVOKER: RLS'li)
-- ---------------------------------------------------------------------------
create or replace function public.finance_account_balances()
returns table (account_id uuid, balance numeric, total_in numeric, total_out numeric, entry_count bigint, last_entry_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
         a.opening_balance + coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0),
         coalesce(sum(case when e.direction = 'in' then e.amount end), 0),
         coalesce(sum(case when e.direction = 'out' then e.amount end), 0),
         count(e.id),
         max(e.entry_date)
  from public.finance_accounts a
  left join public.cash_entries e on e.account_id = a.id and e.tenant_id = a.tenant_id and e.voided_at is null
  where a.tenant_id = public.current_active_tenant_id()
    and ((a.owner_scope = 'user' and a.owner_user_id = auth.uid())
         or (a.owner_scope = 'office' and public.has_effective_permission('expenses', 'view')))
  group by a.id, a.opening_balance;
$$;

-- Gelir/gider özeti (transfer ve düzeltme hariç, iptaller hariç); RLS'li olduğundan gizli maaş satırları toplama girmez.
create or replace function public.finance_cash_summary(p_from date default null, p_to date default null)
returns table (account_id uuid, direction text, category text, total numeric, entry_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.account_id, e.direction, e.category, sum(e.amount), count(*)
  from public.cash_entries e
  where e.kind in ('income', 'expense') and e.voided_at is null
    and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
  group by e.account_id, e.direction, e.category;
$$;

revoke all on function public.finance_is_owner_gm() from public, anon;
revoke all on function public.finance_account_access(uuid, text) from public, anon;
revoke all on function public.finance_account_create(text, text, text, text, text, numeric, date) from public, anon;
revoke all on function public.finance_account_update(uuid, text, text, numeric, date) from public, anon;
revoke all on function public.finance_account_set_archived(uuid, boolean) from public, anon;
revoke all on function public.finance_record_entry(uuid, text, numeric, date, text, text, text, text, text, text, uuid, boolean, text, uuid) from public, anon;
revoke all on function public.finance_update_entry(uuid, numeric, date, text, text, text, text, text, text) from public, anon;
revoke all on function public.finance_void_entry(uuid, text) from public, anon;
revoke all on function public.finance_void_source_entries(text, uuid, text) from public, anon;
revoke all on function public.finance_transfer(uuid, uuid, numeric, date, text) from public, anon;
revoke all on function public.finance_account_balances() from public, anon;
revoke all on function public.finance_cash_summary(date, date) from public, anon;
grant execute on function public.finance_is_owner_gm() to authenticated, service_role;
grant execute on function public.finance_account_access(uuid, text) to authenticated, service_role;
grant execute on function public.finance_account_create(text, text, text, text, text, numeric, date) to authenticated, service_role;
grant execute on function public.finance_account_update(uuid, text, text, numeric, date) to authenticated, service_role;
grant execute on function public.finance_account_set_archived(uuid, boolean) to authenticated, service_role;
grant execute on function public.finance_record_entry(uuid, text, numeric, date, text, text, text, text, text, text, uuid, boolean, text, uuid) to authenticated, service_role;
grant execute on function public.finance_update_entry(uuid, numeric, date, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.finance_void_entry(uuid, text) to authenticated, service_role;
grant execute on function public.finance_void_source_entries(text, uuid, text) to authenticated, service_role;
grant execute on function public.finance_transfer(uuid, uuid, numeric, date, text) to authenticated, service_role;
grant execute on function public.finance_account_balances() to authenticated, service_role;
grant execute on function public.finance_cash_summary(date, date) to authenticated, service_role;

comment on table public.finance_accounts is 'Kasa/banka/kart hesabı. owner_scope=user kişisel hesaptır: yalnız sahibi görür (ofis sahibi dahil kimse); ofis hesapları expenses yetkisine bağlıdır. Bakiye saklanmaz.';
comment on table public.cash_entries is 'Para hareket defteri. Yazma yalnız finance_* RPC; kaynak bağı (source_type/source_id) çift sayımı engeller; maaş kategorisi ofis hesaplarında yalnız owner/gm okur.';

notify pgrst, 'reload schema';
