-- Finans (Paket C): banka ekstresi içe aktarma + mutabakat.
--
-- NEDEN: Hesap bakiyesi elle girilen hareketlerden türüyor; bankanın gerçek hareketiyle karşılaştırılmıyordu. Ekstre (CSV/Excel/OFX)
--   yüklenir, satırlar önce TASLAK olur, mevcut hareketlerle eşleşenler "mutabık" işaretlenir, eşleşmeyenler tek tıkla hareket olur.
--   Tasarım: docs/design/FINANS_KASA_EFATURA_TASARIM_2026-10.md Paket C.
-- İÇERİK:
--   1) cash_entries.reconciled_at (nullable; mutabakat işareti). Mevcut satır/davranış değişmez.
--   2) finance_statement_imports: yüklenen dosya (SHA-256 karması; aynı dosya aynı hesaba ikinci kez alınmaz).
--      finance_statement_lines: taslak satırlar (hesap başına line_hash benzersiz -> çakışan ekstreler çift satır üretmez).
--      finance_statement_mappings: hesap başına hatırlanan sütun eşlemesi.
--      Ham dosya ve dosya adı SAKLANMAZ; açıklama en çok 300 karakter, kişisel veri loglanmaz.
--   3) Yazma YALNIZ RPC (SECURITY DEFINER, search_path=''): finance_statement_stage / _apply / _discard / _mapping_save.
--      Hareket üretimi source_type='import', source_id=satır id (mükerrer engelli, kısmi benzersiz indeks Paket A'dan).
--      Komisyon/kira/aidat tahsilatına bağlı onay ofis hesabı + ilgili modül düzenleme yetkisi ister (Paket A kuralı).
--   4) finance_reconciliation_status(): görünür hesaplar için son mutabakat ve mutabık olmayan hareket sayısı (ekstre kapsam penceresinde).
-- Yeni izin modülü YOK: ofis hesapları `expenses`, kişisel hesaplar oturum sahibine bağlıdır (finance_account_access).
-- Bağımlılık: 20261010000600 (finance_accounts, cash_entries, finance_account_access, finance_is_owner_gm).
-- GERİ ALMA: rollbacks/20261011001200_bank_statement_import.rollback.sql (taslaklar ve mutabakat işaretleri KAYBOLUR; hareketler yerinde kalır).
-- RİSK: düşük (yeni tablolar/fonksiyonlar + 1 nullable sütun). Kod şema yokken "Ekstre yükle" düğmesini göstermez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.finance_accounts') is null
     or pg_catalog.to_regclass('public.cash_entries') is null
     or pg_catalog.to_regclass('public.expenses') is null
     or pg_catalog.to_regclass('public.audit_logs') is null
     or pg_catalog.to_regprocedure('public.finance_account_access(uuid,text)') is null
     or pg_catalog.to_regprocedure('public.finance_is_owner_gm()') is null then
    raise exception '20261011001200: 20261010000600 (finance_accounts / cash_entries) yok.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Mutabakat işareti
-- ---------------------------------------------------------------------------
alter table public.cash_entries add column if not exists reconciled_at timestamptz;
create index if not exists idx_cash_entries_unreconciled
  on public.cash_entries (tenant_id, account_id, entry_date) where voided_at is null and reconciled_at is null;

-- ---------------------------------------------------------------------------
-- 2) Taslak tabloları
-- ---------------------------------------------------------------------------
create table if not exists public.finance_statement_imports (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  account_id  uuid not null,
  file_hash   text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  format      text not null check (format in ('csv', 'xlsx', 'ofx')),
  row_count   integer not null check (row_count between 0 and 2000),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint finance_statement_imports_account_fk foreign key (account_id, tenant_id)
    references public.finance_accounts (id, tenant_id) on delete cascade,
  constraint finance_statement_imports_file_unique unique (account_id, file_hash),
  constraint finance_statement_imports_id_tenant unique (id, tenant_id)
);
create index if not exists idx_finance_statement_imports_account on public.finance_statement_imports (tenant_id, account_id, created_at desc);

create table if not exists public.finance_statement_lines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  import_id     uuid not null,
  account_id    uuid not null,
  line_hash     text not null check (char_length(line_hash) between 8 and 80),
  line_date     date not null check (line_date between date '2000-01-01' and date '2100-12-31'),
  direction     text not null check (direction in ('in', 'out')),
  amount        numeric(14,2) not null check (amount > 0 and amount <= 9999999999.99),
  description   text not null default '' check (char_length(description) <= 300),
  balance_after numeric(14,2),
  status        text not null default 'pending' check (status in ('pending', 'posted', 'matched', 'skipped')),
  entry_id      uuid references public.cash_entries(id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint finance_statement_lines_import_fk foreign key (import_id, tenant_id)
    references public.finance_statement_imports (id, tenant_id) on delete cascade,
  constraint finance_statement_lines_account_fk foreign key (account_id, tenant_id)
    references public.finance_accounts (id, tenant_id) on delete cascade,
  constraint finance_statement_lines_hash_unique unique (account_id, line_hash)
);
create index if not exists idx_finance_statement_lines_import on public.finance_statement_lines (import_id, line_date, created_at);
create index if not exists idx_finance_statement_lines_pending on public.finance_statement_lines (tenant_id, account_id, line_date) where status = 'pending';
create index if not exists idx_finance_statement_lines_entry on public.finance_statement_lines (entry_id) where entry_id is not null;

create table if not exists public.finance_statement_mappings (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null,
  mapping    jsonb not null check (jsonb_typeof(mapping) = 'object' and pg_catalog.octet_length(mapping::text) <= 2000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (account_id),
  constraint finance_statement_mappings_account_fk foreign key (account_id, tenant_id)
    references public.finance_accounts (id, tenant_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- RLS (okuma; görünürlük hesabın görünürlüğüyle aynı); yazma yalnız RPC
-- ---------------------------------------------------------------------------
alter table public.finance_statement_imports enable row level security;
alter table public.finance_statement_lines enable row level security;
alter table public.finance_statement_mappings enable row level security;

drop policy if exists finance_statement_imports_select on public.finance_statement_imports;
create policy finance_statement_imports_select on public.finance_statement_imports
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and exists (select 1 from public.finance_accounts a where a.id = finance_statement_imports.account_id and a.tenant_id = finance_statement_imports.tenant_id)
  );

drop policy if exists finance_statement_lines_select on public.finance_statement_lines;
create policy finance_statement_lines_select on public.finance_statement_lines
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and exists (select 1 from public.finance_accounts a where a.id = finance_statement_lines.account_id and a.tenant_id = finance_statement_lines.tenant_id)
  );

drop policy if exists finance_statement_mappings_select on public.finance_statement_mappings;
create policy finance_statement_mappings_select on public.finance_statement_mappings
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and exists (select 1 from public.finance_accounts a where a.id = finance_statement_mappings.account_id and a.tenant_id = finance_statement_mappings.tenant_id)
  );

revoke all on public.finance_statement_imports from public, anon, authenticated;
revoke all on public.finance_statement_lines from public, anon, authenticated;
revoke all on public.finance_statement_mappings from public, anon, authenticated;
grant select on public.finance_statement_imports to authenticated;
grant select on public.finance_statement_lines to authenticated;
grant select on public.finance_statement_mappings to authenticated;
grant all on public.finance_statement_imports to service_role;
grant all on public.finance_statement_lines to service_role;
grant all on public.finance_statement_mappings to service_role;

-- ---------------------------------------------------------------------------
-- RPC: ekstre satırlarını taslak olarak yaz
--   p_lines: [{d: 'YYYY-MM-DD', dir: 'in'|'out', amt: 123.45, desc: '...', h: '<karma>', bal: 100.00|null}, ...]
-- ---------------------------------------------------------------------------
create or replace function public.finance_statement_stage(p_account_id uuid, p_file_hash text, p_format text, p_lines jsonb)
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
  v_acc public.finance_accounts%rowtype;
  v_import uuid;
  v_total integer;
  v_valid integer;
  v_inserted integer;
  v_rows jsonb;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if public.current_profile_role() = 'readonly' then return jsonb_build_object('outcome', 'forbidden'); end if;
  if p_account_id is null or p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$'
     or p_format not in ('csv', 'xlsx', 'ofx')
     or p_lines is null or pg_catalog.jsonb_typeof(p_lines) <> 'array'
     or pg_catalog.jsonb_array_length(p_lines) not between 1 and 1000 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if not public.finance_account_access(p_account_id, 'create') then return jsonb_build_object('outcome', 'forbidden'); end if;
  select * into v_acc from public.finance_accounts a where a.id = p_account_id and a.tenant_id = v_tenant for share;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_acc.archived_at is not null then return jsonb_build_object('outcome', 'archived'); end if;

  v_total := pg_catalog.jsonb_array_length(p_lines);
  begin
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('d', t.d, 'dir', t.dir, 'amt', t.amt, 'desc', t.descr, 'h', t.h, 'bal', t.bal)), '[]'::jsonb)
      into v_rows
    from (
      select (x->>'d')::date as d, x->>'dir' as dir, (x->>'amt')::numeric as amt, pg_catalog.left(coalesce(x->>'desc', ''), 300) as descr,
             x->>'h' as h, nullif(x->>'bal', '')::numeric as bal
      from pg_catalog.jsonb_array_elements(p_lines) x
    ) t
    where t.d is not null and t.dir in ('in', 'out') and t.amt is not null and t.amt >= 0.01 and t.amt <= 9999999999.99
      and pg_catalog.round(t.amt, 2) = t.amt
      and t.h is not null and pg_catalog.char_length(t.h) between 8 and 80
      and t.d <= v_today and t.d >= v_acc.opening_date
      and (t.bal is null or (abs(t.bal) <= 9999999999.99 and pg_catalog.round(t.bal, 2) = t.bal));
  exception when others then
    return jsonb_build_object('outcome', 'invalid_input');
  end;
  v_valid := pg_catalog.jsonb_array_length(v_rows);
  if v_valid = 0 then return jsonb_build_object('outcome', 'no_valid_rows', 'invalid', v_total); end if;

  begin
    insert into public.finance_statement_imports (tenant_id, account_id, file_hash, format, row_count, created_by)
    values (v_tenant, p_account_id, p_file_hash, p_format, v_valid, v_uid)
    returning id into v_import;
  exception when unique_violation then
    return jsonb_build_object('outcome', 'duplicate_file');
  end;

  with ins as (
    insert into public.finance_statement_lines (tenant_id, import_id, account_id, line_hash, line_date, direction, amount, description, balance_after)
    select v_tenant, v_import, p_account_id, r.h, r.d, r.dir, r.amt, r."desc", r.bal
    from pg_catalog.jsonb_to_recordset(v_rows) as r(d date, dir text, amt numeric, "desc" text, h text, bal numeric)
    on conflict (account_id, line_hash) do nothing
    returning 1
  )
  select pg_catalog.count(*) into v_inserted from ins;

  if v_inserted = 0 then
    delete from public.finance_statement_imports where id = v_import and tenant_id = v_tenant;
    return jsonb_build_object('outcome', 'nothing_new', 'duplicates', v_valid, 'invalid', v_total - v_valid);
  end if;
  update public.finance_statement_imports set row_count = v_inserted where id = v_import and tenant_id = v_tenant;

  if v_acc.owner_scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (v_tenant, v_uid, 'finance_statement.stage', 'finance_account', p_account_id,
      jsonb_build_object('import_id', v_import, 'format', p_format, 'inserted', v_inserted, 'duplicates', v_valid - v_inserted));
  end if;
  return jsonb_build_object('outcome', 'staged', 'import_id', v_import, 'inserted', v_inserted,
    'duplicates', v_valid - v_inserted, 'invalid', v_total - v_valid);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: kullanıcı kararlarını uygula
--   p_decisions: [{line_id, action: 'create'|'match'|'skip', category, title, entry_id, source_type, source_id, expense_category}, ...]
-- ---------------------------------------------------------------------------
create or replace function public.finance_statement_apply(p_account_id uuid, p_decisions jsonb)
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
  v_acc public.finance_accounts%rowtype;
  d jsonb;
  v_line public.finance_statement_lines%rowtype;
  v_action text;
  v_cat text;
  v_title text;
  v_src text;
  v_src_id uuid;
  v_entry uuid;
  v_exp uuid;
  v_created boolean;
  v_created_n integer := 0;
  v_matched_n integer := 0;
  v_skipped_n integer := 0;
  v_failed_n integer := 0;
  v_ok boolean;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if public.current_profile_role() = 'readonly' then return jsonb_build_object('outcome', 'forbidden'); end if;
  if p_account_id is null or p_decisions is null or pg_catalog.jsonb_typeof(p_decisions) <> 'array'
     or pg_catalog.jsonb_array_length(p_decisions) not between 1 and 500 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if not public.finance_account_access(p_account_id, 'create') then return jsonb_build_object('outcome', 'forbidden'); end if;
  select * into v_acc from public.finance_accounts a where a.id = p_account_id and a.tenant_id = v_tenant for share;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_acc.archived_at is not null then return jsonb_build_object('outcome', 'archived'); end if;

  for d in select x from pg_catalog.jsonb_array_elements(p_decisions) x loop
    v_ok := true;
    v_action := d->>'action';
    begin
      select * into v_line from public.finance_statement_lines l
       where l.id = (d->>'line_id')::uuid and l.account_id = p_account_id and l.tenant_id = v_tenant and l.status = 'pending' for update;
    exception when invalid_text_representation then
      v_failed_n := v_failed_n + 1; continue;
    end;
    if not found then v_failed_n := v_failed_n + 1; continue; end if;

    if v_action = 'skip' then
      update public.finance_statement_lines set status = 'skipped', decided_at = pg_catalog.now() where id = v_line.id;
      v_skipped_n := v_skipped_n + 1;

    elsif v_action = 'match' then
      begin
        v_entry := (d->>'entry_id')::uuid;
      exception when invalid_text_representation then
        v_failed_n := v_failed_n + 1; continue;
      end;
      update public.cash_entries e set reconciled_at = pg_catalog.now()
       where e.id = v_entry and e.tenant_id = v_tenant and e.account_id = p_account_id and e.voided_at is null and e.reconciled_at is null
         and e.kind in ('income', 'expense', 'transfer') and e.direction = v_line.direction and e.amount = v_line.amount
         and (e.category is distinct from 'maas' or v_acc.owner_scope = 'user' or public.finance_is_owner_gm());
      if not found then v_failed_n := v_failed_n + 1; continue; end if;
      update public.finance_statement_lines set status = 'matched', entry_id = v_entry, decided_at = pg_catalog.now() where id = v_line.id;
      v_matched_n := v_matched_n + 1;

    elsif v_action = 'create' then
      v_cat := nullif(pg_catalog.btrim(coalesce(d->>'category', '')), '');
      v_title := pg_catalog.left(pg_catalog.btrim(coalesce(nullif(pg_catalog.btrim(coalesce(d->>'title', '')), ''), v_line.description, '')), 160);
      if v_title = '' then v_title := case when v_line.direction = 'in' then 'Banka girişi' else 'Banka çıkışı' end; end if;
      v_src := coalesce(nullif(d->>'source_type', ''), 'import');
      v_src_id := null;
      if v_cat is not null and pg_catalog.char_length(v_cat) > 40 then v_failed_n := v_failed_n + 1; continue; end if;
      if v_line.line_date < v_acc.opening_date or v_line.line_date > v_today then v_failed_n := v_failed_n + 1; continue; end if;
      if v_cat = 'maas' and v_acc.owner_scope = 'office' and not public.finance_is_owner_gm() then v_failed_n := v_failed_n + 1; continue; end if;

      if v_src = 'import' then
        v_src_id := v_line.id;
      elsif v_src in ('commission', 'rent', 'building') then
        begin
          v_src_id := (d->>'source_id')::uuid;
        exception when invalid_text_representation then
          v_failed_n := v_failed_n + 1; continue;
        end;
        if v_acc.owner_scope <> 'office' or v_line.direction <> 'in' or v_src_id is null then v_failed_n := v_failed_n + 1; continue; end if;
        if not (case v_src
                  when 'commission' then public.has_effective_permission('commissions', 'edit')
                  when 'rent' then public.has_effective_permission('rentals', 'edit')
                  else public.has_effective_permission('expenses', 'edit') end) then
          v_failed_n := v_failed_n + 1; continue;
        end if;
        if not (case v_src
                  when 'commission' then exists (select 1 from public.commissions c where c.id = v_src_id and c.tenant_id = v_tenant)
                  when 'rent' then exists (select 1 from public.rent_payments r where r.id = v_src_id and r.tenant_id = v_tenant and r.voided_at is null)
                  else exists (select 1 from public.building_payments b where b.id = v_src_id and b.tenant_id = v_tenant and b.voided_at is null) end) then
          v_failed_n := v_failed_n + 1; continue;
        end if;
      else
        v_failed_n := v_failed_n + 1; continue;
      end if;

      v_exp := null; v_created := false;
      -- Ofis TL gideri: elle gider akışıyla aynı kural (expenses tek gider gerçeği; maaş hariç).
      if v_line.direction = 'out' and v_acc.owner_scope = 'office' and v_acc.currency = 'TRY' and v_cat is distinct from 'maas'
         and coalesce((d->>'create_expense')::boolean, true) then
        insert into public.expenses (tenant_id, created_by, category, title, amount, currency, expense_date, notes)
        values (v_tenant, v_uid, coalesce(nullif(pg_catalog.btrim(coalesce(d->>'expense_category', '')), ''), 'diger'), v_title, v_line.amount, 'TRY',
                v_line.line_date, 'Banka ekstresinden')
        returning id into v_exp;
        v_created := true;
      end if;

      begin
        insert into public.cash_entries (tenant_id, account_id, direction, amount, currency, entry_date, kind, category, title,
          expense_id, created_expense, source_type, source_id, created_by, reconciled_at)
        values (v_tenant, p_account_id, v_line.direction, v_line.amount, v_acc.currency, v_line.line_date,
          case when v_line.direction = 'in' then 'income' else 'expense' end, v_cat, v_title,
          v_exp, v_created, v_src, v_src_id, v_uid, pg_catalog.now())
        returning id into v_entry;
      exception when unique_violation then
        if v_created and v_exp is not null then delete from public.expenses where id = v_exp and tenant_id = v_tenant; end if;
        v_failed_n := v_failed_n + 1; continue;
      end;
      update public.finance_statement_lines set status = 'posted', entry_id = v_entry, decided_at = pg_catalog.now() where id = v_line.id;
      v_created_n := v_created_n + 1;
    else
      v_failed_n := v_failed_n + 1;
    end if;
  end loop;

  if v_acc.owner_scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (v_tenant, v_uid, 'finance_statement.apply', 'finance_account', p_account_id,
      jsonb_build_object('created', v_created_n, 'matched', v_matched_n, 'skipped', v_skipped_n, 'failed', v_failed_n));
  end if;
  return jsonb_build_object('outcome', 'applied', 'created', v_created_n, 'matched', v_matched_n, 'skipped', v_skipped_n, 'failed', v_failed_n);
end;
$$;

-- RPC: taslağı at (yalnız bekleyen satırlar; işlenmiş satır ve hareketler kalır). Hiç işlenmiş satır kalmazsa dosya kaydı da silinir.
create or replace function public.finance_statement_discard(p_import_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_account uuid;
  v_removed integer;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if p_import_id is null then return jsonb_build_object('outcome', 'invalid_input'); end if;
  select i.account_id into v_account from public.finance_statement_imports i where i.id = p_import_id and i.tenant_id = v_tenant;
  if v_account is null then return jsonb_build_object('outcome', 'not_found'); end if;
  if not public.finance_account_access(v_account, 'edit') then return jsonb_build_object('outcome', 'forbidden'); end if;

  with del as (
    delete from public.finance_statement_lines l where l.import_id = p_import_id and l.tenant_id = v_tenant and l.status = 'pending' returning 1
  )
  select pg_catalog.count(*) into v_removed from del;
  if not exists (select 1 from public.finance_statement_lines l where l.import_id = p_import_id and l.tenant_id = v_tenant) then
    delete from public.finance_statement_imports where id = p_import_id and tenant_id = v_tenant;
  end if;
  return jsonb_build_object('outcome', 'discarded', 'removed', v_removed);
end;
$$;

-- RPC: hesap başına sütun eşlemesini hatırla
create or replace function public.finance_statement_mapping_save(p_account_id uuid, p_mapping jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if p_account_id is null or p_mapping is null or pg_catalog.jsonb_typeof(p_mapping) <> 'object'
     or pg_catalog.octet_length(p_mapping::text) > 2000 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if not public.finance_account_access(p_account_id, 'create') then return jsonb_build_object('outcome', 'forbidden'); end if;
  insert into public.finance_statement_mappings (tenant_id, account_id, mapping, updated_by)
  values (v_tenant, p_account_id, p_mapping, v_uid)
  on conflict (account_id) do update set mapping = excluded.mapping, updated_by = excluded.updated_by, updated_at = pg_catalog.now();
  return jsonb_build_object('outcome', 'saved');
end;
$$;

-- ---------------------------------------------------------------------------
-- Okuma: hesap başına mutabakat durumu. Mutabık olmayan = ekstre kapsam penceresinde (ilk-son satır tarihi) mutabık işaretsiz hareket.
-- DEFINER: görünür hesaplarla sınırlı (finance_account_balances ile aynı kural); maaş satırı yalnız owner/gm'ye sayılır.
-- ---------------------------------------------------------------------------
create or replace function public.finance_reconciliation_status()
returns table (account_id uuid, last_reconciled_at timestamptz, unreconciled_count bigint, pending_lines bigint,
               has_import boolean, coverage_from date, coverage_to date)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
         (select max(e.reconciled_at) from public.cash_entries e where e.account_id = a.id and e.tenant_id = a.tenant_id and e.voided_at is null),
         case when cov.n = 0 then 0::bigint else
           (select pg_catalog.count(*) from public.cash_entries e
             where e.account_id = a.id and e.tenant_id = a.tenant_id and e.voided_at is null and e.reconciled_at is null
               and e.kind in ('income', 'expense', 'transfer') and e.entry_date between cov.d1 and cov.d2
               and (a.owner_scope = 'user' or e.category is distinct from 'maas' or public.finance_is_owner_gm())) end,
         (select pg_catalog.count(*) from public.finance_statement_lines l where l.account_id = a.id and l.tenant_id = a.tenant_id and l.status = 'pending'),
         cov.n > 0,
         cov.d1,
         cov.d2
  from public.finance_accounts a
  cross join lateral (
    select pg_catalog.count(*) as n, min(l.line_date) as d1, max(l.line_date) as d2
    from public.finance_statement_lines l where l.account_id = a.id and l.tenant_id = a.tenant_id
  ) cov
  where a.tenant_id = public.current_active_tenant_id()
    and ((a.owner_scope = 'user' and a.owner_user_id = auth.uid())
         or (a.owner_scope = 'office' and public.has_effective_permission('expenses', 'view')));
$$;

revoke all on function public.finance_statement_stage(uuid, text, text, jsonb) from public, anon;
revoke all on function public.finance_statement_apply(uuid, jsonb) from public, anon;
revoke all on function public.finance_statement_discard(uuid) from public, anon;
revoke all on function public.finance_statement_mapping_save(uuid, jsonb) from public, anon;
revoke all on function public.finance_reconciliation_status() from public, anon;
grant execute on function public.finance_statement_stage(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.finance_statement_apply(uuid, jsonb) to authenticated, service_role;
grant execute on function public.finance_statement_discard(uuid) to authenticated, service_role;
grant execute on function public.finance_statement_mapping_save(uuid, jsonb) to authenticated, service_role;
grant execute on function public.finance_reconciliation_status() to authenticated, service_role;

comment on table public.finance_statement_imports is 'Yüklenen banka ekstresi kaydı (yalnız SHA-256 karması; ham dosya/ad saklanmaz). Yazma yalnız finance_statement_* RPC.';
comment on table public.finance_statement_lines is 'Ekstre taslak satırı. status pending=onay bekler; posted=hareket üretildi; matched=mevcut hareketle eşlendi; skipped=atlandı.';

notify pgrst, 'reload schema';
