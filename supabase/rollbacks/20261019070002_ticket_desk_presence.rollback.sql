-- Geri alma: 20261019070002_ticket_desk_presence.sql
-- Iki presence politikasi duser; veri degismez. Talep detayindaki "kim bakiyor" seridi sessizce gizlenir.
set local lock_timeout = '5s';
do $$
begin
  if pg_catalog.to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists rt_ticket_desk_presence_read on realtime.messages';
    execute 'drop policy if exists rt_ticket_desk_presence_write on realtime.messages';
  end if;
end $$;
