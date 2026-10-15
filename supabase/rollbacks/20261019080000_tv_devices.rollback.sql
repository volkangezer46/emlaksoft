-- 20261019080000 geri alma: TV eslestirme tablolari ve RPC'leri duser. Eslesmis TV'ler bir sonraki yoklamada eslestirme
--   ekranina doner; "tv_device.paired/revoked" islem izi (audit_logs) kalir. Oturumlu Pano TV etkilenmez.
set local lock_timeout = '5s';

drop function if exists public.tv_device_revoke(uuid);
drop function if exists public.tv_device_pair(text, text);
drop table if exists public.tv_pairing_codes;
drop table if exists public.tv_devices;
