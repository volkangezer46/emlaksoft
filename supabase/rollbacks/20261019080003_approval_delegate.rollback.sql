-- 20261019080003 geri alma: approval_actor_can_decide 20260823000100 govdesine doner (yalniz yonetim kademesi +
--   commissions:edit), vekil yardimcisi ve vekalet tablosu duser (vekil karar veremez; verilmis kararlar kalir).
set local lock_timeout = '5s';

create or replace function public.approval_actor_can_decide()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.current_profile_role() in ('owner', 'gm', 'branch_manager', 'team_lead')
      and public.has_effective_permission('commissions', 'edit'),
    false
  );
$$;

revoke all on function public.approval_actor_can_decide() from public, anon;
grant execute on function public.approval_actor_can_decide() to authenticated, service_role;

drop function if exists public.approval_actor_is_delegate();
drop table if exists public.approval_delegations;
drop function if exists public.guard_approval_delegation();
