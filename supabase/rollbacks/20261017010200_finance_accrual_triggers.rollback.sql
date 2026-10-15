-- Geri alma: 20261017010200_finance_accrual_triggers.sql
-- ONCE 20261017010400 ve 20261017010300 geri alinir. Tetikleyiciler ve esitleme fonksiyonlari duser; finance_open_item_recompute
-- 20261017010000 govdesine doner; offbook_amount kolonu duser (kalemlerin mevcut paid_amount / status degerleri YERINDE KALIR,
-- yeniden hesaplanmaz: kasa disi kapanmis kalem kapali gorunmeye devam eder).
-- VERI: tetikleyicinin / geri doldurmanin actigi tahakkuk kalemleri, cariler ve eski yol hareketlerinin open_item_id bagi
-- YERINDE KALIR (silme yok; nakit yazilmadigi icin kasa bakiyesi degismez). Kalemleri kapatmak gerekirse finance_reverse ile tek tek.
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.finance_pnl(date,date,text)') is not null then
    raise exception 'Once 20261017010400_finance_pnl_v3.rollback.sql calistirilmali.';
  end if;
  if pg_catalog.to_regprocedure('public.finance_accrual_backfill()') is not null then
    raise exception 'Once 20261017010300_finance_parties_backfill.rollback.sql calistirilmali.';
  end if;
end $$;

drop trigger if exists trg_commissions_finance_accrual on public.commissions;
drop trigger if exists trg_commission_splits_finance_accrual on public.commission_splits;
drop trigger if exists trg_commission_payouts_finance_accrual on public.commission_payouts;
drop trigger if exists trg_building_charges_finance_accrual on public.building_charges;
drop trigger if exists trg_cash_entries_accrual_link on public.cash_entries;

drop function if exists public.finance_accrual_source_trg();
drop function if exists public.cash_entries_accrual_link();
drop function if exists public.finance_building_accrual_sync(uuid);
drop function if exists public.finance_payout_accrual_sync(uuid);
drop function if exists public.finance_commission_accrual_sync(uuid);
drop function if exists public.finance_split_accrual_sync(uuid);
drop function if exists public.finance_accrual_link_cash(uuid, text, uuid[]);
drop function if exists public.finance_accrual_cash_target(uuid, text, uuid);
drop function if exists public.finance_accrual_apply_offbook(uuid, numeric);
drop function if exists public.finance_accrual_sync(uuid, text, text, jsonb, text);
drop function if exists public.finance_accrual_active_item(uuid, text, text);
drop function if exists public.finance_accrual_key_match(text, text);
drop function if exists public.finance_accrual_party(uuid, text, text, uuid, uuid);
drop function if exists public.finance_accrual_actor();

-- 20261017010000 govdesi (kasa disi taban yok).
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

revoke all on function public.finance_open_item_recompute(uuid) from public, anon, authenticated;
grant execute on function public.finance_open_item_recompute(uuid) to service_role;

alter table public.finance_open_items drop constraint if exists finance_open_items_offbook_amount_check;
alter table public.finance_open_items drop column if exists offbook_amount;
delete from public.finance_posting_rules where event_type = 'payout.approved';
