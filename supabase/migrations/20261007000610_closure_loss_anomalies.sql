-- "Potansiyel kayıp" TEK KAYNAK: listing_anomalies (PB51).
--
-- SORUN: Kayıp-Kaçak ekranı "kaçan komisyon"u eski listing_closures tablosundan, İlan Kontrol ise listing_anomalies'ten
--   okuyordu; aynı kavram iki kaynakta, iki farklı sayı.
-- COZUM (tablo SILINMEZ; listing_closures kapanış formu kaydı olarak kalır):
--   1. listing_anomalies.type CHECK'ine 'closure_loss' eklenir ("kapanışta kaçan komisyon"). Bu tür motorun portföy başına
--      eşitlediği türlerden DEĞİLDİR (lc_sync_anomalies onu otomatik kapatmaz); kaynağı kapanış formudur.
--   2. listing_closures AFTER INSERT/UPDATE tetikleyicisi: tahmini kaçan komisyon > 0 olan kapanış, aynı anda
--      'closure_loss' anomalisi olarak yazılır/güncellenir (dedupe 'closure_loss:<kapanış id>'). Kapanış formu açıklamanın
--      kendisidir: durum 'explained' (SLA zinciri tetiklenmez, bildirim seli yok). Kayıp sonradan sıfırlanırsa 'false_positive'.
--   3. Tek seferlik UZLAŞTIRMA: mevcut kayıplı kapanışlar aynı kuralla anomaliye taşınır (on conflict do nothing; tekrar
--      çalıştırılabilir).
--   4. lc_closure_loss_ready(): kod yoklaması (rpc-probe). Yokken ekran eski kaynağa düşer.
-- Kapsam alanları (şube/takım/danışman) lc_sync_anomalies ile AYNI kuralla portföyden okunur (lc_row_visible RLS'i).
-- BAGIMLILIK: 20260721000000 (listing_closures, portal_listings), 20260826002030 (listing_anomalies, listing_anomaly_actions).
-- GERI ALMA: rollbacks/20261007000610_closure_loss_anomalies.rollback.sql (tetikleyici + fonksiyonlar düşer, closure_loss
--   satırları silinir, CHECK eski listeye döner).
-- RISK: düşük-orta (CHECK yeniden kurulur: NOT VALID + VALIDATE ile kısa kilit; yeni satırlar yalnız 'explained').

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.listing_closures') is null
     or pg_catalog.to_regclass('public.listing_anomalies') is null
     or pg_catalog.to_regclass('public.listing_anomaly_actions') is null
     or pg_catalog.to_regclass('public.portal_listings') is null then
    raise exception 'listing_closures/listing_anomalies/portal_listings yok; once 20260826002030 uygulanmali.';
  end if;
end $$;

-- 1) Tür listesi
alter table public.listing_anomalies drop constraint if exists listing_anomalies_type_check;
alter table public.listing_anomalies add constraint listing_anomalies_type_check check (type in
  ('portal_missing', 'not_published', 'unregistered_listing', 'bulk_mismatch', 'price_mismatch', 'advisor_mismatch',
   'duplicate', 'potential_lost_deal', 'sold_still_listed', 'incomplete_closure', 'authority_expiring', 'closure_loss')) not valid;
alter table public.listing_anomalies validate constraint listing_anomalies_type_check;

-- 2) Eşitleme fonksiyonu (tek kural; tetikleyici ve uzlaştırma aynısını çağırır)
create or replace function public.lc_upsert_closure_loss(p_closure_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v_property uuid;
  v_branch uuid;
  v_advisor uuid;
  v_team uuid;
  v_amount numeric;
  v_key text;
  v_id uuid;
  v_sev text;
begin
  select lc.id, lc.tenant_id, lc.portal_listing_id, lc.reason, lc.deal_happened, lc.deal_amount, lc.closed_by_us,
         lc.competitor_closed, lc.estimated_lost_commission, lc.created_by, lc.created_at
    into c
    from public.listing_closures lc where lc.id = p_closure_id;
  if not found then
    return;
  end if;
  v_key := 'closure_loss:' || c.id::text;
  v_amount := coalesce(c.estimated_lost_commission, 0);

  if v_amount <= 0 then
    -- Kayıp kalktıysa (form düzeltildi) mevcut kayıt kapatılır; hiç yoksa bir şey yazılmaz.
    update public.listing_anomalies a
       set status = 'false_positive', resolved_at = now(), last_seen_at = now()
     where a.tenant_id = c.tenant_id and a.dedupe_key = v_key and a.status <> 'false_positive'
    returning a.id into v_id;
    if v_id is not null then
      insert into public.listing_anomaly_actions (tenant_id, anomaly_id, action, note)
      values (c.tenant_id, v_id, 'false_positive', 'Kapanış formunda kaçan komisyon kalmadı');
    end if;
    return;
  end if;

  select pl.property_id into v_property from public.portal_listings pl where pl.id = c.portal_listing_id and pl.tenant_id = c.tenant_id;
  if v_property is null then
    return;
  end if;
  select pr.branch_id, pr.assigned_to into v_branch, v_advisor from public.properties pr where pr.id = v_property and pr.tenant_id = c.tenant_id;
  select nullif(to_jsonb(pf) ->> 'team_id', '')::uuid into v_team from public.profiles pf where pf.id = v_advisor;
  v_sev := case when v_amount >= 100000 then 'critical' when v_amount >= 25000 then 'high' else 'medium' end;

  insert into public.listing_anomalies as a
    (tenant_id, property_id, portal_listing_id, type, severity, status, dedupe_key, branch_id, team_id, advisor_id, assignee_id,
     details, first_seen_at, last_seen_at, explained_reason_code, explained_note, explained_by, explained_at)
  values
    (c.tenant_id, v_property, c.portal_listing_id, 'closure_loss', v_sev, 'explained', v_key, v_branch, v_team, v_advisor, v_advisor,
     jsonb_build_object(
       'source', 'closure', 'closure_id', c.id, 'estimated_lost_commission', v_amount, 'deal_amount', c.deal_amount,
       'competitor_closed', c.competitor_closed, 'closed_by_us', c.closed_by_us, 'deal_happened', c.deal_happened,
       'reason', left(coalesce(c.reason, ''), 200)
     ),
     c.created_at, now(), 'other', left('Kapanış formu: ' || coalesce(c.reason, ''), 500), c.created_by, c.created_at)
  on conflict (tenant_id, dedupe_key) do update
     set severity = excluded.severity,
         status = case when a.status = 'false_positive' then 'explained' else a.status end,
         resolved_at = case when a.status = 'false_positive' then null else a.resolved_at end,
         details = excluded.details,
         last_seen_at = now()
  returning a.id into v_id;
end;
$$;

create or replace function public.lc_closure_loss_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Eşitleme hatası kapanış formunu ASLA düşürmez (en iyi çaba; uzlaştırma yeniden çalıştırılabilir).
  begin
    perform public.lc_upsert_closure_loss(new.id);
  exception when others then
    raise warning 'closure_loss esitleme atlandi (%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_listing_closures_loss_anomaly on public.listing_closures;
create trigger trg_listing_closures_loss_anomaly
  after insert or update of estimated_lost_commission, deal_happened, closed_by_us, competitor_closed, reason, deal_amount
  on public.listing_closures
  for each row execute function public.lc_closure_loss_trigger();

-- 3) Tek seferlik uzlaştırma (tekrar çalıştırılabilir)
do $$
declare
  r record;
begin
  for r in select lc.id from public.listing_closures lc where coalesce(lc.estimated_lost_commission, 0) > 0 loop
    perform public.lc_upsert_closure_loss(r.id);
  end loop;
end $$;

-- 4) Kod yoklaması
create or replace function public.lc_closure_loss_ready()
returns boolean
language sql
stable
set search_path = ''
as $$ select true $$;

revoke all on function public.lc_upsert_closure_loss(uuid) from public, anon, authenticated;
grant execute on function public.lc_upsert_closure_loss(uuid) to service_role;
revoke all on function public.lc_closure_loss_trigger() from public, anon, authenticated;
revoke all on function public.lc_closure_loss_ready() from public, anon;
grant execute on function public.lc_closure_loss_ready() to authenticated, service_role;

comment on function public.lc_upsert_closure_loss(uuid) is 'Kayıplı kapanışı closure_loss anomalisi olarak eşitler (potansiyel kayıp tek kaynak: listing_anomalies).';

notify pgrst, 'reload schema';
