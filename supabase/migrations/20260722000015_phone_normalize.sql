-- A6: Telefon verisi normalizasyonu + ulusal format (05XXXXXXXXX) CHECK kısıtı
-- src/lib/phone.ts normalizeTurkishPhone ile aynı mantık (SQL karşılığı).

create or replace function public.normalize_tr_phone(input text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  if input is null then
    return null;
  end if;
  digits := regexp_replace(input, '\D', '', 'g');

  if left(digits, 4) = '0090' then
    digits := substring(digits from 3);
  end if;
  if left(digits, 2) = '90' and length(digits) >= 12 then
    digits := '0' || substring(digits from 3);
  end if;
  if length(digits) = 10 and left(digits, 1) = '5' then
    digits := '0' || digits;
  end if;

  return left(digits, 11);
end;
$$;

comment on function public.normalize_tr_phone is
  'src/lib/phone.ts normalizeTurkishPhone ile birebir — serbest metin telefonu 05XXXXXXXXX ulusal formata çevirir.';

-- ========== mevcut veriyi normalize et (tek seferlik) ==========

update public.profiles
set phone = public.normalize_tr_phone(phone)
where phone is not null and phone !~ '^05\d{9}$';

update public.customers
set phone = public.normalize_tr_phone(phone)
where phone is not null and phone !~ '^05\d{9}$';

update public.calls
set phone = public.normalize_tr_phone(phone)
where phone !~ '^05\d{9}$';

-- Normalize sonrası hâlâ kalıba uymayan (örn. sabit hat, yabancı numara) NULL'a çevrilebilecek
-- alanları temizle — sadece nullable kolonlarda.
update public.profiles set phone = null where phone is not null and phone !~ '^05\d{9}$';
update public.customers set phone = null where phone is not null and phone !~ '^05\d{9}$';

-- ========== CHECK kısıtları ==========
-- NOT VALID: yeni/güncellenen satırlar hemen kısıtlanır, olası artık uyumsuz eski satırlar
-- deploy'u bloklamaz. Veri temiz olduğunda `validate constraint` ile sıkılaştırılabilir.

alter table public.profiles
  drop constraint if exists profiles_phone_tr_format,
  add constraint profiles_phone_tr_format check (phone is null or phone ~ '^05\d{9}$') not valid;

alter table public.customers
  drop constraint if exists customers_phone_tr_format,
  add constraint customers_phone_tr_format check (phone is null or phone ~ '^05\d{9}$') not valid;

-- calls.phone NOT NULL — boş string'e izin verilmez, ama sabit hat gibi normalize edilemeyen
-- eski kayıtlar deploy'u bloklamasın diye burada da NOT VALID kullanılıyor.
alter table public.calls
  drop constraint if exists calls_phone_tr_format,
  add constraint calls_phone_tr_format check (phone ~ '^05\d{9}$') not valid;
