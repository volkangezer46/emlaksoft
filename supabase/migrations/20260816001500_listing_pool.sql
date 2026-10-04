-- Faz 3 / 04: ilan havuzu — listing_pool_entries, listing_pool_events ve atomik atama RPC'si.
--
-- properties.status ENUM'una/metnine DOKUNULMAZ: havuz durumu ayrı kayıttır. Bir ilan, havuz açıkken (tenants.
-- listing_pool_enabled) ve kaynağı havuza düşmesi gerekenlerden ise bir 'pending' kayıt alır; atanınca
-- properties.assigned_to güncellenir. Aynı ilan için aynı anda tek 'pending' kayıt olur (kısmi unique index).
-- suggestions jsonb: [{profile_id, score, reasons:[{key,label,points,max}]}] — KİŞİSEL VERİ İÇERMEZ (yalnız id/puan/etiket).
-- assign_pool_entry (SECURITY DEFINER, search_path boş): atama + properties.assigned_to + olay satırı TEK transaction.
--   Yetki: owner/gm/branch_manager (manual, suggested, reassign); danışmanın kendisi yalnız method='claim' ve
--   claim_open_until dolmamışken; 'auto'/'fallback' yalnız service_role (cron). Tenant çapraz erişimi engellenir.
--   Yarış güvenli: FOR UPDATE kilidi; ikinci sahiplenen "already assigned" hatası alır.
-- GERİ ALMA: rollbacks/20260816001500_listing_pool.rollback.sql (havuz kayıtları ve geçmişi silinir; properties.assigned_to kalır).
-- RİSK: orta-düşük (yeni tablolar + bir DEFINER fonksiyon). Yeni service_role kullanımı EKLEMEZ; cron için
--   mevcut admin-client kabul listesine eklenecek tek yeni dosya P-HAVUZ'da denetlenir.
-- BAĞIMLILIK: 20260816000900, 20260816001200 (assignment_rules + target_kind), idx_properties_id_tenant_unique (mevcut).

create table if not exists public.listing_pool_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null,
  source text not null default 'manual'
    check (source in ('manual', 'import', 'portal_form', 'network', 'api', 'transfer')),
  status text not null default 'pending' check (status in ('pending', 'assigned', 'skipped', 'withdrawn')),
  rule_id uuid,
  suggestions jsonb not null default '[]'::jsonb,
  top_score smallint check (top_score is null or top_score between 0 and 100),
  suggested_at timestamptz,
  sla_due_at timestamptz,
  claim_open_until timestamptz,
  assigned_to uuid,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  assign_method text check (assign_method is null or assign_method in ('manual', 'suggested', 'auto', 'claim', 'fallback', 'reassign')),
  reason text check (reason is null or char_length(reason) <= 500),
  skip_reason text check (skip_reason is null or char_length(skip_reason) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_pool_entries_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties (id, tenant_id) on delete cascade,
  constraint listing_pool_entries_assignee_tenant_fkey
    foreign key (assigned_to, tenant_id) references public.profiles (id, tenant_id) on delete set null (assigned_to),
  constraint listing_pool_entries_rule_tenant_fkey
    foreign key (rule_id, tenant_id) references public.assignment_rules (id, tenant_id) on delete set null (rule_id)
);
create unique index if not exists uq_listing_pool_open_per_property
  on public.listing_pool_entries (property_id) where status = 'pending';
create index if not exists idx_listing_pool_queue
  on public.listing_pool_entries (tenant_id, status, created_at desc);
create index if not exists idx_listing_pool_sla
  on public.listing_pool_entries (sla_due_at) where status = 'pending' and sla_due_at is not null;
create index if not exists idx_listing_pool_assignee
  on public.listing_pool_entries (tenant_id, assigned_to) where assigned_to is not null;

create table if not exists public.listing_pool_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entry_id uuid not null references public.listing_pool_entries(id) on delete cascade,
  event text not null check (event in
    ('created', 'suggested', 'claim_opened', 'assigned', 'reassigned', 'skipped', 'withdrawn', 'sla_breached', 'escalated')),
  actor_id uuid references public.profiles(id) on delete set null,
  from_profile_id uuid references public.profiles(id) on delete set null,
  to_profile_id uuid references public.profiles(id) on delete set null,
  score smallint check (score is null or score between 0 and 100),
  reason text check (reason is null or char_length(reason) <= 500),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_listing_pool_events_entry on public.listing_pool_events (entry_id, created_at);
create index if not exists idx_listing_pool_events_tenant on public.listing_pool_events (tenant_id, created_at desc);

drop trigger if exists trg_listing_pool_entries_touch on public.listing_pool_entries;
create trigger trg_listing_pool_entries_touch before update on public.listing_pool_entries
for each row execute function public.faz2_touch_updated_at();

alter table public.listing_pool_entries enable row level security;
alter table public.listing_pool_events enable row level security;

-- Okuma: portföy görüntüleme izni. Kayıt açma: portföy oluşturma izni. Doğrudan güncelleme: yönetici roller
-- (öneri/SLA alanları ve atlama); atama yolu RPC'dir.
create policy listing_pool_entries_select on public.listing_pool_entries for select to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('properties', 'view')));
create policy listing_pool_entries_insert on public.listing_pool_entries for insert to authenticated
with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('properties', 'create')));
create policy listing_pool_entries_update on public.listing_pool_entries for update to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager'))
with check (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager'));
create policy listing_pool_entries_delete on public.listing_pool_entries for delete to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'));

create policy listing_pool_events_select on public.listing_pool_events for select to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('properties', 'view')));
create policy listing_pool_events_insert on public.listing_pool_events for insert to authenticated
with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('properties', 'create')));

revoke all on table public.listing_pool_entries from public, anon;
revoke all on table public.listing_pool_events from public, anon;
grant select, insert, update, delete on table public.listing_pool_entries to authenticated;
grant select, insert on table public.listing_pool_events to authenticated;
grant all on table public.listing_pool_entries to service_role;
grant all on table public.listing_pool_events to service_role;

create or replace function public.assign_pool_entry(
  p_entry_id uuid,
  p_profile_id uuid,
  p_method text,
  p_reason text default null,
  p_score smallint default null,
  p_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service boolean := (select auth.role()) = 'service_role';
  v_uid uuid := (select auth.uid());
  v_tenant uuid;
  v_role text;
  v_entry public.listing_pool_entries%rowtype;
  v_prev uuid;
begin
  if p_method not in ('manual', 'suggested', 'auto', 'claim', 'fallback', 'reassign') then
    raise exception 'Gecersiz atama yontemi.' using errcode = '22023';
  end if;

  if v_service then
    select * into v_entry from public.listing_pool_entries where id = p_entry_id for update;
  else
    v_tenant := (select public.current_tenant_id());
    v_role := (select public.current_profile_role());
    if v_tenant is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
    select * into v_entry from public.listing_pool_entries where id = p_entry_id and tenant_id = v_tenant for update;
  end if;
  if not found then raise exception 'Havuz kaydi bulunamadi.' using errcode = 'P0002'; end if;

  if not v_service then
    if p_method in ('auto', 'fallback') then
      raise exception 'Bu yontem yalnizca sistem icindir.' using errcode = '42501';
    elsif p_method = 'claim' then
      if v_uid is distinct from p_profile_id
         or v_entry.claim_open_until is null
         or v_entry.claim_open_until < now() then
        raise exception 'Sahiplenme suresi acik degil.' using errcode = '42501';
      end if;
    elsif v_role not in ('owner', 'gm', 'branch_manager') then
      raise exception 'Atama yetkiniz yok.' using errcode = '42501';
    end if;
  end if;

  if p_method = 'reassign' then
    if v_entry.status <> 'assigned' then raise exception 'Yalniz atanmis kayit yeniden atanir.' using errcode = '22023'; end if;
  elsif v_entry.status <> 'pending' then
    raise exception 'Kayit zaten atanmis veya kapanmis.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.tenant_id = v_entry.tenant_id and p.is_active
      and p.role in ('owner', 'gm', 'branch_manager', 'team_lead', 'advisor')
  ) then
    raise exception 'Atanacak kullanici bu ofiste aktif degil.' using errcode = '22023';
  end if;

  v_prev := v_entry.assigned_to;
  update public.properties set assigned_to = p_profile_id
  where id = v_entry.property_id and tenant_id = v_entry.tenant_id;

  update public.listing_pool_entries set
    status = 'assigned',
    assigned_to = p_profile_id,
    assigned_by = case when p_method in ('auto', 'fallback') then null else v_uid end,
    assigned_at = now(),
    assign_method = p_method,
    reason = coalesce(p_reason, reason),
    claim_open_until = null
  where id = v_entry.id;

  insert into public.listing_pool_events
    (tenant_id, entry_id, event, actor_id, from_profile_id, to_profile_id, score, reason, detail)
  values
    (v_entry.tenant_id, v_entry.id,
     case when p_method = 'reassign' then 'reassigned' else 'assigned' end,
     v_uid, v_prev, p_profile_id, p_score, p_reason,
     coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('method', p_method));

  return jsonb_build_object('entry_id', v_entry.id, 'property_id', v_entry.property_id,
                            'assigned_to', p_profile_id, 'method', p_method);
end;
$$;

revoke all on function public.assign_pool_entry(uuid, uuid, text, text, smallint, jsonb) from public, anon;
grant execute on function public.assign_pool_entry(uuid, uuid, text, text, smallint, jsonb) to authenticated, service_role;
