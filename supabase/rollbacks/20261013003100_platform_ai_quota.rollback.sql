-- 20261013003100 geri alma: platform AI kotasi duser. Kod tablo/RPC yokken SEO AI onerisini "kota kurulmadi" diyerek
-- kapali tutar; platform danismani limit ayari yoksa etkilenmez.
drop function if exists public.platform_ai_quota_take(text, integer);
drop table if exists public.platform_ai_quota;
notify pgrst, 'reload schema';
