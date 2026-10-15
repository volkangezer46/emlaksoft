-- 20261016080000 geri alma: increment_share_view kaldırılır, offers.owner_visible_note (ve uzunluk kısıtı) düşürülür.
-- DİKKAT: owner_visible_note'a yazılmış malik açıklamaları SİLİNİR (kod sütun yokken açıklamayı göstermez ve yazmaz).
-- /paylas sayacı RPC yokken artmaz (sayfa açılır; yalnız sayaç/ilk açılış bildirimi atlanır). Idempotent.

set local lock_timeout = '5s';

drop function if exists public.increment_share_view(text);

alter table public.offers drop constraint if exists offers_owner_visible_note_len;
alter table public.offers drop column if exists owner_visible_note;
