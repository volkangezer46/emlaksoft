-- 20261013003500 geri alma: site medya tablosu, `site-media` kovası ve KOVADAKİ NESNE KAYITLARI silinir.
-- UYARI: yüklenen görseller kaybolur (depolama arka ucundaki dosyalar kayıtsız kalır; gerekirse Storage API ile temizlenir).
-- Kod tablo/kova yokken ana sayfayı görselsiz (bugünkü haliyle) çizer, Medya ekranı "kurulum bekliyor" gösterir.
do $$
begin
  if pg_catalog.to_regclass('storage.objects') is not null then
    -- Storage koruma tetikleyicisi doğrudan silmeyi engeller; bu oturum için bilinçli izin.
    perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects where bucket_id = 'site-media';
  end if;
  if pg_catalog.to_regclass('storage.buckets') is not null then
    perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);
    delete from storage.buckets where id = 'site-media';
  end if;
end $$;

drop table if exists public.site_media;
notify pgrst, 'reload schema';
