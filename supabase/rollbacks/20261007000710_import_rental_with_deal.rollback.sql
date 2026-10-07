-- Rollback: 20261007000710_import_rental_with_deal
-- Yalnız RPC düşer. Aktarılmış kira/anlaşma/komisyon kayıtları KALIR (ofisin iş kaydıdır; kira Kiralama ekranından
-- sonlandırılır). Kod RPC yokken "Kiralama" içe aktarma türünü "etkin değil" diye kapatır (yoklama).

set local lock_timeout = '5s';

drop function if exists public.import_rental_with_deal(
  uuid, uuid, numeric, integer, date, date, numeric, numeric, uuid, uuid, text, uuid
);

notify pgrst, 'reload schema';
