-- Rollback: 20261012000600_ef_pack_names_tl
-- Seed paket adlarını eski "... aylık N kontör" yazımına döndürür (yalnız "aylık N TL" desenli adlar). Veri kaybı yok.

update public.platform_settings
   set value = pg_catalog.regexp_replace(value, '(aylık [0-9.]+) TL"', '\1 kontör"', 'g'),
       updated_at = pg_catalog.now()
 where key = 'ef.packs'
   and value ~ 'aylık [0-9.]+ TL"';
