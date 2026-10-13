-- 20261013008200 geri alma: elle mutabakat RPC'si kaldırılır. cash_entries.reconciled_at değerleri OLDUĞU GİBİ kalır
-- (elle işaretlenmiş mutabakatlar silinmez); Hareketler'deki toplu "Mutabık işaretle" "kurulum bekliyor" der. Veri kaybı yok.

set local lock_timeout = '5s';

drop function if exists public.finance_entries_set_reconciled(uuid[], boolean);
notify pgrst, 'reload schema';
