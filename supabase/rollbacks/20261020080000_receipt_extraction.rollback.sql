-- 20261020080000 geri alma: akilli fis okuma sutunlari, fonksiyonlari ve kova XML izni kaldirilir.
--   Kod sutun/fonksiyon yokken eski ocr_json'a yazar ve yapay zeka anahtarini kapali sayar (kesinti yok).
--   UYARI: finance_attachments.extraction verisi (okunan alanlar) silinir; ocr_json'daki eski bicim oneri kalir.
set local lock_timeout = '5s';

drop function if exists public.finance_attachment_set_extraction(uuid, jsonb, jsonb);
drop function if exists public.finance_settings_set_ocr_ai(boolean);

alter table public.finance_attachments drop constraint if exists finance_attachments_extraction_check;
alter table public.finance_attachments drop column if exists extraction;
alter table public.finance_settings drop column if exists ocr_ai_enabled;

do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is not null then
    update storage.buckets
       set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
     where id = 'expense-receipts';
  end if;
end
$$;
