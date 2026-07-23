-- B6: RLS role-farkındalığı — en riskli yazma yolları için.
-- `current_profile_role()` + `tenant_role_permissions`/`permission_defaults`'a bakan
-- `has_effective_permission(module, action)` SQL fonksiyonu; en riskli policy'lere uygulanır:
-- commissions, payment_links (module: 'commissions' — app tarafında da bu modülle kontrol ediliyor),
-- team (profiles.role/tenant_id değişimi — trigger ile, RLS satır politikaları eski/yeni kolon
-- karşılaştırmasını desteklemediği için).
--
-- Not: Diğer tablolar (customers, properties, vb.) hâlâ sadece tenant izolasyonu kullanıyor;
-- bunlar için role-aware RLS kapsam dışı bırakıldı (follow-up), zira yazma yolları zaten
-- `requirePermission`/`requireModulePage` ile uygulama katmanında korunuyor.

create or replace function public.has_effective_permission(p_module text, p_action text)
returns boolean
language sql
stable
as $$
  select coalesce(
    (
      select allowed
      from public.tenant_role_permissions
      where tenant_id = public.current_tenant_id()
        and role = public.current_profile_role()
        and module = p_module
        and action = p_action
      limit 1
    ),
    exists (
      select 1
      from public.permission_defaults
      where role = public.current_profile_role()
        and module = p_module
        and action = p_action
    ),
    false
  );
$$;

comment on function public.has_effective_permission is
  'Etkin izin kontrolü (SQL karşılığı) — src/lib/permissions-effective.ts getEffectivePermissions ile aynı mantık: tenant override varsa o, yoksa permission_defaults geçerli.';

-- ========== commissions: view/create/edit/delete ayrıştırılmış RLS ==========

drop policy if exists commissions_tenant on public.commissions;

create policy commissions_select on public.commissions for select
  using (tenant_id = public.current_tenant_id() and public.has_effective_permission('commissions', 'view'));

create policy commissions_insert on public.commissions for insert
  with check (tenant_id = public.current_tenant_id() and public.has_effective_permission('commissions', 'create'));

create policy commissions_update on public.commissions for update
  using (tenant_id = public.current_tenant_id() and public.has_effective_permission('commissions', 'edit'))
  with check (tenant_id = public.current_tenant_id() and public.has_effective_permission('commissions', 'edit'));

create policy commissions_delete on public.commissions for delete
  using (tenant_id = public.current_tenant_id() and public.has_effective_permission('commissions', 'delete'));

-- ========== payment_links: aynı ayrıştırma (app tarafında da 'commissions' modülüyle kontrol ediliyor) ==========

drop policy if exists payment_links_tenant on public.payment_links;

create policy payment_links_select on public.payment_links for select
  using (tenant_id = public.current_tenant_id() and public.has_effective_permission('commissions', 'view'));

create policy payment_links_insert on public.payment_links for insert
  with check (tenant_id = public.current_tenant_id() and public.has_effective_permission('commissions', 'create'));

create policy payment_links_update on public.payment_links for update
  using (tenant_id = public.current_tenant_id() and public.has_effective_permission('commissions', 'edit'))
  with check (tenant_id = public.current_tenant_id() and public.has_effective_permission('commissions', 'edit'));

create policy payment_links_delete on public.payment_links for delete
  using (tenant_id = public.current_tenant_id() and public.has_effective_permission('commissions', 'delete'));

-- ========== team: profiles.role / tenant_id değişimini koru (trigger) ==========
-- RLS satır politikaları eski/yeni kolon karşılaştırmasını desteklemediği için trigger kullanılır.
-- Sadece kullanıcı oturumu (auth.uid() dolu) üzerinden gelen isteklerde uygulanır — service_role
-- (admin panel / server action arka planı) ile yapılan yönetimsel güncellemeler etkilenmez.

create or replace function public.guard_profile_role_change()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null
     and (new.role is distinct from old.role or new.tenant_id is distinct from old.tenant_id)
     and not public.has_effective_permission('team', 'edit')
  then
    raise exception 'Bu işlem için yetkiniz yok (team:edit gerekli).';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_role_change on public.profiles;
create trigger trg_guard_profile_role_change
  before update on public.profiles
  for each row
  execute function public.guard_profile_role_change();
