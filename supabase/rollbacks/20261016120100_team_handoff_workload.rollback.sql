-- Geri alma: 20261016120100_team_handoff_workload.sql
-- Yalniz devir fonksiyonu kaldirilir; devredilmis kayitlar ve audit satirlari kalir. Kod fonksiyon yokken eski tablo tablo yola duser.
drop function if exists public.team_handoff_workload(uuid, uuid, text[], text);
notify pgrst, 'reload schema';
