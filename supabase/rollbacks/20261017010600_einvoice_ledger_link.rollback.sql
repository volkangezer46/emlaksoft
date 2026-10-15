-- 20261017010600 geri alma: e-Fatura <-> defter tetikleri, esitleme/cari/geri doldurma fonksiyonlari ve einvoices.party_id /
--   open_item_id kolonlari duser. Fatura akisi (taslak, resmilestirme, iptal) degismeden calisir; yalniz deftere yazmaz.
-- VERI: serbest faturalar icin acilmis 'invoice.issued' alacaklari (finance_open_items.event_type = 'invoice.issued') ve
--   komisyon alacaklarindaki invoice_id bagi SILINMEZ (muhasebe kaydidir; Muhasebe > Cari'de kalem olarak gorunur).
--   Yeni cariler (finance_parties, kind musteri) kalir.
set local lock_timeout = '5s';

drop trigger if exists trg_einvoices_ledger_link_ins on public.einvoices;
drop trigger if exists trg_einvoices_ledger_link_upd on public.einvoices;
drop trigger if exists trg_finance_open_items_einvoice_link on public.finance_open_items;

drop function if exists public.finance_einvoice_ledger_backfill();
drop function if exists public.finance_open_items_einvoice_link();
drop function if exists public.einvoices_ledger_link();
drop function if exists public.finance_einvoice_ledger_sync(uuid, uuid, boolean);
drop function if exists public.finance_einvoice_ledger_note(uuid, uuid, uuid, text, jsonb);
drop function if exists public.finance_einvoice_party(uuid, text, text, uuid);

drop index if exists public.idx_einvoices_open_item;
drop index if exists public.idx_einvoices_party;
alter table public.einvoices drop column if exists open_item_id;
alter table public.einvoices drop column if exists party_id;
