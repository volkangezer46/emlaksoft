-- MIGRATION 20261019070002_ticket_desk_presence.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: politika yokken ozel presence kanali reddedilir, talep detayindaki
--   "kim bakiyor / yaziyor" seridi sessizce gizli kalir; gonderim oncesi "yeni mesaj geldi" sunucu kontrolu bu
--   migration'a bagli DEGILDIR (her zaman calisir).
-- Geri alma: supabase/rollbacks/20261019070002_ticket_desk_presence.rollback.sql (iki politika duser).
-- BAGIMLILIK: 20261016040000 (public.rt_staff_can_listen: aktif personel, MFA zorunluysa aal2, impersonation haric).
--
-- NE (PA-8, Zendesk/Freshdesk "agent collision"): ayni talebi acan destek personeli birbirini gorur ("Ayse bakiyor /
--   yaziyor"). Supabase Realtime PRESENCE, OZEL konu 'ticket-desk:<talep uuid>'. Yuk yalniz personel kimligi + adi +
--   yaziyor bayragi; talep icerigi/ofis verisi yoktur. Erisim: realtime.messages uzerinde presence uzantisi icin
--   okuma (SELECT) ve yayin (INSERT) yalniz rt_staff_can_listen() olan personele ve yalniz bu konu ailesine.
--   Ofis kullanicilari (kiraci JWT) bu konuya katilamaz; mevcut politikalarla OR'lanir, baska konulara dokunmaz.
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('realtime.messages') is null then
    raise notice 'PA-8: realtime.messages yok, presence politikasi atlandi';
    return;
  end if;
  execute 'drop policy if exists rt_ticket_desk_presence_read on realtime.messages';
  execute 'drop policy if exists rt_ticket_desk_presence_write on realtime.messages';
  execute $p$
    create policy rt_ticket_desk_presence_read on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension in ('presence')
        and (select realtime.topic()) ~ '^ticket-desk:[0-9a-f-]{36}$'
        and (select public.rt_staff_can_listen())
      )
  $p$;
  execute $p$
    create policy rt_ticket_desk_presence_write on realtime.messages
      for insert to authenticated
      with check (
        realtime.messages.extension in ('presence')
        and (select realtime.topic()) ~ '^ticket-desk:[0-9a-f-]{36}$'
        and (select public.rt_staff_can_listen())
      )
  $p$;
end $$;
