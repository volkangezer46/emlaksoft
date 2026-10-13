-- Rollback: 20261014001000_finance_ledger_v2
-- ÖNCE 20261014001200 ve 20261014001100 rollback'leri çalıştırılır. Bu dosya finans v2 şemasını düşürür:
-- görünümler, tetikler, yeni tablolar (cari, açık kalem, ek kayıtları, kategori, kural, ay kilidi, bütçe, ayar, kayıtlı görünüm)
-- ve cash_entries / recurring_rules'a eklenen kolonlar. VERİ KAYBI: bu tablolara girilen cari/kalem/ek kaydı/bütçe ve
-- hareketlerdeki KDV/stopaj/cari bağı kaybolur. Hareketlerin tutarı/tarihi/hesabı ve bakiye DEĞİŞMEZ; expenses ve
-- expense_budgets etkilenmez. Depodaki (expense-receipts) ek dosyaları silinmez.

set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['finance_open_items', 'finance_parties'] loop
      if exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute pg_catalog.format('alter publication supabase_realtime drop table public.%I', t);
      end if;
    end loop;
  end if;
end
$$;

drop view if exists public.finance_open_items_v;
drop view if exists public.finance_ledger_v;

drop trigger if exists trg_cash_entries_open_item_upd on public.cash_entries;
drop trigger if exists trg_cash_entries_open_item_ins on public.cash_entries;
drop trigger if exists trg_cash_entries_period_lock on public.cash_entries;
drop trigger if exists trg_finance_open_items_period_lock on public.finance_open_items;
drop function if exists public.finance_entry_open_item_sync();
drop function if exists public.finance_open_item_recompute(uuid);
drop function if exists public.finance_period_lock_guard();
drop function if exists public.finance_period_is_locked(uuid, date);

alter table public.recurring_rules drop column if exists withholding_rate;
alter table public.recurring_rules drop column if exists vat_rate;
alter table public.recurring_rules drop column if exists party_id;

drop index if exists public.idx_cash_entries_expense;
drop index if exists public.idx_cash_entries_property;
drop index if exists public.idx_cash_entries_open_item;
drop index if exists public.idx_cash_entries_party;
alter table public.cash_entries drop column if exists open_item_id;
alter table public.cash_entries drop column if exists property_id;
alter table public.cash_entries drop column if exists withholding_amount;
alter table public.cash_entries drop column if exists withholding_rate;
alter table public.cash_entries drop column if exists vat_included;
alter table public.cash_entries drop column if exists vat_amount;
alter table public.cash_entries drop column if exists vat_rate;
alter table public.cash_entries drop column if exists party_id;

drop table if exists public.finance_saved_views;
drop table if exists public.finance_settings;
drop table if exists public.finance_budgets;
drop table if exists public.finance_period_locks;
drop table if exists public.finance_rules;
drop table if exists public.finance_categories;
drop table if exists public.finance_attachments;
drop table if exists public.finance_open_items;
drop table if exists public.finance_parties;

notify pgrst, 'reload schema';
