-- Güvenlik denetimi 3 / #1 (P1): approval_requests — karar alanları ve içerik DB'de korunur.
--
-- NEDEN: 20260728000123 tek bir `for all` politikasıyla yalnız tenant koşulu koyuyordu (20260813000100 yalnız
--   initplan sarmalaması yaptı). Bir danışman PostgREST ile doğrudan:
--     * status='onaylandi' bir satır INSERT edebiliyor,
--     * kendi bekleyen talebini UPDATE ile 'onaylandi' yapabiliyor,
--     * onaylanmış eski bir talebin description'ındaki parmak izini değiştirip onayı başka işleme taşıyabiliyor,
--     * satırları silebiliyordu (tasarım: "satır hiçbir durumda silinmez").
--   Ofis kontrol onay kapısı (src/lib/oversight/approval-store.ts → findOpen) 'onaylandi' + parmak izi eşleşmesini
--   onay sayar; yani kapı atlanabiliyordu.
--
-- NE YAPAR:
--   1. consumed_at timestamptz sütunu (kod ajanı atomik tüketim için kullanacak; sütun yokken kod geri uyumlu).
--   2. Eski `approval_requests_tenant` (for all) DÜŞER; yerine:
--        SELECT : tenant içi (mevcut /app/onaylar listesi aynen).
--        INSERT : status='bekliyor' VE requested_by=auth.uid() VE karar/tüketim alanları boş.
--        UPDATE : talep sahibi (iptal/tüketim) veya karar kademesi; ayrıntılı kural trigger'da.
--        DELETE : politika YOK → authenticated silemez (service_role etkilenmez).
--   3. BEFORE UPDATE trigger (guard_approval_request_update): yalnız authenticated/anon çağrılarda çalışır;
--        * talep içeriği (kind, title, description, tutarlar, entity_*, requested_by, tenant_id, created_at) değişmez;
--        * durum yalnız 'bekliyor'dan çıkar;
--        * 'onaylandi'/'reddedildi': karar kademesi (approval_actor_can_decide) VE kendi talebi DEĞİL;
--          decided_by=auth.uid(), decided_at=now() DB tarafından yazılır;
--        * 'iptal': yalnız talep sahibi; karar alanlarına dokunamaz;
--        * durum değişmeden karar alanları (decided_by/decided_at/decision_note) yazılamaz;
--        * consumed_at: yalnız bir kez, yalnız 'onaylandi' talepte, talep sahibi veya karar kademesi; değeri now().
--   Karar kademesi = src/lib/approvals.ts isManagerRole (MANAGEMENT_TIER_ROLES: owner, gm, branch_manager, team_lead)
--   VE commissions:edit (decideApproval'ın requirePermission kapısı). Böylece mevcut akışla birebir aynı küme.
--
-- KOD UYUMU (okundu): src/app/actions/approvals.ts ve approval-store.ts KULLANICI OTURUMUYLA (createClient) yazar;
--   insert'lerde status='bekliyor', requested_by=gate.userId; karar update'i status/decided_by/decided_at/
--   decision_note/updated_at; iptal update'i status/updated_at. Hepsi yeni kurallarla geçerlidir.
--   scripts/seed-demo.ts service_role ile yazar → RLS/trigger dışında.
-- ETKİ: kilit yalnız approval_requests üzerinde kısa süreli (policy/trigger DDL); veri taşıma yok.
-- GERİ ALMA: supabase/rollbacks/20260823000100_sec3_approval_requests_rls.rollback.sql
-- RİSK: düşük-orta. Tenant override ile team_lead/branch_manager'a commissions:edit verilmemişse bu roller karar
--   veremez (uygulama zaten vermiyordu). Kod RLS hatasında "Karar kaydedilemedi." döner.

alter table public.approval_requests
  add column if not exists consumed_at timestamptz;

comment on column public.approval_requests.consumed_at is
  'Onayın bir işlemde kullanıldığı an (tek kullanımlık onay). Yalnız bir kez, yalnız onaylandi talepte yazılır; geri alınamaz.';

-- ---------------------------------------------------------------------------
-- Karar kademesi yardımcısı
-- ---------------------------------------------------------------------------
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

comment on function public.approval_actor_can_decide() is
  'Onay talebine karar verebilir mi: yönetim kademesi (isManagerRole) + commissions:edit. src/lib/approvals.ts canDecide ile aynı küme.';

revoke all on function public.approval_actor_can_decide() from public, anon;
grant execute on function public.approval_actor_can_decide() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Politikalar
-- ---------------------------------------------------------------------------
alter table public.approval_requests enable row level security;

drop policy if exists approval_requests_tenant on public.approval_requests;
drop policy if exists approval_requests_select on public.approval_requests;
drop policy if exists approval_requests_insert on public.approval_requests;
drop policy if exists approval_requests_update on public.approval_requests;

create policy approval_requests_select on public.approval_requests
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

create policy approval_requests_insert on public.approval_requests
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and requested_by = (select auth.uid())
    and status = 'bekliyor'
    and decided_by is null
    and decided_at is null
    and decision_note is null
    and consumed_at is null
  );

create policy approval_requests_update on public.approval_requests
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      requested_by = (select auth.uid())
      or (select public.approval_actor_can_decide())
    )
  )
  with check (tenant_id = (select public.current_tenant_id()));

comment on policy approval_requests_select on public.approval_requests is
  'Kiracı içi okuma (/app/onaylar).';
comment on policy approval_requests_insert on public.approval_requests is
  'Yalnız kendi adına, bekliyor durumunda ve karar alanları boş talep açılır.';
comment on policy approval_requests_update on public.approval_requests is
  'Talep sahibi (iptal/tüketim) veya karar kademesi. Alan kuralları: guard_approval_request_update trigger.';

-- ---------------------------------------------------------------------------
-- Sütun/durum koruma trigger'ı
-- ---------------------------------------------------------------------------
create or replace function public.guard_approval_request_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- service_role (cron/seed/admin), migration ve doğrudan DB oturumları bu kurala tabi değil.
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.kind is distinct from old.kind
     or new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.amount is distinct from old.amount
     or new.current_value is distinct from old.current_value
     or new.requested_value is distinct from old.requested_value
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.requested_by is distinct from old.requested_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Onay talebinin icerigi degistirilemez.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'bekliyor' then
      raise exception 'Sonuclanmis talebin durumu degistirilemez.' using errcode = '42501';
    end if;

    if new.status in ('onaylandi', 'reddedildi') then
      if not public.approval_actor_can_decide() then
        raise exception 'Onay/ret karari yalnizca yonetici kademesi tarafindan verilebilir.' using errcode = '42501';
      end if;
      if old.requested_by is not null and old.requested_by = v_uid then
        raise exception 'Kendi talebinizi onaylayamaz veya reddedemezsiniz.' using errcode = '42501';
      end if;
      new.decided_by := v_uid;
      new.decided_at := now();
    elsif new.status = 'iptal' then
      if old.requested_by is distinct from v_uid then
        raise exception 'Yalnizca talebi acan kisi iptal edebilir.' using errcode = '42501';
      end if;
      if new.decided_by is distinct from old.decided_by
         or new.decided_at is distinct from old.decided_at
         or new.decision_note is distinct from old.decision_note then
        raise exception 'Iptal sirasinda karar alanlari yazilamaz.' using errcode = '42501';
      end if;
    else
      raise exception 'Gecersiz durum gecisi.' using errcode = '42501';
    end if;
  elsif new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at
     or new.decision_note is distinct from old.decision_note then
    raise exception 'Karar alanlari yalnizca karar aninda yazilir.' using errcode = '42501';
  end if;

  if new.consumed_at is distinct from old.consumed_at then
    if old.consumed_at is not null then
      raise exception 'Kullanilmis onay geri alinamaz.' using errcode = '42501';
    end if;
    if new.status <> 'onaylandi' then
      raise exception 'Yalnizca onaylanmis talep kullanilabilir.' using errcode = '42501';
    end if;
    if old.requested_by is distinct from v_uid and not public.approval_actor_can_decide() then
      raise exception 'Bu onayi kullanma yetkiniz yok.' using errcode = '42501';
    end if;
    new.consumed_at := now();
  end if;

  return new;
end;
$$;

comment on function public.guard_approval_request_update() is
  'approval_requests BEFORE UPDATE: içerik değişmez, karar yalnız kademe ve kendi talebi değil, iptal yalnız sahibi, consumed_at tek seferlik.';

revoke all on function public.guard_approval_request_update() from public, anon, authenticated;

drop trigger if exists trg_approval_requests_guard on public.approval_requests;
create trigger trg_approval_requests_guard
  before update on public.approval_requests
  for each row execute function public.guard_approval_request_update();

-- Tüketim sorgusu (kod ajanı): onaylı + henüz tüketilmemiş talepler.
create index if not exists idx_approval_requests_unconsumed
  on public.approval_requests (tenant_id, requested_by)
  where status = 'onaylandi' and consumed_at is null;

notify pgrst, 'reload schema';
