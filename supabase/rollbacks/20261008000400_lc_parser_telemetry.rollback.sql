-- Rollback: 20261008000400_lc_parser_telemetry. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Ayristirici telemetri tablosu ve yazma RPC'si DUSER (sayaclar kaybolur; baska veri etkilenmez). Kod tablo/RPC yokken
-- telemetriyi sessizce atlar ve "Ayristirici sagligi" bolumunu gostermez.

set local lock_timeout = '5s';

drop function if exists public.lc_parser_report(text, text, text, text, text, boolean);
drop table if exists public.lc_parser_telemetry;

notify pgrst, 'reload schema';
