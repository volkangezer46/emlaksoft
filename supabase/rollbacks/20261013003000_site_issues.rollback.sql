-- 20261013003000 geri alma: Büyüme Kokpiti tabloları ve budama RPC'si düşer (kod tablo yokken "kurulum bekliyor" gösterir,
-- yayın sonrası kayıt sessizce atlanır). Başka nesneye dokunmaz.
drop function if exists public.site_issues_prune();
drop table if exists public.site_optimizer_actions;
drop table if exists public.site_issues;
notify pgrst, 'reload schema';
