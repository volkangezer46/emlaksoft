-- MIGRATION 20261007000100_property_media_is_document.sql (PB48, KVKK P0-9 kalici cozum)
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261007000100_property_media_is_document.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261007000100_property_media_is_document.rollback.sql (tetikleyici + fonksiyonlar +
--   sutun duser; kod gecici ad kuralina geri doner).
--
-- NEDEN: property_media'da ilan gorseli / belge ayrimi yoktu. Gecici onlem (src/lib/public-property-media.ts
--   isPublicListingImage) belgeyi yalniz DOSYA ADINDAN tanir; telefondan "IMG_1234.jpg" adiyla yuklenmis tapu
--   fotografi public paylasim/sunum/vitrin yuzeylerine cikabiliyordu. Bu dosya kalici isareti ekler:
--     property_media.is_document boolean not null default false
--   true olan medya HICBIR public yuzeyde gosterilmez ve public servis uclarindan servis edilmez (kod:
--   isPublicListingImage is_document === true -> false). Ofis ici ekranlar (medya yoneticisi, belgeler) gormeye devam eder.
-- AD KURALI (SQL tek kaynak): public.media_file_name_looks_like_document(text). Kalip listesi kodsal
--   DOCUMENT_NAME_TOKENS ile BIREBIR aynidir (sozlesme testi: src/lib/public-property-media.test.ts). Turkce harfler
--   ASCII'ye indirgenir (translate), sonra ILIKE. Tabloda etiket sutunu yoktur; yalniz file_name taranir.
-- VERI: belge adli mevcut satirlar true yapilir. Bugun de bu satirlar public'te gizli oldugu icin gorunur davranis
--   DEGISMEZ; kural sutuna tasinir. is_cover'a DOKUNULMAZ (geri alinabilirlik; public kapak secimi belgeyi atlar).
-- TETIKLEYICI (yalniz INSERT): belge adli yeni kayit is_document=true ve is_cover=false dogar. Yuklemede "Belge" turu
--   secilince kod ada `belge-` oneki ekler; boylece kayit ILK ANDAN isaretlidir (public gorunme penceresi yok).
--   UPDATE'te calismaz: ofis yanlis pozitifi bilincli olarak "Fotograf"a cevirebilir.
-- INDEKS: eklenmedi. Public sorgular is_document'i SECIP uygulamada suzer (sutun yokken de calismasi icin); SQL'de
--   "where not is_document" filtresi yok, kismi indeks okuyucusuz kalirdi. Mevcut indeksler ayni sorgulari karsilar.
-- RLS: DEGISMEZ (property_media_tenant "for all" tenant kosulu aynen). Sutun eklemek PG11+ hizli varsayilandir (tablo
--   yeniden yazilmaz). Transaction-uyumlu; tekrar calistirilabilir.

set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.property_media') is null then
    raise exception '20261007000100: public.property_media yok.';
  end if;
end
$$;

alter table public.property_media
  add column if not exists is_document boolean not null default false;

comment on column public.property_media.is_document is
  'KVKK P0-9: true = belge (tapu, yetki belgesi, kimlik...). Public yuzeylerde (paylasim, sunum, vitrin, danisman, portallar) ASLA gosterilmez/servis edilmez; yalniz ofis ici. Kod tek kural: src/lib/public-property-media.ts isPublicListingImage.';

-- Ad kurali (saf, veri okumaz). Liste DOCUMENT_NAME_TOKENS ile ayni.
create or replace function public.media_file_name_looks_like_document(p_file_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    translate(p_file_name, 'ıİğĞüÜşŞöÖçÇâÂîÎûÛ', 'iigguussooccaaiiuu') ilike any (array[
      '%tapu%', '%yetki%', '%ruhsat%', '%iskan%', '%kimlik%', '%nufus%', '%ehliyet%', '%pasaport%', '%vekalet%',
      '%sozlesme%', '%kontrat%', '%dekont%', '%fatura%', '%makbuz%', '%ekspertiz%', '%belge%', '%evrak%', '%imza%',
      '%taahhut%'
    ]),
    false
  );
$$;

comment on function public.media_file_name_looks_like_document(text) is
  'KVKK P0-9 ad kurali (SQL esi). Kod esi: src/lib/public-property-media.ts DOCUMENT_NAME_TOKENS (sozlesme testiyle birebir).';

-- Mevcut belge adli satirlar.
update public.property_media
   set is_document = true
 where is_document = false
   and file_name is not null
   and public.media_file_name_looks_like_document(file_name);

-- Yeni kayit: belge adli ise belge dogar ve kapak olmaz (finalize_direct_file_upload ilk gorseli kapak yapar).
create or replace function public.property_media_mark_document_on_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_document is not true and public.media_file_name_looks_like_document(new.file_name) then
    new.is_document := true;
  end if;
  if new.is_document then
    new.is_cover := false;
  end if;
  return new;
end
$$;

drop trigger if exists property_media_mark_document_on_insert on public.property_media;
create trigger property_media_mark_document_on_insert
before insert on public.property_media
for each row execute function public.property_media_mark_document_on_insert();

notify pgrst, 'reload schema';
