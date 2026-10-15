-- 20261019010000 geri alma: vitrin arama/secenek RPC'leri duser. Kod RPC bulamayinca eski PostgREST sorgusuna duser
--   (islem/fiyat/oda/tur/konum suzgeci + sayfalama calisir; m2/yas/kat suzgecleri ve m2 fiyati siralamasi devre disi).
set local lock_timeout = '5s';

drop function if exists public.vitrin_listing_facets(uuid);
drop function if exists public.vitrin_listing_search(uuid, jsonb, integer, integer);
drop function if exists public.vitrin_json_number(jsonb);
