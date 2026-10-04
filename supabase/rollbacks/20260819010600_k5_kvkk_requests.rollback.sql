-- Rollback: 20260819010600_k5_kvkk_requests
-- UYARI: tum KVKK talep kayitlari kalici olarak silinir.
drop table if exists public.kvkk_requests;

notify pgrst, 'reload schema';
