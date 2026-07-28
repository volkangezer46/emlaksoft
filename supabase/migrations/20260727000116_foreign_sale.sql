-- 116 · Yabancıya satış paketi — müşteri ve portföy alanları
--
-- Türkiye'de yabancıya konut satışı ayrı bir operasyon: pasaport/uyruk kaydı,
-- askeri yasak bölge uygunluğu, SPK değerleme raporu. Sistemde hiç karşılığı
-- yoktu; bu migration o iş için gereken en dar alan setini açar.
--
-- RLS: her iki tabloda da tenant politikaları zaten kurulu — kolon eklemek
-- politikayı değiştirmez, ek policy gerekmez.
-- Index: yabancı müşteri sayısı ofis ölçeğinde onlarca satır; seq scan yeterli,
-- bilinçli olarak index eklenmedi.

-- Müşteri: yabancı alıcı kimliği
alter table public.customers
  add column if not exists is_foreign boolean not null default false,
  add column if not exists nationality text null,
  add column if not exists passport_no text null;

comment on column public.customers.is_foreign is 'Yabancı uyruklu alıcı — yabancıya satış evrak akışını tetikler';
comment on column public.customers.nationality is 'Uyruk (serbest metin, örn. "Almanya")';
comment on column public.customers.passport_no is 'Pasaport numarası — tapu işlemi için gerekli';

-- Portföy: yabancıya satış uygunluğu
-- Varsayılan TRUE: Türkiye'de taşınmazların büyük çoğunluğu yabancıya satılabilir;
-- istisna (askeri yasak/güvenlik bölgesi, ilçe %10 kotası dolu) işaretlenir.
alter table public.properties
  add column if not exists foreign_eligible boolean not null default true,
  add column if not exists foreign_note text null;

comment on column public.properties.foreign_eligible is 'Yabancıya satılabilir mi — askeri yasak bölge/kota istisnasında false';
comment on column public.properties.foreign_note is 'Uygunluk notu (yasak bölge sorgu sonucu, kota durumu vb.)';
