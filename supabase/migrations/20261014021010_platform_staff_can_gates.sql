-- UYGULANMADI (canlıya henüz uygulanmadı; sahibin onayı + yedek doğrulaması sonrası `npm run db:migrate`).
--
-- SN1 — Rol tutarlılığı: veritabanında rol ADINA bakan personel kapıları DG1 özel rol modeline (modül × eylem) uyumlu.
-- 20261014001300 (DG1: platform_custom_roles, platform_staff.custom_role_id) SONRASI.
--
-- SORUN: DG1 ile personele özel rol (ör. "Tahsilat uzmanı": billing görüntüle+yaz+onayla) atanabiliyor ve uygulama kapıları
--   (`platformCan`) matrisi okuyor; ama SQL kapıları hâlâ `platform_staff.role in (...)` diyordu. Özel rolün `role` sütunu taban
--   roldür (ops/support/billing): taban rolü 'support' olan bir "billing onaylayıcı" paket değiştiremiyor, tersine taban rolü
--   'billing' olup billing yetkisi kaldırılmış özel rol RPC'yi doğrudan çalıştırabiliyordu.
-- ÇÖZÜM:
--   1) public.platform_staff_can(staff_id, modül, eylem) + oturum sürümü platform_staff_can(modül, eylem) (auth.uid()).
--      src/lib/platform-access.ts ile BİREBİR: özel rol atanmışsa YALNIZ onun matrisi (eylemler iç içe: approve ⊇ write ⊇ view;
--      dashboard her personelde view; bilinmeyen modül/eylem yok sayılır; rol okunamazsa fail-closed = yalnız dashboard),
--      yoksa sabit rol matrisi (PLATFORM_ROLE_MODULES + PLATFORM_READONLY_MODULES; süper admin her modülde approve). Pasif
--      personel hiçbir şey yapamaz. Sözleşme testi TS fixedRoleMatrix ile SQL'i tüm rol × modül × eylem için karşılaştırır.
--   2) Kapılar (sabit rollerde sonuç BİREBİR aynı; modül eşlemesi uygulama kapısıyla aynı):
--        update_tenant_plan_subscription   super_admin|billing              -> billing:write   (canlı gövde, tek ifade)
--        convert_demo_request_to_tenant    super_admin|ops|support          -> sales:write     (canlı gövde, tek ifade)
--        support_is_ticket_staff           4 rol (destek SELECT politikaları) -> tickets:view
--        support_actor_is_valid ('staff')  4 rol (destek yazma RPC'leri)    -> tickets:write
--        pt_rules_is_operator              super_admin|ops                  -> sistem:write
--        pt_rules_is_super_admin           super_admin                      -> sistem:approve
--        growth_staff_super_admin          super_admin                      -> sales:approve  (TS ADMIN_GATE: sales)
--        platform_mrr_daily_staff_select   super_admin|ops|billing          -> reports:view
--      BİLEREK DOKUNULMAYANLAR (yetki değil yönlendirme/alıcı listesi ya da tam karşılığı olan modül yok):
--        support_pick_assignee / SLA yükseltme bildirim alıcıları / pt_rules_publish_system bildirim alıcıları (kime iş/bildirim
--        düşeceği; yetki kapısı değil), support_ticket_attachments_select (super_admin|ops|support: billing tickets modülünü
--        görür ama eki görmez; tek modül×eylem bu kümeyi vermez, sabit rol davranışı değişeceği için olduğu gibi kaldı).
--   Büyük gövdeler (update_tenant_plan_subscription, convert_demo_request_to_tenant) CANLI tanım üzerinden yalnız rol ifadesi
--   değiştirilerek yeniden tanımlanır (pg_get_functiondef; imza, SECURITY DEFINER, search_path ve yetkiler aynen kalır). Beklenen
--   eşleşme 1 değilse HİÇBİR şey yazılmaz; ikinci çalıştırmada (platform_staff_can içeriyorsa) atlanır.
-- GERİ ALMA: supabase/rollbacks/20261014021010_platform_staff_can_gates.rollback.sql
-- RİSK: düşük (sabit rollerde sonuç aynı; yalnız özel rol atanmış personelin SQL yetkisi matrisine hizalanır).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.platform_custom_roles') is null
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.platform_staff'::regclass and attname = 'custom_role_id' and not attisdropped)
     or pg_catalog.to_regprocedure('public.update_tenant_plan_subscription(uuid,uuid,text,text)') is null
     or pg_catalog.to_regprocedure('public.convert_demo_request_to_tenant(uuid,uuid,uuid,text)') is null
     or pg_catalog.to_regprocedure('public.support_is_ticket_staff()') is null
     or pg_catalog.to_regprocedure('public.support_actor_is_valid(uuid,text,uuid)') is null
     or pg_catalog.to_regprocedure('public.pt_rules_is_operator()') is null
     or pg_catalog.to_regprocedure('public.pt_rules_is_super_admin()') is null
     or pg_catalog.to_regprocedure('public.growth_staff_super_admin()') is null
     or pg_catalog.to_regclass('public.platform_settings') is null
     or pg_catalog.to_regclass('public.platform_mrr_daily') is null then
    raise exception '20261014021010: önce 20261014001300 (DG1) ve kapı fonksiyonlarının migration''ları uygulanmalı.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Matris yardımcıları
-- ---------------------------------------------------------------------------
-- Sabit rolün bir modüldeki eylemleri (TS fixedRoleMatrix). Bilinmeyen rol/modül: boş dizi.
create or replace function public.platform_fixed_role_actions(p_role text, p_module text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_role = 'super_admin' and p_module = any (array['dashboard', 'sales', 'tenants', 'members', 'billing', 'tickets', 'reports',
      'advisor', 'activity', 'geo', 'sistem', 'broadcast', 'personel', 'marka', 'seo', 'sitemenu', 'sitecontent', 'reklam', 'veri'])
      then array['view', 'write', 'approve']
    when p_role = 'ops' and p_module = 'reklam' then array['view']
    when p_role = 'ops' and p_module = any (array['dashboard', 'sales', 'tenants', 'members', 'tickets', 'reports', 'advisor', 'activity',
      'geo', 'sistem', 'broadcast', 'seo', 'sitemenu', 'sitecontent'])
      then array['view', 'write']
    when p_role = 'billing' and p_module = any (array['dashboard', 'billing', 'tenants', 'reports', 'advisor', 'tickets'])
      then array['view', 'write']
    when p_role = 'support' and p_module = any (array['dashboard', 'sales', 'tickets', 'members', 'tenants'])
      then array['view', 'write']
    else array[]::text[]
  end;
$$;

-- Personelin modülde eylem yetkisi (TS platformCan). Özel rol varsa YALNIZ onun matrisi; rol satırı okunamazsa yalnız dashboard.
create or replace function public.platform_staff_can(p_staff_id uuid, p_module text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when p_action not in ('view', 'write', 'approve') then false
      when p_module <> all (array['dashboard', 'sales', 'tenants', 'members', 'billing', 'tickets', 'reports', 'advisor', 'activity', 'geo',
        'sistem', 'broadcast', 'personel', 'marka', 'seo', 'sitemenu', 'sitecontent', 'reklam', 'veri']) then false
      when s.custom_role_id is null then p_action = any (public.platform_fixed_role_actions(s.role, p_module))
      when p_module = 'dashboard' and p_action = 'view' then true
      else coalesce((
        select case
                 when pg_catalog.jsonb_typeof(cr.permissions -> p_module) <> 'array' then false
                 when p_action = 'approve' then (cr.permissions -> p_module) ? 'approve'
                 when p_action = 'write' then (cr.permissions -> p_module) ?| array['write', 'approve']
                 else (cr.permissions -> p_module) ?| array['view', 'write', 'approve']
               end
          from public.platform_custom_roles cr
         where cr.id = s.custom_role_id
      ), false)
    end
    from public.platform_staff s
    where s.id = p_staff_id and s.is_active = true
  ), false);
$$;

-- Oturumdaki personel (politikalar ve oturumla çağrılan RPC'ler).
create or replace function public.platform_staff_can(p_module text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.platform_staff_can(auth.uid(), p_module, p_action);
$$;

revoke all on function public.platform_fixed_role_actions(text, text) from public, anon;
revoke all on function public.platform_staff_can(uuid, text, text) from public, anon, authenticated;
revoke all on function public.platform_staff_can(text, text) from public, anon;
grant execute on function public.platform_fixed_role_actions(text, text) to authenticated, service_role;
grant execute on function public.platform_staff_can(uuid, text, text) to service_role;
grant execute on function public.platform_staff_can(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Küçük kapılar: tam gövde (yalnız rol ifadesi değişir)
-- ---------------------------------------------------------------------------
create or replace function public.support_is_ticket_staff()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.platform_staff s
    where s.id = auth.uid()
      and s.is_active = true
      and public.platform_staff_can(s.id, 'tickets', 'view')
  );
end;
$$;

create or replace function public.support_actor_is_valid(p_actor_id uuid, p_actor_kind text, p_tenant_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_actor_kind
    when 'tenant' then exists (
      select 1
      from public.profiles p
      where p.id = p_actor_id
        and p.tenant_id = p_tenant_id
        and p.is_active = true
    )
    when 'staff' then exists (
      select 1
      from public.platform_staff s
      where s.id = p_actor_id
        and s.is_active = true
        and public.platform_staff_can(s.id, 'tickets', 'write')
    )
    else false
  end;
$$;

create or replace function public.pt_rules_is_operator()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.platform_staff ps
     where ps.id = auth.uid() and ps.is_active = true and public.platform_staff_can(ps.id, 'sistem', 'write')
       and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
  );
$$;

create or replace function public.pt_rules_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.platform_staff ps
     where ps.id = auth.uid() and ps.is_active = true and public.platform_staff_can(ps.id, 'sistem', 'approve')
       and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
  );
$$;

create or replace function public.growth_staff_super_admin()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ps.id from public.platform_staff ps
  where ps.id = auth.uid() and ps.is_active and public.platform_staff_can(ps.id, 'sales', 'approve')
    and (not public.growth_flag_on('platform.mfa_enforced') or (auth.jwt() ->> 'aal') = 'aal2');
$$;

-- ---------------------------------------------------------------------------
-- 3) Büyük gövdeler: canlı tanım üzerinden tek ifade
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_def text;
  v_count integer;
begin
  for r in
    select t.sig, t.old_expr, t.new_expr
    from (values
      ('public.update_tenant_plan_subscription(uuid,uuid,text,text)',
       'and ps.role in (''super_admin'', ''billing'')',
       'and public.platform_staff_can(ps.id, ''billing'', ''write'')'),
      ('public.convert_demo_request_to_tenant(uuid,uuid,uuid,text)',
       'and ps.role in (''super_admin'', ''ops'', ''support'')',
       'and public.platform_staff_can(ps.id, ''sales'', ''write'')')
    ) as t(sig, old_expr, new_expr)
  loop
    v_def := pg_catalog.pg_get_functiondef(r.sig::regprocedure);
    if pg_catalog.strpos(v_def, r.new_expr) > 0 and pg_catalog.strpos(v_def, r.old_expr) = 0 then
      continue; -- ikinci çalıştırma: zaten dönüştürülmüş
    end if;
    v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, r.old_expr, ''))) / pg_catalog.length(r.old_expr);
    if v_count <> 1 then
      raise exception '20261014021010: % gövdesinde 1 rol ifadesi bekleniyordu, % bulundu; hiçbir şey yazılmadı.', r.sig, v_count;
    end if;
    execute pg_catalog.replace(v_def, r.old_expr, r.new_expr);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 4) Politikalar
-- ---------------------------------------------------------------------------
-- platform_settings_super_admin BİLEREK eski kuralında (s.role = 'super_admin'): uygulama bu tabloya yalnız servis istemcisiyle
-- (setPlatformSetting + denetim kaydı) erişir, TS ayar kapıları da hâlâ sabit super_admin'e bakar. Politikayı matrise açmak
-- sistem:approve verilmiş özel rol personeline denetimsiz doğrudan PostgREST yazımı verirdi.
drop policy if exists platform_mrr_daily_staff_select on public.platform_mrr_daily;
create policy platform_mrr_daily_staff_select on public.platform_mrr_daily
  for select to authenticated
  using ((select public.is_platform_staff()) and (select public.platform_staff_can('reports', 'view')));

notify pgrst, 'reload schema';
