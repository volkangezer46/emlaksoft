-- UYGULANMADI (canlıya henüz uygulanmadı; sahibin onayı + yedek doğrulaması sonrası `npm run db:migrate`).
--
-- Finans v2 (FN1) — 2/3 RPC'ler. 20261014001000 (şema) SONRASI.
-- Hepsi SECURITY DEFINER + search_path=''; kiracı = current_active_tenant_id() (JWT), yetki `expenses` modülü
-- (view / create / edit / delete); maaş (category='maas') yalnız owner/gm (finance_is_owner_gm). Okuma RPC'leri kiracı
-- süzgecini AÇIKÇA uygular (definer RLS'i atlar). Hata sözleşmesi: `raise exception 'FN:<kod>'` (P0001); dönem kilidi
-- tetikten `DONEM_KILITLI` gelir. TS katmanı (src/app/actions/finance-ledger.ts) kodları Türkçe mesaja çevirir.
-- v2 kayıt/güncelleme ESKİ finance_record_entry / finance_update_entry / finance_transfer'i SARAR (imza ve gövdeleri DEĞİŞMEZ):
--   Kasam, komisyon/kira/aidat tahsilatı, düzenli ödeme döngüsü ve ekstre aynı yoldan yazmaya devam eder.
-- KDV/stopaj hesabı tek yerde: finance_vat_split + finance_entry_amounts (src/lib/finance/ledger/vat.ts ile birebir; test edilir).
--   Belge tutarı (vat_included ? KDV dahil : KDV hariç) → net, KDV, brüt; stopaj = round(net × oran / 100);
--   hesaptan çıkan/giren nakit = brüt − stopaj.
-- Para tutarları numeric; TRY dönüşümü p_rates jsonb ({"USD": 41.2, "EUR": 47.9}) ile; kur yoksa o para birimi toplanmaz.
-- GERİ ALMA: supabase/rollbacks/20261014001100_finance_ledger_v2_rpc.rollback.sql (yalnız bu dosyanın fonksiyonları düşer).
-- RİSK: düşük (yalnız yeni fonksiyonlar; mevcut fonksiyonlara dokunulmaz).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.finance_parties') is null
     or pg_catalog.to_regclass('public.finance_open_items_v') is null
     or pg_catalog.to_regprocedure('public.finance_record_entry(uuid,text,numeric,date,text,text,text,text,text,text,uuid,boolean,text,uuid)') is null
     or pg_catalog.to_regprocedure('public.finance_update_entry(uuid,numeric,date,text,text,text,text,text,text)') is null
     or pg_catalog.to_regprocedure('public.finance_transfer(uuid,uuid,numeric,date,text)') is null
     or pg_catalog.to_regprocedure('public.finance_account_balances()') is null
     or pg_catalog.to_regprocedure('public.finance_account_access(uuid,text)') is null then
    raise exception '20261014001100: önce 20261014001000 (finans v2 şema) ve 20261010000600 uygulanmalı.';
  end if;
end $$;

-- ===========================================================================
-- Yardımcılar (istemciye kapalı; yalnız definer gövdelerinden çağrılır)
-- ===========================================================================
create or replace function public.finance_v2_raise(p_code text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  raise exception 'FN:%', coalesce(p_code, 'error') using errcode = 'P0001';
end;
$$;

-- Oturum + kiracı + `expenses:<p_level>` kapısı; kiracıyı döner. Yazma seviyelerinde salt-okunur rol reddedilir.
create or replace function public.finance_v2_ctx(p_level text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if auth.uid() is null then perform public.finance_v2_raise('unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then perform public.finance_v2_raise('unauthorized'); end if;
  if p_level <> 'view' and public.current_profile_role() = 'readonly' then perform public.finance_v2_raise('forbidden'); end if;
  if not public.has_effective_permission('expenses', p_level) then perform public.finance_v2_raise('forbidden'); end if;
  return v_tenant;
end;
$$;

-- Para birimi → TL çarpanı (TRY = 1; diğerleri p_rates'ten; yoksa/geçersizse null).
create or replace function public.finance_fx(p_currency text, p_rates jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_currency is null or p_currency = 'TRY' then 1::numeric
    when p_rates is not null and pg_catalog.jsonb_typeof(p_rates -> p_currency) = 'number' and (p_rates ->> p_currency)::numeric > 0
      then (p_rates ->> p_currency)::numeric
    else null
  end;
$$;

-- KDV ayrıştırma (vat.ts splitVat ile birebir): dahil → brüt sabit, net = round(brüt×100/(100+oran)); hariç → net sabit, KDV = round(net×oran/100).
create or replace function public.finance_vat_split(p_amount numeric, p_rate numeric, p_included boolean)
returns table (net numeric, vat numeric, gross numeric)
language sql
immutable
set search_path = ''
as $$
  select s.net, s.gross - s.net, s.gross
  from (
    select case when coalesce(p_included, true)
                then pg_catalog.round(pg_catalog.round(p_amount, 2) * 100 / (100 + coalesce(p_rate, 0)), 2)
                else pg_catalog.round(p_amount, 2) end as net,
           case when coalesce(p_included, true)
                then pg_catalog.round(p_amount, 2)
                else pg_catalog.round(p_amount, 2) + pg_catalog.round(pg_catalog.round(p_amount, 2) * coalesce(p_rate, 0) / 100, 2) end as gross
  ) s;
$$;

-- Hareket tutarları: belge tutarı + KDV (null = bilinmiyor) + stopaj → nakit (vat.ts entryAmounts ile birebir).
create or replace function public.finance_entry_amounts(p_amount numeric, p_vat_rate numeric, p_included boolean, p_wh_rate numeric)
returns table (net numeric, vat numeric, gross numeric, withheld numeric, cash numeric)
language sql
immutable
set search_path = ''
as $$
  select v.net,
         case when p_vat_rate is null then null else v.vat end,
         v.gross,
         case when p_wh_rate is null then null else pg_catalog.round(v.net * p_wh_rate / 100, 2) end,
         v.gross - coalesce(case when p_wh_rate is null then null else pg_catalog.round(v.net * p_wh_rate / 100, 2) end, 0)
  from public.finance_vat_split(p_amount, case when p_vat_rate is null then 0 else p_vat_rate end,
                                case when p_vat_rate is null then true else p_included end) v;
$$;

-- Cari çözümü: id verilirse aynı ofisin carisi olmalı; ad verilirse (büyük/küçük harf duyarsız) var olan kullanılır, yoksa açılır.
create or replace function public.finance_v2_resolve_party(p_tenant uuid, p_party_id uuid, p_name text, p_kind text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_kind text := coalesce(nullif(pg_catalog.btrim(coalesce(p_kind, '')), ''), 'diger');
begin
  if p_party_id is not null then
    select p.id into v_id from public.finance_parties p where p.id = p_party_id and p.tenant_id = p_tenant;
    if v_id is null then perform public.finance_v2_raise('party_not_found'); end if;
    return v_id;
  end if;
  if v_name = '' then return null; end if;
  if char_length(v_name) > 120 or v_kind not in ('musteri', 'malik', 'kiraci', 'tedarikci', 'danisman', 'diger') then
    perform public.finance_v2_raise('invalid_input');
  end if;
  select p.id into v_id from public.finance_parties p
   where p.tenant_id = p_tenant and pg_catalog.lower(p.name) = pg_catalog.lower(v_name) and p.archived_at is null
   order by (p.kind = v_kind) desc, p.created_at
   limit 1;
  if v_id is not null then return v_id; end if;
  if not public.has_effective_permission('expenses', 'create') then perform public.finance_v2_raise('forbidden'); end if;
  insert into public.finance_parties (tenant_id, kind, name, created_by)
  values (p_tenant, v_kind, v_name, auth.uid())
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select p.id into v_id from public.finance_parties p
     where p.tenant_id = p_tenant and pg_catalog.lower(p.name) = pg_catalog.lower(v_name) and p.kind = v_kind and p.archived_at is null;
  end if;
  return v_id;
end;
$$;

-- Ofis kategorisi doğrulaması: 'x_' ile başlayan anahtar o ofiste, o yönde, arşivde olmayan bir kategori olmalı.
create or replace function public.finance_v2_check_category(p_tenant uuid, p_category text, p_direction text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_category is not null and p_category like 'x\_%' and not exists (
    select 1 from public.finance_categories c
     where c.tenant_id = p_tenant and c.key = p_category and c.direction = p_direction and c.archived_at is null
  ) then
    perform public.finance_v2_raise('invalid_category');
  end if;
end;
$$;

-- ===========================================================================
-- Hareket
-- ===========================================================================
create or replace function public.finance_record_entry_v2(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_dir text := p ->> 'direction';
  v_account uuid;
  v_to_account uuid;
  v_amount numeric;
  v_date date;
  v_cat text := nullif(pg_catalog.btrim(coalesce(p ->> 'category', '')), '');
  v_title text := nullif(pg_catalog.btrim(coalesce(p ->> 'title', '')), '');
  v_vat_rate numeric;
  v_included boolean;
  v_wh_rate numeric;
  v_property uuid;
  v_item_id uuid;
  v_party uuid;
  v_source_type text := coalesce(nullif(p ->> 'source_type', ''), 'manual');
  v_source_id uuid;
  v_expense_id uuid;
  v_create_expense boolean;
  v_rule uuid;
  v_att uuid[];
  v_amt record;
  v_item public.finance_open_items%rowtype;
  v_acc_currency text;
  v_counterparty text;
  v_res jsonb;
  v_id uuid;
begin
  if auth.uid() is null then perform public.finance_v2_raise('unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then perform public.finance_v2_raise('unauthorized'); end if;
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then perform public.finance_v2_raise('invalid_input'); end if;

  begin
    v_account := nullif(p ->> 'account_id', '')::uuid;
    v_to_account := nullif(p ->> 'to_account_id', '')::uuid;
    v_amount := nullif(p ->> 'amount', '')::numeric;
    v_date := coalesce(nullif(p ->> 'entry_date', '')::date, v_today);
    v_vat_rate := nullif(p ->> 'vat_rate', '')::numeric;
    v_included := coalesce(nullif(p ->> 'vat_included', '')::boolean, true);
    v_wh_rate := nullif(p ->> 'withholding_rate', '')::numeric;
    v_property := nullif(p ->> 'property_id', '')::uuid;
    v_item_id := nullif(p ->> 'open_item_id', '')::uuid;
    v_party := nullif(p ->> 'party_id', '')::uuid;
    v_source_id := nullif(p ->> 'source_id', '')::uuid;
    v_expense_id := nullif(p ->> 'expense_id', '')::uuid;
    v_create_expense := coalesce(nullif(p ->> 'create_expense', '')::boolean, false);
    v_rule := nullif(p ->> 'rule_id', '')::uuid;
    if pg_catalog.jsonb_typeof(p -> 'attachment_ids') = 'array' then
      select pg_catalog.array_agg(x::uuid) into v_att from pg_catalog.jsonb_array_elements_text(p -> 'attachment_ids') x;
    end if;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    perform public.finance_v2_raise('invalid_input');
  end;

  -- Transfer: eski finance_transfer (iki bacak, tek transaction); dönüş = transfer grubu kimliği.
  if v_dir = 'transfer' then
    v_res := public.finance_transfer(v_account, v_to_account, v_amount, v_date, nullif(pg_catalog.btrim(coalesce(p ->> 'note', '')), ''));
    if coalesce(v_res ->> 'outcome', '') <> 'transferred' then perform public.finance_v2_raise(coalesce(v_res ->> 'outcome', 'error')); end if;
    return (v_res ->> 'transfer_group_id')::uuid;
  end if;

  if v_dir is null or v_dir not in ('in', 'out') or v_account is null
     or v_amount is null or v_amount < 0.01 or v_amount > 9999999999.99 or pg_catalog.round(v_amount, 2) <> v_amount
     or (v_vat_rate is not null and (v_vat_rate < 0 or v_vat_rate > 100))
     or (v_wh_rate is not null and (v_wh_rate < 0 or v_wh_rate > 100))
     or coalesce(pg_catalog.array_length(v_att, 1), 0) > 20 then
    perform public.finance_v2_raise('invalid_input');
  end if;

  select * into v_amt from public.finance_entry_amounts(v_amount, v_vat_rate, v_included, v_wh_rate);
  if v_amt.cash < 0.01 then perform public.finance_v2_raise('invalid_input'); end if;

  perform public.finance_v2_check_category(v_tenant, v_cat, v_dir);

  v_party := public.finance_v2_resolve_party(v_tenant, v_party, p ->> 'party_name',
    coalesce(nullif(p ->> 'party_kind', ''), case when v_dir = 'in' then 'musteri' else 'tedarikci' end));
  v_counterparty := coalesce(nullif(pg_catalog.btrim(coalesce(p ->> 'counterparty', '')), ''),
                             (select pt.name from public.finance_parties pt where pt.id = v_party));
  if v_title is null then
    v_title := pg_catalog.left(coalesce(v_counterparty, case when v_dir = 'in' then 'Gelir' else 'Gider' end), 160);
  end if;

  if v_property is not null and not exists (select 1 from public.properties pr where pr.id = v_property and pr.tenant_id = v_tenant) then
    perform public.finance_v2_raise('invalid_input');
  end if;

  if v_item_id is not null then
    select * into v_item from public.finance_open_items o where o.id = v_item_id and o.tenant_id = v_tenant for update;
    if not found then perform public.finance_v2_raise('not_found'); end if;
    select a.currency into v_acc_currency from public.finance_accounts a where a.id = v_account and a.tenant_id = v_tenant;
    if v_item.status not in ('open', 'partial') then perform public.finance_v2_raise('item_closed'); end if;
    if (v_item.direction = 'receivable') <> (v_dir = 'in') or v_acc_currency is distinct from v_item.currency then
      perform public.finance_v2_raise('invalid_input');
    end if;
    if v_amt.cash + coalesce(v_amt.withheld, 0) > v_item.amount - v_item.paid_amount + 0.005 then
      perform public.finance_v2_raise('amount_exceeds_open');
    end if;
    if v_item.category = 'maas' and not public.finance_is_owner_gm() then perform public.finance_v2_raise('forbidden'); end if;
    if v_party is null then v_party := v_item.party_id; end if;
  end if;

  v_res := public.finance_record_entry(
    v_account, v_dir, v_amt.cash, v_date, v_cat, v_title, v_counterparty,
    nullif(pg_catalog.btrim(coalesce(p ->> 'document_url', '')), ''), nullif(pg_catalog.btrim(coalesce(p ->> 'note', '')), ''),
    v_source_type, v_source_id, v_create_expense, nullif(p ->> 'expense_category', ''), v_expense_id);
  if coalesce(v_res ->> 'outcome', '') <> 'recorded' then perform public.finance_v2_raise(coalesce(v_res ->> 'outcome', 'error')); end if;
  v_id := (v_res ->> 'entry_id')::uuid;

  update public.cash_entries e
     set party_id = v_party,
         vat_rate = v_vat_rate,
         vat_amount = v_amt.vat,
         vat_included = case when v_vat_rate is null then e.vat_included else v_included end,
         withholding_rate = v_wh_rate,
         withholding_amount = v_amt.withheld,
         property_id = v_property,
         open_item_id = v_item_id
   where e.id = v_id and e.tenant_id = v_tenant;

  if v_att is not null then
    update public.finance_attachments fa set entry_id = v_id
     where fa.tenant_id = v_tenant and fa.id = any (v_att) and fa.entry_id is null;
  end if;
  if v_rule is not null then
    update public.finance_rules r set hits = r.hits + 1 where r.id = v_rule and r.tenant_id = v_tenant;
  end if;
  return v_id;
end;
$$;

create or replace function public.finance_update_entry_v2(p_entry_id uuid, p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_e public.cash_entries%rowtype;
  v_scope text;
  v_doc numeric;
  v_included boolean;
  v_rate numeric;
  v_whr numeric;
  v_date date;
  v_cat text;
  v_title text;
  v_counterparty text;
  v_note text;
  v_doc_url text;
  v_party uuid;
  v_property uuid;
  v_amt record;
  v_res jsonb;
  v_core boolean;
begin
  if auth.uid() is null then perform public.finance_v2_raise('unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then perform public.finance_v2_raise('unauthorized'); end if;
  if p_entry_id is null or p is null or pg_catalog.jsonb_typeof(p) <> 'object' then perform public.finance_v2_raise('invalid_input'); end if;

  select * into v_e from public.cash_entries e where e.id = p_entry_id and e.tenant_id = v_tenant for update;
  if not found then perform public.finance_v2_raise('not_found'); end if;
  if v_e.voided_at is not null then perform public.finance_v2_raise('already_voided'); end if;
  if not public.finance_account_access(v_e.account_id, 'edit') then perform public.finance_v2_raise('forbidden'); end if;
  select a.owner_scope into v_scope from public.finance_accounts a where a.id = v_e.account_id and a.tenant_id = v_tenant;

  begin
    v_doc := case when p ? 'amount' then (p ->> 'amount')::numeric else v_e.amount + coalesce(v_e.withholding_amount, 0) end;
    v_included := case when p ? 'amount' then coalesce(nullif(p ->> 'vat_included', '')::boolean, true) else true end;
    v_rate := case when p ? 'vat_rate' then nullif(p ->> 'vat_rate', '')::numeric else v_e.vat_rate end;
    v_whr := case when p ? 'withholding_rate' then nullif(p ->> 'withholding_rate', '')::numeric else v_e.withholding_rate end;
    v_date := case when p ? 'entry_date' then (p ->> 'entry_date')::date else v_e.entry_date end;
    v_property := case when p ? 'property_id' then nullif(p ->> 'property_id', '')::uuid else v_e.property_id end;
    v_party := case when p ? 'party_id' then nullif(p ->> 'party_id', '')::uuid else null end;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    perform public.finance_v2_raise('invalid_input');
  end;
  v_cat := case when p ? 'category' then nullif(pg_catalog.btrim(coalesce(p ->> 'category', '')), '') else v_e.category end;
  v_title := case when p ? 'title' then pg_catalog.btrim(coalesce(p ->> 'title', '')) else v_e.title end;
  v_counterparty := case when p ? 'counterparty' then nullif(pg_catalog.btrim(coalesce(p ->> 'counterparty', '')), '') else v_e.counterparty end;
  v_note := case when p ? 'note' then nullif(pg_catalog.btrim(coalesce(p ->> 'note', '')), '') else v_e.note end;
  v_doc_url := case when p ? 'document_url' then nullif(pg_catalog.btrim(coalesce(p ->> 'document_url', '')), '') else v_e.document_url end;

  if v_doc is null or v_doc < 0.01 or v_doc > 9999999999.99 or pg_catalog.round(v_doc, 2) <> v_doc
     or (v_rate is not null and (v_rate < 0 or v_rate > 100)) or (v_whr is not null and (v_whr < 0 or v_whr > 100)) then
    perform public.finance_v2_raise('invalid_input');
  end if;
  if v_scope = 'office' and (v_cat = 'maas' or v_e.category = 'maas') and not public.finance_is_owner_gm() then
    perform public.finance_v2_raise('forbidden');
  end if;
  perform public.finance_v2_check_category(v_tenant, v_cat, v_e.direction);

  select * into v_amt from public.finance_entry_amounts(v_doc, v_rate, v_included, v_whr);
  if v_amt.cash < 0.01 then perform public.finance_v2_raise('invalid_input'); end if;

  if p ? 'party_id' or p ? 'party_name' then
    v_party := public.finance_v2_resolve_party(v_tenant, v_party, p ->> 'party_name',
      coalesce(nullif(p ->> 'party_kind', ''), case when v_e.direction = 'in' then 'musteri' else 'tedarikci' end));
  else
    v_party := v_e.party_id;
  end if;
  if v_property is not null and not exists (select 1 from public.properties pr where pr.id = v_property and pr.tenant_id = v_tenant) then
    perform public.finance_v2_raise('invalid_input');
  end if;

  v_core := v_amt.cash is distinct from v_e.amount or v_date is distinct from v_e.entry_date or v_cat is distinct from v_e.category
            or v_title is distinct from v_e.title or v_counterparty is distinct from v_e.counterparty
            or v_note is distinct from v_e.note or v_doc_url is distinct from v_e.document_url or p ? 'expense_category';
  if v_core then
    if v_e.source_type <> 'manual' or v_e.kind not in ('income', 'expense') then perform public.finance_v2_raise('locked'); end if;
    if v_e.open_item_id is not null and v_amt.cash + coalesce(v_amt.withheld, 0) > v_e.amount + coalesce(v_e.withholding_amount, 0) and exists (
      select 1 from public.finance_open_items o where o.id = v_e.open_item_id
         and v_amt.cash + coalesce(v_amt.withheld, 0) - v_e.amount - coalesce(v_e.withholding_amount, 0) > o.amount - o.paid_amount + 0.005
    ) then
      perform public.finance_v2_raise('amount_exceeds_open');
    end if;
    v_res := public.finance_update_entry(p_entry_id, v_amt.cash, v_date, v_cat, v_title, v_counterparty, v_doc_url, v_note,
                                         nullif(p ->> 'expense_category', ''));
    if coalesce(v_res ->> 'outcome', '') <> 'updated' then perform public.finance_v2_raise(coalesce(v_res ->> 'outcome', 'error')); end if;
  end if;

  update public.cash_entries e
     set party_id = v_party,
         vat_rate = v_rate,
         vat_amount = v_amt.vat,
         vat_included = case when v_rate is null then e.vat_included else v_included end,
         withholding_rate = v_whr,
         withholding_amount = v_amt.withheld,
         property_id = v_property
   where e.id = p_entry_id and e.tenant_id = v_tenant
     and (e.party_id is distinct from v_party or e.vat_rate is distinct from v_rate or e.vat_amount is distinct from v_amt.vat
          or e.withholding_rate is distinct from v_whr or e.withholding_amount is distinct from v_amt.withheld
          or e.property_id is distinct from v_property);

  if not v_core and v_scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (v_tenant, auth.uid(), 'cash_entry.update_meta', 'cash_entry', p_entry_id,
      jsonb_build_object('party_id', v_party, 'vat_rate', v_rate, 'withholding_rate', v_whr, 'property_id', v_property));
  end if;
end;
$$;

-- Deftere bağlanmamış eski giderleri seçilen ofis hesabına hareket olarak taşır (gider kaydı korunur, çift sayım olmaz).
-- Para birimi uyuşmayan, açılıştan önce kalan, geleceğe tarihli ya da kilitli aya düşen gider atlanır. Dönüş: taşınan adet.
create or replace function public.finance_adopt_legacy_expenses(p_account_id uuid, p_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('create');
  v_acc public.finance_accounts%rowtype;
  r record;
  v_res jsonb;
  v_n integer := 0;
begin
  if p_account_id is null or p_ids is null or coalesce(pg_catalog.array_length(p_ids, 1), 0) not between 1 and 500 then
    perform public.finance_v2_raise('invalid_input');
  end if;
  select * into v_acc from public.finance_accounts a where a.id = p_account_id and a.tenant_id = v_tenant;
  if not found then perform public.finance_v2_raise('not_found'); end if;
  if v_acc.owner_scope <> 'office' then perform public.finance_v2_raise('invalid_input'); end if;

  for r in
    select x.id, x.amount, x.currency, x.expense_date, x.category::text as category, x.title, x.notes, x.receipt_url, x.property_id
      from public.expenses x
     where x.tenant_id = v_tenant and x.id = any (p_ids)
       and not exists (select 1 from public.cash_entries c where c.expense_id = x.id and c.voided_at is null)
     order by x.expense_date, x.id
  loop
    continue when coalesce(r.currency, 'TRY') <> v_acc.currency;
    begin
      v_res := public.finance_record_entry(
        p_account_id, 'out', r.amount, r.expense_date,
        case when r.category in ('reklam', 'ofis', 'ulasim') then r.category else 'diger_gider' end,
        pg_catalog.left(coalesce(nullif(pg_catalog.btrim(coalesce(r.title, '')), ''), 'Gider'), 160),
        null,
        case when r.receipt_url ~ '^https://' and char_length(r.receipt_url) <= 500 then r.receipt_url end,
        pg_catalog.left(nullif(pg_catalog.btrim(coalesce(r.notes, '')), ''), 1000),
        'manual', null, false, null, r.id);
    exception when sqlstate 'P0001' then
      if sqlerrm = 'DONEM_KILITLI' then continue; end if;
      raise;
    end;
    if v_res ->> 'outcome' = 'recorded' then
      v_n := v_n + 1;
      if r.property_id is not null then
        update public.cash_entries e set property_id = r.property_id where e.id = (v_res ->> 'entry_id')::uuid;
      end if;
    elsif v_res ->> 'outcome' in ('forbidden', 'unauthorized') then
      perform public.finance_v2_raise(v_res ->> 'outcome');
    end if;
  end loop;
  return v_n;
end;
$$;

-- ===========================================================================
-- Cari
-- ===========================================================================
create or replace function public.finance_party_upsert(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_tenant uuid;
  v_kind text := coalesce(nullif(pg_catalog.btrim(coalesce(p ->> 'kind', '')), ''), 'diger');
  v_name text := pg_catalog.btrim(coalesce(p ->> 'name', ''));
  v_tax text := nullif(pg_catalog.regexp_replace(coalesce(p ->> 'tax_id', ''), '[^0-9]', '', 'g'), '');
  v_iban text := nullif(pg_catalog.btrim(coalesce(p ->> 'iban_last4', '')), '');
  v_phone text := nullif(pg_catalog.btrim(coalesce(p ->> 'phone', '')), '');
  v_email text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p ->> 'email', ''))), '');
  v_note text := nullif(pg_catalog.btrim(coalesce(p ->> 'note', '')), '');
  v_customer uuid;
  v_user uuid;
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then perform public.finance_v2_raise('invalid_input'); end if;
  begin
    v_id := nullif(p ->> 'id', '')::uuid;
    v_customer := nullif(p ->> 'customer_id', '')::uuid;
    v_user := nullif(p ->> 'user_id', '')::uuid;
  exception when invalid_text_representation then
    perform public.finance_v2_raise('invalid_input');
  end;
  v_tenant := public.finance_v2_ctx(case when v_id is null then 'create' else 'edit' end);

  if v_kind not in ('musteri', 'malik', 'kiraci', 'tedarikci', 'danisman', 'diger')
     or char_length(v_name) not between 1 and 120
     or (v_tax is not null and v_tax !~ '^[0-9]{10}$')
     or (v_iban is not null and v_iban !~ '^[0-9]{4}$')
     or (v_phone is not null and v_phone !~ '^(0[0-9]{10}|\+[1-9][0-9]{6,14})$')
     or (v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
     or char_length(coalesce(v_note, '')) > 1000 then
    perform public.finance_v2_raise('invalid_input');
  end if;
  if v_customer is not null and not exists (select 1 from public.customers c where c.id = v_customer and c.tenant_id = v_tenant) then
    perform public.finance_v2_raise('invalid_input');
  end if;
  if v_user is not null and not exists (select 1 from public.profiles pr where pr.id = v_user and pr.tenant_id = v_tenant) then
    perform public.finance_v2_raise('invalid_input');
  end if;

  begin
    if v_id is null then
      insert into public.finance_parties (tenant_id, kind, name, tax_id, iban_last4, phone, email, customer_id, user_id, note, created_by)
      values (v_tenant, v_kind, v_name, v_tax, v_iban, v_phone, v_email, v_customer, v_user, v_note, auth.uid())
      returning id into v_id;
    else
      update public.finance_parties pt
         set kind = v_kind, name = v_name, tax_id = v_tax, iban_last4 = v_iban, phone = v_phone, email = v_email,
             customer_id = v_customer, user_id = v_user, note = v_note, updated_at = pg_catalog.now()
       where pt.id = v_id and pt.tenant_id = v_tenant;
      if not found then perform public.finance_v2_raise('not_found'); end if;
    end if;
  exception when unique_violation then
    perform public.finance_v2_raise('duplicate_name');
  end;
  return v_id;
end;
$$;

create or replace function public.finance_party_set_archived(p_id uuid, p_archived boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
begin
  if p_id is null or p_archived is null then perform public.finance_v2_raise('invalid_input'); end if;
  begin
    update public.finance_parties pt
       set archived_at = case when p_archived then coalesce(pt.archived_at, pg_catalog.now()) end, updated_at = pg_catalog.now()
     where pt.id = p_id and pt.tenant_id = v_tenant;
    if not found then perform public.finance_v2_raise('not_found'); end if;
  exception when unique_violation then
    perform public.finance_v2_raise('duplicate_name');
  end;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, auth.uid(), case when p_archived then 'finance_party.archive' else 'finance_party.unarchive' end, 'finance_party', p_id, '{}'::jsonb);
end;
$$;

-- Cari bakiyeleri: balance = açık alacak − açık borç (+ = bize borçlu). Bağsız (peşin) hareketler bakiyeyi değiştirmez.
create or replace function public.finance_party_balances(p_kind text default null, p_q text default null)
returns table (party_id uuid, name text, kind text, receivable_open numeric, payable_open numeric, paid_in numeric, paid_out numeric,
               balance numeric, overdue_amount numeric, last_activity date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_q text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_q, ''))), '');
begin
  return query
  select pt.id, pt.name, pt.kind,
         coalesce(it.rec_open, 0), coalesce(it.pay_open, 0), coalesce(en.paid_in, 0), coalesce(en.paid_out, 0),
         coalesce(it.rec_open, 0) - coalesce(it.pay_open, 0), coalesce(it.overdue, 0),
         nullif(greatest(coalesce(en.last_d, date '2000-01-01'), coalesce(it.last_d, date '2000-01-01')), date '2000-01-01')
  from public.finance_parties pt
  left join lateral (
    select sum(o.amount - o.paid_amount) filter (where o.direction = 'receivable' and o.status in ('open', 'partial')) as rec_open,
           sum(o.amount - o.paid_amount) filter (where o.direction = 'payable' and o.status in ('open', 'partial')) as pay_open,
           sum(o.amount - o.paid_amount) filter (where o.status in ('open', 'partial') and o.due_date < v_today) as overdue,
           max(o.issue_date) as last_d
      from public.finance_open_items o
     where o.tenant_id = v_tenant and o.party_id = pt.id and o.status <> 'cancelled'
       and (o.category is distinct from 'maas' or v_gm)
  ) it on true
  left join lateral (
    select sum(e.amount) filter (where e.direction = 'in') as paid_in,
           sum(e.amount) filter (where e.direction = 'out') as paid_out,
           max(e.entry_date) as last_d
      from public.cash_entries e
      join public.finance_accounts a on a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office'
     where e.tenant_id = v_tenant and e.party_id = pt.id and e.voided_at is null and e.kind in ('income', 'expense')
       and (e.category is distinct from 'maas' or v_gm)
  ) en on true
  where pt.tenant_id = v_tenant and pt.archived_at is null
    and (p_kind is null or pt.kind = p_kind)
    and (v_q is null or pg_catalog.strpos(pg_catalog.lower(pt.name), v_q) > 0)
  order by pt.name
  limit 2000;
end;
$$;

-- Cari ekstresi: alacak/borç belgesi + tahsilat/ödeme; bağsız (peşin) hareket borç=alacak gösterilir. running_balance + = bize borçlu.
create or replace function public.finance_party_statement(p_party_id uuid, p_from date default null, p_to date default null)
returns table (d date, doc_type text, ref_id uuid, title text, debit numeric, credit numeric, running_balance numeric, href text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
begin
  if p_party_id is null or (p_from is not null and p_to is not null and p_from > p_to) then perform public.finance_v2_raise('invalid_input'); end if;
  if not exists (select 1 from public.finance_parties pt where pt.id = p_party_id and pt.tenant_id = v_tenant) then
    perform public.finance_v2_raise('not_found');
  end if;

  return query
  with base as (
    select o.issue_date as bd, 0 as bord, (case when o.direction = 'receivable' then 'alacak' else 'borc' end)::text as btype,
           o.id as bref, o.title as btitle,
           (case when o.direction = 'receivable' then o.amount else 0 end)::numeric as bdebit,
           (case when o.direction = 'payable' then o.amount else 0 end)::numeric as bcredit,
           ('/app/giderler?sekme=cari&kalem=' || o.id::text)::text as bhref
      from public.finance_open_items o
     where o.tenant_id = v_tenant and o.party_id = p_party_id and o.status <> 'cancelled'
       and (o.category is distinct from 'maas' or v_gm)
    union all
    select e.entry_date, 1,
           (case when linked.id is not null then (case when e.direction = 'in' then 'tahsilat' else 'odeme' end)
                 else (case when e.direction = 'in' then 'pesin_tahsilat' else 'pesin_odeme' end) end)::text,
           e.id, e.title,
           (case when linked.id is null or e.direction = 'out' then e.amount + coalesce(e.withholding_amount, 0) else 0 end)::numeric,
           (case when linked.id is null or e.direction = 'in' then e.amount + coalesce(e.withholding_amount, 0) else 0 end)::numeric,
           ('/app/giderler?sekme=hareketler&hareket=' || e.id::text)::text
      from public.cash_entries e
      join public.finance_accounts a on a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office'
      left join public.finance_open_items linked
        on linked.id = e.open_item_id and linked.tenant_id = e.tenant_id and linked.status <> 'cancelled' and linked.party_id = p_party_id
     where e.tenant_id = v_tenant and e.voided_at is null and e.kind in ('income', 'expense')
       and (e.party_id = p_party_id or linked.id is not null)
       and (e.category is distinct from 'maas' or v_gm)
  ),
  opening as (
    select coalesce(sum(b.bdebit - b.bcredit), 0)::numeric as s from base b where p_from is not null and b.bd < p_from
  ),
  rows_in as (
    select b.*, (select o.s from opening o) + sum(b.bdebit - b.bcredit)
             over (order by b.bd, b.bord, b.bref rows between unbounded preceding and current row) as brun
      from base b
     where p_from is null or b.bd >= p_from
  )
  select x.xd, x.xtype, x.xref, x.xtitle, x.xdebit, x.xcredit, x.xrun, x.xhref
    from (
      select p_from as xd, -1 as xord, 'devir'::text as xtype, null::uuid as xref, 'Devir'::text as xtitle,
             greatest(o.s, 0)::numeric as xdebit, greatest(-o.s, 0)::numeric as xcredit, o.s as xrun, null::text as xhref
        from opening o
       where p_from is not null
      union all
      select r.bd, r.bord, r.btype, r.bref, r.btitle, r.bdebit, r.bcredit, r.brun, r.bhref
        from rows_in r
       where p_to is null or r.bd <= p_to
    ) x
   order by x.xd, x.xord, x.xref;
end;
$$;

-- ===========================================================================
-- Açık kalem
-- ===========================================================================
create or replace function public.finance_open_item_create(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('create');
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_dir text := p ->> 'direction';
  v_title text := pg_catalog.btrim(coalesce(p ->> 'title', ''));
  v_cat text := nullif(pg_catalog.btrim(coalesce(p ->> 'category', '')), '');
  v_currency text := coalesce(nullif(p ->> 'currency', ''), 'TRY');
  v_note text := nullif(pg_catalog.btrim(coalesce(p ->> 'note', '')), '');
  v_source_type text := nullif(pg_catalog.btrim(coalesce(p ->> 'source_type', '')), '');
  v_amount numeric;
  v_rate numeric;
  v_whr numeric;
  v_issue date;
  v_due date;
  v_property uuid;
  v_source_id uuid;
  v_party uuid;
  v_split record;
  v_id uuid;
begin
  begin
    v_amount := nullif(p ->> 'amount', '')::numeric;
    v_rate := nullif(p ->> 'vat_rate', '')::numeric;
    v_whr := nullif(p ->> 'withholding_rate', '')::numeric;
    v_issue := coalesce(nullif(p ->> 'issue_date', '')::date, v_today);
    v_due := coalesce(nullif(p ->> 'due_date', '')::date, v_issue);
    v_property := nullif(p ->> 'property_id', '')::uuid;
    v_source_id := nullif(p ->> 'source_id', '')::uuid;
    v_party := nullif(p ->> 'party_id', '')::uuid;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    perform public.finance_v2_raise('invalid_input');
  end;
  if v_dir is null or v_dir not in ('receivable', 'payable')
     or char_length(v_title) not between 1 and 160 or char_length(coalesce(v_cat, '')) > 40
     or v_currency not in ('TRY', 'USD', 'EUR')
     or v_amount is null or v_amount < 0.01 or v_amount > 9999999999.99 or pg_catalog.round(v_amount, 2) <> v_amount
     or (v_rate is not null and (v_rate < 0 or v_rate > 100)) or (v_whr is not null and (v_whr < 0 or v_whr > 100))
     or v_issue < date '2000-01-01' or v_issue > date '2100-12-31' or v_due < v_issue or v_due > date '2100-12-31'
     or char_length(coalesce(v_note, '')) > 1000 or char_length(coalesce(v_source_type, '')) > 40 then
    perform public.finance_v2_raise('invalid_input');
  end if;
  if v_cat = 'maas' and not public.finance_is_owner_gm() then perform public.finance_v2_raise('forbidden'); end if;
  perform public.finance_v2_check_category(v_tenant, v_cat, case when v_dir = 'receivable' then 'in' else 'out' end);
  if v_property is not null and not exists (select 1 from public.properties pr where pr.id = v_property and pr.tenant_id = v_tenant) then
    perform public.finance_v2_raise('invalid_input');
  end if;
  v_party := public.finance_v2_resolve_party(v_tenant, v_party, p ->> 'party_name',
    coalesce(nullif(p ->> 'party_kind', ''), case when v_dir = 'receivable' then 'musteri' else 'tedarikci' end));

  -- Tutar KDV dahil brüttür; KDV ve stopaj belgeden türetilir (stopaj matrahı KDV hariç net).
  select * into v_split from public.finance_vat_split(v_amount, coalesce(v_rate, 0), true);

  insert into public.finance_open_items (tenant_id, direction, party_id, title, category, amount, currency, vat_rate, vat_amount,
    withholding_amount, issue_date, due_date, source_type, source_id, property_id, note, created_by)
  values (v_tenant, v_dir, v_party, v_title, v_cat, v_amount, v_currency, v_rate,
    case when v_rate is null then null else v_split.vat end,
    case when v_whr is null then null else pg_catalog.round(v_split.net * v_whr / 100, 2) end,
    v_issue, v_due, v_source_type, v_source_id, v_property, v_note, auth.uid())
  returning id into v_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, auth.uid(), 'finance_open_item.create', 'finance_open_item', v_id,
    jsonb_build_object('direction', v_dir, 'amount', v_amount, 'due_date', v_due, 'party_id', v_party));
  return v_id;
end;
$$;

create or replace function public.finance_open_item_cancel(p_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('delete');
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_item public.finance_open_items%rowtype;
begin
  if p_id is null or char_length(v_reason) not between 3 and 300 then perform public.finance_v2_raise('invalid_input'); end if;
  select * into v_item from public.finance_open_items o where o.id = p_id and o.tenant_id = v_tenant for update;
  if not found then perform public.finance_v2_raise('not_found'); end if;
  if v_item.category = 'maas' and not public.finance_is_owner_gm() then perform public.finance_v2_raise('forbidden'); end if;
  if v_item.status not in ('open', 'partial') then perform public.finance_v2_raise('item_closed'); end if;
  update public.finance_open_items o
     set status = 'cancelled', cancelled_at = pg_catalog.now(), cancel_reason = v_reason
   where o.id = p_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (v_tenant, auth.uid(), 'finance_open_item.cancel', 'finance_open_item', p_id,
    jsonb_build_object('amount', v_item.amount, 'paid_amount', v_item.paid_amount), jsonb_build_object('reason', v_reason));
end;
$$;

-- Kalemi (kısmen) kapatır: bağlı hareketi yazar (kalem 'partial' ya da 'paid' olur) ve hareket kimliğini döner.
-- Kalemde stopaj varsa son ödeme hareketi stopajı taşır (nakit = kalan − stopaj).
create or replace function public.finance_open_item_settle(p_id uuid, p_account_id uuid, p_amount numeric default null,
  p_date date default null, p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('create');
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_item public.finance_open_items%rowtype;
  v_wh_left numeric;
  v_cash_left numeric;
  v_amount numeric;
  v_id uuid;
begin
  if p_id is null or p_account_id is null then perform public.finance_v2_raise('invalid_input'); end if;
  select * into v_item from public.finance_open_items o where o.id = p_id and o.tenant_id = v_tenant for update;
  if not found then perform public.finance_v2_raise('not_found'); end if;
  if v_item.status not in ('open', 'partial') then perform public.finance_v2_raise('item_closed'); end if;

  v_wh_left := case when coalesce(v_item.withholding_amount, 0) > 0 and not exists (
                      select 1 from public.cash_entries e
                       where e.open_item_id = p_id and e.voided_at is null and coalesce(e.withholding_amount, 0) > 0)
                    then v_item.withholding_amount else 0 end;
  v_cash_left := v_item.amount - v_item.paid_amount - v_wh_left;
  v_amount := coalesce(p_amount, v_cash_left);
  if v_amount < 0.01 or pg_catalog.round(v_amount, 2) <> v_amount or v_amount > v_cash_left + 0.005 then
    perform public.finance_v2_raise('amount_exceeds_open');
  end if;

  v_id := public.finance_record_entry_v2(jsonb_build_object(
    'account_id', p_account_id,
    'direction', case when v_item.direction = 'receivable' then 'in' else 'out' end,
    'amount', v_amount,
    'entry_date', coalesce(p_date, v_today),
    'category', coalesce(v_item.category, case when v_item.direction = 'receivable' then 'diger_gelir' else 'diger_gider' end),
    'title', v_item.title,
    'party_id', v_item.party_id,
    'property_id', v_item.property_id,
    'open_item_id', v_item.id,
    'note', p_note));

  if v_wh_left > 0 and v_amount >= v_cash_left - 0.005 then
    update public.cash_entries e set withholding_amount = v_wh_left where e.id = v_id;
  end if;
  return v_id;
end;
$$;

-- Yaşlandırma (yalnız TL; tüm kaynaklar: elle kalem, kira, komisyon, düzenli ödeme, hakediş).
create or replace function public.finance_aging(p_direction text)
returns table (bucket text, cnt integer, amount numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
begin
  if p_direction is null or p_direction not in ('receivable', 'payable') then perform public.finance_v2_raise('invalid_input'); end if;
  return query
  select b.bucket, pg_catalog.count(v.amount_open)::integer, coalesce(sum(v.amount_open), 0)::numeric
  from (values ('vadesi_gelmedi', 0), ('0-30', 1), ('31-60', 2), ('61-90', 3), ('90+', 4)) b(bucket, ord)
  left join (
    select o.amount_open,
           case when o.due_date >= v_today then 'vadesi_gelmedi'
                when v_today - o.due_date <= 30 then '0-30'
                when v_today - o.due_date <= 60 then '31-60'
                when v_today - o.due_date <= 90 then '61-90'
                else '90+' end as bk
      from public.finance_open_items_v o
     where o.tenant_id = v_tenant and o.direction = p_direction and o.amount_open > 0 and o.currency = 'TRY'
       and (o.category is distinct from 'maas' or v_gm)
  ) v on v.bk = b.bucket
  group by b.bucket, b.ord
  order by b.ord;
end;
$$;

-- ===========================================================================
-- Pano ve tahmin
-- ===========================================================================
-- Ofis hesaplarının TL toplamı (kur yoksa o para birimi atlanır) — overview/forecast ortak.
create or replace function public.finance_v2_cash_total(p_rates jsonb)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(b.balance * public.finance_fx(a.currency, p_rates)), 0)
    from public.finance_account_balances() b
    join public.finance_accounts a on a.id = b.account_id
   where a.owner_scope = 'office' and a.archived_at is null and public.finance_fx(a.currency, p_rates) is not null;
$$;

create or replace function public.finance_overview(p_from date, p_to date, p_rates jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_month date := pg_catalog.date_trunc('month', (pg_catalog.now() at time zone 'Europe/Istanbul'))::date;
  v_by_currency jsonb;
  v_fx_missing boolean;
  v_in numeric;
  v_out numeric;
  v_rec numeric;
  v_pay numeric;
  v_overdue integer;
  v_review integer;
  v_legacy integer;
  v_vat numeric;
begin
  if p_from is null or p_to is null or p_from > p_to then perform public.finance_v2_raise('invalid_input'); end if;

  select coalesce(jsonb_agg(jsonb_build_object('currency', s.cur, 'amount', s.amt) order by s.cur), '[]'::jsonb),
         coalesce(bool_or(public.finance_fx(s.cur, p_rates) is null), false)
    into v_by_currency, v_fx_missing
    from (select a.currency as cur, sum(b.balance) as amt
            from public.finance_account_balances() b
            join public.finance_accounts a on a.id = b.account_id
           where a.owner_scope = 'office' and a.archived_at is null
           group by a.currency) s;

  select coalesce(sum(e.amount * public.finance_fx(e.currency, p_rates)) filter (where e.direction = 'in'), 0),
         coalesce(sum(e.amount * public.finance_fx(e.currency, p_rates)) filter (where e.direction = 'out'), 0)
    into v_in, v_out
    from public.cash_entries e
    join public.finance_accounts a on a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office'
   where e.tenant_id = v_tenant and e.voided_at is null and e.kind in ('income', 'expense')
     and e.entry_date between p_from and p_to and public.finance_fx(e.currency, p_rates) is not null
     and (e.category is distinct from 'maas' or v_gm);

  select coalesce(sum(o.amount_open * public.finance_fx(o.currency, p_rates)) filter (where o.direction = 'receivable'), 0),
         coalesce(sum(o.amount_open * public.finance_fx(o.currency, p_rates)) filter (where o.direction = 'payable'), 0),
         pg_catalog.count(*) filter (where o.due_date < v_today)::integer
    into v_rec, v_pay, v_overdue
    from public.finance_open_items_v o
   where o.tenant_id = v_tenant and o.amount_open > 0 and public.finance_fx(o.currency, p_rates) is not null
     and (o.category is distinct from 'maas' or v_gm);

  v_review :=
      (select pg_catalog.count(*) from public.finance_statement_lines l
         join public.finance_accounts a on a.id = l.account_id and a.tenant_id = l.tenant_id and a.owner_scope = 'office'
        where l.tenant_id = v_tenant and l.status = 'pending')::integer
    + (select pg_catalog.count(*) from public.recurring_occurrences ro
         join public.recurring_rules rr on rr.id = ro.rule_id and rr.tenant_id = ro.tenant_id and rr.scope = 'office'
        where ro.tenant_id = v_tenant and ro.status = 'pending' and (rr.category is distinct from 'maas' or v_gm))::integer
    + (select pg_catalog.count(*) from public.finance_attachments fa
        where fa.tenant_id = v_tenant and fa.entry_id is null and fa.open_item_id is null)::integer;

  select pg_catalog.count(*)::integer into v_legacy
    from public.expenses x
   where x.tenant_id = v_tenant
     and not exists (select 1 from public.cash_entries c where c.expense_id = x.id and c.voided_at is null);

  select coalesce(sum(v.payable), 0) into v_vat
    from public.finance_vat_summary(v_month, (v_month + interval '1 month' - interval '1 day')::date) v;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'cash_total_try', public.finance_v2_cash_total(p_rates),
    'by_currency', v_by_currency,
    'fx_missing', v_fx_missing,
    'in_total', v_in, 'out_total', v_out, 'net', v_in - v_out,
    'receivable_open', v_rec, 'payable_open', v_pay, 'overdue_count', v_overdue,
    'review_count', v_review,
    'legacy_unadopted_count', v_legacy,
    'vat_payable_month', v_vat);
end;
$$;

-- Nakit akışı: son günlerin gerçekleşeni (is_actual) + bugünden p_days gün ileri tahmin.
-- Tahmin = bugünkü TL bakiye + vadesi gelen açık kalemler (vadesi geçenler bugüne) + düzenli ödemelerin gelecek oluşumları.
create or replace function public.finance_cashflow_forecast(p_days integer, p_rates jsonb default null)
returns table (d date, inflow numeric, outflow numeric, balance numeric, is_actual boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_end date;
  v_hist integer;
  v_bal numeric;
begin
  if p_days is null or p_days not between 1 and 366 then perform public.finance_v2_raise('invalid_input'); end if;
  v_end := v_today + p_days;
  v_hist := least(p_days, 30);
  v_bal := public.finance_v2_cash_total(p_rates);

  return query
  with ent as (
    select e.entry_date as ed,
           (e.amount * public.finance_fx(e.currency, p_rates)) * (case when e.direction = 'in' then 1 else -1 end) as signed
      from public.cash_entries e
      join public.finance_accounts a on a.id = e.account_id and a.tenant_id = e.tenant_id
                                     and a.owner_scope = 'office' and a.archived_at is null
     where e.tenant_id = v_tenant and e.voided_at is null and e.entry_date > v_today - v_hist
       and public.finance_fx(e.currency, p_rates) is not null
       and (e.category is distinct from 'maas' or v_gm)
  ),
  hist as (
    select g.day::date as hd,
           coalesce((select sum(x.signed) from ent x where x.ed = g.day::date and x.signed > 0), 0) as h_in,
           coalesce((select -sum(x.signed) from ent x where x.ed = g.day::date and x.signed < 0), 0) as h_out,
           v_bal - coalesce((select sum(x.signed) from ent x where x.ed > g.day::date), 0) as h_bal
      from pg_catalog.generate_series((v_today - v_hist)::timestamp, (v_today - 1)::timestamp, interval '1 day') g(day)
  ),
  due as (
    select greatest(o.due_date, v_today) as dd, o.direction as dir, o.amount_open * public.finance_fx(o.currency, p_rates) as amt
      from public.finance_open_items_v o
     where o.tenant_id = v_tenant and o.source <> 'recurring' and o.amount_open > 0 and o.due_date <= v_end
       and public.finance_fx(o.currency, p_rates) is not null and (o.category is distinct from 'maas' or v_gm)
    union all
    select occ.dd, case when rr.direction = 'in' then 'receivable' else 'payable' end, rr.amount * public.finance_fx(a.currency, p_rates)
      from public.recurring_rules rr
      join public.finance_accounts a on a.id = rr.account_id and a.tenant_id = rr.tenant_id
      cross join lateral (
        select greatest(due_k, v_today) as dd
          from (
            select case when k = 0 then rr.next_due
                        else (pm + (least(rr.pay_day::integer,
                                          pg_catalog.date_part('day', (pm + interval '1 month' - interval '1 day'))::integer) - 1))::date
                   end as due_k
              from pg_catalog.generate_series(0, 60) k
              cross join lateral (
                select (pg_catalog.date_trunc('month', coalesce(rr.next_period, rr.next_due))
                        + pg_catalog.make_interval(months => k * (case rr.frequency when 'monthly' then 1 when 'quarterly' then 3 else 12 end)))::date as pm
              ) pmx
          ) occ0
         where occ0.due_k <= v_end and (rr.end_date is null or occ0.due_k <= rr.end_date)
      ) occ
     where rr.tenant_id = v_tenant and rr.active and rr.scope = 'office' and rr.next_due is not null
       and public.finance_fx(a.currency, p_rates) is not null and (rr.category is distinct from 'maas' or v_gm)
  ),
  fut as (
    select g.day::date as fd,
           coalesce((select sum(x.amt) from due x where x.dd = g.day::date and x.dir = 'receivable'), 0) as f_in,
           coalesce((select sum(x.amt) from due x where x.dd = g.day::date and x.dir = 'payable'), 0) as f_out
      from pg_catalog.generate_series(v_today::timestamp, v_end::timestamp, interval '1 day') g(day)
  )
  select h.hd, h.h_in, h.h_out, h.h_bal, true from hist h
  union all
  select f.fd, f.f_in, f.f_out,
         v_bal + sum(f.f_in - f.f_out) over (order by f.fd rows between unbounded preceding and current row), false
    from fut f
  order by 1;
end;
$$;

-- Kâr/zarar (TL). Gelir = komisyon (brüt − KDV − ofis dışı paylar; mevcut mantık) + yönetim ücreti
--   + elle girilen gelir hareketleri (kaynak 'manual'; komisyon/kira tahsilatı/kira yönetimi kategorileri çift sayılmaz).
-- Gider = expenses (mülk sahibine yansıtılanlar hariç) + gider kaydı olmayan çıkışlar (transfer ve mülk sahibi ödemesi hariç).
-- KDV biliniyorsa hareket tutarı KDV hariç sayılır; stopaj belge tutarına eklenir. Maaş satırları yalnız owner/gm için girer.
create or replace function public.finance_pnl(p_from date, p_to date)
returns table (month date, income numeric, expense numeric, net numeric, income_by_category jsonb, expense_by_category jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
  v_m1 date;
  v_m2 date;
begin
  if p_from is null or p_to is null or p_from > p_to then perform public.finance_v2_raise('invalid_input'); end if;
  v_m1 := pg_catalog.date_trunc('month', p_from)::date;
  v_m2 := pg_catalog.date_trunc('month', p_to)::date;
  if v_m2 > (v_m1 + interval '36 months')::date then perform public.finance_v2_raise('invalid_input'); end if;

  return query
  with months as (
    select g.m::date as m from pg_catalog.generate_series(v_m1::timestamp, v_m2::timestamp, interval '1 month') g(m)
  ),
  lines as (
    select pg_catalog.date_trunc('month', (c.created_at at time zone 'Europe/Istanbul'))::date as lm, 'in'::text as side,
           'komisyon'::text as cat,
           c.gross_amount - coalesce(c.vat_amount, 0)
             - coalesce((select sum(s.amount) from public.commission_splits s
                          where s.commission_id = c.id and s.tenant_id = c.tenant_id and s.kind <> 'office'), 0) as amt
      from public.commissions c
     where c.tenant_id = v_tenant and c.status <> 'cancelled' and c.is_sample = false
       and (c.created_at at time zone 'Europe/Istanbul')::date >= v_m1
       and (c.created_at at time zone 'Europe/Istanbul')::date < (v_m2 + interval '1 month')::date
    union all
    select pg_catalog.date_trunc('month', rp.paid_on)::date, 'in', 'kira_yonetimi', rp.management_fee
      from public.rent_payments rp
     where rp.tenant_id = v_tenant and rp.voided_at is null and rp.management_fee > 0
       and rp.paid_on >= v_m1 and rp.paid_on < (v_m2 + interval '1 month')::date
    union all
    select pg_catalog.date_trunc('month', e.entry_date)::date, e.direction, coalesce(e.category, case when e.direction = 'in' then 'diger_gelir' else 'diger_gider' end),
           e.amount + coalesce(e.withholding_amount, 0) - coalesce(e.vat_amount, 0)
      from public.cash_entries e
      join public.finance_accounts a on a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office'
     where e.tenant_id = v_tenant and e.voided_at is null and e.is_sample = false and e.currency = 'TRY'
       and e.entry_date >= v_m1 and e.entry_date < (v_m2 + interval '1 month')::date
       and (
         (e.kind = 'income' and e.source_type = 'manual'
           and coalesce(e.category, '') not in ('komisyon', 'kira_tahsilat', 'aidat_tahsilat', 'kira_yonetimi', 'transfer'))
         or (e.kind = 'expense' and e.expense_id is null and e.source_type <> 'owner_payout'
           and coalesce(e.category, '') not in ('transfer', 'mulk_sahibi_odeme'))
       )
       and (e.category is distinct from 'maas' or v_gm)
    union all
    select pg_catalog.date_trunc('month', x.expense_date)::date, 'out', x.category::text, x.amount
      from public.expenses x
     where x.tenant_id = v_tenant and x.is_sample = false
       and x.expense_date >= v_m1 and x.expense_date < (v_m2 + interval '1 month')::date
       and not exists (select 1 from public.owner_charge_links l where l.kind = 'expense' and l.ref_id = x.id and l.tenant_id = x.tenant_id)
  ),
  cat as (
    select l.lm, l.side, l.cat, sum(l.amt) as amt from lines l group by l.lm, l.side, l.cat
  )
  select mo.m,
         coalesce(sum(c.amt) filter (where c.side = 'in'), 0)::numeric,
         coalesce(sum(c.amt) filter (where c.side = 'out'), 0)::numeric,
         (coalesce(sum(c.amt) filter (where c.side = 'in'), 0) - coalesce(sum(c.amt) filter (where c.side = 'out'), 0))::numeric,
         coalesce(jsonb_object_agg(c.cat, c.amt) filter (where c.side = 'in'), '{}'::jsonb),
         coalesce(jsonb_object_agg(c.cat, c.amt) filter (where c.side = 'out'), '{}'::jsonb)
    from months mo
    left join cat c on c.lm = mo.m
   group by mo.m
   order by mo.m;
end;
$$;

-- ===========================================================================
-- Vergi
-- ===========================================================================
-- Aylık KDV özeti (TL): hesaplanan = gelir hareketlerinin KDV'si + komisyon KDV'si; indirilecek = gider hareketlerinin KDV'si.
-- Stopaj: ödediğimiz ödemelerde kestiğimiz (withholding_paid; vergi dairesine yatırılır) ve bizden kesilen (withholding_collected).
create or replace function public.finance_vat_summary(p_from date, p_to date)
returns table (month date, output_vat numeric, input_vat numeric, payable numeric, withholding_paid numeric, withholding_collected numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
  v_m1 date;
  v_m2 date;
begin
  if p_from is null or p_to is null or p_from > p_to then perform public.finance_v2_raise('invalid_input'); end if;
  v_m1 := pg_catalog.date_trunc('month', p_from)::date;
  v_m2 := pg_catalog.date_trunc('month', p_to)::date;
  if v_m2 > (v_m1 + interval '36 months')::date then perform public.finance_v2_raise('invalid_input'); end if;

  return query
  with months as (
    select g.m::date as m from pg_catalog.generate_series(v_m1::timestamp, v_m2::timestamp, interval '1 month') g(m)
  ),
  ent as (
    select pg_catalog.date_trunc('month', e.entry_date)::date as em, e.direction, e.source_type,
           coalesce(e.vat_amount, 0) as vat, coalesce(e.withholding_amount, 0) as wh
      from public.cash_entries e
      join public.finance_accounts a on a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office'
     where e.tenant_id = v_tenant and e.voided_at is null and e.currency = 'TRY' and e.kind in ('income', 'expense')
       and e.entry_date >= v_m1 and e.entry_date < (v_m2 + interval '1 month')::date
       and (e.category is distinct from 'maas' or v_gm)
  ),
  com as (
    select pg_catalog.date_trunc('month', (c.created_at at time zone 'Europe/Istanbul'))::date as cm, coalesce(c.vat_amount, 0) as vat
      from public.commissions c
     where c.tenant_id = v_tenant and c.status <> 'cancelled' and c.is_sample = false
       and (c.created_at at time zone 'Europe/Istanbul')::date >= v_m1
       and (c.created_at at time zone 'Europe/Istanbul')::date < (v_m2 + interval '1 month')::date
  )
  select mo.m,
         (coalesce((select sum(x.vat) from ent x where x.em = mo.m and x.direction = 'in' and x.source_type <> 'commission'), 0)
           + coalesce((select sum(c.vat) from com c where c.cm = mo.m), 0))::numeric,
         coalesce((select sum(x.vat) from ent x where x.em = mo.m and x.direction = 'out'), 0)::numeric,
         (coalesce((select sum(x.vat) from ent x where x.em = mo.m and x.direction = 'in' and x.source_type <> 'commission'), 0)
           + coalesce((select sum(c.vat) from com c where c.cm = mo.m), 0)
           - coalesce((select sum(x.vat) from ent x where x.em = mo.m and x.direction = 'out'), 0))::numeric,
         coalesce((select sum(x.wh) from ent x where x.em = mo.m and x.direction = 'out'), 0)::numeric,
         coalesce((select sum(x.wh) from ent x where x.em = mo.m and x.direction = 'in'), 0)::numeric
    from months mo
   order by mo.m;
end;
$$;

-- ===========================================================================
-- Kategori ve kural
-- ===========================================================================
create or replace function public.finance_category_upsert(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
  v_id uuid;
  v_dir text := p ->> 'direction';
  v_label text := pg_catalog.btrim(coalesce(p ->> 'label', ''));
  v_icon text := nullif(pg_catalog.btrim(coalesce(p ->> 'icon', '')), '');
  v_exp text := nullif(pg_catalog.btrim(coalesce(p ->> 'expense_category', '')), '');
  v_vat numeric;
  v_wh numeric;
  v_sort integer;
  v_slug text;
  v_key text;
  v_n integer := 1;
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then perform public.finance_v2_raise('invalid_input'); end if;
  begin
    v_id := nullif(p ->> 'id', '')::uuid;
    v_vat := nullif(p ->> 'default_vat_rate', '')::numeric;
    v_wh := nullif(p ->> 'default_withholding_rate', '')::numeric;
    v_sort := coalesce(nullif(p ->> 'sort', '')::integer, 0);
  exception when invalid_text_representation or numeric_value_out_of_range then
    perform public.finance_v2_raise('invalid_input');
  end;
  if char_length(v_label) not between 1 and 60 or char_length(coalesce(v_icon, '')) > 40 or char_length(coalesce(v_exp, '')) > 40
     or (v_vat is not null and (v_vat < 0 or v_vat > 100)) or (v_wh is not null and (v_wh < 0 or v_wh > 100)) then
    perform public.finance_v2_raise('invalid_input');
  end if;

  if v_id is not null then
    update public.finance_categories c
       set label = v_label, icon = v_icon, default_vat_rate = v_vat, default_withholding_rate = v_wh, expense_category = v_exp, sort = v_sort
     where c.id = v_id and c.tenant_id = v_tenant;
    if not found then perform public.finance_v2_raise('not_found'); end if;
    return v_id;
  end if;

  if v_dir is null or v_dir not in ('in', 'out') then perform public.finance_v2_raise('invalid_input'); end if;
  if (select pg_catalog.count(*) from public.finance_categories c where c.tenant_id = v_tenant and c.archived_at is null) >= 200 then
    perform public.finance_v2_raise('limit_reached');
  end if;
  v_slug := pg_catalog.lower(pg_catalog.translate(v_label, 'ÇĞİIÖŞÜÂÎÛçğıöşüâîû', 'CGIIOSUAIUcgiosuaiu'));
  v_slug := pg_catalog.btrim(pg_catalog.regexp_replace(v_slug, '[^a-z0-9]+', '_', 'g'), '_');
  v_slug := pg_catalog.left(coalesce(nullif(v_slug, ''), 'kategori'), 24);
  v_key := 'x_' || v_slug;
  while exists (select 1 from public.finance_categories c where c.tenant_id = v_tenant and c.key = v_key) loop
    v_n := v_n + 1;
    v_key := 'x_' || v_slug || '_' || v_n::text;
  end loop;
  insert into public.finance_categories (tenant_id, direction, key, label, icon, default_vat_rate, default_withholding_rate, expense_category, sort)
  values (v_tenant, v_dir, v_key, v_label, v_icon, v_vat, v_wh, v_exp, v_sort)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.finance_category_archive(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
begin
  update public.finance_categories c set archived_at = coalesce(c.archived_at, pg_catalog.now())
   where c.id = p_id and c.tenant_id = v_tenant;
  if not found then perform public.finance_v2_raise('not_found'); end if;
end;
$$;

create or replace function public.finance_rule_upsert(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
  v_id uuid;
  v_dir text := nullif(p ->> 'direction', '');
  v_text text := nullif(pg_catalog.btrim(coalesce(p ->> 'match_text', '')), '');
  v_iban text := nullif(pg_catalog.btrim(coalesce(p ->> 'match_iban_last4', '')), '');
  v_cat text := pg_catalog.btrim(coalesce(p ->> 'set_category', ''));
  v_mode text := coalesce(nullif(p ->> 'mode', ''), 'suggest');
  v_min numeric;
  v_max numeric;
  v_party uuid;
  v_active boolean;
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then perform public.finance_v2_raise('invalid_input'); end if;
  begin
    v_id := nullif(p ->> 'id', '')::uuid;
    v_min := nullif(p ->> 'amount_min', '')::numeric;
    v_max := nullif(p ->> 'amount_max', '')::numeric;
    v_party := nullif(p ->> 'set_party_id', '')::uuid;
    v_active := coalesce(nullif(p ->> 'active', '')::boolean, true);
  exception when invalid_text_representation or numeric_value_out_of_range then
    perform public.finance_v2_raise('invalid_input');
  end;
  if (v_dir is not null and v_dir not in ('in', 'out')) or v_mode not in ('suggest', 'auto')
     or char_length(v_cat) not between 1 and 40
     or (v_text is not null and char_length(v_text) not between 2 and 100)
     or (v_iban is not null and v_iban !~ '^[0-9]{4}$')
     or (v_min is not null and v_min < 0) or (v_max is not null and v_max < 0) or (v_min is not null and v_max is not null and v_min > v_max)
     or (v_text is null and v_iban is null and v_min is null and v_max is null) then
    perform public.finance_v2_raise('invalid_input');
  end if;
  if v_cat like 'x\_%' and not exists (select 1 from public.finance_categories c where c.tenant_id = v_tenant and c.key = v_cat and c.archived_at is null) then
    perform public.finance_v2_raise('invalid_category');
  end if;
  if v_party is not null and not exists (select 1 from public.finance_parties pt where pt.id = v_party and pt.tenant_id = v_tenant) then
    perform public.finance_v2_raise('party_not_found');
  end if;

  if v_id is null then
    if (select pg_catalog.count(*) from public.finance_rules r where r.tenant_id = v_tenant) >= 200 then
      perform public.finance_v2_raise('limit_reached');
    end if;
    insert into public.finance_rules (tenant_id, direction, match_text, match_iban_last4, amount_min, amount_max, set_category, set_party_id, mode, active, created_by)
    values (v_tenant, v_dir, v_text, v_iban, v_min, v_max, v_cat, v_party, v_mode, v_active, auth.uid())
    returning id into v_id;
  else
    update public.finance_rules r
       set direction = v_dir, match_text = v_text, match_iban_last4 = v_iban, amount_min = v_min, amount_max = v_max,
           set_category = v_cat, set_party_id = v_party, mode = v_mode, active = v_active
     where r.id = v_id and r.tenant_id = v_tenant;
    if not found then perform public.finance_v2_raise('not_found'); end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.finance_rule_delete(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
begin
  delete from public.finance_rules r where r.id = p_id and r.tenant_id = v_tenant;
  if not found then perform public.finance_v2_raise('not_found'); end if;
end;
$$;

-- Eşleşen kurallar (en belirgin önce): metin/IBAN ölçütü ağır, tutar aralığı ve yön hafif sayılır.
create or replace function public.finance_rule_suggest(p_text text, p_amount numeric, p_iban_last4 text, p_direction text)
returns table (rule_id uuid, category text, party_id uuid, mode text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_text text := pg_catalog.lower(coalesce(p_text, ''));
begin
  return query
  select r.id, r.set_category, r.set_party_id, r.mode
    from public.finance_rules r
   where r.tenant_id = v_tenant and r.active
     and (r.direction is null or r.direction = p_direction)
     and (r.match_text is null or pg_catalog.strpos(v_text, pg_catalog.lower(r.match_text)) > 0)
     and (r.match_iban_last4 is null or r.match_iban_last4 = p_iban_last4)
     and (r.amount_min is null or p_amount >= r.amount_min)
     and (r.amount_max is null or p_amount <= r.amount_max)
   order by ((r.match_text is not null)::integer * 4 + (r.match_iban_last4 is not null)::integer * 4
             + (r.amount_min is not null)::integer + (r.amount_max is not null)::integer + (r.direction is not null)::integer) desc,
            (r.mode = 'auto') desc, r.hits desc, r.created_at
   limit 5;
end;
$$;

-- ===========================================================================
-- Dönem
-- ===========================================================================
create or replace function public.finance_period_lock(p_month date, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
  v_month date := pg_catalog.date_trunc('month', p_month)::date;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
begin
  if p_month is null or v_month > pg_catalog.date_trunc('month', (pg_catalog.now() at time zone 'Europe/Istanbul'))::date
     or v_month < date '2000-01-01' or char_length(coalesce(v_note, '')) > 300 then
    perform public.finance_v2_raise('invalid_input');
  end if;
  insert into public.finance_period_locks (tenant_id, period_month, locked_by, note)
  values (v_tenant, v_month, auth.uid(), v_note)
  on conflict (tenant_id, period_month) do nothing;
  if found then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (v_tenant, auth.uid(), 'finance_period.lock', 'finance_period', null, jsonb_build_object('month', v_month, 'note', v_note));
  end if;
end;
$$;

-- Ay kilidini yalnız ofis sahibi ve genel müdür açar.
create or replace function public.finance_period_unlock(p_month date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_month date := pg_catalog.date_trunc('month', p_month)::date;
begin
  if not public.finance_is_owner_gm() then perform public.finance_v2_raise('forbidden'); end if;
  if p_month is null then perform public.finance_v2_raise('invalid_input'); end if;
  delete from public.finance_period_locks l where l.tenant_id = v_tenant and l.period_month = v_month;
  if found then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (v_tenant, auth.uid(), 'finance_period.unlock', 'finance_period', null, jsonb_build_object('month', v_month));
  end if;
end;
$$;

-- ===========================================================================
-- Bütçe
-- ===========================================================================
-- Bütçe aydan itibaren geçerlidir (sonraki ay için yeni satır yoksa taşınır); tutar 0 = o aydan itibaren bütçe yok; null = satırı sil.
create or replace function public.finance_budget_set(p_month date, p_direction text, p_category text, p_amount numeric)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
  v_month date := pg_catalog.date_trunc('month', p_month)::date;
  v_cat text := pg_catalog.btrim(coalesce(p_category, ''));
begin
  if p_month is null or p_direction is null or p_direction not in ('in', 'out') or char_length(v_cat) not between 1 and 60
     or (p_amount is not null and (p_amount < 0 or p_amount > 9999999999.99 or pg_catalog.round(p_amount, 2) <> p_amount)) then
    perform public.finance_v2_raise('invalid_input');
  end if;
  if v_cat = 'maas' and not public.finance_is_owner_gm() then perform public.finance_v2_raise('forbidden'); end if;
  if p_amount is null then
    delete from public.finance_budgets b
     where b.tenant_id = v_tenant and b.period_month = v_month and b.direction = p_direction and b.category = v_cat;
    return;
  end if;
  insert into public.finance_budgets (tenant_id, period_month, direction, category, amount, created_by)
  values (v_tenant, v_month, p_direction, v_cat, p_amount, auth.uid())
  on conflict (tenant_id, period_month, direction, category)
  do update set amount = excluded.amount, updated_at = pg_catalog.now(), created_by = excluded.created_by;
end;
$$;

create or replace function public.finance_budget_vs_actual(p_month date)
returns table (direction text, category text, budget numeric, actual numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
  v_m date := pg_catalog.date_trunc('month', p_month)::date;
  v_m_end date;
begin
  if p_month is null then perform public.finance_v2_raise('invalid_input'); end if;
  v_m_end := (v_m + interval '1 month')::date;
  return query
  with b as (
    select distinct on (fb.direction, fb.category) fb.direction as bdir, fb.category as bcat, fb.amount as bamt
      from public.finance_budgets fb
     where fb.tenant_id = v_tenant and fb.period_month <= v_m and (fb.category is distinct from 'maas' or v_gm)
     order by fb.direction, fb.category, fb.period_month desc
  ),
  a as (
    select 'out'::text as adir, x.category::text as acat, x.amount as aamt
      from public.expenses x
     where x.tenant_id = v_tenant and x.is_sample = false and x.expense_date >= v_m and x.expense_date < v_m_end
       and not exists (select 1 from public.owner_charge_links l where l.kind = 'expense' and l.ref_id = x.id and l.tenant_id = x.tenant_id)
    union all
    select e.direction, coalesce(e.category, case when e.direction = 'in' then 'diger_gelir' else 'diger_gider' end),
           e.amount + coalesce(e.withholding_amount, 0)
      from public.cash_entries e
      join public.finance_accounts ac on ac.id = e.account_id and ac.tenant_id = e.tenant_id and ac.owner_scope = 'office'
     where e.tenant_id = v_tenant and e.voided_at is null and e.is_sample = false and e.currency = 'TRY'
       and e.entry_date >= v_m and e.entry_date < v_m_end
       and ((e.kind = 'income') or (e.kind = 'expense' and e.expense_id is null))
       and coalesce(e.category, '') not in ('transfer', 'mulk_sahibi_odeme')
       and (e.category is distinct from 'maas' or v_gm)
  ),
  aa as (select a.adir, a.acat, sum(a.aamt) as aamt from a group by a.adir, a.acat)
  select coalesce(b.bdir, aa.adir), coalesce(b.bcat, aa.acat), coalesce(b.bamt, 0)::numeric, coalesce(aa.aamt, 0)::numeric
    from b
    full join aa on aa.adir = b.bdir and aa.acat = b.bcat
   where coalesce(b.bamt, 0) > 0 or coalesce(aa.aamt, 0) > 0
   order by 1, 2;
end;
$$;

-- ===========================================================================
-- Ek ve ayar
-- ===========================================================================
create or replace function public.finance_attachment_register(p_storage_path text, p_file_name text, p_file_type text,
  p_file_size bigint, p_entry_id uuid default null, p_open_item_id uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('create');
  v_id uuid;
begin
  if p_storage_path is null or pg_catalog.left(p_storage_path, char_length(v_tenant::text) + 8) <> v_tenant::text || '/ledger/'
     or pg_catalog.strpos(p_storage_path, '..') > 0 or char_length(p_storage_path) > 500
     or char_length(pg_catalog.btrim(coalesce(p_file_name, ''))) not between 1 and 200
     or char_length(coalesce(p_file_type, '')) > 100
     or (p_file_size is not null and (p_file_size < 0 or p_file_size > 26214400)) then
    perform public.finance_v2_raise('invalid_input');
  end if;
  if p_entry_id is not null and not exists (select 1 from public.cash_entries e where e.id = p_entry_id and e.tenant_id = v_tenant) then
    perform public.finance_v2_raise('not_found');
  end if;
  if p_open_item_id is not null and not exists (select 1 from public.finance_open_items o where o.id = p_open_item_id and o.tenant_id = v_tenant) then
    perform public.finance_v2_raise('not_found');
  end if;
  begin
    insert into public.finance_attachments (tenant_id, entry_id, open_item_id, storage_path, file_name, file_type, file_size, uploaded_by)
    values (v_tenant, p_entry_id, p_open_item_id, p_storage_path, pg_catalog.btrim(p_file_name), nullif(p_file_type, ''), p_file_size, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    perform public.finance_v2_raise('duplicate');
  end;
  return v_id;
end;
$$;

-- Eki harekete / kaleme bağlar; ikisi de null ise fiş kutusuna geri koyar.
create or replace function public.finance_attachment_link(p_id uuid, p_entry_id uuid default null, p_open_item_id uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
begin
  if p_entry_id is not null and not exists (select 1 from public.cash_entries e where e.id = p_entry_id and e.tenant_id = v_tenant) then
    perform public.finance_v2_raise('not_found');
  end if;
  if p_open_item_id is not null and not exists (select 1 from public.finance_open_items o where o.id = p_open_item_id and o.tenant_id = v_tenant) then
    perform public.finance_v2_raise('not_found');
  end if;
  update public.finance_attachments fa set entry_id = p_entry_id, open_item_id = p_open_item_id
   where fa.id = p_id and fa.tenant_id = v_tenant;
  if not found then perform public.finance_v2_raise('not_found'); end if;
end;
$$;

create or replace function public.finance_attachment_set_ocr(p_id uuid, p_status text, p_json jsonb default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('create');
begin
  if p_status is null or p_status not in ('none', 'pending', 'done', 'failed')
     or (p_json is not null and pg_catalog.pg_column_size(p_json) > 20000) then
    perform public.finance_v2_raise('invalid_input');
  end if;
  update public.finance_attachments fa set ocr_status = p_status, ocr_json = p_json
   where fa.id = p_id and fa.tenant_id = v_tenant;
  if not found then perform public.finance_v2_raise('not_found'); end if;
end;
$$;

-- Ayar kaydı: verilmeyen anahtar mevcut değerini (yoksa varsayılanını) korur.
create or replace function public.finance_settings_save(p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
  v_cur public.finance_settings%rowtype;
  v_base text;
  v_vat numeric;
  v_inc boolean;
  v_ocr boolean;
  v_min numeric;
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then perform public.finance_v2_raise('invalid_input'); end if;
  select * into v_cur from public.finance_settings s where s.tenant_id = v_tenant;
  begin
    v_base := case when p ? 'base_currency' then p ->> 'base_currency' else coalesce(v_cur.base_currency, 'TRY') end;
    v_vat := case when p ? 'default_vat_rate' then (p ->> 'default_vat_rate')::numeric else coalesce(v_cur.default_vat_rate, 20) end;
    v_inc := case when p ? 'vat_included_default' then (p ->> 'vat_included_default')::boolean else coalesce(v_cur.vat_included_default, true) end;
    v_ocr := case when p ? 'ocr_enabled' then (p ->> 'ocr_enabled')::boolean else coalesce(v_cur.ocr_enabled, false) end;
    v_min := case when p ? 'forecast_min_balance' then nullif(p ->> 'forecast_min_balance', '')::numeric else v_cur.forecast_min_balance end;
  exception when invalid_text_representation or numeric_value_out_of_range then
    perform public.finance_v2_raise('invalid_input');
  end;
  if v_base is null or v_base not in ('TRY', 'USD', 'EUR') or v_vat is null or v_vat < 0 or v_vat > 100
     or v_inc is null or v_ocr is null or (v_min is not null and abs(v_min) > 9999999999.99) then
    perform public.finance_v2_raise('invalid_input');
  end if;
  insert into public.finance_settings (tenant_id, base_currency, default_vat_rate, vat_included_default, ocr_enabled, forecast_min_balance, updated_by, updated_at)
  values (v_tenant, v_base, v_vat, v_inc, v_ocr, v_min, auth.uid(), pg_catalog.now())
  on conflict (tenant_id) do update
    set base_currency = excluded.base_currency, default_vat_rate = excluded.default_vat_rate,
        vat_included_default = excluded.vat_included_default, ocr_enabled = excluded.ocr_enabled,
        forecast_min_balance = excluded.forecast_min_balance, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

-- ===========================================================================
-- Yetkiler: yardımcılar istemciye kapalı; RPC'ler authenticated + service_role
-- ===========================================================================
revoke all on function public.finance_v2_raise(text) from public, anon, authenticated;
revoke all on function public.finance_v2_ctx(text) from public, anon, authenticated;
revoke all on function public.finance_v2_resolve_party(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.finance_v2_check_category(uuid, text, text) from public, anon, authenticated;
revoke all on function public.finance_v2_cash_total(jsonb) from public, anon, authenticated;
grant execute on function public.finance_v2_raise(text) to service_role;
grant execute on function public.finance_v2_ctx(text) to service_role;

revoke all on function public.finance_fx(text, jsonb) from public, anon;
revoke all on function public.finance_vat_split(numeric, numeric, boolean) from public, anon;
revoke all on function public.finance_entry_amounts(numeric, numeric, boolean, numeric) from public, anon;
revoke all on function public.finance_record_entry_v2(jsonb) from public, anon;
revoke all on function public.finance_update_entry_v2(uuid, jsonb) from public, anon;
revoke all on function public.finance_adopt_legacy_expenses(uuid, uuid[]) from public, anon;
revoke all on function public.finance_party_upsert(jsonb) from public, anon;
revoke all on function public.finance_party_set_archived(uuid, boolean) from public, anon;
revoke all on function public.finance_party_balances(text, text) from public, anon;
revoke all on function public.finance_party_statement(uuid, date, date) from public, anon;
revoke all on function public.finance_open_item_create(jsonb) from public, anon;
revoke all on function public.finance_open_item_cancel(uuid, text) from public, anon;
revoke all on function public.finance_open_item_settle(uuid, uuid, numeric, date, text) from public, anon;
revoke all on function public.finance_aging(text) from public, anon;
revoke all on function public.finance_overview(date, date, jsonb) from public, anon;
revoke all on function public.finance_cashflow_forecast(integer, jsonb) from public, anon;
revoke all on function public.finance_pnl(date, date) from public, anon;
revoke all on function public.finance_vat_summary(date, date) from public, anon;
revoke all on function public.finance_category_upsert(jsonb) from public, anon;
revoke all on function public.finance_category_archive(uuid) from public, anon;
revoke all on function public.finance_rule_upsert(jsonb) from public, anon;
revoke all on function public.finance_rule_delete(uuid) from public, anon;
revoke all on function public.finance_rule_suggest(text, numeric, text, text) from public, anon;
revoke all on function public.finance_period_lock(date, text) from public, anon;
revoke all on function public.finance_period_unlock(date) from public, anon;
revoke all on function public.finance_budget_set(date, text, text, numeric) from public, anon;
revoke all on function public.finance_budget_vs_actual(date) from public, anon;
revoke all on function public.finance_attachment_register(text, text, text, bigint, uuid, uuid) from public, anon;
revoke all on function public.finance_attachment_link(uuid, uuid, uuid) from public, anon;
revoke all on function public.finance_attachment_set_ocr(uuid, text, jsonb) from public, anon;
revoke all on function public.finance_settings_save(jsonb) from public, anon;

grant execute on function public.finance_fx(text, jsonb) to authenticated, service_role;
grant execute on function public.finance_vat_split(numeric, numeric, boolean) to authenticated, service_role;
grant execute on function public.finance_entry_amounts(numeric, numeric, boolean, numeric) to authenticated, service_role;
grant execute on function public.finance_record_entry_v2(jsonb) to authenticated, service_role;
grant execute on function public.finance_update_entry_v2(uuid, jsonb) to authenticated, service_role;
grant execute on function public.finance_adopt_legacy_expenses(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.finance_party_upsert(jsonb) to authenticated, service_role;
grant execute on function public.finance_party_set_archived(uuid, boolean) to authenticated, service_role;
grant execute on function public.finance_party_balances(text, text) to authenticated, service_role;
grant execute on function public.finance_party_statement(uuid, date, date) to authenticated, service_role;
grant execute on function public.finance_open_item_create(jsonb) to authenticated, service_role;
grant execute on function public.finance_open_item_cancel(uuid, text) to authenticated, service_role;
grant execute on function public.finance_open_item_settle(uuid, uuid, numeric, date, text) to authenticated, service_role;
grant execute on function public.finance_aging(text) to authenticated, service_role;
grant execute on function public.finance_overview(date, date, jsonb) to authenticated, service_role;
grant execute on function public.finance_cashflow_forecast(integer, jsonb) to authenticated, service_role;
grant execute on function public.finance_pnl(date, date) to authenticated, service_role;
grant execute on function public.finance_vat_summary(date, date) to authenticated, service_role;
grant execute on function public.finance_category_upsert(jsonb) to authenticated, service_role;
grant execute on function public.finance_category_archive(uuid) to authenticated, service_role;
grant execute on function public.finance_rule_upsert(jsonb) to authenticated, service_role;
grant execute on function public.finance_rule_delete(uuid) to authenticated, service_role;
grant execute on function public.finance_rule_suggest(text, numeric, text, text) to authenticated, service_role;
grant execute on function public.finance_period_lock(date, text) to authenticated, service_role;
grant execute on function public.finance_period_unlock(date) to authenticated, service_role;
grant execute on function public.finance_budget_set(date, text, text, numeric) to authenticated, service_role;
grant execute on function public.finance_budget_vs_actual(date) to authenticated, service_role;
grant execute on function public.finance_attachment_register(text, text, text, bigint, uuid, uuid) to authenticated, service_role;
grant execute on function public.finance_attachment_link(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.finance_attachment_set_ocr(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.finance_settings_save(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
