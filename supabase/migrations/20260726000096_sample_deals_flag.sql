-- Örnek veri netliği: deals'e de is_sample bayrağı (bkz. 086_sample_data.sql).
-- Önceden tek örnek anlaşma, örnek müşteri/portföy FK'ları üzerinden dolaylı
-- bulunup siliniyordu — kırılgan (FK null'lanırsa örnek anlaşma yetim kalır,
-- gerçek müşteriye bağlanmış anlaşma yanlışlıkla silinebilir). Artık temizleme
-- diğer tablolarla aynı doğrudan is_sample filtresini kullanır
-- (src/app/actions/sample-data.ts). Hafif kolon, index yok (086 ile aynı gerekçe).

alter table public.deals
  add column if not exists is_sample boolean not null default false;

comment on column public.deals.is_sample is 'Örnek veri işareti — clearSampleData yalnız bu bayrağı taşıyanları siler';
