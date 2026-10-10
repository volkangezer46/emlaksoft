-- Finans (Paket B): düzenli ödemeler / gelirler (aylık otomasyon).
--
-- NEDEN: Ofis veya danışman periyodik ödemeler (kira, portal üyeliği, muhasebe, maaş) yapıyor; her ay elle gider girmek
--   unutulur. `expenses.recurrence` yalnız HATIRLATMA üretiyordu (kayıt açmıyor). Tasarım:
--   docs/design/FINANS_KASA_EFATURA_TASARIM_2026-10.md Paket B.
-- İÇERİK:
--   1) recurring_rules: scope office | user (+ owner_user_id), gelir|gider, kategori, tutar, hesap (finance_accounts), sıklık
--      (aylık | 3 aylık | yıllık), ödeme günü (1..31; kısa ayda ayın SON günü), kip auto (otomatik kayıt) | approve (taslak + bildirim).
--      Dönemler `anchor` ayına hizalıdır; next_period/next_due bir sonraki üretimi gösterir.
--   2) recurring_occurrences: unique(rule_id, period) -> her dönem EN FAZLA bir kez üretilir (idempotent). approve kipinde 'pending' taslak.
--   3) Üretim = cash_entries (source_type='recurring', source_id=occurrence) + ofis gideri ise expenses satırı (maaş ve kişisel hesap HARİÇ,
--      Paket A kuralı). Hareket iptali gider kaydını da kaldırır (Paket A davranışı).
--   4) "Kurala çevir": mevcut expenses.recurrence serisini kurala çevirir ve seriyi hatırlatma dışına alır (recurrence = null) -> çift kayıt yok.
--   5) Yazma YALNIZ RPC (SECURITY DEFINER, search_path=''); tablolara doğrudan yazma yetkisi YOK.
--      recurring_run_due(): yalnız service_role (kira-tahakkuk cron adımı); vadesi gelenleri üretir, vade -3 gün hatırlatır. Geçmişe dönük kayıt YOK.
--   6) Gizlilik: kişisel kural yalnız sahibine; maaş kuralı yalnız owner/gm (RLS + RPC); maaş bildirimi yalnız owner/gm.
-- Yeni izin modülü YOK: ofis kuralları `expenses` yetkisine, kişisel kurallar oturum sahibine bağlıdır.
-- Bağımlılıklar: 20261010000600 (finance_accounts, cash_entries, finance_is_owner_gm, finance_account_access), expenses, notifications, audit_logs.
-- GERİ ALMA: rollbacks/20261010000900_recurring_rules.rollback.sql (kurallar ve taslaklar KAYBOLUR; üretilmiş hareket ve giderler yerinde kalır).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.finance_accounts') is null
     or pg_catalog.to_regclass('public.cash_entries') is null
     or pg_catalog.to_regclass('public.expenses') is null
     or pg_catalog.to_regclass('public.notifications') is null
     or pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.audit_logs') is null
     or pg_catalog.to_regprocedure('public.finance_is_owner_gm()') is null
     or pg_catalog.to_regprocedure('public.finance_account_access(uuid,text)') is null then
    raise exception '20261010000900: 20261010000600 (finance_accounts / cash_entries) veya bildirim/gider tablolari yok.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Kurallar
-- ---------------------------------------------------------------------------
create table if not exists public.recurring_rules (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  scope             text not null check (scope in ('office', 'user')),
  owner_user_id     uuid references public.profiles(id) on delete cascade,
  direction         text not null check (direction in ('in', 'out')),
  category          text not null check (char_length(category) between 1 and 40),
  title             text not null check (char_length(title) between 1 and 160),
  amount            numeric(14,2) not null check (amount > 0 and amount <= 9999999999.99),
  account_id        uuid not null,
  frequency         text not null check (frequency in ('monthly', 'quarterly', 'yearly')),
  pay_day           smallint not null check (pay_day between 1 and 31),
  start_date        date not null check (start_date between date '2000-01-01' and date '2100-12-31'),
  end_date          date,
  anchor            date not null,
  mode              text not null default 'auto' check (mode in ('auto', 'approve')),
  portal_key        text check (portal_key is null or portal_key in ('sahibinden', 'hepsiemlak', 'zingat', 'emlakjet')),
  expense_category  text check (expense_category is null or char_length(expense_category) between 1 and 40),
  create_expense    boolean not null default true,
  source_expense_id uuid references public.expenses(id) on delete set null,
  next_period       date,
  next_due          date,
  last_period       date,
  remind_for        date,
  active            boolean not null default true,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint recurring_rules_account_fk foreign key (account_id, tenant_id)
    references public.finance_accounts (id, tenant_id) on delete cascade,
  constraint recurring_rules_scope_owner check (
    (scope = 'office' and owner_user_id is null) or (scope = 'user' and owner_user_id is not null)
  ),
  constraint recurring_rules_salary check (category <> 'maas' or (scope = 'office' and direction = 'out')),
  constraint recurring_rules_end check (end_date is null or end_date >= start_date)
);

create index if not exists idx_recurring_rules_due on public.recurring_rules (next_due) where active and next_due is not null;
create index if not exists idx_recurring_rules_tenant on public.recurring_rules (tenant_id, scope, created_at);
create index if not exists idx_recurring_rules_owner on public.recurring_rules (owner_user_id) where owner_user_id is not null;
create index if not exists idx_recurring_rules_account on public.recurring_rules (account_id, tenant_id);
-- Bir gider serisi yalnız bir kez kurala çevrilir.
create unique index if not exists idx_recurring_rules_source_expense
  on public.recurring_rules (tenant_id, source_expense_id) where source_expense_id is not null;

create table if not exists public.recurring_occurrences (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  rule_id     uuid not null references public.recurring_rules(id) on delete cascade,
  period      date not null,
  due_date    date not null,
  amount      numeric(14,2) not null check (amount > 0 and amount <= 9999999999.99),
  status      text not null check (status in ('pending', 'posted', 'skipped')),
  skip_reason text check (skip_reason is null or char_length(skip_reason) <= 60),
  entry_id    uuid references public.cash_entries(id) on delete set null,
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint recurring_occurrences_period_unique unique (rule_id, period)
);

create index if not exists idx_recurring_occ_pending on public.recurring_occurrences (tenant_id, due_date) where status = 'pending';
create index if not exists idx_recurring_occ_rule on public.recurring_occurrences (rule_id, period desc);
create index if not exists idx_recurring_occ_entry on public.recurring_occurrences (entry_id) where entry_id is not null;

-- ---------------------------------------------------------------------------
-- Saf yardımcılar (tarih hesapları)
-- ---------------------------------------------------------------------------
-- Ayın ödeme günü: 31 -> kısa ayda ayın son günü.
create or replace function public.recurring_due_date(p_period date, p_pay_day integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select s.ms + (least(p_pay_day, ((s.ms + interval '1 month')::date - s.ms)) - 1)
  from (select (p_period - (pg_catalog.date_part('day', p_period)::integer - 1)) as ms) s;
$$;

create or replace function public.recurring_freq_months(p_frequency text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_frequency when 'monthly' then 1 when 'quarterly' then 3 when 'yearly' then 12 else null end;
$$;

-- anchor ayından başlayarak dönem adımlarıyla ilerler; ödeme günü p_from'a eşit/sonra olan ilk dönem.
create or replace function public.recurring_period_on_or_after(p_anchor date, p_pay_day integer, p_frequency text, p_from date)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_step integer := public.recurring_freq_months(p_frequency);
  v_period date := p_anchor - (pg_catalog.date_part('day', p_anchor)::integer - 1);
  v_guard integer := 0;
begin
  if v_step is null then return null; end if;
  while public.recurring_due_date(v_period, p_pay_day) < p_from and v_guard < 1500 loop
    v_period := (v_period + pg_catalog.make_interval(months => v_step))::date;
    v_guard := v_guard + 1;
  end loop;
  return v_period;
end;
$$;

-- ---------------------------------------------------------------------------
-- Erişim + RLS (okuma); yazma yalnız RPC
-- ---------------------------------------------------------------------------
-- p_level: view | create | edit | delete. Ofis kuralı = expenses yetkisi; kişisel = yalnız sahibi; maaş kuralı yalnız owner/gm.
create or replace function public.recurring_rule_access(p_rule_id uuid, p_level text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (r.scope = 'user' and r.owner_user_id = auth.uid() and (p_level = 'view' or public.current_profile_role() <> 'readonly'))
        or (r.scope = 'office' and public.has_effective_permission('expenses', p_level)
            and (r.category <> 'maas' or public.finance_is_owner_gm()))
    from public.recurring_rules r
    where r.id = p_rule_id and r.tenant_id = public.current_active_tenant_id()
  ), false);
$$;

alter table public.recurring_rules enable row level security;
alter table public.recurring_occurrences enable row level security;

drop policy if exists recurring_rules_select on public.recurring_rules;
create policy recurring_rules_select on public.recurring_rules
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (
      (scope = 'user' and owner_user_id = (select auth.uid()))
      or (scope = 'office' and (select public.has_effective_permission('expenses', 'view'))
          and (category <> 'maas' or (select public.finance_is_owner_gm())))
    )
  );

drop policy if exists recurring_occurrences_select on public.recurring_occurrences;
create policy recurring_occurrences_select on public.recurring_occurrences
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and exists (select 1 from public.recurring_rules r where r.id = recurring_occurrences.rule_id)
  );

revoke all on public.recurring_rules from public, anon, authenticated;
revoke all on public.recurring_occurrences from public, anon, authenticated;
grant select on public.recurring_rules to authenticated;
grant select on public.recurring_occurrences to authenticated;
grant all on public.recurring_rules to service_role;
grant all on public.recurring_occurrences to service_role;

-- ---------------------------------------------------------------------------
-- İç: bildirim (alıcı kuralın görünürlüğüne göre; tekrar yazılmaz)
-- ---------------------------------------------------------------------------
create or replace function public.recurring_notify(
  p_rule_id uuid, p_title text, p_body text, p_kind text, p_key text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.recurring_rules%rowtype;
begin
  select * into r from public.recurring_rules x where x.id = p_rule_id;
  if not found then return; end if;
  insert into public.notifications (tenant_id, user_id, title, body, href, kind, dedupe_key)
  select r.tenant_id, p.id, p_title, p_body,
         case when r.scope = 'user' then '/app/hesabim?sekme=kasam' else '/app/giderler?sekme=duzenli' end,
         p_kind, p_key || ':' || p.id::text
  from public.profiles p
  where p.tenant_id = r.tenant_id and coalesce(p.is_active, true)
    and (
      (r.scope = 'user' and p.id = r.owner_user_id)
      or (r.scope = 'office' and p.role = any (case when r.category = 'maas' then array['owner', 'gm'] else array['owner', 'gm', 'accounting'] end))
    )
  on conflict do nothing;
end;
$$;

-- Para biçimi (yerelden bağımsız): 45.000,00 ₺
create or replace function public.recurring_money_text(p_amount numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.to_char(p_amount, 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.') || ' ₺';
$$;

-- ---------------------------------------------------------------------------
-- İç: bir dönemi hesaba işle (otomatik üretim ve onay ortak yolu)
-- ---------------------------------------------------------------------------
-- Dönüş: posted | archived | before_opening | duplicate | not_found. Beklemedeki kayıt yoksa not_found.
create or replace function public.recurring_post_occurrence(p_occ_id uuid, p_amount numeric, p_actor uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.recurring_occurrences%rowtype;
  r public.recurring_rules%rowtype;
  a public.finance_accounts%rowtype;
  v_amount numeric;
  v_exp uuid;
  v_created boolean := false;
  v_entry uuid;
begin
  select * into o from public.recurring_occurrences x where x.id = p_occ_id and x.status = 'pending' for update;
  if not found then return 'not_found'; end if;
  select * into r from public.recurring_rules x where x.id = o.rule_id;
  select * into a from public.finance_accounts x where x.id = r.account_id and x.tenant_id = r.tenant_id;
  if not found then return 'not_found'; end if;
  v_amount := coalesce(p_amount, o.amount);
  if v_amount is null or v_amount < 0.01 or v_amount > 9999999999.99 or pg_catalog.round(v_amount, 2) <> v_amount then
    return 'invalid_input';
  end if;
  if a.archived_at is not null then return 'archived'; end if;
  if o.due_date < a.opening_date then return 'before_opening'; end if;

  -- Ofis gideri: TL ofis hesabından çıkan, maaş olmayan kural expenses kaydı da üretir (Paket A kuralı).
  if r.scope = 'office' and r.direction = 'out' and r.create_expense and a.owner_scope = 'office'
     and a.currency = 'TRY' and r.category <> 'maas' then
    insert into public.expenses (tenant_id, created_by, category, title, amount, currency, expense_date, notes, portal_key)
    values (r.tenant_id, p_actor, coalesce(r.expense_category, 'diger'), r.title, v_amount, 'TRY', o.due_date, 'Düzenli ödeme', r.portal_key)
    returning id into v_exp;
    v_created := true;
  end if;

  begin
    insert into public.cash_entries (tenant_id, account_id, direction, amount, currency, entry_date, kind, category, title,
      expense_id, created_expense, source_type, source_id, created_by)
    values (r.tenant_id, r.account_id, r.direction, v_amount, a.currency, o.due_date,
      case when r.direction = 'in' then 'income' else 'expense' end, r.category, r.title,
      v_exp, v_created, 'recurring', o.id, p_actor)
    returning id into v_entry;
  exception when unique_violation then
    -- Aynı dönem başka yoldan işlenmiş: üretilen gider kaydı yetim kalmasın.
    if v_exp is not null then delete from public.expenses where id = v_exp; end if;
    return 'duplicate';
  end;

  update public.recurring_occurrences
     set status = 'posted', amount = v_amount, entry_id = v_entry, decided_by = p_actor, decided_at = pg_catalog.now(), skip_reason = null
   where id = o.id;
  if r.scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (r.tenant_id, p_actor, 'recurring.post', 'recurring_rule', r.id,
      jsonb_build_object('period', o.period, 'amount', v_amount, 'entry_id', v_entry, 'mode', r.mode));
  end if;
  return 'posted';
end;
$$;

-- İç: kuralı bir sonraki döneme ilerlet (bitiş tarihini aşarsa kural tamamlanır).
create or replace function public.recurring_advance(p_rule_id uuid, p_done_period date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.recurring_rules%rowtype;
  v_next date;
  v_due date;
begin
  select * into r from public.recurring_rules x where x.id = p_rule_id for update;
  if not found then return; end if;
  v_next := (p_done_period + pg_catalog.make_interval(months => public.recurring_freq_months(r.frequency)))::date;
  v_due := public.recurring_due_date(v_next, r.pay_day);
  if r.end_date is not null and v_due > r.end_date then
    update public.recurring_rules set last_period = p_done_period, next_period = null, next_due = null, active = false, updated_at = pg_catalog.now()
     where id = p_rule_id;
  else
    update public.recurring_rules set last_period = p_done_period, next_period = v_next, next_due = v_due, updated_at = pg_catalog.now()
     where id = p_rule_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- İç: kural ekle (create + kurala çevir ortak)
-- ---------------------------------------------------------------------------
create or replace function public.recurring_insert_rule(
  p_uid uuid, p_tenant uuid, p_scope text, p_direction text, p_category text, p_title text, p_amount numeric, p_account_id uuid,
  p_frequency text, p_pay_day integer, p_start_date date, p_end_date date, p_anchor date, p_mode text, p_portal_key text,
  p_expense_category text, p_create_expense boolean, p_source_expense_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_period date;
  v_id uuid;
begin
  v_period := public.recurring_period_on_or_after(p_anchor, p_pay_day, p_frequency, p_start_date);
  insert into public.recurring_rules (tenant_id, scope, owner_user_id, direction, category, title, amount, account_id, frequency, pay_day,
    start_date, end_date, anchor, mode, portal_key, expense_category, create_expense, source_expense_id, next_period, next_due, created_by)
  values (p_tenant, p_scope, case when p_scope = 'user' then p_uid end, p_direction, p_category, p_title, p_amount, p_account_id, p_frequency,
    p_pay_day, p_start_date, p_end_date, p_anchor - (pg_catalog.date_part('day', p_anchor)::integer - 1), p_mode, p_portal_key,
    p_expense_category, p_create_expense, p_source_expense_id, v_period, public.recurring_due_date(v_period, p_pay_day), p_uid)
  returning id into v_id;
  -- Bitiş tarihi ilk vadeden önceyse kural hiç üretmez: tamamlanmış sayılır.
  update public.recurring_rules set active = false, next_period = null, next_due = null
   where id = v_id and end_date is not null and next_due > end_date;
  if p_scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (p_tenant, p_uid, 'recurring_rule.create', 'recurring_rule', v_id,
      jsonb_build_object('title', p_title, 'amount', p_amount, 'frequency', p_frequency, 'pay_day', p_pay_day, 'mode', p_mode, 'direction', p_direction));
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: kural oluştur
-- ---------------------------------------------------------------------------
create or replace function public.recurring_rule_create(
  p_scope text, p_direction text, p_category text, p_title text, p_amount numeric, p_account_id uuid,
  p_frequency text, p_pay_day integer, p_start_date date default null, p_end_date date default null,
  p_mode text default 'auto', p_portal_key text default null, p_expense_category text default null, p_create_expense boolean default true
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
  v_cat text := pg_catalog.btrim(coalesce(p_category, ''));
  v_start date := coalesce(p_start_date, v_today);
  v_acc public.finance_accounts%rowtype;
  v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if public.current_profile_role() = 'readonly' then return jsonb_build_object('outcome', 'forbidden'); end if;
  if p_scope not in ('office', 'user') or p_direction not in ('in', 'out')
     or char_length(v_title) not between 1 and 160 or char_length(v_cat) not between 1 and 40
     or p_amount is null or p_amount < 0.01 or p_amount > 9999999999.99 or pg_catalog.round(p_amount, 2) <> p_amount
     or p_account_id is null or public.recurring_freq_months(p_frequency) is null
     or p_pay_day is null or p_pay_day not between 1 and 31
     or p_mode not in ('auto', 'approve')
     or (p_portal_key is not null and p_portal_key not in ('sahibinden', 'hepsiemlak', 'zingat', 'emlakjet'))
     or (p_expense_category is not null and char_length(p_expense_category) > 40)
     or v_start < v_today or v_start > date '2100-12-31'
     or (p_end_date is not null and p_end_date < v_start) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if v_cat = 'maas' and (p_scope <> 'office' or p_direction <> 'out') then return jsonb_build_object('outcome', 'invalid_input'); end if;
  if p_scope = 'office' and not public.has_effective_permission('expenses', 'create') then return jsonb_build_object('outcome', 'forbidden'); end if;
  if v_cat = 'maas' and not public.finance_is_owner_gm() then return jsonb_build_object('outcome', 'forbidden'); end if;

  select * into v_acc from public.finance_accounts a where a.id = p_account_id and a.tenant_id = v_tenant;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_acc.archived_at is not null then return jsonb_build_object('outcome', 'archived'); end if;
  if not public.finance_account_access(p_account_id, 'create') or v_acc.owner_scope <> p_scope then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if (select pg_catalog.count(*) from public.recurring_rules r
       where r.tenant_id = v_tenant and r.active
         and ((p_scope = 'office' and r.scope = 'office') or (p_scope = 'user' and r.owner_user_id = v_uid))) >= 100 then
    return jsonb_build_object('outcome', 'limit_reached');
  end if;

  v_id := public.recurring_insert_rule(v_uid, v_tenant, p_scope, p_direction, v_cat, v_title, p_amount, p_account_id, p_frequency, p_pay_day,
    v_start, p_end_date, v_start, p_mode, p_portal_key, p_expense_category, coalesce(p_create_expense, true), null);
  return jsonb_build_object('outcome', 'created', 'rule_id', v_id);
end;
$$;

-- RPC: kural düzenle (tutar/ad/hesap/gün/bitiş/kip; geçmiş üretimler değişmez)
create or replace function public.recurring_rule_update(
  p_rule_id uuid, p_title text, p_amount numeric, p_account_id uuid, p_pay_day integer, p_end_date date, p_mode text
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
  r public.recurring_rules%rowtype;
  v_acc public.finance_accounts%rowtype;
  v_period date;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if char_length(v_title) not between 1 and 160
     or p_amount is null or p_amount < 0.01 or p_amount > 9999999999.99 or pg_catalog.round(p_amount, 2) <> p_amount
     or p_account_id is null or p_pay_day is null or p_pay_day not between 1 and 31 or p_mode not in ('auto', 'approve') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if not public.recurring_rule_access(p_rule_id, 'edit') then return jsonb_build_object('outcome', 'forbidden'); end if;
  select * into r from public.recurring_rules x where x.id = p_rule_id and x.tenant_id = v_tenant for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if p_end_date is not null and p_end_date < v_today then return jsonb_build_object('outcome', 'invalid_input'); end if;
  select * into v_acc from public.finance_accounts a where a.id = p_account_id and a.tenant_id = v_tenant;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if p_account_id <> r.account_id then
    if v_acc.archived_at is not null then return jsonb_build_object('outcome', 'archived'); end if;
    if v_acc.owner_scope <> r.scope or not public.finance_account_access(p_account_id, 'create') then
      return jsonb_build_object('outcome', 'forbidden');
    end if;
  end if;

  -- Gün değişirse sonraki dönem yeniden hesaplanır (bugünden ileri; geçmiş üretilmez).
  v_period := case when r.active then public.recurring_period_on_or_after(r.anchor, p_pay_day, r.frequency, v_today) else r.next_period end;
  update public.recurring_rules
     set title = v_title, amount = p_amount, account_id = p_account_id, pay_day = p_pay_day, end_date = p_end_date, mode = p_mode,
         next_period = v_period, next_due = case when v_period is null then null else public.recurring_due_date(v_period, p_pay_day) end,
         remind_for = null, updated_at = pg_catalog.now()
   where id = p_rule_id;
  update public.recurring_rules set active = false, next_period = null, next_due = null
   where id = p_rule_id and end_date is not null and next_due > end_date;
  if r.scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (v_tenant, v_uid, 'recurring_rule.update', 'recurring_rule', p_rule_id,
      jsonb_build_object('amount', r.amount, 'pay_day', r.pay_day, 'mode', r.mode),
      jsonb_build_object('amount', p_amount, 'pay_day', p_pay_day, 'mode', p_mode));
  end if;
  return jsonb_build_object('outcome', 'updated');
end;
$$;

-- RPC: durdur / sürdür (sürdürünce geçmiş dönemler ÜRETİLMEZ; bir sonraki vadeye atlanır)
create or replace function public.recurring_rule_set_active(p_rule_id uuid, p_active boolean)
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
  r public.recurring_rules%rowtype;
  v_period date;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if p_rule_id is null or p_active is null then return jsonb_build_object('outcome', 'invalid_input'); end if;
  if not public.recurring_rule_access(p_rule_id, 'edit') then return jsonb_build_object('outcome', 'forbidden'); end if;
  select * into r from public.recurring_rules x where x.id = p_rule_id and x.tenant_id = v_tenant for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if p_active then
    v_period := public.recurring_period_on_or_after(r.anchor, r.pay_day, r.frequency, v_today);
    if r.end_date is not null and public.recurring_due_date(v_period, r.pay_day) > r.end_date then
      return jsonb_build_object('outcome', 'ended');
    end if;
    update public.recurring_rules set active = true, next_period = v_period, next_due = public.recurring_due_date(v_period, r.pay_day),
      remind_for = null, updated_at = pg_catalog.now() where id = p_rule_id;
  else
    update public.recurring_rules set active = false, updated_at = pg_catalog.now() where id = p_rule_id;
  end if;
  if r.scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (v_tenant, v_uid, case when p_active then 'recurring_rule.resume' else 'recurring_rule.pause' end, 'recurring_rule', p_rule_id, '{}'::jsonb);
  end if;
  return jsonb_build_object('outcome', case when p_active then 'resumed' else 'paused' end);
end;
$$;

-- RPC: kural sil (yalnız hiç hareket üretmemişse; aksi halde durdurulur)
create or replace function public.recurring_rule_delete(p_rule_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  r public.recurring_rules%rowtype;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if p_rule_id is null then return jsonb_build_object('outcome', 'invalid_input'); end if;
  if not public.recurring_rule_access(p_rule_id, 'delete') then return jsonb_build_object('outcome', 'forbidden'); end if;
  select * into r from public.recurring_rules x where x.id = p_rule_id and x.tenant_id = v_tenant for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if exists (select 1 from public.recurring_occurrences o where o.rule_id = p_rule_id and o.status = 'posted') then
    return jsonb_build_object('outcome', 'has_history');
  end if;
  delete from public.recurring_rules where id = p_rule_id;
  if r.scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value)
    values (v_tenant, v_uid, 'recurring_rule.delete', 'recurring_rule', p_rule_id, jsonb_build_object('title', r.title, 'amount', r.amount));
  end if;
  return jsonb_build_object('outcome', 'deleted');
end;
$$;

-- RPC: mevcut tekrarlayan gider serisini kurala çevir (seri hatırlatmadan çıkar; çift kayıt/çift hatırlatma yok)
create or replace function public.recurring_rule_from_expense(
  p_expense_id uuid, p_account_id uuid, p_pay_day integer default null, p_mode text default 'auto'
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
  e public.expenses%rowtype;
  l public.expenses%rowtype;
  v_acc public.finance_accounts%rowtype;
  v_day integer;
  v_cat text;
  v_anchor date;
  v_id uuid;
  v_cleared integer;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if public.current_profile_role() = 'readonly' or not public.has_effective_permission('expenses', 'create') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_expense_id is null or p_account_id is null or p_mode not in ('auto', 'approve') or (p_pay_day is not null and p_pay_day not between 1 and 31) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  select * into e from public.expenses x where x.id = p_expense_id and x.tenant_id = v_tenant;
  if not found or e.recurrence is null then return jsonb_build_object('outcome', 'not_found'); end if;
  -- Serinin en son kaydı (aynı başlık + kategori + dönem): tutar ve gün oradan gelir.
  select * into l from public.expenses x
   where x.tenant_id = v_tenant and x.recurrence = e.recurrence and x.category = e.category
     and pg_catalog.lower(pg_catalog.btrim(x.title)) = pg_catalog.lower(pg_catalog.btrim(e.title))
   order by x.expense_date desc, x.created_at desc limit 1;
  if exists (select 1 from public.recurring_rules r where r.tenant_id = v_tenant and r.source_expense_id in
      (select x.id from public.expenses x where x.tenant_id = v_tenant and x.recurrence = e.recurrence and x.category = e.category
         and pg_catalog.lower(pg_catalog.btrim(x.title)) = pg_catalog.lower(pg_catalog.btrim(e.title)))) then
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  select * into v_acc from public.finance_accounts a where a.id = p_account_id and a.tenant_id = v_tenant;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_acc.archived_at is not null then return jsonb_build_object('outcome', 'archived'); end if;
  if v_acc.owner_scope <> 'office' or not public.finance_account_access(p_account_id, 'create') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  v_day := coalesce(p_pay_day, pg_catalog.date_part('day', l.expense_date)::integer);
  v_cat := case when l.portal_key is not null then 'portal'
                when l.category in ('reklam', 'ofis', 'ulasim') then l.category
                else 'diger_gider' end;
  -- Serinin bir sonraki dönemi: son kayıt ayı + adım; geçmiş dönemler ÜRETİLMEZ (bugünden ileri ilk vade).
  v_anchor := (l.expense_date - (pg_catalog.date_part('day', l.expense_date)::integer - 1)
               + pg_catalog.make_interval(months => public.recurring_freq_months(l.recurrence)))::date;

  v_id := public.recurring_insert_rule(v_uid, v_tenant, 'office', 'out', v_cat, l.title, l.amount, p_account_id, l.recurrence, v_day,
    v_today, null, v_anchor, p_mode, l.portal_key, l.category, true, l.id);

  update public.expenses x set recurrence = null
   where x.tenant_id = v_tenant and x.recurrence = e.recurrence and x.category = e.category
     and pg_catalog.lower(pg_catalog.btrim(x.title)) = pg_catalog.lower(pg_catalog.btrim(e.title));
  get diagnostics v_cleared = row_count;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, v_uid, 'recurring_rule.from_expense', 'recurring_rule', v_id, jsonb_build_object('expense_id', l.id, 'series_rows', v_cleared));
  return jsonb_build_object('outcome', 'created', 'rule_id', v_id, 'series_rows', v_cleared);
end;
$$;

-- RPC: onay bekleyen taslağı onayla (tutar değiştirilebilir) / atla
create or replace function public.recurring_occurrence_approve(p_occurrence_id uuid, p_amount numeric default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  o public.recurring_occurrences%rowtype;
  v_res text;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if p_occurrence_id is null then return jsonb_build_object('outcome', 'invalid_input'); end if;
  select * into o from public.recurring_occurrences x where x.id = p_occurrence_id and x.tenant_id = v_tenant;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if not public.recurring_rule_access(o.rule_id, 'create') then return jsonb_build_object('outcome', 'forbidden'); end if;
  if o.status <> 'pending' then return jsonb_build_object('outcome', 'already_decided'); end if;
  v_res := public.recurring_post_occurrence(p_occurrence_id, p_amount, v_uid);
  if v_res <> 'posted' then return jsonb_build_object('outcome', v_res); end if;
  return jsonb_build_object('outcome', 'approved');
end;
$$;

create or replace function public.recurring_occurrence_skip(p_occurrence_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  o public.recurring_occurrences%rowtype;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if p_occurrence_id is null then return jsonb_build_object('outcome', 'invalid_input'); end if;
  select * into o from public.recurring_occurrences x where x.id = p_occurrence_id and x.tenant_id = v_tenant for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if not public.recurring_rule_access(o.rule_id, 'create') then return jsonb_build_object('outcome', 'forbidden'); end if;
  if o.status <> 'pending' then return jsonb_build_object('outcome', 'already_decided'); end if;
  update public.recurring_occurrences set status = 'skipped', skip_reason = 'user', decided_by = v_uid, decided_at = pg_catalog.now() where id = o.id;
  return jsonb_build_object('outcome', 'skipped');
end;
$$;

-- ---------------------------------------------------------------------------
-- Cron adımı: vadesi gelen kuralları üret + vade -3 gün hatırlat (YALNIZ service_role; kira-tahakkuk cron'u çağırır)
-- ---------------------------------------------------------------------------
create or replace function public.recurring_run_due(p_today date, p_skip_tenants uuid[] default '{}')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.recurring_rules%rowtype;
  v_occ uuid;
  v_inserted integer;
  v_res text;
  v_loop integer;
  v_posted integer := 0;
  v_drafts integer := 0;
  v_skipped integer := 0;
  v_reminded integer := 0;
  v_failed integer := 0;
  v_period date;
begin
  if p_today is null then return jsonb_build_object('outcome', 'invalid_input'); end if;

  for r in
    select * from public.recurring_rules x
     where x.active and x.next_due is not null and x.next_due <= p_today and not (x.tenant_id = any (coalesce(p_skip_tenants, '{}')))
     order by x.next_due, x.id limit 1000
  loop
    begin
      v_loop := 0;
      -- Cron birkaç gün çalışmadıysa kaçan dönemler de (en çok 12) üretilir; kural başlangıcından önce hiçbir dönem üretilmez.
      while v_loop < 12 loop
        select * into r from public.recurring_rules x where x.id = r.id and x.active and x.next_due is not null and x.next_due <= p_today for update;
        exit when not found;
        v_period := r.next_period;
        insert into public.recurring_occurrences (tenant_id, rule_id, period, due_date, amount, status)
        values (r.tenant_id, r.id, v_period, r.next_due, r.amount, 'pending')
        on conflict (rule_id, period) do nothing
        returning id into v_occ;
        get diagnostics v_inserted = row_count;
        if v_inserted > 0 then
          if r.mode = 'auto' then
            v_res := public.recurring_post_occurrence(v_occ, null, r.created_by);
            if v_res = 'posted' then
              v_posted := v_posted + 1;
              perform public.recurring_notify(r.id, 'Düzenli ödeme kaydedildi',
                r.title || ' · ' || public.recurring_money_text(r.amount) || ' hesabınıza işlendi.',
                'info', 'recurring-post:' || r.id::text || ':' || v_period::text);
            else
              update public.recurring_occurrences set status = 'skipped', skip_reason = v_res, decided_at = pg_catalog.now() where id = v_occ;
              v_skipped := v_skipped + 1;
              perform public.recurring_notify(r.id, 'Düzenli ödeme kaydedilemedi',
                r.title || ' bu ay kaydedilemedi (' ||
                case v_res when 'archived' then 'hesap arşivde' when 'before_opening' then 'tarih hesap açılışından önce' else 'kayıt zaten var' end || ').',
                'warning', 'recurring-fail:' || r.id::text || ':' || v_period::text);
            end if;
          else
            v_drafts := v_drafts + 1;
            perform public.recurring_notify(r.id, 'Onay bekleyen ödeme',
              r.title || ' · ' || public.recurring_money_text(r.amount) || ' — onayınızı bekliyor.',
              'warning', 'recurring-draft:' || v_occ::text);
          end if;
        end if;
        perform public.recurring_advance(r.id, v_period);
        v_loop := v_loop + 1;
      end loop;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  -- Vade -3 gün hatırlatması (kural başına vade başına bir kez).
  for r in
    select * from public.recurring_rules x
     where x.active and x.next_due is not null and x.next_due > p_today and x.next_due <= p_today + 3
       and x.remind_for is distinct from x.next_due and not (x.tenant_id = any (coalesce(p_skip_tenants, '{}')))
     order by x.next_due, x.id limit 1000
  loop
    begin
      perform public.recurring_notify(r.id, 'Yaklaşan düzenli ödeme',
        r.title || ' · ' || public.recurring_money_text(r.amount) || ' · ' || pg_catalog.to_char(r.next_due, 'DD.MM.YYYY') ||
        case when r.mode = 'auto' then ' tarihinde otomatik kaydedilecek.' else ' tarihinde onayınıza sunulacak.' end,
        'info', 'recurring-remind:' || r.id::text || ':' || r.next_due::text);
      update public.recurring_rules set remind_for = r.next_due where id = r.id;
      v_reminded := v_reminded + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('outcome', 'ok', 'posted', v_posted, 'drafts', v_drafts, 'skipped', v_skipped, 'reminded', v_reminded, 'failed', v_failed);
end;
$$;

revoke all on function public.recurring_due_date(date, integer) from public, anon;
revoke all on function public.recurring_freq_months(text) from public, anon;
revoke all on function public.recurring_period_on_or_after(date, integer, text, date) from public, anon;
revoke all on function public.recurring_rule_access(uuid, text) from public, anon;
revoke all on function public.recurring_notify(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.recurring_money_text(numeric) from public, anon;
revoke all on function public.recurring_post_occurrence(uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function public.recurring_advance(uuid, date) from public, anon, authenticated;
revoke all on function public.recurring_insert_rule(uuid, uuid, text, text, text, text, numeric, uuid, text, integer, date, date, date, text, text, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.recurring_rule_create(text, text, text, text, numeric, uuid, text, integer, date, date, text, text, text, boolean) from public, anon;
revoke all on function public.recurring_rule_update(uuid, text, numeric, uuid, integer, date, text) from public, anon;
revoke all on function public.recurring_rule_set_active(uuid, boolean) from public, anon;
revoke all on function public.recurring_rule_delete(uuid) from public, anon;
revoke all on function public.recurring_rule_from_expense(uuid, uuid, integer, text) from public, anon;
revoke all on function public.recurring_occurrence_approve(uuid, numeric) from public, anon;
revoke all on function public.recurring_occurrence_skip(uuid) from public, anon;
revoke all on function public.recurring_run_due(date, uuid[]) from public, anon, authenticated;
grant execute on function public.recurring_due_date(date, integer) to authenticated, service_role;
grant execute on function public.recurring_freq_months(text) to authenticated, service_role;
grant execute on function public.recurring_period_on_or_after(date, integer, text, date) to authenticated, service_role;
grant execute on function public.recurring_rule_access(uuid, text) to authenticated, service_role;
grant execute on function public.recurring_money_text(numeric) to authenticated, service_role;
grant execute on function public.recurring_rule_create(text, text, text, text, numeric, uuid, text, integer, date, date, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.recurring_rule_update(uuid, text, numeric, uuid, integer, date, text) to authenticated, service_role;
grant execute on function public.recurring_rule_set_active(uuid, boolean) to authenticated, service_role;
grant execute on function public.recurring_rule_delete(uuid) to authenticated, service_role;
grant execute on function public.recurring_rule_from_expense(uuid, uuid, integer, text) to authenticated, service_role;
grant execute on function public.recurring_occurrence_approve(uuid, numeric) to authenticated, service_role;
grant execute on function public.recurring_occurrence_skip(uuid) to authenticated, service_role;
grant execute on function public.recurring_run_due(date, uuid[]) to service_role;
grant execute on function public.recurring_notify(uuid, text, text, text, text) to service_role;
grant execute on function public.recurring_post_occurrence(uuid, numeric, uuid) to service_role;
grant execute on function public.recurring_advance(uuid, date) to service_role;
grant execute on function public.recurring_insert_rule(uuid, uuid, text, text, text, text, numeric, uuid, text, integer, date, date, date, text, text, text, boolean, uuid) to service_role;

comment on table public.recurring_rules is 'Düzenli ödeme/gelir kuralı (aylık otomasyon). Yazma yalnız recurring_* RPC; kişisel kural yalnız sahibine, maaş kuralı yalnız owner/gm görünür. Geçmişe dönük kayıt üretilmez.';
comment on table public.recurring_occurrences is 'Kuralın dönem başına tek üretimi (unique(rule_id, period)); pending = onay bekleyen taslak, posted = cash_entries (source_type=recurring) hareketi var.';

notify pgrst, 'reload schema';
