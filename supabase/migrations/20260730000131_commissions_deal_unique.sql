-- Aynı anlaşmaya (deal_id) BİRDEN FAZLA komisyon oluşmasını engeller.
--
-- SORUN (derin denetim, YÜKSEK): eşzamanlı "kazanıldı" geçişi — çift-tık,
-- drag-to-won + buton, ya da retry edilen istek — `ensureCommissionForDeal`'ı
-- (src/app/actions/deals.ts) iki kez tetikliyor. Her ikisi de "komisyon yok"
-- görüp ayrı komisyon satırı insert ediyor → deal başına 2 komisyon → ciro,
-- danışman hakedişi ve KPI toplamları İKİ KATINA çıkıyor (danisman-kpi, pano-tv,
-- komisyon defteri). commissions.deal_id'de yalnız düz (non-unique) indeks vardı.
--
-- Partial: manuel komisyonlar (deal_id NULL) bu kısıttan muaf. Mevcut çift kayıt
-- yok (uygulama öncesi denetim: 0 çift deal_id), güvenle eklenir.
create unique index if not exists uq_commissions_deal_id
  on public.commissions (deal_id)
  where deal_id is not null;
