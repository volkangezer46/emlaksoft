-- 20261018090000 geri alma: giris basarisizlik kovalari ve RPC'leri duser. Kod RPC bulamayinca eski sabit pencere
--   sinirina (check_rate_limit) duser; giris calismaya devam eder. Kova verisi gecicidir (kayip onemsiz).
set local lock_timeout = '5s';

drop function if exists public.auth_login_throttle_clear(text);
drop function if exists public.auth_login_throttle_fail(text[], integer[]);
drop function if exists public.auth_login_throttle_peek(text[]);
drop table if exists public.auth_login_throttle;
