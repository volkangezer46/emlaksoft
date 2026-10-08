-- Ilan analizi (1 kontor) sonuc onbellegi: ayni ilan icin 24 saat icinde tekrar ucret alinmaz.
--
-- NEDEN: Portfoy detayinda "Ilan analizi" karti emsal motoru + EmlakFiyati verisiyle fiyat konumunu hesaplar; her analiz EF kontor
--   cuzdanindan `listing_analysis` kalemiyle 1 kontor dusurur. Sonucun saklanmasi hem tekrar ucreti onler hem gecmisi gosterir.
-- NE: (1) listing_analyses (tenant_id + property_id + input_key + sonuc jsonb + dusen kontor + rezervasyon kimligi);
--     (2) RLS: okuma ofis icinde; yazma yalniz valuation.create izniyle ve ayni ofisin portfoyune. Guncelleme/silme politikasi YOK
--         (sonuc degistirilemez). Kontor dusumu ayri: ef_credit_* RPC'leri (service_role) - bu tablo bakiye TUTMAZ.
-- GIZLILIK: sonuc jsonb yalniz sayi/kural ciktisi tasir (malik, telefon, adres satiri YOK).
-- GERI ALMA: rollbacks/20261008001800_listing_analyses.rollback.sql (tablo duser; kod tablo yokken analizi "etkin degil" der,
--   kontor dusmez). RISK: dusuk (yeni tablo; mevcut tablo/politika degismez).

set local lock_timeout = '5s';

create table if not exists public.listing_analyses (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  property_id    uuid        not null references public.properties(id) on delete cascade,
  user_id        uuid        references public.profiles(id) on delete set null,
  -- Girdi ozeti (fiyat, m2, ilce, tur, islem): girdi degisince onbellek gecersiz, yeni analiz ucretlenir.
  input_key      text        not null check (char_length(input_key) between 1 and 200),
  result         jsonb       not null,
  units_charged  integer     not null default 0 check (units_charged >= 0 and units_charged <= 10000),
  reservation_id uuid,
  created_at     timestamptz not null default now()
);

comment on table public.listing_analyses is 'Ilan analizi sonuclari (EF kontor kalemi listing_analysis). 24 saatlik onbellek; sonuc degistirilemez. Kisisel veri tutulmaz.';

create index if not exists idx_listing_analyses_tenant_property on public.listing_analyses (tenant_id, property_id, created_at desc);

alter table public.listing_analyses enable row level security;

drop policy if exists listing_analyses_select on public.listing_analyses;
create policy listing_analyses_select on public.listing_analyses
  for select to authenticated using (tenant_id = public.current_active_tenant_id());

drop policy if exists listing_analyses_insert on public.listing_analyses;
create policy listing_analyses_insert on public.listing_analyses
  for insert to authenticated
  with check (
    tenant_id = public.current_active_tenant_id()
    and public.has_effective_permission('valuation', 'create')
    and exists (select 1 from public.properties p where p.id = property_id and p.tenant_id = listing_analyses.tenant_id)
  );

notify pgrst, 'reload schema';
