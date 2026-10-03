-- Kayıp nedeni (loss_reason) ve anlaşma aşama adları (deal_stage_label) global varsayılanları.
-- Şema değişikliği YOK: definitions.category text, value/label serbest. Yalnız global seed satırları.
--  * loss_reason: deals.loss_reason'a "<value>" veya "<value> | not" yazılır; eski serbest metin kayıtlar aynen kalır.
--  * deal_stage_label: value = deals.stage anahtarı (new/qualified/negotiation/won/lost); ofis yalnız etiket/rengi
--    kendi tenant satırıyla geçersiz kılar. Aşama anahtarları/enum/CHECK/RPC'ye dokunulmaz.
-- Idempotent: tekrar çalıştırmak güvenlidir. Kod tarafı seed olmadan da varsayılanlara düşer (definition-defaults.ts).

insert into public.definitions (tenant_id, category, value, label, sort_order) values
  (null, 'loss_reason', 'fiyat_yuksek',  'Fiyat yüksek bulundu',      1),
  (null, 'loss_reason', 'baska_ofis',    'Başka ofisle çalıştı',      2),
  (null, 'loss_reason', 'vazgecti',      'Vazgeçti',                  3),
  (null, 'loss_reason', 'finansman_yok', 'Finansman bulamadı',        4),
  (null, 'loss_reason', 'mulk_satildi',  'Mülk satıldı / kiralandı',  5),
  (null, 'loss_reason', 'ulasilamiyor',  'Ulaşılamıyor',              6),
  (null, 'loss_reason', 'diger',         'Diğer',                     7),
  (null, 'deal_stage_label', 'new',         'Yeni',        1),
  (null, 'deal_stage_label', 'qualified',   'Nitelikli',   2),
  (null, 'deal_stage_label', 'negotiation', 'Müzakere',    3),
  (null, 'deal_stage_label', 'won',         'Kazanıldı',   4),
  (null, 'deal_stage_label', 'lost',        'Kaybedildi',  5)
on conflict do nothing;

update public.definitions
   set is_system = true
 where tenant_id is null
   and is_system = false
   and (
        (category = 'loss_reason' and value = 'diger')
     or (category = 'deal_stage_label' and value in ('won', 'lost'))
   );
