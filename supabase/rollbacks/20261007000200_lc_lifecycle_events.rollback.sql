-- Rollback: 20261007000200_lc_lifecycle_events. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Tetikleyici + fonksiyon + append-only olay tablosu (ve icindeki gecis kayitlari) DUSER. property_control_state ve
-- stage_since degismez. Kod tablo yokken zaman cizelgesinde asama gecislerini gostermez (hata vermez).

set local lock_timeout = '5s';

drop trigger if exists trg_lc_lifecycle_event on public.property_control_state;
drop function if exists public.lc_record_lifecycle_event();
drop table if exists public.lc_lifecycle_events;

notify pgrst, 'reload schema';
