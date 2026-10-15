-- 20261020010002 geri alma: aktarilan "Onceki notlar" kayitlari (origin = 'customers.notes') silinir (kaynak metin
--   customers.notes'ta hic degismeden duruyor), sabitleme / anma / kaynak kolonlari duser.
-- ONKOSUL: 20261020010003 once geri alinir (isi ve aday RPC'leri origin kolonunu okur).
set local lock_timeout = '5s';

delete from public.communications where origin = 'customers.notes';

drop index if exists public.idx_communications_customer_pinned;
drop index if exists public.idx_communications_mentions;
drop index if exists public.idx_communications_pinned_by;

alter table public.communications
  drop column if exists origin,
  drop column if exists mentioned_user_ids,
  drop column if exists pinned_by,
  drop column if exists pinned_at;
