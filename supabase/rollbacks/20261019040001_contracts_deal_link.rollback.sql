-- 20261019040001 geri alma: sozlesme <-> anlasma/teklif kesin bagi duser. Sozlesmeler kalir; anlasma sayfasi eski
--   portfoy + musteri eslesmesine doner.
set local lock_timeout = '5s';

drop index if exists public.idx_contracts_deal;
drop index if exists public.idx_contracts_offer;
alter table public.contracts drop constraint if exists contracts_deal_tenant_fkey;
alter table public.contracts drop constraint if exists contracts_offer_tenant_fkey;
alter table public.contracts drop column if exists deal_id;
alter table public.contracts drop column if exists offer_id;
