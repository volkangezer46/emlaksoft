-- MIGRATION 20261016080000_public_surfaces.sql
-- SK8 (2026-10-16): Herkese açık müşteri yüzeyleri — malike görünen teklif açıklaması + atomik paylaşım sayacı.
-- Geri alma: supabase/rollbacks/20261016080000_public_surfaces.rollback.sql
-- BAGIMLILIK: offers ve share_links tabloları (temel şema). Başka migration'a bağlı değil.
--
-- AMAC:
--  (1) offers.owner_visible_note: malik portalında gösterilen TEK teklif metni. Mevcut `offers.notes` danışmanın iç
--      notudur ("alıcı kredi onayı bekliyor" gibi) ve malike ARTIK gösterilmez (B149). Ayrı sütun bilerek boş başlar:
--      eski iç notlar malike taşınmaz; danışman formdaki "Malike görünen açıklama" alanını bilerek doldurur.
--  (2) increment_share_view(p_token): /paylas/[token] görüntülenme sayacı atomik (+1) ve YENİ değeri döndürür (B150).
--      Eski oku-artır-yaz yarışında eşzamanlı açılışlar sayımı kaybediyor, ilk açılış bildirimi iki kez gidebiliyordu;
--      sayfa artık bildirimi yalnız dönen değer 1 olduğunda gönderir. Süresi dolmuş link sayılmaz (null döner).
-- GUVENLIK: RPC SECURITY DEFINER + search_path sabit; yalnız service_role çağırır (anon/authenticated/PUBLIC yok).
-- ETKI: ek (yeni nullable sütun + yeni fonksiyon). Veri değişmez. Idempotent (if not exists / create or replace).

set local lock_timeout = '5s';

alter table public.offers add column if not exists owner_visible_note text;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.offers'::regclass and conname = 'offers_owner_visible_note_len'
  ) then
    alter table public.offers
      add constraint offers_owner_visible_note_len
      check (owner_visible_note is null or char_length(owner_visible_note) <= 2000) not valid;
    alter table public.offers validate constraint offers_owner_visible_note_len;
  end if;
end $$;

comment on column public.offers.owner_visible_note is
  'Malik portalında gösterilen teklif açıklaması (isteğe bağlı). offers.notes iç nottur ve hiçbir public yüzeye çıkmaz.';

create or replace function public.increment_share_view(p_token text)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.share_links
     set view_count = coalesce(view_count, 0) + 1
   where token = p_token
     and (expires_at is null or expires_at > now())
  returning view_count;
$$;

comment on function public.increment_share_view(text) is
  '/paylas/[token] görüntülenme sayacı — atomik +1, yeni değeri döndürür (1 = ilk açılış); service role çağırır';

revoke all on function public.increment_share_view(text) from public, anon, authenticated;
grant execute on function public.increment_share_view(text) to service_role;
