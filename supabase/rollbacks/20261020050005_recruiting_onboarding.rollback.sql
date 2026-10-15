-- 20261020050005 geri alma: danisman adayi hatti ve oryantasyon tablolari, RPC'ler ve tetikleyiciler duser (aday
--   kayitlari, basvuru formu ayari ve oryantasyon listeleri silinir; oryantasyondan/gorusmeden acilan gorevler gorevler
--   listesinde kalir). Kod tablolar yokken Danisman adaylari "kurulum bekliyor" der, /kariyer/[token] 404 verir.
set local lock_timeout = '5s';

drop function if exists public.recruit_purge_expired();
drop function if exists public.recruit_public_apply(uuid, text, text, text, smallint, text, text, boolean);
drop function if exists public.recruit_public_form(uuid);
drop table if exists public.onboarding_items;
drop table if exists public.onboarding_template_items;
drop table if exists public.recruit_candidate_events;
drop table if exists public.recruit_candidates;
drop table if exists public.recruit_settings;
drop function if exists public.guard_onboarding_item_update();
drop function if exists public.recruit_candidate_touch();
