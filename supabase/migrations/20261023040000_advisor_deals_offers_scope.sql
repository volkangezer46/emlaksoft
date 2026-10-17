-- MIGRATION 20261023040000_advisor_deals_offers_scope.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYINIYLA BIRLIKTE (ayni pencere, KOD ONCE ya da SONRA): kod danisman/takim lideri/sube mudurune anlasma ve teklif
--   yazmayi acar; bu dosya ayni izni permission_defaults'a yazar ve yazma kapsamini DB'de daraltir. Kod yokken bu dosya
--   uygulanirsa danisman yalniz KENDI anlasmasina yazabilir (eski kod zaten "Komisyon / Anlasmalar kapali" der).
-- Geri alma: supabase/rollbacks/20261023040000_advisor_deals_offers_scope.rollback.sql
-- BAGIMLILIK: 20260722000014 (permission_defaults), 20261016100000 (scope_allows, kapsam RLS'i), 20261019080003
--   (approval_actor_is_delegate), deal_costs/deal_notes/deal_checklist_items/deal_process_steps, commissions,
--   commission_splits, payment_links, einvoices, einvoice_connections.
--
-- NE (WP2, sahip karari 2026-10-16: danisman kendi anlasmasini ve teklifini yurutur):
--   1) permission_defaults: advisor / team_lead / branch_manager icin commissions view+create+edit, offers view+create+edit
--      (src/lib/permissions.ts DEFAULT_MATRIX ile BIREBIR). Ofisin tenant_role_permissions red satirlari aynen gecerli.
--   2) public.deal_write_self_only(): owner/gm/branch_manager/accounting DISINDAKI her rol (bilinmeyen dahil, fail-closed)
--      anlasmaya yalniz KENDISINE ATANMIS kayitta yazar (src/lib/permission-data-scope.ts isDealSelfScopeRole).
--   3) public.deal_write_allowed(deal_id): alt tablolarin (masraf, not, kontrol listesi, surec adimi) yazma kapisi —
--      kendi kapsamli rolde anlasma kendisine atanmis olmali; digerlerinde SK10 kapsami (scope_allows).
--   4) public.commission_ledger_writer(): komisyon DEFTERI (komisyon satiri, paylasim satirlari, odeme linki, e-Fatura)
--      yalniz owner/gm/accounting ya da ofisin commissions:delete verdigi rol (src/lib/permission-data-scope.ts
--      canWriteCommissionLedger). Danisman anlasma icin commissions:edit tasir ama deftere yazamaz.
--   5) KISITLAYICI (AS RESTRICTIVE) yazma politikalari: mevcut izin politikalarina DOKUNULMAZ, uzerine VE ile eklenir.
--   6) approval_actor_can_decide(): sube muduru/takim lideri varsayilan commissions:edit ile karar VERMEZ; owner/gm +
--      edit, digerleri commissions:delete (tam komisyon yetkisi) ya da vekil (src/lib/approvals.ts canDecideApproval).
-- SELECT politikalari degismez (okuma kapsami SK10 bayragiyla yonetilir). Teklif yazimi zaten yalniz service_role RPC
--   (authenticated INSERT/UPDATE/DELETE REVOKE, 20260813000000); teklif kapsami uygulama katmaninda (actions/offers.ts).
-- service_role (sunucu RPC'leri, atomik asama gecisi) RLS disidir; davranisi degismez.
-- RISK: orta (yazma kapsami daralir). Bilinen etki: ofisin rol istisnasiyla commissions:edit verdigi sube muduru/takim
--   lideri artik onay karari ve defter yazimi icin commissions:delete ister.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.permission_defaults') is null then
    raise exception 'permission_defaults yok; once 20260722000014_permission_matrix uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.scope_allows(uuid)') is null
     or pg_catalog.to_regprocedure('public.current_profile_role()') is null
     or pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null
     or pg_catalog.to_regprocedure('public.approval_actor_is_delegate()') is null then
    raise exception 'Kimlik/kapsam yardimcilari yok; once 20261016100000 ve 20261019080003 uygulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1) Varsayilan izinler
-- ---------------------------------------------------------------------------------------------------------------
insert into public.permission_defaults (role, module, action)
select r, m, a
from (values ('advisor'), ('team_lead'), ('branch_manager')) as roles(r)
cross join (values ('commissions'), ('offers')) as mods(m)
cross join (values ('view'), ('create'), ('edit')) as acts(a)
on conflict (role, module, action) do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- 2-4) Yardimcilar
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.deal_write_self_only()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_profile_role(), '') not in ('owner', 'gm', 'branch_manager', 'accounting');
$$;

comment on function public.deal_write_self_only() is
  'WP2: anlasma yazma kapsami yalniz KENDI kaydi mi (owner/gm/branch_manager/accounting disindaki her rol). src/lib/permission-data-scope.ts isDealSelfScopeRole ile ayni.';

create or replace function public.deal_write_allowed(p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
             when public.deal_write_self_only() then d.assigned_to is not null and d.assigned_to = auth.uid()
             else public.scope_allows(d.assigned_to)
           end
      from public.deals d
     where d.id = p_deal_id
       and d.tenant_id = public.current_active_tenant_id()
  ), false);
$$;

comment on function public.deal_write_allowed(uuid) is
  'WP2: anlasma alt kaydina (masraf/not/kontrol listesi/surec) yazilabilir mi: kendi kapsamli rolde anlasma kendisine atanmis, digerlerinde SK10 kapsami.';

create or replace function public.commission_ledger_writer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.current_profile_role() in ('owner', 'gm', 'accounting')
      or public.has_effective_permission('commissions', 'delete'),
    false
  );
$$;

comment on function public.commission_ledger_writer() is
  'WP2: komisyon defterine (komisyon, paylasim, odeme linki, e-Fatura) yazabilir mi: owner/gm/accounting ya da commissions:delete. src/lib/permission-data-scope.ts canWriteCommissionLedger ile ayni.';

revoke all on function public.deal_write_self_only() from public, anon;
revoke all on function public.deal_write_allowed(uuid) from public, anon;
revoke all on function public.commission_ledger_writer() from public, anon;
grant execute on function public.deal_write_self_only() to authenticated, service_role;
grant execute on function public.deal_write_allowed(uuid) to authenticated, service_role;
grant execute on function public.commission_ledger_writer() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 5a) deals: kendi kapsamli rol yalniz kendisine atanmis anlasmayi acar / degistirir / siler; devredemez.
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists wp2_deals_self_scope_insert on public.deals;
create policy wp2_deals_self_scope_insert on public.deals
  as restrictive
  for insert to authenticated
  with check ((select not public.deal_write_self_only()) or assigned_to = (select auth.uid()));

drop policy if exists wp2_deals_self_scope_update on public.deals;
create policy wp2_deals_self_scope_update on public.deals
  as restrictive
  for update to authenticated
  using ((select not public.deal_write_self_only()) or assigned_to = (select auth.uid()))
  with check ((select not public.deal_write_self_only()) or assigned_to = (select auth.uid()));

drop policy if exists wp2_deals_self_scope_delete on public.deals;
create policy wp2_deals_self_scope_delete on public.deals
  as restrictive
  for delete to authenticated
  using ((select not public.deal_write_self_only()) or assigned_to = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------------------
-- 5b) Anlasma alt tablolari ve 5c) komisyon defteri: tablo varsa kisitlayici yazma politikalari.
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  t text;
  c text;
  pol text;
  cond text;
begin
  foreach t in array array['deal_costs', 'deal_notes', 'deal_checklist_items', 'deal_process_steps'] loop
    if pg_catalog.to_regclass('public.' || t) is null then continue; end if;
    cond := '(public.deal_write_allowed(deal_id))';
    foreach c in array array['insert', 'update', 'delete'] loop
      pol := 'wp2_' || t || '_deal_scope_' || c;
      execute format('drop policy if exists %I on public.%I', pol, t);
      if c = 'insert' then
        execute format('create policy %I on public.%I as restrictive for insert to authenticated with check %s', pol, t, cond);
      elsif c = 'update' then
        execute format('create policy %I on public.%I as restrictive for update to authenticated using %s with check %s', pol, t, cond, cond);
      else
        execute format('create policy %I on public.%I as restrictive for delete to authenticated using %s', pol, t, cond);
      end if;
    end loop;
  end loop;

  foreach t in array array['commissions', 'commission_splits', 'payment_links', 'einvoices', 'einvoice_connections'] loop
    if pg_catalog.to_regclass('public.' || t) is null then continue; end if;
    cond := '((select public.commission_ledger_writer()))';
    foreach c in array array['insert', 'update', 'delete'] loop
      pol := 'wp2_' || t || '_ledger_' || c;
      execute format('drop policy if exists %I on public.%I', pol, t);
      if c = 'insert' then
        execute format('create policy %I on public.%I as restrictive for insert to authenticated with check %s', pol, t, cond);
      elsif c = 'update' then
        execute format('create policy %I on public.%I as restrictive for update to authenticated using %s with check %s', pol, t, cond, cond);
      else
        execute format('create policy %I on public.%I as restrictive for delete to authenticated using %s', pol, t, cond);
      end if;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6) Onay karari: varsayilan commissions:edit artik yonetim kademesinin tamaminda var; karar owner/gm'de kalir.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.approval_actor_can_decide()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      public.current_profile_role() in ('owner', 'gm')
        and public.has_effective_permission('commissions', 'edit')
    )
    or (
      public.current_profile_role() in ('branch_manager', 'team_lead')
        and public.has_effective_permission('commissions', 'delete')
    )
    or public.approval_actor_is_delegate(),
    false
  );
$$;

comment on function public.approval_actor_can_decide() is
  'Onay talebine karar verebilir mi: owner/gm + commissions:edit, sube muduru/takim lideri + commissions:delete (WP2) VEYA suresi dolmamis vekil (OA12). src/lib/approvals.ts canDecideApproval ile ayni.';

revoke all on function public.approval_actor_can_decide() from public, anon;
grant execute on function public.approval_actor_can_decide() to authenticated, service_role;
