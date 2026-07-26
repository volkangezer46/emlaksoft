-- Bildirim tercihleri: yeni tür anahtarları
-- priceDrop (fiyat düşüş eşleşmesi), savedSearch (vitrin kayıtlı arama),
-- share (paylaşım linki açılış/beğeni), dunning (ödeme hatırlatma),
-- rentOverdue (kira gecikmesi), network (ağ iş birliği).
--
-- jsonb varsayılanına ('{}') BİLİNÇLİ olarak dokunulmuyor: eksik anahtar
-- kod tarafında AÇIK kabul edilir (mevcut davranış bozulmaz). Bu migration
-- yalnızca şema dokümantasyonunu günceller.
comment on column public.profiles.notification_prefs is
  'portal, appointment, commission, digest, marketing, priceDrop, savedSearch, share, dunning, rentOverdue, network boolean flags (eksik anahtar = açık; marketing varsayılanı kapalı)';
