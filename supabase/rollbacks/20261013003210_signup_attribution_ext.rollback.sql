-- 20261013003210 geri alma: eklenen atıf sütunları ve kısıtlar düşer (kod sütun yokken eski sütunlarla yazar).
-- 20261013003220 (platform_growth_funnel) channel sütununu okur: önce o geri alınmalı.
drop index if exists public.idx_signup_attr_channel;
alter table public.signup_attributions drop constraint if exists signup_attributions_touch_check;
alter table public.signup_attributions drop constraint if exists signup_attributions_landing_path_check;
alter table public.signup_attributions drop constraint if exists signup_attributions_utm_content_check;
alter table public.signup_attributions drop constraint if exists signup_attributions_utm_term_check;
alter table public.signup_attributions drop constraint if exists signup_attributions_src_host_check;
alter table public.signup_attributions drop constraint if exists signup_attributions_channel_check;
alter table public.signup_attributions
  drop column if exists last_touch,
  drop column if exists first_touch,
  drop column if exists utm_content,
  drop column if exists utm_term,
  drop column if exists src_host,
  drop column if exists channel;
notify pgrst, 'reload schema';
