-- Rollback: 20261007000100_property_media_is_document. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Tetikleyici, iki fonksiyon ve is_document sutunu duser; elle "Belge" olarak isaretlenen kayitlarin isareti KAYBOLUR.
-- Kod sutun yokken gecici ad kuralina (src/lib/public-property-media.ts looksLikeDocumentFileName) geri doner: adi belge
-- cagristirmayan ama elle belge isaretlenmis gorseller yeniden public yuzeylere cikabilir (KVKK). Dusurmeden once
-- gerekirse listeyi saklayin:
--   select id, tenant_id, property_id, file_name from public.property_media where is_document;

set local lock_timeout = '5s';

drop trigger if exists property_media_mark_document_on_insert on public.property_media;
drop function if exists public.property_media_mark_document_on_insert();
alter table public.property_media drop column if exists is_document;
drop function if exists public.media_file_name_looks_like_document(text);

notify pgrst, 'reload schema';
