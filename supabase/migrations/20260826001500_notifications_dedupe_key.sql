-- MIGRATION 20260826001500_notifications_dedupe_key.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826001500_notifications_dedupe_key.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826001500_notifications_dedupe_key.rollback.sql
-- BAGIMLILIK: public.notifications (20260722000007).
--
-- AMAC (denetim R4): cron bildirim tekrar onlemesi govdedeki `task:<uuid>` izine + 5000 satirlik okumaya dayaniyordu
--   (kirilgan). Anahtar bazli, veritabani seviyesinde benzersiz dedupe: `dedupe_key` (or. 'portal-teyit:<ilan>:<gun>').
--   Yalniz EKLER: nullable kolon + kismi benzersiz indeks (eski satirlar/anahtarsiz bildirimler etkilenmez).
--   Kod kolon yoksa eski davranisa duser (migration uygulanmadan da calisir).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.notifications') is null then
    raise exception 'public.notifications yok; once temel migrationlar uygulanmali.';
  end if;
end $$;

alter table public.notifications
  add column if not exists dedupe_key text;

create unique index if not exists notifications_tenant_dedupe_key_uidx
  on public.notifications (tenant_id, dedupe_key)
  where dedupe_key is not null;
