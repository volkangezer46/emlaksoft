-- Finans (Konsey Tur 2, P2): ekstre uygulama = düzenli ödeme ve komisyon TEK GERÇEK.
--
-- NEDEN: finance_statement_apply yalnız create/match/skip biliyordu. Düzenli ödeme önerisi "create" olarak gidince cron'un yazdığı
--   dönem ile ekstre satırı İKİ gider/hareket üretiyordu; komisyon ekstreden bağlanınca komisyon "bekliyor" kalıyordu.
-- İÇERİK (tek fonksiyon: finance_statement_apply, tam gövde; imza/ACL değişmez):
--   1) action='recurring' + rule_id: o kuralın satır tarihine ±7 gün yakın dönemi; bekleyen dönem ekstre tutarıyla post edilir
--      (recurring_post_occurrence -> gider + hareket, mutabık), cron'la post edilmiş dönemin hareketi mutabık işaretlenir (yeni satır yok).
--      Cron henüz üretmediyse vadesi gelmiş sıradaki dönem burada üretilir; gelecek dönem üretilmez.
--   2) source_type='commission' ile create: hareketle AYNI işlemde commissions.status='paid' (workflow.ts mark_commission_paid ile aynı alan);
--      zaten tahsil edilmişse durum değişmez ama kasaya bağlanır. Aynı tahsilat başka hesaba işlenmişse reddedilir (tüm kaynaklar).
-- Bağımlılık: 20261011001200, 20261010000900. Dönüş biçimi ({outcome, created, matched, skipped, failed}) aynı; ek alanlara açık.
-- GERİ ALMA: rollbacks/20261011001400_statement_apply_recurring_commission.rollback.sql (önceki gövde geri yüklenir).
-- RİSK: düşük (tek fonksiyon gövdesi; yeni eylem yalnız yeni istemciden gelir).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.finance_statement_apply(uuid,jsonb)') is null
     or pg_catalog.to_regprocedure('public.recurring_post_occurrence(uuid,numeric,uuid)') is null
     or pg_catalog.to_regprocedure('public.recurring_advance(uuid,date)') is null then
    raise exception '20261011001400: 20261011001200 / 20261010000900 yok.';
  end if;
end $$;

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
  v_rule_id uuid;
  v_rule public.recurring_rules%rowtype;
  v_occ public.recurring_occurrences%rowtype;
  v_res text;
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

    elsif v_action = 'recurring' then
      -- Düzenli ödeme kuralı: bekleyen dönem ekstre satırıyla post edilir (gider + hareket tek işlemde, mutabık);
      -- cron'la zaten post edilmiş dönemin hareketi mutabık sayılır (ikinci gider/hareket YAZILMAZ).
      begin
        v_rule_id := (d->>'rule_id')::uuid;
      exception when invalid_text_representation then
        v_failed_n := v_failed_n + 1; continue;
      end;
      select * into v_rule from public.recurring_rules r
       where r.id = v_rule_id and r.tenant_id = v_tenant and r.account_id = p_account_id and r.direction = v_line.direction for update;
      if not found then v_failed_n := v_failed_n + 1; continue; end if;
      if not public.recurring_rule_access(v_rule.id, 'create') then v_failed_n := v_failed_n + 1; continue; end if;

      v_occ := null;
      select o.* into v_occ from public.recurring_occurrences o
       where o.rule_id = v_rule.id and o.tenant_id = v_tenant and o.status in ('pending', 'posted')
         and abs(o.due_date - v_line.line_date) <= 7
         and (o.status = 'pending' or exists (
               select 1 from public.cash_entries e
                where e.id = o.entry_id and e.tenant_id = v_tenant and e.voided_at is null and e.reconciled_at is null))
       order by abs(o.due_date - v_line.line_date), o.due_date desc
       limit 1 for update;
      if not found then
        -- Dönem henüz üretilmediyse (cron çalışmadı) vadesi gelmiş sıradaki dönem burada üretilir; gelecek dönem üretilmez.
        if v_rule.active and v_rule.next_due is not null and v_rule.next_due <= v_today and abs(v_rule.next_due - v_line.line_date) <= 7 then
          insert into public.recurring_occurrences (tenant_id, rule_id, period, due_date, amount, status)
          values (v_rule.tenant_id, v_rule.id, v_rule.next_period, v_rule.next_due, v_rule.amount, 'pending')
          on conflict (rule_id, period) do nothing
          returning * into v_occ;
          if v_occ.id is not null then perform public.recurring_advance(v_rule.id, v_rule.next_period); end if;
        end if;
        if v_occ.id is null then v_failed_n := v_failed_n + 1; continue; end if;
      end if;

      if v_occ.status = 'pending' then
        v_res := public.recurring_post_occurrence(v_occ.id, v_line.amount, v_uid);
        if v_res <> 'posted' then v_failed_n := v_failed_n + 1; continue; end if;
        select o.entry_id into v_entry from public.recurring_occurrences o where o.id = v_occ.id;
        update public.cash_entries set reconciled_at = pg_catalog.now() where id = v_entry and tenant_id = v_tenant;
        update public.finance_statement_lines set status = 'posted', entry_id = v_entry, decided_at = pg_catalog.now() where id = v_line.id;
        v_created_n := v_created_n + 1;
      else
        update public.cash_entries e set reconciled_at = pg_catalog.now()
         where e.id = v_occ.entry_id and e.tenant_id = v_tenant and e.account_id = p_account_id and e.voided_at is null and e.reconciled_at is null
           and e.direction = v_line.direction and e.amount = v_line.amount;
        if not found then v_failed_n := v_failed_n + 1; continue; end if;
        update public.finance_statement_lines set status = 'matched', entry_id = v_occ.entry_id, decided_at = pg_catalog.now() where id = v_line.id;
        v_matched_n := v_matched_n + 1;
      end if;

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
        -- Aynı tahsilat başka bir hesaba zaten işlenmişse ikinci hareket YAZILMAZ (kısmi benzersiz indeks yalnız aynı hesabı yakalar).
        if exists (select 1 from public.cash_entries e
                    where e.tenant_id = v_tenant and e.source_type = v_src and e.source_id = v_src_id and e.voided_at is null) then
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
      -- Komisyon tahsilatı: kasa hareketiyle AYNI işlemde komisyon "tahsil edildi" olur (workflow.ts mark_commission_paid ile aynı alan).
      if v_src = 'commission' then
        update public.commissions c set status = 'paid'
         where c.id = v_src_id and c.tenant_id = v_tenant and c.status not in ('paid', 'collected');
        if found then
          insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
          values (v_tenant, v_uid, 'commission.paid', 'commission', v_src_id, jsonb_build_object('via', 'bank_statement', 'entry_id', v_entry));
        end if;
      end if;
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

revoke all on function public.finance_statement_apply(uuid, jsonb) from public, anon;
grant execute on function public.finance_statement_apply(uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
