# Coğrafya

## Tablolar

- `geo_provinces` — 81 il (plaka kodu)
- `geo_districts` — ilçe
- `geo_neighborhoods` — mahalle

## Politika

- Chat / kod içinde tüm mahalleleri hardcode etme
- Kaynak: resmi idari birimler; çeyreklik sync (`scripts/geo-sync.ts`)
- MVP seed: 81 il + İstanbul/Ankara/İzmir pilot ilçeler (`20260721000001_geo_seed.sql`)

## Kullanım

Portföy, müşteri, talep ve şube kayıtlarında `province_id` / `district_id` / `neighborhood_id` FK.
