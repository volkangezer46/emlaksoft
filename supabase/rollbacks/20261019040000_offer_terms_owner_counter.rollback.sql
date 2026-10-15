-- 20261019040000 geri alma: malik karsi teklif RPC'si ve teklif kosul sutunlari duser. Kosul verisi (odeme sekli, kapora,
--   tapu tarihi, kredi sarti, takas notu, malik karsi teklifi) silinir; teklif tutari/durumu/turlari degismez. Kod sutunlar
--   yokken kosullari yazmaz ve karsi teklif formunu "etkin degil" olarak gosterir.
set local lock_timeout = '5s';

drop function if exists public.owner_counter_offer_atomic(text, uuid, numeric, text);

alter table public.offers drop constraint if exists offers_payment_method_check;
alter table public.offers drop constraint if exists offers_deposit_amount_check;
alter table public.offers drop constraint if exists offers_swap_note_check;
alter table public.offers drop constraint if exists offers_owner_counter_check;

alter table public.offers drop column if exists payment_method;
alter table public.offers drop column if exists deposit_amount;
alter table public.offers drop column if exists proposed_deed_date;
alter table public.offers drop column if exists credit_contingency;
alter table public.offers drop column if exists swap_note;
alter table public.offers drop column if exists owner_counter_amount;
alter table public.offers drop column if exists owner_counter_note;
alter table public.offers drop column if exists owner_counter_at;
