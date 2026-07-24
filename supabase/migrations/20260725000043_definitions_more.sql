-- Definitions'a gider kategorisi + randevu tipi global varsayılanları
insert into public.definitions (tenant_id, category, value, label, sort_order) values
  -- Gider kategorisi
  (null, 'expense_category', 'reklam', 'Reklam & Pazarlama', 1),
  (null, 'expense_category', 'ofis', 'Ofis Giderleri', 2),
  (null, 'expense_category', 'ulasim', 'Ulaşım', 3),
  (null, 'expense_category', 'egitim', 'Eğitim & Gelişim', 4),
  (null, 'expense_category', 'komisyon_gider', 'Komisyon Gideri', 5),
  (null, 'expense_category', 'diger', 'Diğer', 6),
  -- Randevu tipi
  (null, 'appointment_type', 'showing', 'Yer gösterme', 1),
  (null, 'appointment_type', 'valuation', 'Değerleme', 2),
  (null, 'appointment_type', 'office', 'Ofis görüşmesi', 3),
  (null, 'appointment_type', 'signing', 'İmza / sözleşme', 4),
  (null, 'appointment_type', 'other', 'Diğer', 5)
on conflict do nothing;
