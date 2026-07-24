-- Definitions: talep aciliyeti + destek kategorisi global varsayılanları
insert into public.definitions (tenant_id, category, value, label, sort_order) values
  -- Talep aciliyeti
  (null, 'demand_urgency', 'low', 'Düşük', 1),
  (null, 'demand_urgency', 'normal', 'Normal', 2),
  (null, 'demand_urgency', 'high', 'Yüksek', 3),
  (null, 'demand_urgency', 'urgent', 'Acil', 4),
  -- Destek talebi kategorisi
  (null, 'ticket_category', 'general', 'Genel', 1),
  (null, 'ticket_category', 'billing', 'Abonelik / fatura', 2),
  (null, 'ticket_category', 'bug', 'Hata bildirimi', 3),
  (null, 'ticket_category', 'feature', 'Özellik isteği', 4),
  (null, 'ticket_category', 'compliance', 'İYS / KVKK', 5),
  (null, 'ticket_category', 'onboarding', 'Kurulum', 6)
on conflict do nothing;
