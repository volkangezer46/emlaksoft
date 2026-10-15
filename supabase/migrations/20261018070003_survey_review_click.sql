-- MIGRATION 20261018070003_survey_review_click.sql
-- COM-12: memnuniyet anketinden Google yorum bağlantısına tıklama izi. Public teşekkür ekranındaki "Google'da yorum
-- bırakın" düğmesi sunucu eylemiyle (service_role, token doğrulamalı) yalnız İLK tıklamayı yazar. Danışman bazlı
-- "yorum yönlendirme" sayısı bu sütundan okunur. Ek sütun; mevcut veri ve politikalar değişmez.

alter table public.surveys add column if not exists review_clicked_at timestamptz;

comment on column public.surveys.review_clicked_at is
  'Müşterinin anket teşekkür ekranında Google yorum bağlantısına ilk tıkladığı an (COM-12).';

create index if not exists idx_surveys_review_clicked
  on public.surveys(tenant_id, review_clicked_at) where review_clicked_at is not null;
