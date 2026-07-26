-- 20260726000087 devamı — yeni contract_type değerlerini KULLANAN kısım.
--
-- Ayrı dosya, çünkü ALTER TYPE ... ADD VALUE ile eklenen enum değeri aynı
-- transaction'da kullanılamaz; apply-one.ts her dosyayı tek transaction koşar.
-- SIRA: önce 20260726000087_contract_types.sql, sonra bu dosya.

-- Global şablonların türünü gerçek değerlere çek (id'ler 20260726000070 seed'i)
update public.contract_templates
   set type = 'yer_gosterme'
 where id = 'a1f00001-0000-4000-8000-000000000003' -- "Yer Gösterme Tutanağı"
   and tenant_id is null;

update public.contract_templates
   set type = 'kapora'
 where id = 'a1f00001-0000-4000-8000-000000000004' -- "Kapora (Bağlanma) Sözleşmesi"
   and tenant_id is null;

-- Tür seçenekleri (definitions) — sözleşme diyaloğu dropdown'u bu listeden
-- beslenir (getDefinitions('contract_type')); "Diğer" listede sonda kalsın
-- diye mevcut 'diger' kaydının sırası 7'ye alınır.
insert into public.definitions (tenant_id, category, value, label, sort_order) values
  (null, 'contract_type', 'yer_gosterme', 'Yer gösterme tutanağı', 5),
  (null, 'contract_type', 'kapora',       'Kapora sözleşmesi',     6)
on conflict do nothing;

update public.definitions
   set sort_order = 7
 where tenant_id is null and category = 'contract_type' and value = 'diger';
