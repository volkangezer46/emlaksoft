-- UYGULANMADI (canlıya henüz uygulanmadı; sahibin onayı + yedek doğrulaması sonrası `npm run db:migrate`).
--
-- finance_record_entry: kaynaklı (source_type <> 'manual') dal sertleştirmesi (Güvenlik-4).
--  1) Tutar tavanı: TL hesapta p_amount kaynağın tutarını aşamaz -> {outcome:'invalid_input', reason:'amount_exceeds_source'}.
--     commission: gross_amount + vat_amount (KDV dahil/hariç hangisi girilmişse en büyük meşru tutar); rent: rent_payments.amount;
--     building: building_payments.amount. Eşitlik aranmaz. TL olmayan hesapta kur bilinmediğinden tavan uygulanmaz.
--  2) Komisyonda paid/collected şartı ARANMAZ (toplu tahsilat önce paid yapar, sonra hareketi yazar).
--  3) Mükerrer kontrolü hesaptan bağımsız (statement_apply 20261011001400 ile aynı): aynı tahsilat ikinci hesaba yazılamaz;
--     duplicate dönüşü mevcut entry_id'yi korur (idempotent yeniden deneme).
--  4) Benzersiz indeks BU dosyada YOK. İndeks öncesi SAHİBİN çalıştıracağı salt-okunur çakışma sorgusu (sonuç boş olmalı):
--
--       select tenant_id, source_type, source_id, count(*) as adet,
--              array_agg(id order by created_at) as entry_ids, array_agg(account_id order by created_at) as account_ids
--         from public.cash_entries
--        where voided_at is null and source_id is not null
--        group by tenant_id, source_type, source_id
--       having count(*) > 1
--        order by adet desc;
--
--     Çıkan çiftler elle iptal edilmeden (finance_void_entry) indeks eklenmez; indeks ayrı bir sonraki migration'da gelir.
-- İmza DEĞİŞMEDİ (grant/revoke korunur). Gövde = 20261010000600 + yukarıdaki farklar (sonraki yeniden tanım yok).
-- GERİ ALMA: supabase/rollbacks/20261012001400_finance_entry_source_amount_guard.rollback.sql (000600 gövdesi geri konur).

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
  v_cap numeric;
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
    -- Mükerrer kontrolü HESAPTAN BAĞIMSIZ (statement_apply 20261011001400 ile aynı mantık): aynı tahsilat başka hesaba da yazılamaz.
    select e.id into v_dup from public.cash_entries e
     where e.tenant_id = v_tenant and e.source_type = p_source_type and e.source_id = p_source_id and e.voided_at is null
     order by e.created_at, e.id
     limit 1;
    if v_dup is not null then return jsonb_build_object('outcome', 'duplicate', 'entry_id', v_dup); end if;
    -- Tutar tavanı: kaynak kaydın tutarını aşan tahsilat hareketi yazılamaz (eşitlik aranmaz; kısmi tahsilat serbest).
    -- Kaynak tutarlar TL'dir; hesap TL değilse (kur bilinmez) tavan UYGULANMAZ.
    -- Komisyon için paid/collected şartı ARANMAZ: toplu tahsilat önce paid yapar, sonra hareketi yazar.
    if v_acc.currency = 'TRY' then
      v_cap := case p_source_type
                 when 'commission' then (select c.gross_amount + greatest(coalesce(c.vat_amount, 0), 0)
                                           from public.commissions c where c.id = p_source_id and c.tenant_id = v_tenant)
                 when 'rent' then (select r.amount from public.rent_payments r where r.id = p_source_id and r.tenant_id = v_tenant)
                 else (select b.amount from public.building_payments b where b.id = p_source_id and b.tenant_id = v_tenant)
               end;
      if v_cap is not null and p_amount > v_cap then
        return jsonb_build_object('outcome', 'invalid_input', 'reason', 'amount_exceeds_source');
      end if;
    end if;
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
     where e.tenant_id = v_tenant and e.source_type = p_source_type and e.source_id = p_source_id and e.voided_at is null
     order by e.created_at, e.id
     limit 1;
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

revoke all on function public.finance_record_entry(uuid, text, numeric, date, text, text, text, text, text, text, uuid, boolean, text, uuid) from public, anon;
grant execute on function public.finance_record_entry(uuid, text, numeric, date, text, text, text, text, text, text, uuid, boolean, text, uuid) to authenticated, service_role;
