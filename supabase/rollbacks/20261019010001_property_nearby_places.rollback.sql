-- 20261019010001 geri alma: properties.nearby_places duser (danisman girdisi kaybolur; vitrin bolumu gizlenir,
--   portfoy karti "kurulum bekliyor" der).
set local lock_timeout = '5s';

alter table public.properties drop constraint if exists properties_nearby_places_shape;
alter table public.properties drop column if exists nearby_places;
