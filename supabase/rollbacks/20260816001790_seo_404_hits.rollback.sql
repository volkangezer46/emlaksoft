-- Geri alma: SEO 404 kayıtları. Yalnız 404 sayaçları silinir; başka veri etkilenmez.
drop function if exists public.seo_prune_404(integer, integer);
drop function if exists public.seo_log_404(text, text, integer);
drop table if exists public.seo_404_hits;
