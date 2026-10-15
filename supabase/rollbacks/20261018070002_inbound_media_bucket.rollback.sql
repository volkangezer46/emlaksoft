-- 20261018070002 geri alma. ON KOSUL: inbound-media kovasindaki nesneler once Storage API'den silinmeli
-- (kova satiri, icinde nesne varken silinemez). Kod kova yokken medyayi saklamaz, yalniz metin ozetini yazar.
delete from storage.buckets where id = 'inbound-media';
