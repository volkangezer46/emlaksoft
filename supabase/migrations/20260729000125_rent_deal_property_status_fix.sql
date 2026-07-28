-- =====================================================================
-- P0 VERİ BÜTÜNLÜĞÜ: Kira anlaşması kazanılınca portföy "Satıldı" oluyordu
-- =====================================================================
--
-- KÖK NEDEN (kodda düzeltildi): actions/deals.ts `ensureCommissionForDeal`
-- ve actions/workflow.ts `create_deal_from_property`, anlaşma "won" olunca
-- portföye KOŞULSUZ `status = 'sold'` yazıyordu. `deal_type = 'rent'` için de
-- aynı satır çalıştığından kiralık portföy kalıcı "Satıldı" damgası yiyor,
-- eşleştirmeden ve vitrinden düşüyordu.
--
-- ŞEMA NOTU — YENİ DEĞER GEREKMEDİ:
-- `public.properties.status` serbest metin; kolonda CHECK kısıtı YOK
-- (bkz. 20260721000000_init.sql: `status text not null default 'draft'`).
-- Geçerli değerler `public.definitions` sözlüğünde `property_status` altında
-- tanımlı ve 20260723000034_property_history_auth_lookup.sql orada ZATEN
-- 'rented' → 'Kiralandı' satırını seed ediyor. Bu yüzden yeni bir enum
-- değeri/CHECK değişikliği eklenmedi; mevcut 'rented' kullanıldı.
--
-- GEÇMİŞ VERİ DÜZELTMESİ:
-- Yalnızca KESİN olan kayıtlar düzeltilir:
--   · portföy şu an 'sold'
--   · portföye bağlı KAZANILMIŞ (stage='won') bir KİRA anlaşması var
--   · aynı portföye bağlı kazanılmış SATIŞ anlaşması YOK
-- Üçüncü koşul şart: hem kiralanıp hem satılmış portföyde 'sold' doğru
-- olabilir; belirsiz kayda DOKUNULMAZ.
--
-- ÖLÇÜM (dev DB, migration yazılmadan önce salt-okunur sayıldı):
--   · yukarıdaki kesin kümede etkilenen portföy : 0
--   · belirsiz küme (hem kira hem satış won)     : 0
--   · toplam kazanılmış kira anlaşması           : 1
--   · hâlihazırda 'rented' portföy               : 1
-- Yani dev'de bu UPDATE no-op'tur; prod/başka ortamlarda birikmiş bozuk
-- kayıtları düzeltmek için idempotent olarak bırakıldı.

update public.properties p
set    status     = 'rented',
       updated_at = now()
where  p.status = 'sold'
  and  exists (
         select 1 from public.deals d
         where  d.property_id = p.id
           and  d.tenant_id   = p.tenant_id
           and  d.deal_type   = 'rent'
           and  d.stage       = 'won'
       )
  and  not exists (
         select 1 from public.deals d2
         where  d2.property_id = p.id
           and  d2.tenant_id   = p.tenant_id
           and  d2.deal_type   = 'sale'
           and  d2.stage       = 'won'
       );
