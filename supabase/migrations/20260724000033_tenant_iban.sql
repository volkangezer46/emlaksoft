-- Migration: tenants tablosuna iban + phone + address kolonları ekle
-- Fatura ve iletişim bilgileri için gerekli

alter table tenants
  add column if not exists iban         text,
  add column if not exists phone        text,
  add column if not exists address_line text,
  add column if not exists city         text;

comment on column tenants.iban         is 'Ofis IBAN numarası (fatura/ödeme için)';
comment on column tenants.phone        is 'Ofis telefon numarası';
comment on column tenants.address_line is 'Ofis açık adresi';
comment on column tenants.city         is 'Ofis bulunduğu şehir';
