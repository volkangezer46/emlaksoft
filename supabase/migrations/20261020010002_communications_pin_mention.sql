-- MIGRATION 20261020010002_communications_pin_mention.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE uygulanir: yeni Musteri 360 not listesi pinned_at / mentioned_user_ids okur (kolonlar yokken liste
--   sabitleme ve anma olmadan eski bicimde calisir; not yazimi bozulmaz).
-- Geri alma: supabase/rollbacks/20261020010002_communications_pin_mention.rollback.sql (aktarilan "Onceki notlar" kayitlari
--   silinir; customers.notes zaten hic degismedi; sabitleme ve anma bilgisi kaybolur).
-- BAGIMLILIK: communications (20260723000032), comm_channel 'note' + comm_direction 'internal'.
--
-- NE (CRM-G9, yapilandirilmis notlar):
--   1) communications.pinned_at / pinned_by: notu sabitle (360'ta hero altinda en fazla 3 sabit not).
--   2) communications.mentioned_user_ids: @anilan ekip arkadaslari (bildirim uygulama katmaninda gider; filtre "Benden
--      bahsedenler" bu diziye bakar).
--   3) communications.origin: kaydin uretildigi yol ('customers.notes' = bu migration'in aktardigi eski serbest metin).
--   4) VERI (yikicisiz): customers.notes serbest metni not listesine TEK bir "Onceki notlar" kaydi olarak KOPYALANIR
--      (customers.notes DEGISMEZ; "Genel aciklama" olarak kalir). Tarih = musteri kayit tarihi, origin = 'customers.notes'.
--      Bu kayit "son temas" sayilmaz (customer_heat_signals 20261020010003 origin'i disarida birakir). Idempotent:
--      musteride ayni origin'li kayit varsa tekrar eklenmez.
--
-- GUVENLIK: tablo politikasi degismez (okuma customers:view, guncelleme customers:edit). Silinmis musteri aktarilmaz.
set local lock_timeout = '5s';

alter table public.communications
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references public.profiles(id) on delete set null,
  add column if not exists mentioned_user_ids uuid[] not null default '{}'::uuid[],
  add column if not exists origin text check (origin is null or char_length(origin) <= 40);

comment on column public.communications.pinned_at is 'CRM-G9: not sabitlendi (Musteri 360 sabit notlar seridi).';
comment on column public.communications.mentioned_user_ids is 'CRM-G9: notta @anilan ekip uyeleri (profiles.id).';
comment on column public.communications.origin is
  'Kaydin kaynagi: null = kullanici/entegrasyon; ''customers.notes'' = eski serbest notun aktarimi (son temas sayilmaz).';

create index if not exists idx_communications_customer_pinned
  on public.communications (customer_id, pinned_at desc) where pinned_at is not null;
create index if not exists idx_communications_mentions
  on public.communications using gin (mentioned_user_ids) where cardinality(mentioned_user_ids) > 0;
create index if not exists idx_communications_pinned_by on public.communications (pinned_by) where pinned_by is not null;

-- Eski serbest metin -> not listesi (kopya; kaynak metin aynen kalir).
insert into public.communications (tenant_id, customer_id, created_by, channel, direction, subject, body, created_at, origin)
select c.tenant_id, c.id, null, 'note', 'internal', 'Önceki notlar', btrim(c.notes), c.created_at, 'customers.notes'
from public.customers c
where c.deleted_at is null
  and coalesce(btrim(c.notes), '') <> ''
  and not exists (
    select 1 from public.communications m
     where m.customer_id = c.id and m.tenant_id = c.tenant_id and m.origin = 'customers.notes'
  );
