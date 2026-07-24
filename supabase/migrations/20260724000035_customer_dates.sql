-- Migration: customers tablosuna doğum tarihi + yıldönümü alanları ekle
-- Emlak CRM'de müşteri ilişkisi yönetimi için kritik

alter table customers
  add column if not exists birth_date        date,
  add column if not exists anniversary_date  date,  -- Sözleşme/mülk alım yıldönümü
  add column if not exists anniversary_note  text;  -- "3 yıllık kiracı", "İlk ev alımı" vb.

comment on column customers.birth_date       is 'Müşteri doğum tarihi (doğum günü hatırlatma için)';
comment on column customers.anniversary_date is 'Önemli yıldönümü tarihi (sözleşme, mülk alımı vb.)';
comment on column customers.anniversary_note is 'Yıldönümü açıklaması';

-- Doğum günü ve yıldönümü için performant sorgu (ay+gün bazlı)
-- Index: bugünün ayı ve günüyle eşleşen müşterileri hızlı bul
create index if not exists idx_customers_birth_month_day
  on customers (extract(month from birth_date), extract(day from birth_date))
  where birth_date is not null and deleted_at is null;

create index if not exists idx_customers_anniv_month_day
  on customers (extract(month from anniversary_date), extract(day from anniversary_date))
  where anniversary_date is not null and deleted_at is null;
