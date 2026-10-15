-- MIGRATION 20261018070002_inbound_media_bucket.sql
-- COM-03: WhatsApp'tan gelen fotoğraf / ses / belge / video kaybolmasın. Meta medya URL'leri ~5 dk geçerlidir; webhook
-- işlenirken sunucu (service_role) dosyayı indirip bu ÖZEL kovaya yazar: <ofis>/<yyyy>/<mm>/<iletisim>/<dosya>.
-- Güvenlik: kova public=false, 16 MB, yalnız izinli MIME. storage.objects için anon/authenticated politikası EKLENMEZ;
-- panel dosyayı yalnız sunucunun ürettiği kısa ömürlü imzalı URL ile görür (kiracı kontrolü sunucuda).
-- Saklama (KVKK): communications.provider_metadata.media[].path üzerinden; temizlik operational-retention adımına bağlanabilir.

do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'inbound-media', 'inbound-media', false, 16777216,
      array[
        'image/jpeg', 'image/png', 'image/webp',
        'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr',
        'video/mp4', 'video/3gpp',
        'application/pdf'
      ]::text[]
    )
    on conflict (id) do update
      set public = false,
          file_size_limit = 16777216,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
