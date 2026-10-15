-- MIGRATION 20261017010000_finance_posting_core.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Tasarim: docs/design/FINANS_ENTEGRASYON_2026-10.md, WP1 "Kayit cekirdegi".
-- Geri alma: supabase/rollbacks/20261017010000_finance_posting_core.rollback.sql (ONCE 20261017010100 geri alinir;
--   posting_key / event_type / reversal_of / invoice_id kolonlari ve kayit kurallari tablosu duser; yeni kaynak turuyle
--   yazilmis hareket varsa geri alma durur).
-- BAGIMLILIK: 20261014001000 + 20261014001100 + 20261014011000 (finans v2 + P12) + 20261016060100 (son settle govdesi),
--   20261010000700 (einvoices), 20260816000400 (commission_payouts).
--
-- NE:
--  1) cash_entries + finance_open_items: posting_key (kiraci basina tekil; kismi unique index), event_type, reversal_of
--     (ayna kaydin asli; her kayda en cok bir ayna). finance_open_items.invoice_id (einvoices baglantisi).
--  2) cash_entries.source_type CHECK genisler: commission_payout, invoice, deposit, subscription (due zaten vardi).
--     Eski kaynak tekilligi (tenant, source_type, source_id, account) YALNIZ posting_key'siz (eski yol) satirlara uygulanir:
--     kayit servisinde tekillik posting_key ile saglanir (kismi tahsilat ayni kaynaga birden cok satir yazabilir).
--  3) finance_posting_rules: olay turu -> acik kalem / nakit / K/Z / TDHP kurali (src/lib/finance/posting/rules.ts aynasi; testle eslenir).
--  4) finance_post(p_event jsonb) [authenticated] + finance_post_internal(tenant, actor, event) [yalniz service_role / tetikleyici]:
--     tek transaction; {outcome, entry_ids, open_item_id}; ayni posting_key ile tekrar cagri `duplicate` (yeni satir yok).
--     Kilitli aya dusen ACIK KALEM ilk acik aya tarihlenir ve not ile isaretlenir; kilitli aya NAKIT yazilmaz (period_locked).
--  5) finance_reverse(p_target, p_reason, p_date) [authenticated] + finance_reverse_internal: acik donemde iptal (void/cancel);
--     kilitli donemde ilk acik aya reversal_of bagli ayna kayit. Hicbir sey silinmez.
--  6) finance_open_item_recompute: odenen = yone gore isaretli bagli hareketler (ayna cikis tahsilati geri alir) + ayna kalemler.
--  7) audit_logs tetikleyicileri (cash_entries ofis hesaplari + finance_open_items): ekleme, iptal, ters kayit, parasal degisiklik.
-- GUVENLIK: tum fonksiyonlar SECURITY DEFINER + search_path=''; kiraci = current_active_tenant_id(); yetki kuraldaki modul
--   (has_effective_permission), readonly reddedilir, hakedis odemesi yalniz owner/gm, maas yalniz owner/gm, P12 danisman carisi.
--   Ic fonksiyonlar istemciye kapali (yalniz service_role).
-- ETKI: ek + davranis (yeni kolonlar null dogar; eski RPC'ler ayni; acik kalem odeme hesabi mevcut satirlarda ayni sonucu verir:
--   bugun bagli hareketler daima kalemle ayni yondedir).
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.finance_open_items') is null
     or pg_catalog.to_regclass('public.cash_entries') is null
     or pg_catalog.to_regclass('public.finance_accounts') is null
     or pg_catalog.to_regclass('public.finance_parties') is null
     or pg_catalog.to_regclass('public.einvoices') is null
     or pg_catalog.to_regclass('public.audit_logs') is null
     or pg_catalog.to_regprocedure('public.finance_open_item_recompute(uuid)') is null
     or pg_catalog.to_regprocedure('public.finance_period_is_locked(uuid,date)') is null
     or pg_catalog.to_regprocedure('public.finance_account_is_office(uuid)') is null
     or pg_catalog.to_regprocedure('public.finance_account_access(uuid,text)') is null
     or pg_catalog.to_regprocedure('public.finance_v2_raise(text)') is null
     or pg_catalog.to_regprocedure('public.finance_v2_resolve_party(uuid,uuid,text,text)') is null
     or pg_catalog.to_regprocedure('public.finance_v2_check_category(uuid,text,text)') is null
     or pg_catalog.to_regprocedure('public.finance_vat_split(numeric,numeric,boolean)') is null
     or pg_catalog.to_regprocedure('public.finance_party_foreign_advisor(uuid)') is null
     or pg_catalog.to_regprocedure('public.finance_is_owner_gm()') is null
     or pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.current_profile_role()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null then
    raise exception '20261017010000: finans v2 onkosullari eksik (20261014001000, 20261014001100, 20261014011000, 20261010000700 once uygulanmali).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Kolonlar + tekillik
-- ---------------------------------------------------------------------------
alter table public.cash_entries add column if not exists posting_key text;
alter table public.cash_entries add column if not exists event_type text;
alter table public.cash_entries add column if not exists reversal_of uuid references public.cash_entries(id) on delete restrict;
alter table public.finance_open_items add column if not exists posting_key text;
alter table public.finance_open_items add column if not exists event_type text;
alter table public.finance_open_items add column if not exists reversal_of uuid references public.finance_open_items(id) on delete restrict;
alter table public.finance_open_items add column if not exists invoice_id uuid references public.einvoices(id) on delete set null;

alter table public.cash_entries drop constraint if exists cash_entries_posting_key_len;
alter table public.cash_entries add constraint cash_entries_posting_key_len
  check (posting_key is null or char_length(posting_key) between 3 and 220);
alter table public.cash_entries drop constraint if exists cash_entries_event_type_len;
alter table public.cash_entries add constraint cash_entries_event_type_len
  check (event_type is null or char_length(event_type) between 3 and 60);
alter table public.finance_open_items drop constraint if exists finance_open_items_posting_key_len;
alter table public.finance_open_items add constraint finance_open_items_posting_key_len
  check (posting_key is null or char_length(posting_key) between 3 and 220);
alter table public.finance_open_items drop constraint if exists finance_open_items_event_type_len;
alter table public.finance_open_items add constraint finance_open_items_event_type_len
  check (event_type is null or char_length(event_type) between 3 and 60);

-- Olay anahtari kiraci basina bir kez kullanilir (iptal/ters kayit sonrasi da): duzeltilmis yeniden kayit yeni surum anahtari ister.
create unique index if not exists idx_cash_entries_posting_key
  on public.cash_entries (tenant_id, posting_key) where posting_key is not null;
create unique index if not exists idx_finance_open_items_posting_key
  on public.finance_open_items (tenant_id, posting_key) where posting_key is not null;
create unique index if not exists idx_cash_entries_reversal_of
  on public.cash_entries (reversal_of) where reversal_of is not null;
create unique index if not exists idx_finance_open_items_reversal_of
  on public.finance_open_items (reversal_of) where reversal_of is not null;
create index if not exists idx_finance_open_items_invoice
  on public.finance_open_items (invoice_id) where invoice_id is not null;

-- Eski kaynak tekilligi yalniz eski yol (posting_key yok) satirlari icin.
drop index if exists public.idx_cash_entries_source_unique;
create unique index if not exists idx_cash_entries_source_unique
  on public.cash_entries (tenant_id, source_type, source_id, account_id)
  where source_id is not null and voided_at is null and posting_key is null;

-- ---------------------------------------------------------------------------
-- 2) cash_entries.source_type genisler (mevcut degerler aynen)
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in select con.conname from pg_catalog.pg_constraint con
            where con.conrelid = 'public.cash_entries'::regclass and con.contype = 'c'
              and pg_catalog.pg_get_constraintdef(con.oid) like '%source_type%' loop
    execute pg_catalog.format('alter table public.cash_entries drop constraint %I', c.conname);
  end loop;
  alter table public.cash_entries add constraint cash_entries_source_type_check
    check (source_type in ('manual', 'commission', 'rent', 'due', 'building', 'recurring', 'import', 'owner_payout',
                           'commission_payout', 'invoice', 'deposit', 'subscription'));
end $$;

-- ---------------------------------------------------------------------------
-- 3) Kayit kurallari (src/lib/finance/posting/rules.ts ile BIREBIR; pglite testi esler)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_posting_rules (
  event_type      text primary key check (event_type ~ '^[a-z_]+(\.[a-z_]+)?$'),
  label           text not null check (char_length(label) between 1 and 80),
  key_prefix      text not null check (key_prefix ~ '^[a-z_]+$'),
  source_type     text not null check (char_length(source_type) between 1 and 40),
  source_required boolean not null,
  item_mode       text not null check (item_mode in ('none', 'required', 'optional')),
  item_direction  text check (item_direction is null or item_direction in ('receivable', 'payable', 'either')),
  item_category   text,
  cash_mode       text not null check (cash_mode in ('none', 'required', 'optional')),
  cash_direction  text check (cash_direction is null or cash_direction in ('in', 'out', 'either', 'transfer')),
  cash_category   text,
  account_scope   text not null check (account_scope in ('office', 'user')),
  pnl             text not null check (pnl in ('income', 'expense', 'excluded', 'memo', 'conditional', 'none')),
  perm_module     text not null,
  perm_action     text not null check (perm_action in ('view', 'create', 'edit', 'delete')),
  owner_gm_only   boolean not null default false,
  tdhp            text not null,
  constraint finance_posting_rules_item_shape check ((item_mode = 'none') = (item_direction is null)),
  constraint finance_posting_rules_cash_shape check ((cash_mode = 'none') = (cash_direction is null))
);

insert into public.finance_posting_rules
  (event_type, label, key_prefix, source_type, source_required, item_mode, item_direction, item_category,
   cash_mode, cash_direction, cash_category, account_scope, pnl, perm_module, perm_action, owner_gm_only, tdhp)
values
  ('commission.accrued', 'Komisyon alacağı', 'commission', 'commission', true, 'required', 'receivable', 'komisyon',
   'none', null, null, 'office', 'income', 'commissions', 'edit', false, '120 / 600 + 391'),
  ('commission.split_accrued', 'Danışman hakedişi', 'split', 'commission_split', true, 'required', 'payable', 'danisman_hakedis',
   'none', null, null, 'office', 'expense', 'commissions', 'edit', false, '740/770 / 335/320'),
  ('commission.collected', 'Komisyon tahsilatı', 'commission', 'commission', true, 'none', null, null,
   'required', 'in', 'komisyon', 'office', 'none', 'commissions', 'edit', false, '102 / 120'),
  ('payout.paid', 'Hakediş ödemesi', 'payout', 'commission_payout', true, 'optional', 'payable', 'stopaj',
   'required', 'out', 'danisman_hakedis', 'office', 'none', 'commissions', 'edit', true, '335 / 102, 360'),
  ('payout.approved', 'Hakediş tahakkuku', 'payout', 'commission_payout', true, 'required', 'payable', 'danisman_hakedis',
   'none', null, null, 'office', 'expense', 'commissions', 'edit', true, '740/770 / 335'),
  ('payout.personal', 'Hakediş (Kasam)', 'payout', 'commission_payout', true, 'none', null, null,
   'required', 'in', 'danisman_hakedis', 'user', 'excluded', 'commissions', 'view', false, '-'),
  ('rent.accrued', 'Kira tahakkuku', 'rent_charge', 'rent_charge', true, 'none', null, null,
   'none', null, null, 'office', 'memo', 'rentals', 'view', false, 'memo'),
  ('rent.collected', 'Kira tahsilatı', 'rent', 'rent', true, 'optional', 'payable', 'mulk_sahibi_odeme',
   'required', 'in', 'kira_tahsilat', 'office', 'excluded', 'rentals', 'edit', false, '102/336, 336/600'),
  ('owner.paid', 'Mülk sahibi ödemesi', 'owner_payout', 'owner_payout', true, 'none', null, null,
   'required', 'out', 'mulk_sahibi_odeme', 'office', 'excluded', 'rentals', 'edit', false, '336 / 102'),
  ('deposit.received', 'Depozito alındı', 'deposit', 'deposit', true, 'required', 'payable', 'depozito',
   'required', 'in', 'depozito', 'office', 'excluded', 'rentals', 'edit', false, '102 / 336'),
  ('deposit.returned', 'Depozito iadesi', 'deposit', 'deposit', true, 'none', null, null,
   'required', 'out', 'depozito', 'office', 'excluded', 'rentals', 'edit', false, '102 / 336'),
  ('building.charged', 'Bina aidatı tahakkuku', 'building_charge', 'building_charge', true, 'required', 'receivable', 'aidat_tahsilat',
   'none', null, null, 'office', 'excluded', 'expenses', 'edit', false, '102 / 336'),
  ('building.collected', 'Bina aidatı tahsilatı', 'building', 'building', true, 'none', null, null,
   'required', 'in', 'aidat_tahsilat', 'office', 'excluded', 'expenses', 'edit', false, '102 / 336'),
  ('dues.accrued', 'Aidat borcu/alacağı', 'due', 'due', true, 'required', 'either', 'aidat',
   'none', null, null, 'office', 'conditional', 'expenses', 'create', false, '770'),
  ('dues.settled', 'Aidat ödemesi', 'due', 'due', true, 'none', null, null,
   'required', 'either', 'aidat', 'office', 'none', 'expenses', 'create', false, '770'),
  ('invoice.issued', 'Kesilen fatura', 'einvoice', 'invoice', true, 'optional', 'receivable', null,
   'none', null, null, 'office', 'income', 'expenses', 'create', false, '120/600/391'),
  ('invoice.received', 'Gelen fatura', 'invoice_in', 'invoice', false, 'required', 'payable', null,
   'optional', 'out', null, 'office', 'expense', 'expenses', 'create', false, '770 / 320 + 191'),
  ('expense.paid', 'Gider ödemesi', 'expense', 'manual', false, 'none', null, null,
   'required', 'out', null, 'office', 'expense', 'expenses', 'create', false, '770 / 100-102'),
  ('transfer', 'Hesaplar arası transfer', 'transfer', 'manual', false, 'none', null, null,
   'required', 'transfer', 'transfer', 'office', 'excluded', 'expenses', 'create', false, '102 / 100'),
  ('subscription.invoiced', 'Abonelik faturası', 'subscription', 'subscription', true, 'required', 'payable', 'yazilim',
   'none', null, null, 'office', 'expense', 'expenses', 'create', false, '770 / 320')
on conflict (event_type) do update set
  label = excluded.label, key_prefix = excluded.key_prefix, source_type = excluded.source_type,
  source_required = excluded.source_required, item_mode = excluded.item_mode, item_direction = excluded.item_direction,
  item_category = excluded.item_category, cash_mode = excluded.cash_mode, cash_direction = excluded.cash_direction,
  cash_category = excluded.cash_category, account_scope = excluded.account_scope, pnl = excluded.pnl,
  perm_module = excluded.perm_module, perm_action = excluded.perm_action, owner_gm_only = excluded.owner_gm_only,
  tdhp = excluded.tdhp;

-- Kural tablosu kod sabitidir: istemci dogrudan okumaz/yazmaz (rules.ts ayni veriyi tasir).
alter table public.finance_posting_rules enable row level security;
revoke all on public.finance_posting_rules from public, anon, authenticated;
grant select on public.finance_posting_rules to service_role;

-- ---------------------------------------------------------------------------
-- 4) Yardimcilar (istemciye kapali)
-- ---------------------------------------------------------------------------
-- Tarih kilitli aya dusuyorsa ilk acik ayin ilk gunu; degilse tarihin kendisi.
create or replace function public.finance_first_open_date(p_tenant uuid, p_date date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_m date;
  v_i integer := 0;
begin
  if p_date is null or not public.finance_period_is_locked(p_tenant, p_date) then return p_date; end if;
  v_m := pg_catalog.date_trunc('month', p_date)::date;
  loop
    v_m := (v_m + interval '1 month')::date;
    v_i := v_i + 1;
    exit when not public.finance_period_is_locked(p_tenant, v_m) or v_i >= 240;
  end loop;
  return v_m;
end;
$$;

-- Olay kaynagi tablosu (kaynak dogrulamasi icin; bilinmeyen tur = dogrulanmaz).
create or replace function public.finance_posting_source_table(p_source_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_source_type
    when 'commission' then 'commissions'
    when 'commission_split' then 'commission_splits'
    when 'commission_payout' then 'commission_payouts'
    when 'rent' then 'rent_payments'
    when 'rent_charge' then 'rent_charges'
    when 'owner_payout' then 'owner_payouts'
    when 'deposit' then 'rentals'
    when 'building_charge' then 'building_charges'
    when 'building' then 'building_payments'
    when 'due' then 'property_dues'
    when 'invoice' then 'einvoices'
    when 'subscription' then 'invoices'
    else null
  end;
$$;

create or replace function public.finance_posting_source_exists(p_tenant uuid, p_source_type text, p_source_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_table text := public.finance_posting_source_table(p_source_type);
  v_ok boolean;
begin
  if p_source_id is null then return false; end if;
  if v_table is null or pg_catalog.to_regclass('public.' || v_table) is null then return true; end if;
  execute pg_catalog.format('select exists (select 1 from public.%I s where s.id = $1 and s.tenant_id = $2)', v_table)
    into v_ok using p_source_id, p_tenant;
  return coalesce(v_ok, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Acik kalem odeme ilerlemesi (ayna kayitlarla)
--    Odenen = bagli iptal edilmemis hareketler (kalemle ayni yon +, ters yon -; tutar + stopaj) + iptal edilmemis ayna kalemler.
--    Ayna kalemin kendisi daima kapali (asliyla mahsup). Bugunku satirlarda sonuc ayni (bagli hareket daima ayni yonde).
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
  v_status text;
begin
  if p_id is null then return; end if;
  select * into v_item from public.finance_open_items o where o.id = p_id for update;
  if not found then return; end if;
  if v_item.reversal_of is not null then
    v_paid := v_item.amount;
  else
    select coalesce(sum(case when (e.direction = 'in') = (v_item.direction = 'receivable') then 1 else -1 end
                        * (e.amount + coalesce(e.withholding_amount, 0))), 0)
      into v_paid
      from public.cash_entries e where e.open_item_id = p_id and e.tenant_id = v_item.tenant_id and e.voided_at is null;
    v_paid := v_paid + coalesce((select sum(m.amount) from public.finance_open_items m
                                  where m.reversal_of = p_id and m.tenant_id = v_item.tenant_id and m.status <> 'cancelled'), 0);
    v_paid := greatest(v_paid, 0);
  end if;
  v_status := case when v_item.status = 'cancelled' then 'cancelled'
                   when v_paid >= v_item.amount then 'paid'
                   when v_paid > 0 then 'partial'
                   else 'open' end;
  update public.finance_open_items
     set paid_amount = v_paid, status = v_status
   where id = p_id and (paid_amount is distinct from v_paid or status is distinct from v_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Ic kayit servisi: tek transaction; hata = raise 'FN:<kod>' (cagiran donusturur); basari/tekrar jsonb doner.
--    p_event: {event_type, posting_key, date?, source_id?, party_id?, property_id?, title?, note?,
--              item?: {direction?, category?, amount, currency?, vat_rate?, vat_amount?, withholding_amount?, due_date?, invoice_id?, title?},
--              entries?: [{account_id, direction?, amount, category?, title?, counterparty?, vat_rate?, vat_amount?,
--                          withholding_amount?, settles? (acik kalem id ya da 'item')}]}
-- ---------------------------------------------------------------------------
create or replace function public.finance_post_internal(p_tenant uuid, p_actor uuid, p_event jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_type text;
  v_key text;
  r public.finance_posting_rules%rowtype;
  v_date date;
  v_source uuid;
  v_party uuid;
  v_property uuid;
  v_title text;
  v_note text;
  v_item jsonb;
  v_entries jsonb;
  v_dup_item uuid;
  v_dup_entries uuid[];
  v_reversed boolean;
  -- kalem
  v_item_id uuid;
  v_i_dir text;
  v_i_cat text;
  v_i_amount numeric;
  v_i_cur text;
  v_i_vat_rate numeric;
  v_i_vat numeric;
  v_i_wh numeric;
  v_i_issue date;
  v_i_due date;
  v_i_invoice uuid;
  v_i_title text;
  v_i_note text;
  v_redated boolean := false;
  -- hareket
  v_leg jsonb;
  v_n bigint;
  v_count integer;
  v_acc public.finance_accounts%rowtype;
  v_e_dir text;
  v_e_amount numeric;
  v_e_cat text;
  v_e_vat_rate numeric;
  v_e_vat numeric;
  v_e_wh numeric;
  v_e_settles text;
  v_e_item uuid;
  v_target public.finance_open_items%rowtype;
  v_group uuid;
  v_first_amount numeric;
  v_first_currency text;
  v_first_account uuid;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  if p_tenant is null or p_event is null or pg_catalog.jsonb_typeof(p_event) <> 'object' then
    perform public.finance_v2_raise('invalid_input');
  end if;
  v_type := nullif(pg_catalog.btrim(coalesce(p_event ->> 'event_type', '')), '');
  v_key := nullif(pg_catalog.btrim(coalesce(p_event ->> 'posting_key', '')), '');
  if v_type is null or v_key is null then perform public.finance_v2_raise('invalid_input'); end if;
  select * into r from public.finance_posting_rules pr where pr.event_type = v_type;
  if not found then perform public.finance_v2_raise('unknown_event'); end if;
  if r.item_mode = 'none' and r.cash_mode = 'none' then
    return jsonb_build_object('outcome', 'memo', 'entry_ids', '[]'::jsonb, 'open_item_id', null);
  end if;
  -- Anahtar: '<onek>:<parca>(:<parca>)*'; '#' bacak, ':rev' ayna icin ayrilmistir.
  if char_length(v_key) > 200 or v_key !~ ('^' || r.key_prefix || '(:[A-Za-z0-9_.-]+)+$') or v_key ~ ':rev$' then
    perform public.finance_v2_raise('invalid_key');
  end if;

  -- Ayni anahtar icin eszamanli cagrilar sirayla islenir; ikincisi `duplicate` gorur.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_tenant::text || '|' || v_key));
  select o.id into v_dup_item from public.finance_open_items o where o.tenant_id = p_tenant and o.posting_key = v_key;
  select pg_catalog.array_agg(e.id order by e.posting_key, e.id) into v_dup_entries
    from public.cash_entries e
   where e.tenant_id = p_tenant
     and (e.posting_key = v_key or pg_catalog.left(e.posting_key, char_length(v_key) + 1) = v_key || '#');
  if v_dup_item is not null or v_dup_entries is not null then
    v_reversed := exists (select 1 from public.finance_open_items o where o.id = v_dup_item
                            and (o.status = 'cancelled' or exists (select 1 from public.finance_open_items m where m.reversal_of = o.id)))
               or exists (select 1 from public.cash_entries e where e.id = any (coalesce(v_dup_entries, '{}'))
                            and (e.voided_at is not null or exists (select 1 from public.cash_entries m where m.reversal_of = e.id)));
    return jsonb_build_object('outcome', 'duplicate', 'open_item_id', v_dup_item,
      'entry_ids', pg_catalog.to_jsonb(coalesce(v_dup_entries, '{}'::uuid[])), 'reversed', v_reversed);
  end if;

  begin
    v_date := coalesce(nullif(p_event ->> 'date', '')::date, v_today);
    v_source := nullif(p_event ->> 'source_id', '')::uuid;
    v_party := nullif(p_event ->> 'party_id', '')::uuid;
    v_property := nullif(p_event ->> 'property_id', '')::uuid;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    perform public.finance_v2_raise('invalid_input');
  end;
  v_title := nullif(pg_catalog.btrim(coalesce(p_event ->> 'title', '')), '');
  v_note := nullif(pg_catalog.btrim(coalesce(p_event ->> 'note', '')), '');
  v_item := case when pg_catalog.jsonb_typeof(p_event -> 'item') = 'object' then p_event -> 'item' end;
  v_entries := case when pg_catalog.jsonb_typeof(p_event -> 'entries') = 'array'
                     and pg_catalog.jsonb_array_length(p_event -> 'entries') > 0 then p_event -> 'entries' end;

  if v_date < date '2000-01-01' or v_date > date '2100-12-31'
     or char_length(coalesce(v_title, '')) > 160 or char_length(coalesce(v_note, '')) > 900
     or (pg_catalog.jsonb_typeof(p_event -> 'item') is not null and pg_catalog.jsonb_typeof(p_event -> 'item') not in ('object', 'null'))
     or (pg_catalog.jsonb_typeof(p_event -> 'entries') is not null and pg_catalog.jsonb_typeof(p_event -> 'entries') not in ('array', 'null')) then
    perform public.finance_v2_raise('invalid_input');
  end if;
  if (r.item_mode = 'none' and v_item is not null) or (r.item_mode = 'required' and v_item is null)
     or (r.cash_mode = 'none' and v_entries is not null) or (r.cash_mode = 'required' and v_entries is null)
     or (v_item is null and v_entries is null) then
    perform public.finance_v2_raise('invalid_input');
  end if;
  if v_entries is not null and pg_catalog.jsonb_array_length(v_entries) <> (case when r.cash_direction = 'transfer' then 2 else 1 end) then
    perform public.finance_v2_raise('invalid_input');
  end if;

  -- Kaynak + cari + portfoy ayni ofisin kaydi olmali.
  if r.source_required and v_source is null then perform public.finance_v2_raise('invalid_input'); end if;
  if r.source_type = 'manual' and v_source is not null then perform public.finance_v2_raise('invalid_input'); end if;
  if v_source is not null and r.source_required and not public.finance_posting_source_exists(p_tenant, r.source_type, v_source) then
    perform public.finance_v2_raise('source_not_found');
  end if;
  if v_party is not null and not exists (select 1 from public.finance_parties p where p.id = v_party and p.tenant_id = p_tenant) then
    perform public.finance_v2_raise('party_not_found');
  end if;
  if v_property is not null and not exists (select 1 from public.properties pr where pr.id = v_property and pr.tenant_id = p_tenant) then
    perform public.finance_v2_raise('invalid_input');
  end if;

  -- ---------------- Acik kalem (tahakkuk) ----------------
  if v_item is not null then
    begin
      v_i_amount := nullif(v_item ->> 'amount', '')::numeric;
      v_i_vat_rate := nullif(v_item ->> 'vat_rate', '')::numeric;
      v_i_vat := nullif(v_item ->> 'vat_amount', '')::numeric;
      v_i_wh := nullif(v_item ->> 'withholding_amount', '')::numeric;
      v_i_due := nullif(v_item ->> 'due_date', '')::date;
      v_i_invoice := nullif(v_item ->> 'invoice_id', '')::uuid;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
      perform public.finance_v2_raise('invalid_input');
    end;
    v_i_dir := nullif(v_item ->> 'direction', '');
    if r.item_direction <> 'either' then
      if v_i_dir is not null and v_i_dir <> r.item_direction then perform public.finance_v2_raise('invalid_input'); end if;
      v_i_dir := r.item_direction;
    end if;
    if v_i_dir is null or v_i_dir not in ('receivable', 'payable') then perform public.finance_v2_raise('invalid_input'); end if;
    v_i_cat := nullif(pg_catalog.btrim(coalesce(v_item ->> 'category', '')), '');
    if r.item_category is not null then
      if v_i_cat is not null and v_i_cat <> r.item_category then perform public.finance_v2_raise('invalid_input'); end if;
      v_i_cat := r.item_category;
    end if;
    v_i_cat := coalesce(v_i_cat, case when v_i_dir = 'receivable' then 'diger_gelir' else 'diger_gider' end);
    if char_length(v_i_cat) > 40 then perform public.finance_v2_raise('invalid_input'); end if;
    perform public.finance_v2_check_category(p_tenant, v_i_cat, case when v_i_dir = 'receivable' then 'in' else 'out' end);
    v_i_cur := coalesce(nullif(v_item ->> 'currency', ''), 'TRY');
    if v_i_amount is null or v_i_amount < 0.01 or v_i_amount > 9999999999.99 or pg_catalog.round(v_i_amount, 2) <> v_i_amount
       or v_i_cur not in ('TRY', 'USD', 'EUR')
       or (v_i_vat_rate is not null and (v_i_vat_rate < 0 or v_i_vat_rate > 100))
       or (v_i_vat is not null and (v_i_vat < 0 or v_i_vat > v_i_amount or pg_catalog.round(v_i_vat, 2) <> v_i_vat))
       or (v_i_wh is not null and (v_i_wh < 0 or v_i_wh > v_i_amount or pg_catalog.round(v_i_wh, 2) <> v_i_wh)) then
      perform public.finance_v2_raise('invalid_input');
    end if;
    if v_i_vat is null and v_i_vat_rate is not null then
      select s.vat into v_i_vat from public.finance_vat_split(v_i_amount, v_i_vat_rate, true) s;
    end if;
    if v_i_invoice is not null and not exists (select 1 from public.einvoices x where x.id = v_i_invoice and x.tenant_id = p_tenant) then
      perform public.finance_v2_raise('invalid_input');
    end if;
    v_i_title := pg_catalog.left(coalesce(nullif(pg_catalog.btrim(coalesce(v_item ->> 'title', '')), ''), v_title, r.label), 160);
    v_i_note := v_note;
    v_i_issue := v_date;
    -- Kilitli aya dusen tahakkuk ilk acik aya tarihlenir; asil tarih notta kalir.
    if public.finance_period_is_locked(p_tenant, v_date) then
      v_i_issue := public.finance_first_open_date(p_tenant, v_date);
      v_redated := true;
      v_i_note := pg_catalog.left('Kilitli dönem: asıl tarih ' || pg_catalog.to_char(v_date, 'DD.MM.YYYY')
                                  || coalesce(' — ' || v_note, ''), 1000);
    end if;
    v_i_due := coalesce(v_i_due, v_i_issue);
    if v_i_due < v_i_issue then
      if v_redated then v_i_due := v_i_issue; else perform public.finance_v2_raise('invalid_input'); end if;
    end if;
    if v_i_due > date '2100-12-31' then perform public.finance_v2_raise('invalid_input'); end if;

    insert into public.finance_open_items (tenant_id, direction, party_id, title, category, amount, currency, vat_rate, vat_amount,
      withholding_amount, issue_date, due_date, source_type, source_id, property_id, note, created_by, posting_key, event_type, invoice_id)
    values (p_tenant, v_i_dir, v_party, v_i_title, v_i_cat, v_i_amount, v_i_cur, v_i_vat_rate, v_i_vat,
      v_i_wh, v_i_issue, v_i_due, r.source_type, v_source, v_property, v_i_note, p_actor, v_key, v_type, v_i_invoice)
    returning id into v_item_id;
  end if;

  -- ---------------- Nakit hareket(ler) ----------------
  if v_entries is not null then
    if v_date > v_today then perform public.finance_v2_raise('invalid_input'); end if;
    if r.cash_direction = 'transfer' then v_group := gen_random_uuid(); end if;
    v_count := 0;
    for v_leg, v_n in select x.value, x.ordinality from pg_catalog.jsonb_array_elements(v_entries) with ordinality x loop
      v_count := v_count + 1;
      if pg_catalog.jsonb_typeof(v_leg) <> 'object' then perform public.finance_v2_raise('invalid_input'); end if;
      begin
        select * into v_acc from public.finance_accounts a
         where a.id = nullif(v_leg ->> 'account_id', '')::uuid and a.tenant_id = p_tenant for share;
        v_e_amount := nullif(v_leg ->> 'amount', '')::numeric;
        v_e_vat_rate := nullif(v_leg ->> 'vat_rate', '')::numeric;
        v_e_vat := nullif(v_leg ->> 'vat_amount', '')::numeric;
        v_e_wh := nullif(v_leg ->> 'withholding_amount', '')::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
        perform public.finance_v2_raise('invalid_input');
      end;
      if v_acc.id is null then perform public.finance_v2_raise('account_not_found'); end if;
      if v_acc.archived_at is not null then perform public.finance_v2_raise('archived'); end if;
      if v_date < v_acc.opening_date then perform public.finance_v2_raise('before_opening'); end if;
      if v_acc.owner_scope <> r.account_scope then perform public.finance_v2_raise('invalid_input'); end if;

      v_e_dir := nullif(v_leg ->> 'direction', '');
      if r.cash_direction = 'transfer' then
        if v_e_dir is distinct from (case when v_count = 1 then 'out' else 'in' end) then perform public.finance_v2_raise('invalid_input'); end if;
      elsif r.cash_direction in ('in', 'out') then
        if v_e_dir is not null and v_e_dir <> r.cash_direction then perform public.finance_v2_raise('invalid_input'); end if;
        v_e_dir := r.cash_direction;
      end if;
      if v_e_dir is null or v_e_dir not in ('in', 'out') then perform public.finance_v2_raise('invalid_input'); end if;

      v_e_cat := nullif(pg_catalog.btrim(coalesce(v_leg ->> 'category', '')), '');
      if r.cash_category is not null then
        if v_e_cat is not null and v_e_cat <> r.cash_category then perform public.finance_v2_raise('invalid_input'); end if;
        v_e_cat := r.cash_category;
      end if;
      if v_e_cat is null or char_length(v_e_cat) > 40 then perform public.finance_v2_raise('invalid_input'); end if;
      if r.cash_direction <> 'transfer' then perform public.finance_v2_check_category(p_tenant, v_e_cat, v_e_dir); end if;

      if v_e_amount is null or v_e_amount < 0.01 or v_e_amount > 9999999999.99 or pg_catalog.round(v_e_amount, 2) <> v_e_amount
         or (v_e_vat_rate is not null and (v_e_vat_rate < 0 or v_e_vat_rate > 100))
         or (v_e_vat is not null and (v_e_vat < 0 or v_e_vat > v_e_amount or pg_catalog.round(v_e_vat, 2) <> v_e_vat))
         or (v_e_wh is not null and (v_e_wh < 0 or pg_catalog.round(v_e_wh, 2) <> v_e_wh))
         or char_length(coalesce(v_leg ->> 'title', '')) > 160 or char_length(coalesce(v_leg ->> 'counterparty', '')) > 120 then
        perform public.finance_v2_raise('invalid_input');
      end if;
      if r.cash_direction = 'transfer' then
        if v_count = 1 then
          v_first_amount := v_e_amount; v_first_currency := v_acc.currency; v_first_account := v_acc.id;
        elsif v_e_amount <> v_first_amount or v_acc.currency <> v_first_currency or v_acc.id = v_first_account then
          perform public.finance_v2_raise('invalid_input');
        end if;
      end if;

      -- Kapatilan acik kalem: ayni ofis, acik, yon uyumlu, ayni para birimi, ofis hesabi, kalan tutari asmaz.
      v_e_item := null;
      v_e_settles := nullif(v_leg ->> 'settles', '');
      if v_e_settles is not null then
        if r.cash_direction = 'transfer' or v_acc.owner_scope <> 'office' then perform public.finance_v2_raise('invalid_input'); end if;
        if v_e_settles = 'item' then
          if v_item_id is null then perform public.finance_v2_raise('invalid_input'); end if;
          v_e_item := v_item_id;
        else
          begin
            v_e_item := v_e_settles::uuid;
          exception when invalid_text_representation then
            perform public.finance_v2_raise('invalid_input');
          end;
        end if;
        select * into v_target from public.finance_open_items o where o.id = v_e_item and o.tenant_id = p_tenant for update;
        if not found then perform public.finance_v2_raise('not_found'); end if;
        if v_target.status not in ('open', 'partial') or v_target.reversal_of is not null then perform public.finance_v2_raise('item_closed'); end if;
        if (v_target.direction = 'receivable') <> (v_e_dir = 'in') or v_target.currency <> v_acc.currency then
          perform public.finance_v2_raise('invalid_input');
        end if;
        if v_e_amount + coalesce(v_e_wh, 0) > v_target.amount - v_target.paid_amount + 0.005 then
          perform public.finance_v2_raise('amount_exceeds_open');
        end if;
      end if;

      -- Kapanmis ayin kasasi hicbir yoldan degismez (ofis hesabi); tetik de reddeder, burada okunur kod doner.
      if v_acc.owner_scope = 'office' and public.finance_period_is_locked(p_tenant, v_date) then
        perform public.finance_v2_raise('period_locked');
      end if;

      insert into public.cash_entries (tenant_id, account_id, direction, amount, currency, entry_date, kind, category, title,
        counterparty, note, transfer_group_id, source_type, source_id, created_by, party_id, vat_rate, vat_amount,
        withholding_amount, property_id, open_item_id, posting_key, event_type)
      values (p_tenant, v_acc.id, v_e_dir, v_e_amount, v_acc.currency, v_date,
        case when r.cash_direction = 'transfer' then 'transfer' when v_e_dir = 'in' then 'income' else 'expense' end,
        v_e_cat,
        pg_catalog.left(coalesce(nullif(pg_catalog.btrim(coalesce(v_leg ->> 'title', '')), ''), v_title, r.label), 160),
        coalesce(nullif(pg_catalog.btrim(coalesce(v_leg ->> 'counterparty', '')), ''),
                 (select pt.name from public.finance_parties pt where pt.id = v_party)),
        v_note, v_group, r.source_type, v_source, p_actor,
        case when r.cash_direction = 'transfer' then null else v_party end,
        v_e_vat_rate, v_e_vat, v_e_wh, v_property, v_e_item,
        case when v_n = 1 then v_key else v_key || '#' || v_n::text end, v_type)
      returning id into v_id;
      v_ids := v_ids || v_id;
    end loop;
  end if;

  return jsonb_build_object('outcome', 'posted', 'open_item_id', v_item_id, 'entry_ids', pg_catalog.to_jsonb(v_ids),
                            'redated', v_redated, 'issue_date', v_i_issue);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Oturum kapisi: finance_post(p_event) — kural modulu yetkisi, readonly reddi, owner/gm, maas, P12, hesap erisimi.
-- ---------------------------------------------------------------------------
create or replace function public.finance_post(p_event jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  r public.finance_posting_rules%rowtype;
  v_ev jsonb := p_event;
  v_party uuid;
  v_kind text;
  v_leg jsonb;
  v_acc public.finance_accounts%rowtype;
  v_item public.finance_open_items%rowtype;
  v_all boolean;
  v_gm boolean;
  v_cat text;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if p_event is null or pg_catalog.jsonb_typeof(p_event) <> 'object' then return jsonb_build_object('outcome', 'invalid_input'); end if;
  select * into r from public.finance_posting_rules pr where pr.event_type = p_event ->> 'event_type';
  if not found then return jsonb_build_object('outcome', 'unknown_event'); end if;
  if public.current_profile_role() = 'readonly' or not public.has_effective_permission(r.perm_module, r.perm_action) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  v_gm := public.finance_is_owner_gm();
  if r.owner_gm_only and not v_gm then return jsonb_build_object('outcome', 'forbidden'); end if;
  v_all := public.has_effective_permission('earnings_all', 'view');

  begin
    -- Cari: id (P12 kapisi finance_v2_resolve_party icinde) ya da ad (yoksa acilir; expenses:create ister).
    if nullif(p_event ->> 'party_id', '') is not null or nullif(pg_catalog.btrim(coalesce(p_event ->> 'party_name', '')), '') is not null then
      v_kind := coalesce(nullif(p_event ->> 'party_kind', ''),
                         case when coalesce(p_event #>> '{item,direction}', r.item_direction, '') = 'payable'
                                or coalesce(p_event #>> '{entries,0,direction}', r.cash_direction, '') = 'out'
                              then 'tedarikci' else 'musteri' end);
      begin
        v_party := public.finance_v2_resolve_party(v_tenant, nullif(p_event ->> 'party_id', '')::uuid, p_event ->> 'party_name', v_kind);
      exception when invalid_text_representation then
        return jsonb_build_object('outcome', 'invalid_input');
      end;
    end if;
    v_ev := (v_ev - 'party_name' - 'party_kind') || jsonb_build_object('party_id', v_party);

    -- Kalem kategorisi maas ise yalniz owner/gm.
    v_cat := coalesce(r.item_category, p_event #>> '{item,category}');
    if v_cat = 'maas' and not v_gm then return jsonb_build_object('outcome', 'forbidden'); end if;

    if pg_catalog.jsonb_typeof(p_event -> 'entries') = 'array' then
      for v_leg in select x from pg_catalog.jsonb_array_elements(p_event -> 'entries') x loop
        if pg_catalog.jsonb_typeof(v_leg) <> 'object' then return jsonb_build_object('outcome', 'invalid_input'); end if;
        begin
          select * into v_acc from public.finance_accounts a
           where a.id = nullif(v_leg ->> 'account_id', '')::uuid and a.tenant_id = v_tenant;
        exception when invalid_text_representation then
          return jsonb_build_object('outcome', 'invalid_input');
        end;
        if v_acc.id is null then return jsonb_build_object('outcome', 'account_not_found'); end if;
        -- Kisisel hesap yalniz sahibine; ofis hesabinda Muhasebe olaylari hesap yetkisi, kaynak modulu olaylari modul yetkisi ister.
        if (v_acc.owner_scope = 'user' or r.perm_module = 'expenses') and not public.finance_account_access(v_acc.id, 'create') then
          return jsonb_build_object('outcome', 'forbidden');
        end if;
        v_cat := coalesce(r.cash_category, v_leg ->> 'category');
        if v_acc.owner_scope = 'office' and v_cat = 'maas' and not v_gm then return jsonb_build_object('outcome', 'forbidden'); end if;
        if nullif(v_leg ->> 'settles', '') is not null and v_leg ->> 'settles' <> 'item' then
          begin
            select * into v_item from public.finance_open_items o where o.id = (v_leg ->> 'settles')::uuid and o.tenant_id = v_tenant;
          exception when invalid_text_representation then
            return jsonb_build_object('outcome', 'invalid_input');
          end;
          if v_item.id is null
             or (v_item.party_id is not null and not v_all and public.finance_party_foreign_advisor(v_item.party_id)) then
            return jsonb_build_object('outcome', 'not_found');
          end if;
          if v_item.category = 'maas' and not v_gm then return jsonb_build_object('outcome', 'forbidden'); end if;
        end if;
      end loop;
    end if;

    return public.finance_post_internal(v_tenant, v_uid, v_ev);
  exception
    when unique_violation then
      return jsonb_build_object('outcome', 'duplicate');
    when sqlstate 'P0001' then
      if sqlerrm like 'FN:%' then return jsonb_build_object('outcome', pg_catalog.substr(sqlerrm, 4)); end if;
      if sqlerrm = 'DONEM_KILITLI' then return jsonb_build_object('outcome', 'period_locked'); end if;
      raise;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Ters kayit: acik donemde iptal; kilitli donemde ilk acik aya reversal_of bagli ayna. Hicbir sey silinmez.
-- ---------------------------------------------------------------------------
create or replace function public.finance_reverse_internal(p_tenant uuid, p_actor uuid, p_target uuid, p_reason text, p_date date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_e public.cash_entries%rowtype;
  v_leg public.cash_entries%rowtype;
  v_o public.finance_open_items%rowtype;
  v_locked boolean := false;
  v_ids uuid[] := '{}';
  v_rev uuid[] := '{}';
  v_id uuid;
  v_mdate date;
begin
  if p_tenant is null or p_target is null or char_length(v_reason) not between 3 and 300
     or p_date < date '2000-01-01' or p_date > date '2100-12-31' then
    perform public.finance_v2_raise('invalid_input');
  end if;

  select * into v_e from public.cash_entries e where e.id = p_target and e.tenant_id = p_tenant for update;
  if found then
    if v_e.reversal_of is not null then perform public.finance_v2_raise('invalid_input'); end if;
    if v_e.voided_at is not null or exists (select 1 from public.cash_entries m where m.reversal_of = v_e.id) then
      return jsonb_build_object('outcome', 'already_reversed', 'entry_ids', pg_catalog.to_jsonb(array[v_e.id]));
    end if;
    -- Eski gider kaydi ureten hareket eski iptal yolundan (finance_void_entry) geri alinir.
    if v_e.expense_id is not null and v_e.created_expense then perform public.finance_v2_raise('legacy_expense_linked'); end if;

    -- Transferin iki bacagi birlikte geri alinir.
    v_locked := exists (
      select 1 from public.cash_entries e
       where e.tenant_id = p_tenant and e.voided_at is null
         and (e.id = v_e.id or (v_e.transfer_group_id is not null and e.transfer_group_id = v_e.transfer_group_id))
         and public.finance_account_is_office(e.account_id) and public.finance_period_is_locked(p_tenant, e.entry_date));

    if not v_locked then
      for v_leg in
        select * from public.cash_entries e
         where e.tenant_id = p_tenant and e.voided_at is null
           and (e.id = v_e.id or (v_e.transfer_group_id is not null and e.transfer_group_id = v_e.transfer_group_id))
         order by e.created_at, e.id
         for update
      loop
        update public.cash_entries set voided_at = pg_catalog.now(), voided_by = p_actor, void_reason = v_reason where id = v_leg.id;
        v_ids := v_ids || v_leg.id;
      end loop;
      return jsonb_build_object('outcome', 'voided', 'entry_ids', pg_catalog.to_jsonb(v_ids), 'reversal_ids', '[]'::jsonb);
    end if;

    -- Ayna tarihi: istenen tarih (yoksa asil tarih; asil tarihten once olamaz); kilitliyse ilk acik ayin ilk gunu.
    -- Nakit gelecege yazilmaz.
    v_mdate := public.finance_first_open_date(p_tenant, greatest(coalesce(p_date, v_e.entry_date), v_e.entry_date));
    if v_mdate > v_today then
      perform public.finance_v2_raise('no_open_period');
    end if;
    for v_leg in
      select * from public.cash_entries e
       where e.tenant_id = p_tenant and e.voided_at is null
         and (e.id = v_e.id or (v_e.transfer_group_id is not null and e.transfer_group_id = v_e.transfer_group_id))
       order by e.created_at, e.id
       for update
    loop
      insert into public.cash_entries (tenant_id, account_id, direction, amount, currency, entry_date, kind, category, title,
        counterparty, note, source_type, source_id, created_by, party_id, vat_rate, vat_amount, vat_included,
        withholding_rate, withholding_amount, property_id, open_item_id, posting_key, event_type, reversal_of)
      values (p_tenant, v_leg.account_id, case when v_leg.direction = 'in' then 'out' else 'in' end, v_leg.amount, v_leg.currency,
        v_mdate, 'adjust', v_leg.category, pg_catalog.left('Ters kayıt: ' || v_leg.title, 160), v_leg.counterparty,
        pg_catalog.left(v_reason, 1000), v_leg.source_type, v_leg.source_id, p_actor, v_leg.party_id, v_leg.vat_rate,
        v_leg.vat_amount, v_leg.vat_included, v_leg.withholding_rate, v_leg.withholding_amount, v_leg.property_id,
        v_leg.open_item_id, pg_catalog.left(coalesce(v_leg.posting_key, 'entry:' || v_leg.id::text), 200) || ':rev',
        v_leg.event_type, v_leg.id)
      returning id into v_id;
      v_ids := v_ids || v_leg.id;
      v_rev := v_rev || v_id;
    end loop;
    return jsonb_build_object('outcome', 'mirrored', 'entry_ids', pg_catalog.to_jsonb(v_ids),
                              'reversal_ids', pg_catalog.to_jsonb(v_rev), 'reversal_date', v_mdate);
  end if;

  select * into v_o from public.finance_open_items o where o.id = p_target and o.tenant_id = p_tenant for update;
  if not found then perform public.finance_v2_raise('not_found'); end if;
  if v_o.reversal_of is not null then perform public.finance_v2_raise('invalid_input'); end if;
  if v_o.status = 'cancelled' or exists (select 1 from public.finance_open_items m where m.reversal_of = v_o.id) then
    return jsonb_build_object('outcome', 'already_reversed', 'open_item_id', v_o.id);
  end if;
  -- Tahsil/odeme gormus kalem once hareketleri geri alinarak geri alinir.
  if v_o.paid_amount > 0 then perform public.finance_v2_raise('has_settlements'); end if;

  if not public.finance_period_is_locked(p_tenant, v_o.issue_date) then
    update public.finance_open_items
       set status = 'cancelled', cancelled_at = pg_catalog.now(), cancel_reason = v_reason
     where id = v_o.id;
    return jsonb_build_object('outcome', 'cancelled', 'open_item_id', v_o.id, 'reversal_ids', '[]'::jsonb);
  end if;

  v_mdate := public.finance_first_open_date(p_tenant, greatest(coalesce(p_date, v_o.issue_date), v_o.issue_date));
  insert into public.finance_open_items (tenant_id, direction, party_id, title, category, amount, currency, vat_rate, vat_amount,
    withholding_amount, issue_date, due_date, source_type, source_id, property_id, note, created_by, posting_key, event_type, reversal_of)
  values (p_tenant, case when v_o.direction = 'receivable' then 'payable' else 'receivable' end, v_o.party_id,
    pg_catalog.left('Ters kayıt: ' || v_o.title, 160), v_o.category, v_o.amount, v_o.currency, v_o.vat_rate, v_o.vat_amount,
    v_o.withholding_amount, v_mdate, v_mdate, v_o.source_type, v_o.source_id, v_o.property_id, pg_catalog.left(v_reason, 1000),
    p_actor, pg_catalog.left(coalesce(v_o.posting_key, 'item:' || v_o.id::text), 200) || ':rev', v_o.event_type, v_o.id)
  returning id into v_id;
  perform public.finance_open_item_recompute(v_id);
  perform public.finance_open_item_recompute(v_o.id);
  return jsonb_build_object('outcome', 'mirrored', 'open_item_id', v_o.id, 'reversal_ids', pg_catalog.to_jsonb(array[v_id]),
                            'reversal_date', v_mdate);
end;
$$;

create or replace function public.finance_reverse(p_target uuid, p_reason text, p_date date default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_gm boolean;
  v_e public.cash_entries%rowtype;
  v_o public.finance_open_items%rowtype;
  r public.finance_posting_rules%rowtype;
  v_ok boolean;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if p_target is null then return jsonb_build_object('outcome', 'invalid_input'); end if;
  if public.current_profile_role() = 'readonly' then return jsonb_build_object('outcome', 'forbidden'); end if;
  v_gm := public.finance_is_owner_gm();

  select * into v_e from public.cash_entries e where e.id = p_target and e.tenant_id = v_tenant;
  if found then
    select * into r from public.finance_posting_rules pr where pr.event_type = v_e.event_type;
    -- Hesap erisimi (kisisel hesap yalniz sahibine; transferin her bacagi icin) + kaynak modulu yetkisi.
    v_ok := not exists (
      select 1 from public.cash_entries e
       where e.tenant_id = v_tenant
         and (e.id = v_e.id or (v_e.transfer_group_id is not null and e.transfer_group_id = v_e.transfer_group_id))
         and not (case when public.finance_account_is_office(e.account_id) and r.event_type is not null and r.perm_module <> 'expenses'
                       then true else public.finance_account_access(e.account_id, 'delete') end));
    if not v_ok then return jsonb_build_object('outcome', 'forbidden'); end if;
    if r.event_type is not null and public.finance_account_is_office(v_e.account_id) then
      if not public.has_effective_permission(r.perm_module, case when r.perm_module = 'commissions' then 'edit' else 'delete' end)
         or (r.owner_gm_only and not v_gm) then
        return jsonb_build_object('outcome', 'forbidden');
      end if;
    end if;
    if public.finance_account_is_office(v_e.account_id) and v_e.category = 'maas' and not v_gm then
      return jsonb_build_object('outcome', 'forbidden');
    end if;
  else
    select * into v_o from public.finance_open_items o where o.id = p_target and o.tenant_id = v_tenant;
    if not found
       or (v_o.party_id is not null and not public.has_effective_permission('earnings_all', 'view')
           and public.finance_party_foreign_advisor(v_o.party_id)) then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    select * into r from public.finance_posting_rules pr where pr.event_type = v_o.event_type;
    if not public.has_effective_permission(coalesce(r.perm_module, 'expenses'),
                                           case when r.perm_module = 'commissions' then 'edit' else 'delete' end)
       or (r.owner_gm_only and not v_gm) or (v_o.category = 'maas' and not v_gm) then
      return jsonb_build_object('outcome', 'forbidden');
    end if;
  end if;

  begin
    return public.finance_reverse_internal(v_tenant, v_uid, p_target, p_reason, p_date);
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FN:%' then return jsonb_build_object('outcome', pg_catalog.substr(sqlerrm, 4)); end if;
      if sqlerrm = 'DONEM_KILITLI' then return jsonb_build_object('outcome', 'period_locked'); end if;
      raise;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) Denetim: cash_entries (yalniz ofis hesabi; Kasam kisiseldir) + finance_open_items
-- ---------------------------------------------------------------------------
create or replace function public.finance_ledger_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_entity text;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_table_name = 'cash_entries' then
    if not public.finance_account_is_office(new.account_id) then return null; end if;
    v_entity := 'cash_entry';
    if tg_op = 'INSERT' then
      v_action := case when new.reversal_of is not null then 'finance.cash_entry.reverse' else 'finance.cash_entry.insert' end;
    elsif old.voided_at is null and new.voided_at is not null then
      v_action := 'finance.cash_entry.void';
    elsif new.amount is distinct from old.amount or new.entry_date is distinct from old.entry_date
       or new.direction is distinct from old.direction or new.account_id is distinct from old.account_id
       or new.category is distinct from old.category or new.open_item_id is distinct from old.open_item_id
       or new.vat_amount is distinct from old.vat_amount or new.withholding_amount is distinct from old.withholding_amount then
      v_action := 'finance.cash_entry.update';
      v_old := jsonb_build_object('amount', old.amount, 'direction', old.direction, 'entry_date', old.entry_date,
        'account_id', old.account_id, 'category', old.category, 'open_item_id', old.open_item_id);
    else
      return null;
    end if;
    v_new := jsonb_build_object('amount', new.amount, 'direction', new.direction, 'entry_date', new.entry_date,
      'account_id', new.account_id, 'category', new.category, 'source_type', new.source_type, 'source_id', new.source_id,
      'posting_key', new.posting_key, 'event_type', new.event_type, 'reversal_of', new.reversal_of,
      'open_item_id', new.open_item_id, 'void_reason', new.void_reason);
  else
    v_entity := 'finance_open_item';
    if tg_op = 'INSERT' then
      v_action := case when new.reversal_of is not null then 'finance.open_item.reverse' else 'finance.open_item.insert' end;
    elsif old.cancelled_at is null and new.cancelled_at is not null then
      v_action := 'finance.open_item.cancel';
    elsif new.amount is distinct from old.amount or new.issue_date is distinct from old.issue_date
       or new.due_date is distinct from old.due_date or new.direction is distinct from old.direction
       or new.party_id is distinct from old.party_id or new.vat_amount is distinct from old.vat_amount
       or new.withholding_amount is distinct from old.withholding_amount or new.invoice_id is distinct from old.invoice_id then
      v_action := 'finance.open_item.update';
      v_old := jsonb_build_object('amount', old.amount, 'direction', old.direction, 'issue_date', old.issue_date,
        'due_date', old.due_date, 'party_id', old.party_id, 'invoice_id', old.invoice_id);
    else
      return null; -- odeme ilerlemesi (paid_amount/status) turetilmis alandir
    end if;
    v_new := jsonb_build_object('amount', new.amount, 'direction', new.direction, 'issue_date', new.issue_date,
      'due_date', new.due_date, 'party_id', new.party_id, 'category', new.category, 'source_type', new.source_type,
      'source_id', new.source_id, 'posting_key', new.posting_key, 'event_type', new.event_type,
      'reversal_of', new.reversal_of, 'invoice_id', new.invoice_id, 'cancel_reason', new.cancel_reason);
  end if;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (new.tenant_id, auth.uid(), v_action, v_entity, new.id, v_old, v_new);
  return null;
end;
$$;

drop trigger if exists trg_cash_entries_audit on public.cash_entries;
create trigger trg_cash_entries_audit
  after insert or update on public.cash_entries
  for each row execute function public.finance_ledger_audit();
drop trigger if exists trg_finance_open_items_audit on public.finance_open_items;
create trigger trg_finance_open_items_audit
  after insert or update on public.finance_open_items
  for each row execute function public.finance_ledger_audit();

-- ---------------------------------------------------------------------------
-- 10) Yetkiler
-- ---------------------------------------------------------------------------
revoke all on function public.finance_first_open_date(uuid, date) from public, anon, authenticated;
revoke all on function public.finance_posting_source_table(text) from public, anon, authenticated;
revoke all on function public.finance_posting_source_exists(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.finance_open_item_recompute(uuid) from public, anon, authenticated;
revoke all on function public.finance_post_internal(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finance_reverse_internal(uuid, uuid, uuid, text, date) from public, anon, authenticated;
revoke all on function public.finance_ledger_audit() from public, anon, authenticated;
revoke all on function public.finance_post(jsonb) from public, anon;
revoke all on function public.finance_reverse(uuid, text, date) from public, anon;
grant execute on function public.finance_first_open_date(uuid, date) to service_role;
grant execute on function public.finance_posting_source_table(text) to service_role;
grant execute on function public.finance_posting_source_exists(uuid, text, uuid) to service_role;
grant execute on function public.finance_open_item_recompute(uuid) to service_role;
grant execute on function public.finance_post_internal(uuid, uuid, jsonb) to service_role;
grant execute on function public.finance_reverse_internal(uuid, uuid, uuid, text, date) to service_role;
grant execute on function public.finance_post(jsonb) to authenticated, service_role;
grant execute on function public.finance_reverse(uuid, text, date) to authenticated, service_role;

comment on table public.finance_posting_rules is
  'Kayit kurallari (olay turu -> acik kalem / nakit / K/Z / TDHP). src/lib/finance/posting/rules.ts aynasi; yalniz definer fonksiyonlar okur.';
comment on column public.cash_entries.posting_key is 'Olay anahtari (kiraci basina tekil; ikinci bacak #2, ayna :rev). Eski yol satirlarinda null.';
comment on column public.finance_open_items.posting_key is 'Olay anahtari (kiraci basina tekil; ayna :rev). Elle kalemlerde null.';
comment on column public.cash_entries.reversal_of is 'Kilitli donem ters kaydi: asil hareket (ayna ters yonde, kind adjust).';
comment on column public.finance_open_items.reversal_of is 'Kilitli donem ters kaydi: asil kalem (ayna ters yonde, asliyla mahsup kapali).';
comment on function public.finance_post(jsonb) is
  'Tek kayit servisi: {outcome, entry_ids, open_item_id}. Ayni posting_key ile tekrar cagri duplicate. Kural: finance_posting_rules.';
comment on function public.finance_reverse(uuid, text, date) is
  'Ters kayit: acik donemde iptal (voided/cancelled); kilitli donemde ilk acik aya reversal_of bagli ayna (mirrored). Silme yok.';
