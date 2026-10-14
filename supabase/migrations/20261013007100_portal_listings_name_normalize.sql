-- MIGRATION 20261013007100_portal_listings_name_normalize.sql (EP1 — portal adı tek biçim, kalıcı)
-- UYGULANMADI: 20261013007000_tenant_portal_accounts.sql'den SONRA, yalnız restore edilebilir backup/PITR doğrulandıktan
-- sonra SAHİBİ `npm run db:migrate -- --only 20261013007100_portal_listings_name_normalize.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261013007100_portal_listings_name_normalize.rollback.sql
--
-- NEDEN: 20261013007000 portal_listings.portal_name'i tek seferlik küçük harfe çevirdi ve createPortalListing küçük harf
--   yazıyor; ancak pt_complete_session / pt_import_bind (20261012002700) ve lc_match_decide (20261007000210)
--   lc_bind_portal_listing'e initcap(portal) geçiriyor ("Sahibinden"). Büyük harfli satırlar yeniden birikir ve üyelik
--   süzgeçleri (kontrol kuyruğu, "üyelik dışı canlı ilan" uyarısı) katalog kimliğiyle eşleşmeyi kaçırır.
--
-- NE YAPAR:
--   1. portal_listings_normalize_name: BEFORE INSERT OR UPDATE OF portal_name tetikleyicisi, portal_name :=
--      lower(btrim(portal_name)). Bütün yazıcıları (RPC'ler, sunucu eylemleri, ileride eklenecekler) kapsar; uygulanmış
--      RPC gövdelerine dokunmaz (initcap çağrısı zararsız hale gelir).
--   2. Kalan farklı satırlar düzeltilir (007000 sonrası yazılmış olabilecekler) ve CHECK portal_name = lower(btrim(portal_name))
--      eklenir (NOT VALID + VALIDATE: kısa kilit).
-- ETKİ: yalnız büyük/küçük harf ve boşluk. Tekil indeksler zaten lower(btrim(portal_name)) üzerindedir, çakışma üretmez.
-- RİSK: düşük. Tetikleyici guard tetikleyicisinden (portal_listings_guard_atomic_mutation) bağımsızdır; yetki denetimi aynı kalır.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.portal_listings') is null then
    raise exception '20261013007100: public.portal_listings yok.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Tetikleyici: her yazımda tek biçim
-- ---------------------------------------------------------------------------
create or replace function public.portal_listings_normalize_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.portal_name is not null then
    new.portal_name := lower(btrim(new.portal_name));
  end if;
  return new;
end;
$$;

revoke all on function public.portal_listings_normalize_name() from public, anon, authenticated;

drop trigger if exists portal_listings_normalize_name on public.portal_listings;
create trigger portal_listings_normalize_name
  before insert or update of portal_name on public.portal_listings
  for each row execute function public.portal_listings_normalize_name();

-- ---------------------------------------------------------------------------
-- 2) Kalan satırlar + CHECK
-- ---------------------------------------------------------------------------
update public.portal_listings
   set portal_name = lower(btrim(portal_name))
 where portal_name is not null
   and portal_name <> lower(btrim(portal_name));

alter table public.portal_listings drop constraint if exists portal_listings_portal_name_normalized;
alter table public.portal_listings
  add constraint portal_listings_portal_name_normalized check (portal_name = lower(btrim(portal_name))) not valid;
alter table public.portal_listings validate constraint portal_listings_portal_name_normalized;
