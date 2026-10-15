-- Geri alma: 20261017010000_finance_posting_core.sql
-- ONCE 20261017010100 geri alinir (v3 gorunumu posting_key okur). Kayit servisi, ters kayit, denetim tetikleyicileri ve kural
-- tablosu duser; posting_key / event_type / reversal_of / invoice_id kolonlari (icerikleriyle) KAYBOLUR; kayit servisinin yazdigi
-- hareket ve kalem satirlari KALIR (eski RPC'ler okur). Acik kalem odeme hesabi 20261014001000 govdesine doner (ayna kayitlar
-- artik isaretli sayilmaz: once ayna kayit varsa geri alma durur).
-- Yeni kaynak turuyle (commission_payout/invoice/deposit/subscription) yazilmis hareket varsa ya da eski kaynak tekilligini
-- bozacak satir varsa geri alma DURUR (veri elle incelenmeden CHECK/indeks daraltilamaz).
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.finance_open_items_v') is not null
     and pg_catalog.pg_get_viewdef('public.finance_open_items_v'::regclass) like '%posting_key%' then
    raise exception 'Once 20261017010100_finance_open_items_v3.rollback.sql calistirilmali.';
  end if;
  if exists (select 1 from public.cash_entries where source_type in ('commission_payout', 'invoice', 'deposit', 'subscription')) then
    raise exception 'Yeni kaynak turuyle yazilmis hareket var; geri alma durdu (once incelenmeli).';
  end if;
  if exists (select 1 from public.cash_entries where reversal_of is not null)
     or exists (select 1 from public.finance_open_items where reversal_of is not null) then
    raise exception 'Ters kayit (ayna) satiri var; geri alma durdu (once incelenmeli).';
  end if;
  if exists (select 1 from public.cash_entries e where e.source_id is not null and e.voided_at is null
              group by e.tenant_id, e.source_type, e.source_id, e.account_id having count(*) > 1) then
    raise exception 'Ayni kaynaga birden cok etkin hareket var; eski tekillik indeksi kurulamaz, geri alma durdu.';
  end if;
end $$;

drop trigger if exists trg_cash_entries_audit on public.cash_entries;
drop trigger if exists trg_finance_open_items_audit on public.finance_open_items;
drop function if exists public.finance_ledger_audit();
drop function if exists public.finance_reverse(uuid, text, date);
drop function if exists public.finance_reverse_internal(uuid, uuid, uuid, text, date);
drop function if exists public.finance_post(jsonb);
drop function if exists public.finance_post_internal(uuid, uuid, jsonb);
drop function if exists public.finance_posting_source_exists(uuid, text, uuid);
drop function if exists public.finance_posting_source_table(text);
drop function if exists public.finance_first_open_date(uuid, date);
drop table if exists public.finance_posting_rules;

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
revoke all on function public.finance_open_item_recompute(uuid) from public, anon, authenticated;
grant execute on function public.finance_open_item_recompute(uuid) to service_role;

drop index if exists public.idx_cash_entries_source_unique;
create unique index if not exists idx_cash_entries_source_unique
  on public.cash_entries (tenant_id, source_type, source_id, account_id)
  where source_id is not null and voided_at is null;

do $$
declare c record;
begin
  for c in select con.conname from pg_catalog.pg_constraint con
            where con.conrelid = 'public.cash_entries'::regclass and con.contype = 'c'
              and pg_catalog.pg_get_constraintdef(con.oid) like '%source_type%' loop
    execute pg_catalog.format('alter table public.cash_entries drop constraint %I', c.conname);
  end loop;
  alter table public.cash_entries add constraint cash_entries_source_type_check
    check (source_type in ('manual', 'commission', 'rent', 'due', 'building', 'recurring', 'import', 'owner_payout'));
end $$;

drop index if exists public.idx_cash_entries_posting_key;
drop index if exists public.idx_finance_open_items_posting_key;
drop index if exists public.idx_cash_entries_reversal_of;
drop index if exists public.idx_finance_open_items_reversal_of;
drop index if exists public.idx_finance_open_items_invoice;
alter table public.cash_entries drop constraint if exists cash_entries_posting_key_len;
alter table public.cash_entries drop constraint if exists cash_entries_event_type_len;
alter table public.finance_open_items drop constraint if exists finance_open_items_posting_key_len;
alter table public.finance_open_items drop constraint if exists finance_open_items_event_type_len;
alter table public.cash_entries drop column if exists reversal_of;
alter table public.cash_entries drop column if exists event_type;
alter table public.cash_entries drop column if exists posting_key;
alter table public.finance_open_items drop column if exists invoice_id;
alter table public.finance_open_items drop column if exists reversal_of;
alter table public.finance_open_items drop column if exists event_type;
alter table public.finance_open_items drop column if exists posting_key;
notify pgrst, 'reload schema';
