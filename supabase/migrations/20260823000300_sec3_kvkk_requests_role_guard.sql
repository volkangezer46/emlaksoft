-- Güvenlik denetimi 3 / #8 (P1): kvkk_requests — ofis düzeyi talepler (hesap kapatma / veri indirme) rol kapısı.
--
-- NEDEN: 20260819010600 INSERT/UPDATE politikaları yalnız tenant koşulu taşıyordu. Herhangi bir ofis üyesi
--   PostgREST ile account_closure/data_export talebi açabiliyor, başkası adına (created_by) kayıt yazabiliyor
--   veya bir talebin durumunu/türünü değiştirebiliyordu. Uygulama kapısı (src/app/actions/kvkk-requests.ts:
--   compliance:create/edit + ofis türleri için owner/gm) DB'de karşılıksızdı.
--
-- NE YAPAR:
--   INSERT (authenticated): tenant + created_by=auth.uid() + status='open' + resolved_* boş + compliance:create;
--     ofis düzeyi türlerde (account_closure, data_export) ayrıca rol owner/gm.
--   UPDATE (authenticated): USING eski satır, WITH CHECK yeni satır için aynı kural:
--     ofis düzeyi türler → yalnız owner/gm; veri sahibi (müşteri) türleri → compliance:edit
--     (varsayılan matriste yalnız owner/gm; updateKvkkRequestStatus kapısıyla aynı).
--     Böylece müşteri talebini ofis düzeyi türe çevirmek de engellenir (WITH CHECK yeni türe bakar).
--   BEFORE UPDATE trigger (guard_kvkk_request_update; yalnız authenticated/anon): tenant_id, request_type,
--     created_by, created_at değişmez; resolved_by yalnız NULL, eski değer veya auth.uid() olabilir.
--   Platform personeli politikası (kvkk_requests_staff) ve service_role (platform-tenant-closure.ts) AYNEN kalır.
--   DELETE: politika ve grant zaten yoktu; değişmedi.
--
-- KOD UYUMU (okundu): createKvkkRequest insert'i tenant_id/request_type/customer_id/requester_name/note/due_at/
--   created_by=gate.userId yazar (status varsayılan 'open'); updateKvkkRequestStatus status/resolution_note/
--   resolved_by=gate.userId|null/resolved_at/updated_at yazar. İkisi de yeni kurallarla geçerlidir.
-- ETKİ: yalnız politika/trigger DDL; veri değişmez.
-- GERİ ALMA: supabase/rollbacks/20260823000300_sec3_kvkk_requests_role_guard.rollback.sql
-- RİSK: düşük. Tenant override ile compliance:edit verilen (owner/gm dışı) roller yalnız müşteri taleplerini
--   güncelleyebilir; ofis düzeyi talepleri yalnız owner/gm (ve platform/service_role) günceller.

alter table public.kvkk_requests enable row level security;

drop policy if exists kvkk_requests_tenant_insert on public.kvkk_requests;
create policy kvkk_requests_tenant_insert on public.kvkk_requests
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and created_by = (select auth.uid())
    and status = 'open'
    and resolved_by is null
    and resolved_at is null
    and (select public.has_effective_permission('compliance', 'create'))
    and (
      request_type not in ('account_closure', 'data_export')
      or (select public.current_profile_role()) in ('owner', 'gm')
    )
  );

drop policy if exists kvkk_requests_tenant_update on public.kvkk_requests;
create policy kvkk_requests_tenant_update on public.kvkk_requests
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (request_type in ('account_closure', 'data_export')
        and (select public.current_profile_role()) in ('owner', 'gm'))
      or (request_type not in ('account_closure', 'data_export')
        and (select public.has_effective_permission('compliance', 'edit')))
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (
      (request_type in ('account_closure', 'data_export')
        and (select public.current_profile_role()) in ('owner', 'gm'))
      or (request_type not in ('account_closure', 'data_export')
        and (select public.has_effective_permission('compliance', 'edit')))
    )
  );

comment on policy kvkk_requests_tenant_insert on public.kvkk_requests is
  'Kendi adına, open durumunda, compliance:create; hesap kapatma/veri indirme yalnız owner/gm.';
comment on policy kvkk_requests_tenant_update on public.kvkk_requests is
  'Ofis düzeyi talepler yalnız owner/gm; veri sahibi talepleri compliance:edit. Alan kuralları: guard_kvkk_request_update.';

create or replace function public.guard_kvkk_request_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  -- Platform personeli kendi politikasıyla (kvkk_requests_staff) çalışır; onların işlem akışını kısıtlama.
  if public.is_platform_staff() then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.request_type is distinct from old.request_type
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'KVKK talebinin turu ve sahibi degistirilemez.' using errcode = '42501';
  end if;

  if new.resolved_by is not null
     and new.resolved_by is distinct from old.resolved_by
     and new.resolved_by is distinct from auth.uid() then
    raise exception 'Talebi baskasi adina sonuclandiramazsiniz.' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_kvkk_request_update() is
  'kvkk_requests BEFORE UPDATE: tür/sahip/tenant değişmez; resolved_by yalnız çağıranın kendisi.';

revoke all on function public.guard_kvkk_request_update() from public, anon, authenticated;

drop trigger if exists trg_kvkk_requests_guard on public.kvkk_requests;
create trigger trg_kvkk_requests_guard
  before update on public.kvkk_requests
  for each row execute function public.guard_kvkk_request_update();

notify pgrst, 'reload schema';
