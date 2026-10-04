-- Güvenlik denetimi 3 / #11 (P2): property_owner_info — UPDATE ile kaydı başka ilana/müşteriye taşıma.
--
-- NEDEN: 20260819020100'de property_owner_info_update politikasının WITH CHECK'i yalnız tenant koşuluydu.
--   USING kapsamı (owner/gm/branch_manager veya ilanın atananı/oluşturanı) yalnız ESKİ satıra uygulanıyordu;
--   danışman kendi satırındaki property_id'yi başka (kendisine ait olmayan) ilana, customer_id'yi göremediği
--   bir müşteriye çevirebiliyordu.
--
-- NE YAPAR:
--   1. property_owner_info_update yeniden kurulur: WITH CHECK = USING ile aynı kapsam (yeni satırın ilanı da
--      çağıranın kapsamında olmalı) + properties:edit.
--   2. BEFORE UPDATE trigger (guard_property_owner_info_update, SECURITY INVOKER; yalnız authenticated/anon):
--        * property_id, tenant_id, created_by, created_at değişmez (kayıt ilanına bağlıdır, 1:1);
--        * customer_id DEĞİŞİRSE yeni müşteri bu ofiste, silinmemiş ve çağıranın RLS'iyle GÖRÜNÜR olmalı
--          (SECURITY INVOKER: customers RLS'i çağıran adına uygulanır — action'daki kontrolle aynı).
--
-- KOD UYUMU (okundu): src/app/actions/property-owner.ts update'i aynı property_id ile yazar; customer_id'yi
--   değiştirebilir (ilan sahibi müşteri seçimi) — action müşteriyi kullanıcı oturumuyla, tenant + deleted_at IS NULL
--   ile doğruladığından trigger aynı sonucu verir. src/lib/property-owner/persist.ts yalnız INSERT yapar (etkilenmez).
-- ETKİ: yalnız politika/trigger DDL; veri değişmez.
-- GERİ ALMA: supabase/rollbacks/20260823000400_sec3_property_owner_info_update_scope.rollback.sql
-- RİSK: düşük.

alter table public.property_owner_info enable row level security;

drop policy if exists property_owner_info_update on public.property_owner_info;
create policy property_owner_info_update on public.property_owner_info
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_effective_permission('properties', 'edit'))
    and (
      (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
      or exists (
        select 1 from public.properties p
        where p.id = property_owner_info.property_id and p.tenant_id = property_owner_info.tenant_id
          and (p.assigned_to = (select auth.uid()) or p.created_by = (select auth.uid()))
      )
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_effective_permission('properties', 'edit'))
    and (
      (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
      or exists (
        select 1 from public.properties p
        where p.id = property_owner_info.property_id and p.tenant_id = property_owner_info.tenant_id
          and (p.assigned_to = (select auth.uid()) or p.created_by = (select auth.uid()))
      )
    )
  );

comment on policy property_owner_info_update on public.property_owner_info is
  'Eski ve yeni satır aynı kapsamda: ofis yönetimi veya ilanın atananı/oluşturanı. property_id değişmez (trigger).';

create or replace function public.guard_property_owner_info_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.property_id is distinct from old.property_id
     or new.tenant_id is distinct from old.tenant_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Ilan sahibi kaydi baska ilana tasinamaz.' using errcode = '42501';
  end if;

  if new.customer_id is not null and new.customer_id is distinct from old.customer_id then
    -- SECURITY INVOKER: customers RLS'i çağıran adına uygulanır (görmediği müşteriye bağlayamaz).
    if not exists (
      select 1 from public.customers c
      where c.id = new.customer_id
        and c.tenant_id = new.tenant_id
        and c.deleted_at is null
    ) then
      raise exception 'Secilen musteri bulunamadi veya erisiminiz yok.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.guard_property_owner_info_update() is
  'property_owner_info BEFORE UPDATE: ilan bağı değişmez; yeni müşteri çağıranın görebildiği, silinmemiş müşteri olmalı.';

revoke all on function public.guard_property_owner_info_update() from public, anon;

drop trigger if exists trg_property_owner_info_guard on public.property_owner_info;
create trigger trg_property_owner_info_guard
  before update on public.property_owner_info
  for each row execute function public.guard_property_owner_info_update();

notify pgrst, 'reload schema';
