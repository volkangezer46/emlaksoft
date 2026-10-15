-- 20261019050000 geri alma. Fiyat gecmisi satirlari silinir (daire fiyatlari degismez); kod RPC/tablo yokken
-- toplu fiyat guncelleme ve Excel aktarimi "etkin degil" der, tekil duzenleme calisir.
drop function if exists public.import_project_units(uuid, jsonb);
drop function if exists public.undo_project_unit_reprice(uuid);
drop function if exists public.bulk_reprice_project_units(uuid, uuid[], text, numeric, numeric, text);
drop trigger if exists project_units_price_history on public.project_units;
drop function if exists public.project_unit_price_history_capture();
drop table if exists public.project_unit_price_history;
