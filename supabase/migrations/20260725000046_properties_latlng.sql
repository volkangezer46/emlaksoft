-- ACİL: properties tablosuna lat/lng kolonları (harita özelliği bunlara yazıyor;
-- kolonlar yoktu → createProperty/updateProperty PGRST204 ile başarısız oluyordu).
alter table public.properties
  add column if not exists lat double precision,
  add column if not exists lng double precision;

-- Harita/coğrafi listeleme için (koordinatı olan portföyler)
create index if not exists idx_properties_latlng
  on public.properties(tenant_id)
  where lat is not null and lng is not null;
