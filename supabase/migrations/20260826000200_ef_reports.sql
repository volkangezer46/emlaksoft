-- MIGRATION 20260826000200_ef_reports.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826000200_ef_reports.sql` ile uygular (YAYIN_PENCERESI_2.md §7).
-- Geri alma: supabase/rollbacks/20260826000200_ef_reports.rollback.sql (000300 rollback'inden SONRA, 000100'den ONCE).
--
-- EmlakFiyati ortak degerleme RAPORLARI kaydi (docs/integrations/EMLAKFIYATI_ORTAK_API_V1.md §3, §7.3, §9).
-- Kesinlesen degerlemenin rapor_id'si kullaniciyla iliskilendirilip saklanir (PDF ve tekrar indirme icin; ilk PDF
-- bir kez ucretlenir, tekrarlar ucretsiz: pdf_charged + pdf_reservation_id). KISISEL VERI KOLONU YOK: yalniz
-- coğrafi anahtar (mahalle_id/ada/parsel), tip, guven sinifi, sonuc durumu ve kontor bilgisi. Ad/telefon/e-posta/
-- adres/TC/malik bilgisi bu tabloya YAZILMAZ (bicim CHECK'leri serbest metni engeller).
--
-- TASARIM
--   * unique(tenant_id, rapor_id): ayni rapor iki kez yazilmaz (Idempotency-Replayed yanitinda tekrar kayit yok).
--   * reservation_id ZORUNLU ve tekil: her degerleme bir rezerv kaydina baglidir (0 kontorluk akista da;
--     20260826000100 basligi "0 kontorluk islem"). Bilesik FK (tenant_id, reservation_id) ->
--     ef_credit_reservations(tenant_id, id): rapor ile rezerv AYNI ofiste olmak zorunda.
--   * pdf_reservation_id (bos olabilir, tekil): ilk PDF'in rezervi; pdf_charged=true ise dolu olmali.
--   * FK adlari `<tablo>_<kolon>_fkey`: ef_credit_reservations'a IKI FK var -> PostgREST gommeleri FK adiyla
--     yazilmali (`reservation:ef_credit_reservations!ef_reports_reservation_id_fkey(...)`).
--   * RLS: SELECT = ayni ofis VE (kendi raporu ya da owner/gm). Yazma YALNIZ service_role (politika yok,
--     authenticated'a yalniz SELECT). rapor_id bir erisim anahtaridir (§10): baska kullanicinin raporu gorunmez.
--   * expires_at: EmlakFiyati rapor_gecerlilik.expires_at (yoksa NULL).
--
-- BAGIMLILIK: 20260826000100 (ef_credit_reservations + unique(tenant_id,id)). Eksikse hicbir sey yazmadan durur.
-- Kod (src/lib/ef-credits/) henuz YOK.
--
-- SALT-OKUNUR DOGRULAMA (uygulamadan SONRA; YAYIN_PENCERESI_2.md §7.2):
-- select to_regclass('public.ef_reports') is not null as tablo,
--        (select relrowsecurity from pg_class where oid='public.ef_reports'::regclass) as rls,
--        (select count(*) from pg_policies where schemaname='public' and tablename='ef_reports') as pol,
--        (select count(*) from pg_constraint where conrelid='public.ef_reports'::regclass and contype='f' and conname in
--          ('ef_reports_tenant_id_fkey','ef_reports_user_id_fkey','ef_reports_reservation_id_fkey','ef_reports_pdf_reservation_id_fkey')) as fk,
--        has_table_privilege('authenticated','public.ef_reports','insert') as auth_insert,
--        has_table_privilege('authenticated','public.ef_reports','select') as auth_select;
-- BEKLENEN: t | t | 1 | 4 | f | t

do $$
begin
  if pg_catalog.to_regclass('public.ef_credit_reservations') is null then
    raise exception '20260826000200: public.ef_credit_reservations yok; once 20260826000100 uygulanmali.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.ef_credit_reservations'::regclass
      and c.conname = 'ef_credit_reservations_tenant_id_id_key'
  ) then
    raise exception '20260826000200: ef_credit_reservations_tenant_id_id_key yok; 20260826000100 durumu beklenenden farkli.';
  end if;
end
$$;

create table if not exists public.ef_reports (
  id                 uuid not null default gen_random_uuid(),
  tenant_id          uuid not null,
  user_id            uuid,
  rapor_id           text not null,
  reservation_id     uuid not null,
  mahalle_id         integer,
  ada                text,
  parsel             text,
  tip                text not null,
  guven_sinifi       text,
  sonuc_durumu       text not null,
  units_charged      integer not null default 0,
  pdf_charged        boolean not null default false,
  pdf_reservation_id uuid,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz,
  constraint ef_reports_pkey primary key (id),
  constraint ef_reports_tenant_id_fkey foreign key (tenant_id)
    references public.tenants(id) on delete cascade,
  constraint ef_reports_user_id_fkey foreign key (user_id)
    references public.profiles(id) on delete set null,
  constraint ef_reports_reservation_id_fkey foreign key (tenant_id, reservation_id)
    references public.ef_credit_reservations(tenant_id, id),
  constraint ef_reports_pdf_reservation_id_fkey foreign key (tenant_id, pdf_reservation_id)
    references public.ef_credit_reservations(tenant_id, id),
  constraint ef_reports_tenant_rapor_key unique (tenant_id, rapor_id),
  constraint ef_reports_tenant_reservation_key unique (tenant_id, reservation_id),
  constraint ef_reports_tenant_pdf_reservation_key unique (tenant_id, pdf_reservation_id),
  -- EmlakFiyati rapor kimligi: 8-64 harf/rakam/tire (v1 kilavuzu §3.2).
  constraint ef_reports_rapor_id_check check (rapor_id ~ '^[A-Za-z0-9-]{8,64}$'),
  constraint ef_reports_mahalle_id_check check (mahalle_id is null or mahalle_id > 0),
  -- Ada/parsel yalniz kisa kod: serbest metin (kisisel veri) yazilamaz.
  constraint ef_reports_ada_check check (ada is null or ada ~ '^[0-9A-Za-z./-]{1,20}$'),
  constraint ef_reports_parsel_check check (parsel is null or parsel ~ '^[0-9A-Za-z./-]{1,20}$'),
  constraint ef_reports_tip_check check (tip in ('arsa', 'konut')),
  constraint ef_reports_guven_sinifi_check check (guven_sinifi is null or guven_sinifi ~ '^[a-z_]{1,20}$'),
  constraint ef_reports_sonuc_durumu_check check (sonuc_durumu ~ '^[a-z_]{1,40}$'),
  constraint ef_reports_units_charged_check check (units_charged >= 0),
  constraint ef_reports_pdf_check check (not pdf_charged or pdf_reservation_id is not null)
);

comment on table public.ef_reports is
  'EmlakFiyati ortak degerleme raporlari (rapor_id kullaniciyla iliskili). KISISEL VERI YOK. Yazma yalniz service_role; okuma: kendi raporu ya da owner/gm.';
comment on column public.ef_reports.rapor_id is
  'EmlakFiyati rapor kimligi: erisim anahtari gibi davranir (v1 §10); herkese acik baglantida paylasilmaz.';

create index if not exists idx_ef_reports_tenant_created
  on public.ef_reports (tenant_id, created_at desc);
create index if not exists idx_ef_reports_user
  on public.ef_reports (tenant_id, user_id, created_at desc);
create index if not exists idx_ef_reports_user_fk
  on public.ef_reports (user_id)
  where user_id is not null;

alter table public.ef_reports enable row level security;
drop policy if exists ef_reports_select on public.ef_reports;
create policy ef_reports_select on public.ef_reports
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      user_id = (select auth.uid())
      or (select public.current_profile_role()) in ('owner', 'gm')
    )
  );
-- Yazma politikasi YOK: yalniz service_role (RLS disi). Varsayilan yazma/TRUNCATE ayricaliklari temizlenir.
revoke all privileges on table public.ef_reports from public, anon, authenticated;
grant select on table public.ef_reports to authenticated;
grant all privileges on table public.ef_reports to service_role;

notify pgrst, 'reload schema';
