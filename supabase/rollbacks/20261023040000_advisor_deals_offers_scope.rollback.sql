-- GERI ALMA: 20261023040000_advisor_deals_offers_scope — kisitlayici politikalar ve yardimcilar duser,
-- approval_actor_can_decide 20261019080003 govdesine doner, eklenen permission_defaults satirlari silinir.
-- Not: geri alma sonrasi kod hala yeni matrisi tasiyorsa danisman anlasma yazar ama DB kapsami yalniz SK10 bayragina kalir;
-- once kod geri alinmali.

set local lock_timeout = '5s';

do $$
declare
  t text;
  c text;
begin
  foreach t in array array['deal_costs', 'deal_notes', 'deal_checklist_items', 'deal_process_steps'] loop
    if pg_catalog.to_regclass('public.' || t) is null then continue; end if;
    foreach c in array array['insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', 'wp2_' || t || '_deal_scope_' || c, t);
    end loop;
  end loop;
  foreach t in array array['commissions', 'commission_splits', 'payment_links', 'einvoices', 'einvoice_connections'] loop
    if pg_catalog.to_regclass('public.' || t) is null then continue; end if;
    foreach c in array array['insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', 'wp2_' || t || '_ledger_' || c, t);
    end loop;
  end loop;
end $$;

drop policy if exists wp2_deals_self_scope_insert on public.deals;
drop policy if exists wp2_deals_self_scope_update on public.deals;
drop policy if exists wp2_deals_self_scope_delete on public.deals;

create or replace function public.approval_actor_can_decide()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      public.current_profile_role() in ('owner', 'gm', 'branch_manager', 'team_lead')
        and public.has_effective_permission('commissions', 'edit')
    )
    or public.approval_actor_is_delegate(),
    false
  );
$$;

drop function if exists public.deal_write_allowed(uuid);
drop function if exists public.deal_write_self_only();
drop function if exists public.commission_ledger_writer();

delete from public.permission_defaults
 where role in ('advisor', 'team_lead', 'branch_manager')
   and ((module = 'commissions' and action in ('create', 'edit'))
     or (module = 'offers' and action in ('view', 'create', 'edit')));
