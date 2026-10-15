-- MIGRATION 20261016050100_commissions_inherit_sample.sql
-- SK5 (2026-10-16): komisyonun örnek (is_sample) bayrağı anlaşmasından türer.
-- Geri alma: supabase/rollbacks/20261016050100_commissions_inherit_sample.rollback.sql
--
-- SORUN (B085, canlı ölçüm 2026-10-15): commissions.is_sample anlaşmadan türetilmiyordu. Örnek (is_sample) anlaşma
--   kazanıldı yapılınca komisyon is_sample=false yazılıyor, ciroya ve KDV'ye giriyordu (demo-ofis: 5 komisyon,
--   669.760 TL ciro / 133.952 TL KDV). Komisyon yazan RPC'ler (transition_deal_stage_atomic, sell_project_unit_atomic,
--   import_rental_with_deal) ve demo tohumu is_sample'ı hiç vermiyor. Rapor RPC'leri c.is_sample'a, anlaşma
--   sayıları d.is_sample'a bakıyor; tutarsızlık buradan.
-- ÇÖZÜM: BEFORE INSERT OR UPDATE OF deal_id tetikleyicisi: new.is_sample := anlaşmanın is_sample'ı (aynı kiracı);
--   anlaşma bulunamazsa gelen değer korunur. Tetikleyici SECURITY DEFINER (kapsam RLS'i anlaşmayı gizlese de doğru
--   değer), yalnız aynı tenant_id'li anlaşmayı okur. Mevcut uyuşmazlar tek seferlik düzeltilir (bugün yalnız demo-ofis'te 5).
-- ETKİ: davranış — örnek anlaşmanın komisyonu artık örnek sayılır (rapor/ciro/KDV dışı). Gerçek ofislerde 0 satır değişir.
-- İdempotent: create or replace / drop trigger if exists; backfill yalnız uyuşmaz satırları günceller.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.commissions') is null or pg_catalog.to_regclass('public.deals') is null then
    raise exception 'public.commissions / public.deals yok.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'commissions' and column_name = 'is_sample'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'deals' and column_name = 'is_sample'
  ) then
    raise exception 'commissions.is_sample / deals.is_sample yok (20260816001600 önce uygulanmalı).';
  end if;
end $$;

create or replace function public.commissions_inherit_sample()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sample boolean;
begin
  if new.deal_id is null then
    return new;
  end if;
  select d.is_sample into v_sample
  from public.deals d
  where d.id = new.deal_id
    and d.tenant_id = new.tenant_id;
  new.is_sample := coalesce(v_sample, new.is_sample);
  return new;
end;
$$;

comment on function public.commissions_inherit_sample() is
  'SK5: komisyonun is_sample bayrağı anlaşmasından türer (aynı kiracı); anlaşma yoksa gelen değer korunur.';

revoke all on function public.commissions_inherit_sample() from public;

drop trigger if exists trg_commissions_inherit_sample on public.commissions;
create trigger trg_commissions_inherit_sample
  before insert or update of deal_id on public.commissions
  for each row
  execute function public.commissions_inherit_sample();

-- Tek seferlik: mevcut uyuşmaz satırlar (2026-10-15 canlı: yalnız demo-ofis'te 5 satır; gerçek ofislerde 0).
update public.commissions c
   set is_sample = d.is_sample
  from public.deals d
 where d.id = c.deal_id
   and d.tenant_id = c.tenant_id
   and c.is_sample is distinct from d.is_sample;
