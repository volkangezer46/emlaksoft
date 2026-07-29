-- C.3 — Kira sözleşmesi yaşam döngüsü: portföy durumu yönetimi + depozito iadesi.
-- Önceden createRental portföyü 'rented' yapmıyor, endRental durumu geri açmıyor
-- ve depozito iadesi hiç izlenmiyordu.
--   · prev_property_status : kira başlarken portföyün durumu saklanır → bitince
--     aynı duruma geri döndürülür (körlemesine bir değere set etmek yerine).
--   · deposit_returned / _at : depozito iadesi ayrı fiziksel olay; işaretlenir.
alter table public.rentals
  add column if not exists prev_property_status text,
  add column if not exists deposit_returned      boolean not null default false,
  add column if not exists deposit_returned_at    timestamptz;
