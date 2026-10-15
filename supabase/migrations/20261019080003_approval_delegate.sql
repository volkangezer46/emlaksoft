-- MIGRATION 20261019080003_approval_delegate.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE uygulanir: yeni kod vekil onaylayiciya karar dugmesi gosterir; fonksiyon eski govdedeyken vekilin
--   karari RLS/tetikleyicide reddedilir ("Karar kaydedilemedi"), baska davranis degismez.
-- Geri alma: supabase/rollbacks/20261019080003_approval_delegate.rollback.sql (fonksiyon 20260823000100 govdesine doner,
--   yardimci ve vekalet tablosu duser).
-- BAGIMLILIK: 20260823000100 (approval_actor_can_decide + guard_approval_request_update).
--
-- NE (OA12, onay politikasi: vekil onaylayici):
--   approval_delegations: ofis basina TEK vekalet (vekil uye + bitis gunu dahil + not). Ofis sahibi/GM (settings:edit)
--   Onaylar > Politika'dan atar/kaldirir; vekil ayni ofisin aktif, salt-okunur olmayan uyesi olmali (tetikleyici).
--   approval_actor_can_decide() artik (a) eski kosul (yonetim kademesi + commissions:edit) VEYA (b) suresi dolmamis
--   vekil icin true doner. "Kendi talebini onaylayamaz" kurali tetikleyicide aynen kalir. Acik uclu vekalet yok
--   (bitis zorunlu); gun Istanbul gunune gore dahil.
set local lock_timeout = '5s';

create table if not exists public.approval_delegations (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  delegate_id uuid not null references public.profiles(id) on delete cascade,
  until_on date not null,
  note text check (note is null or char_length(note) <= 200),
  set_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.approval_delegations enable row level security;

drop policy if exists approval_delegations_select on public.approval_delegations;
create policy approval_delegations_select on public.approval_delegations
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()));

drop policy if exists approval_delegations_insert on public.approval_delegations;
create policy approval_delegations_insert on public.approval_delegations
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.current_profile_role()) in ('owner', 'gm')
    and (select public.has_effective_permission('settings'::text, 'edit'::text))
    and set_by = (select auth.uid())
  );

drop policy if exists approval_delegations_update on public.approval_delegations;
create policy approval_delegations_update on public.approval_delegations
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.current_profile_role()) in ('owner', 'gm')
    and (select public.has_effective_permission('settings'::text, 'edit'::text))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.current_profile_role()) in ('owner', 'gm')
    and set_by = (select auth.uid())
  );

drop policy if exists approval_delegations_delete on public.approval_delegations;
create policy approval_delegations_delete on public.approval_delegations
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.current_profile_role()) in ('owner', 'gm')
    and (select public.has_effective_permission('settings'::text, 'edit'::text))
  );

create or replace function public.guard_approval_delegation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = new.delegate_id
       and p.tenant_id = new.tenant_id
       and p.is_active = true
       and p.role <> 'readonly'
  ) then
    raise exception 'Vekil bu ofisin aktif uyesi olmali.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.guard_approval_delegation() from public, anon, authenticated;

drop trigger if exists trg_approval_delegations_guard on public.approval_delegations;
create trigger trg_approval_delegations_guard
  before insert or update on public.approval_delegations
  for each row execute function public.guard_approval_delegation();

revoke all privileges on table public.approval_delegations from public, anon;
grant select, insert, update, delete on table public.approval_delegations to authenticated, service_role;

comment on table public.approval_delegations is
  'OA12: ofisin vekil onaylayicisi (tek satir, bitis gunu zorunlu). Yazma owner/gm + settings:edit; approval_actor_can_decide vekili tanir.';

create or replace function public.approval_actor_is_delegate()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and public.current_profile_role() not in ('', 'readonly')
    and exists (
      select 1
        from public.approval_delegations d
       where d.tenant_id = public.current_active_tenant_id()
         and d.delegate_id = auth.uid()
         and d.until_on >= (pg_catalog.now() at time zone 'Europe/Istanbul')::date
    ),
    false
  );
$$;

revoke all on function public.approval_actor_is_delegate() from public, anon;
grant execute on function public.approval_actor_is_delegate() to authenticated, service_role;

comment on function public.approval_actor_is_delegate() is
  'OA12: cagiran, ofisin suresi dolmamis vekil onaylayicisi mi (approval_delegations).';

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

comment on function public.approval_actor_can_decide() is
  'Onay talebine karar verebilir mi: yonetim kademesi + commissions:edit (src/lib/approvals.ts canDecideApproval) VEYA suresi dolmamis vekil onaylayici (OA12).';

revoke all on function public.approval_actor_can_decide() from public, anon;
grant execute on function public.approval_actor_can_decide() to authenticated, service_role;
