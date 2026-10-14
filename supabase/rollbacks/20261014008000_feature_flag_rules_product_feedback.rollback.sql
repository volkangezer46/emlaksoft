-- 20261014008000 geri alma: bayrak hedefleme, NPS anketi ve özellik istek panosu nesneleri silinir.
-- UYARI: hedefleme kuralları, NPS yanıtları, öneriler ve oylar kaybolur. Kod tablolar yokken bayrakları genel durumla
-- değerlendirir (hedefleme yok), NPS göstermez ve öneri panosunda "kurulum bekliyor" der.

set local lock_timeout = '5s';

drop trigger if exists trg_product_feature_request_vote_count on public.product_feature_request_votes;
drop function if exists public.product_feature_request_vote_count();
drop table if exists public.product_feature_request_votes;
drop table if exists public.product_feature_requests;

drop function if exists public.platform_nps_mark_shown(uuid, uuid, uuid, integer);
drop table if exists public.platform_nps_responses;
drop table if exists public.platform_nps_surveys;

drop table if exists public.feature_flag_rules;
