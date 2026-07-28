-- ============================================================
-- Sunum → müşteri gerçek bağı (presentations.customer_id)
-- ============================================================
-- SORUN: presentations tablosunda müşteri yalnız `customer_name` serbest
-- metniyle tutuluyordu. Sunum gerçekte müşteriye yapılan bir teklif hamlesi
-- ama Müşteri 360'ta HİÇ görünmüyordu — veri sistemde vardı, kullanıcı
-- göremiyordu.
--
-- ÇÖZÜM: opsiyonel FK. Serbest metin KALIYOR (müşteri kaydı olmayan kişiye de
-- sunum çıkılabilmeli — mevcut davranış aynen sürsün); seçim yapılırsa ikisi
-- birlikte dolar. Müşteri silinirse sunum ve public linki ölmesin → set null.

alter table public.presentations
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

comment on column public.presentations.customer_id is
  'Opsiyonel müşteri bağı — Müşteri 360''ta sunumları listelemek için. customer_name serbest metni yedek/etiket olarak kalır.';

-- Müşteri 360 sorgusu bu index üzerinden gider (tenant zaten RLS ile daralıyor).
create index if not exists idx_presentations_customer
  on public.presentations(customer_id, created_at desc)
  where customer_id is not null;

-- ============================================================
-- Güvenli backfill
-- ============================================================
-- YALNIZCA aynı tenant içinde `customer_name` ile TAM eşleşen ve TEK aday
-- bulunan satırlar bağlanır. İki "Ayşe Yılmaz" varsa DOKUNULMAZ — yanlış
-- müşteriye sunum iliştirmek, hiç bağlamamaktan daha kötüdür.
update public.presentations p
   set customer_id = m.cid
  from (
    -- min(uuid) PostgreSQL'de yok; tek aday zaten garanti (having count = 1)
    select p2.id as pid, (array_agg(c.id))[1] as cid
      from public.presentations p2
      join public.customers c
        on c.tenant_id = p2.tenant_id
       and c.deleted_at is null
       and c.full_name = p2.customer_name
     where p2.customer_id is null
       and p2.customer_name is not null
       and btrim(p2.customer_name) <> ''
     group by p2.id
    having count(c.id) = 1
  ) m
 where p.id = m.pid;
