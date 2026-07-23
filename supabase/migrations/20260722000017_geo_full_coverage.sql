-- Tam il/ilçe/mahalle kapsamı için şema genişletmesi.
-- source_id: dış veri kaynağındaki (TurkiyeAPI) kimlik — idempotent senkron için.
-- postal_code/population: mahalle/ilçe zenginleştirme; admin ekranında gösterim için.

alter table public.geo_provinces add column if not exists population integer;
alter table public.geo_provinces add column if not exists region text;

alter table public.geo_districts add column if not exists source_id integer;
alter table public.geo_districts add column if not exists population integer;

alter table public.geo_neighborhoods add column if not exists source_id integer;
alter table public.geo_neighborhoods add column if not exists postal_code text;
alter table public.geo_neighborhoods add column if not exists population integer;

create unique index if not exists geo_districts_source_id_key
  on public.geo_districts(source_id) where source_id is not null;
create unique index if not exists geo_neighborhoods_source_id_key
  on public.geo_neighborhoods(source_id) where source_id is not null;

create extension if not exists pg_trgm;

create index if not exists idx_geo_neighborhoods_name on public.geo_neighborhoods using gin (name gin_trgm_ops);
create index if not exists idx_geo_districts_name on public.geo_districts using gin (name gin_trgm_ops);

-- Admin CRUD (il/ilçe/mahalle) service_role (admin client) üzerinden yürütülür;
-- bu tablolar önceden sadece SELECT yetkisine sahipti.
grant insert, update, delete on public.geo_provinces to service_role;
grant insert, update, delete on public.geo_districts to service_role;
grant insert, update, delete on public.geo_neighborhoods to service_role;
