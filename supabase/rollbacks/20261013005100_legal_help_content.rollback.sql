-- 20261013005100 geri alma: AD12 tabloları silinir.
-- UYARI: yasal belge sürümleri, yeniden onay kayıtları (IP dahil), mevzuat sabiti geçmişi, yardım makaleleri ve oylar kaybolur.
-- Yeniden onay kayıtları hukuki kanıt olabilir; geri almadan önce dışa aktarın.
-- Kod tablolar yokken yasal sayfaları ve yardım merkezini koddaki içerikle çizer, yeniden onay penceresi çıkmaz.
drop function if exists public.legal_publish_draft(text, uuid);
drop table if exists public.help_article_votes;
drop table if exists public.help_articles;
drop table if exists public.legal_constants;
drop table if exists public.legal_consents;
drop table if exists public.legal_documents;
notify pgrst, 'reload schema';
