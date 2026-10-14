-- KQ6 bildirim gurultusu: tek seferlik VERI temizligi (sema degismez).
--  1) dedupe_key kolonu (20260826001500) gelmeden once portal-teyit cron'unun her turda yazdigi
--     'Portal teyit gecikti' satirlari (dedupe_key NULL) ilan basina EN YENI satira indirilir. Eski satirda ilan kimligi
--     yalniz govdede (portal adi + portal ilan no) bulunur: ilan = (tenant_id, user_id, body).
--  2) Saat kaymasiyla (ileri tarihli test/cron calismasi) yazilmis GELECEK tarihli satirlar: once ayni kiraci/kullanici/
--     baslik/tur/govdedeki gelecek tarihli kopyalar (dedupe_key NULL) en yeniye indirilir, sonra kalanlarin created_at'i
--     now() ile kelepcelenir (listede "az once" ve sirada en ustte kalmasinlar diye). dedupe_key'li satirlar silinmez.
-- Bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir. Geri alinamaz (silinen satirlar tekrarli kopyalardir);
-- geri alma dosyasi bilincli olarak islem yapmaz.
-- Idempotent: ikinci calistirmada silinecek kopya ve gelecek tarihli satir kalmaz.

-- 1) Eski (anahtarsiz) portal teyit uyarilari: ilan basina en yeni satir kalir.
with ranked as (
  select id,
         row_number() over (
           partition by tenant_id, user_id, coalesce(body, '')
           order by created_at desc, id desc
         ) as rn
  from public.notifications
  where title = 'Portal teyit gecikti'
    and dedupe_key is null
)
delete from public.notifications n
using ranked r
where n.id = r.id
  and r.rn > 1;

-- 2a) Gelecek tarihli anahtarsiz kopyalar: ayni icerikte en yeni satir kalir.
with future_ranked as (
  select id,
         row_number() over (
           partition by tenant_id, user_id, title, kind, coalesce(body, '')
           order by created_at desc, id desc
         ) as rn
  from public.notifications
  where created_at > now()
    and dedupe_key is null
)
delete from public.notifications n
using future_ranked r
where n.id = r.id
  and r.rn > 1;

-- 2b) Kalan gelecek tarihli satirlar bugune kelepcelenir.
update public.notifications
set created_at = now()
where created_at > now();
