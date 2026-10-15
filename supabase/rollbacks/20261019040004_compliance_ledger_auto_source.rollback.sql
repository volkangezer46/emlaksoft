-- 20261019040004 geri alma: otomatik kaynak etiketi ve tekillik indeksi duser. Defter satirlari KALIR (degismez kayit);
--   otomatik olusmus satirlar elle kayit gibi gorunur.
set local lock_timeout = '5s';

drop index if exists public.idx_compliance_ledger_auto_deal_party;
drop index if exists public.idx_compliance_ledger_deal;
alter table public.compliance_ledger_entries drop constraint if exists compliance_ledger_entries_source_check;
alter table public.compliance_ledger_entries drop column if exists source;
