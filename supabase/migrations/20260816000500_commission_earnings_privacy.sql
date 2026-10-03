-- Faz 2 / 05: kazanç gizliliği DB katmanında (commissions RLS + advisor_kpis ciro maskesi).
--
-- NEDEN: bugün commissions SELECT politikası tenant genelinde `commissions:view` sahibine açık;
-- branch_manager/team_lead/advisor başkasının komisyonunu PostgREST ile okuyabilir (gizlilik yalnız
-- sayfa katmanında). advisor_kpis RPC'si de tüm danışmanların cirosunu döndürüyor (belge 3e, 7/2).
-- NE YAPAR:
--  1) public.can_view_commission_earnings(...): SECURITY DEFINER yardımcı. Satır görünür iff
--     tenant eşleşir VE commissions:view VAR VE (earnings_all:view VAR VEYA deal.assigned_to = kullanıcı
--     VEYA commission_splits'te kullanıcının payı var).
--  2) commissions_select politikası bu fonksiyonu kullanır. INSERT/UPDATE/DELETE politikaları ve
--     guard_commission_atomic_ledger trigger'ı DEĞİŞMEZ. SECURITY DEFINER akışlar (atomik kapanış)
--     RLS'e takılmaz.
--  3) advisor_kpis: İMZA AYNI (uuid, timestamptz) -> aynı sütunlar. Tek fark: `revenue` yalnız
--     earnings_all sahibine veya satırın kendi sahibine gerçek değer, diğerlerine 0 döner.
-- BAĞIMLILIK: 01 (permission seed), 02 (commission_splits). Bunlar olmadan UYGULANMAZ.
-- DAVRANIŞ DEĞİŞİKLİĞİ (RİSK, YÜKSEK ETKİ): branch_manager/team_lead/advisor artık yalnız KENDİ
--   komisyonlarını görür; `komisyon` sayfası toplamları, dashboard/rapor komisyon toplamları ve
--   user-client ile komisyon toplayan her sorgu bu roller için DARALIR. Kod incelemesi bitmeden uygulama.
--   `cuzdan` (kendi payı) çalışmaya devam eder. Service-role/admin-client okumaları etkilenmez.
-- GERİ ALMA: rollbacks/20260816000500_commission_earnings_privacy.rollback.sql (eski politika +
--   eski advisor_kpis gövdesini geri yazar; veri değişmez).

create or replace function public.can_view_commission_earnings(
  p_tenant_id uuid,
  p_deal_id uuid,
  p_commission_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_tenant_id = public.current_tenant_id()
    and public.has_effective_permission('commissions', 'view')
    and (
      public.has_effective_permission('earnings_all', 'view')
      or exists (
        select 1
        from public.deals d
        where d.id = p_deal_id
          and d.tenant_id = p_tenant_id
          and d.assigned_to = auth.uid()
      )
      or exists (
        select 1
        from public.commission_splits s
        where s.commission_id = p_commission_id
          and s.tenant_id = p_tenant_id
          and s.profile_id = auth.uid()
      )
    );
$$;

comment on function public.can_view_commission_earnings(uuid, uuid, uuid) is
  'Komisyon satırı görünürlüğü: commissions:view + (earnings_all:view veya kendi deal.assigned_to veya kendi commission_splits payı).';

revoke all on function public.can_view_commission_earnings(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.can_view_commission_earnings(uuid, uuid, uuid)
  to authenticated, service_role;

alter policy commissions_select on public.commissions
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.can_view_commission_earnings(tenant_id, deal_id, id))
);

create or replace function public.advisor_kpis(
  p_tenant_id uuid,
  p_month_start timestamptz
)
returns table(
  assigned_to uuid,
  customer_count bigint,
  call_count bigint,
  appoint_count bigint,
  offer_count bigint,
  deal_count bigint,
  revenue numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with cust as (
    select c.assigned_to, count(*)::bigint as c
    from public.customers c
    where c.tenant_id = public.assert_current_tenant(p_tenant_id)
      and c.deleted_at is null
      and c.assigned_to is not null
    group by c.assigned_to
  ),
  cal as (
    select c.handled_by as uid, count(*)::bigint as c
    from public.calls c
    where c.tenant_id = public.assert_current_tenant(p_tenant_id)
      and c.started_at >= p_month_start
      and c.handled_by is not null
    group by c.handled_by
  ),
  appt as (
    select a.assigned_to as uid, count(*)::bigint as c
    from public.appointments a
    where a.tenant_id = public.assert_current_tenant(p_tenant_id)
      and a.scheduled_at >= p_month_start
      and a.assigned_to is not null
    group by a.assigned_to
  ),
  off as (
    select o.created_by as uid,
           count(*)::bigint as c,
           count(*) filter (where o.status = 'accepted')::bigint as accepted
    from public.offers o
    where o.tenant_id = public.assert_current_tenant(p_tenant_id)
      and o.created_at >= p_month_start
      and o.created_by is not null
    group by o.created_by
  ),
  comm as (
    select d.assigned_to as uid, coalesce(sum(cm.gross_amount), 0)::numeric as rev
    from public.commissions cm
    join public.deals d on d.id = cm.deal_id
    where cm.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cm.created_at >= p_month_start
      and cm.status in ('paid', 'collected')
      and d.assigned_to is not null
    group by d.assigned_to
  ),
  ids as (
    select cust.assigned_to as uid from cust
    union select cal.uid from cal
    union select appt.uid from appt
    union select off.uid from off
    union select comm.uid from comm
  ),
  gate as (
    select public.has_effective_permission('earnings_all', 'view') as see_all
  )
  select
    ids.uid as assigned_to,
    coalesce(cust.c, 0) as customer_count,
    coalesce(cal.c, 0) as call_count,
    coalesce(appt.c, 0) as appoint_count,
    coalesce(off.c, 0) as offer_count,
    coalesce(off.accepted, 0) as deal_count,
    -- Ciro maskesi: başkasının kazancı earnings_all olmadan 0 döner (imza/sütun aynı).
    case when gate.see_all or ids.uid = auth.uid() then coalesce(comm.rev, 0) else 0 end as revenue
  from ids
  cross join gate
  left join cust on cust.assigned_to = ids.uid
  left join cal on cal.uid = ids.uid
  left join appt on appt.uid = ids.uid
  left join off on off.uid = ids.uid
  left join comm on comm.uid = ids.uid;
$$;

revoke all privileges on function public.advisor_kpis(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.advisor_kpis(uuid, timestamptz)
  to authenticated, service_role;
