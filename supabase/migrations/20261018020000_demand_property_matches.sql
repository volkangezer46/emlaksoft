-- CRM-G4: talep × portföy eşleşme durumu (önerildi / gönderildi / görüldü / beğendi / beğenmedi / gösterildi / uygun değil).
--
-- NEDEN: aynı portföy aynı müşteriye defalarca öneriliyor, toplu gönderimde aynı ilan ikinci kez gidebiliyordu; danışman
-- "bu müşteriye uymaz, çünkü kat yüksek" bilgisini saklayamıyordu. Tek satır = tek (talep, portföy) çifti; durum
-- tarihleri (gönderim, gizleme) ve son gönderim kanalı aynı satırda tutulur. Olay geçmişi audit_logs'ta kalır
-- (match.sent / match.dismissed / match.restored), bu tablo yalnız GÜNCEL durumdur.
--
-- Yazanlar (kod): sendMatchToCustomer + sendBulkMatchToCustomers (sent), "Uygun değil" düğmesi (dismissed / geri al),
-- eşleşme bildirimleri (suggested; yalnız satır yoksa, service_role). Okuyan: src/lib/match-candidates.ts loadDemandMatches.
--
-- Güvenlik: tenant + `matching` izni + talebin KENDİSİNİ görebilme (customer_demands RLS'i çağıranın yetkisiyle çalışır,
-- böylece danışman kapsamı (scope_owner_ids) otomatik uyar). Silme yalnız cascade (talep/portföy silinince).
-- Ofis sınırı portföy ve müşteri için bileşik (id, tenant_id) FK; talep için politika içindeki exists koşulu.
-- KOD DAVRANIŞI: tablo yokken okuyucu boş durum kümesiyle çalışır (eski davranış), yazanlar hatayı yutar.
-- GERİ ALMA: supabase/rollbacks/20261018020000_demand_property_matches.rollback.sql
-- RİSK: düşük (yeni tablo; mevcut nesne/veri değişmez). İdempotent.

create table if not exists public.demand_property_matches (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,
  demand_id       uuid        not null references public.customer_demands(id) on delete cascade,
  property_id     uuid        not null,
  customer_id     uuid,
  state           text        not null default 'suggested'
                  check (state in ('suggested', 'sent', 'viewed', 'liked', 'disliked', 'shown', 'dismissed')),
  dismiss_reason  text        check (dismiss_reason is null or dismiss_reason in ('price', 'location', 'floor', 'rooms', 'other')),
  dismiss_note    text        check (dismiss_note is null or char_length(dismiss_note) <= 300),
  dismissed_at    timestamptz,
  dismissed_by    uuid        references public.profiles(id) on delete set null,
  score_at_send   smallint    check (score_at_send is null or score_at_send between 0 and 100),
  sent_at         timestamptz,
  sent_by         uuid        references public.profiles(id) on delete set null,
  send_count      integer     not null default 0 check (send_count >= 0),
  channel         text        check (channel is null or channel in ('link', 'whatsapp', 'sms', 'email', 'presentation')),
  share_token     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (demand_id, property_id)
);

comment on table public.demand_property_matches is
  'Talep × portföy eşleşme durumu (CRM-G4). Tek satır = tek çift; güncel durum + son gönderim/gizleme bilgisi. Olay geçmişi audit_logs (match.*).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'demand_property_matches_property_tenant_fkey') then
    alter table public.demand_property_matches
      add constraint demand_property_matches_property_tenant_fkey
      foreign key (property_id, tenant_id)
      references public.properties(id, tenant_id)
      on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'demand_property_matches_customer_tenant_fkey') then
    alter table public.demand_property_matches
      add constraint demand_property_matches_customer_tenant_fkey
      foreign key (customer_id, tenant_id)
      references public.customers(id, tenant_id)
      on delete set null (customer_id);
  end if;
end $$;

create index if not exists idx_demand_property_matches_tenant_demand
  on public.demand_property_matches (tenant_id, demand_id);
create index if not exists idx_demand_property_matches_property
  on public.demand_property_matches (property_id);
create index if not exists idx_demand_property_matches_customer
  on public.demand_property_matches (customer_id, updated_at desc)
  where customer_id is not null;

alter table public.demand_property_matches enable row level security;

drop policy if exists capability_demand_property_matches_select on public.demand_property_matches;
create policy capability_demand_property_matches_select on public.demand_property_matches
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('matching'::text, 'view'::text))
    and exists (
      select 1 from public.customer_demands d
       where d.id = demand_property_matches.demand_id
         and d.tenant_id = demand_property_matches.tenant_id
    )
  );

drop policy if exists capability_demand_property_matches_insert on public.demand_property_matches;
create policy capability_demand_property_matches_insert on public.demand_property_matches
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('matching'::text, 'create'::text))
    and exists (
      select 1 from public.customer_demands d
       where d.id = demand_property_matches.demand_id
         and d.tenant_id = demand_property_matches.tenant_id
    )
  );

drop policy if exists capability_demand_property_matches_update on public.demand_property_matches;
create policy capability_demand_property_matches_update on public.demand_property_matches
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('matching'::text, 'create'::text))
    and exists (
      select 1 from public.customer_demands d
       where d.id = demand_property_matches.demand_id
         and d.tenant_id = demand_property_matches.tenant_id
    )
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('matching'::text, 'create'::text))
  );

-- Silme politikası bilinçli olarak YOK: satır talep/portföy silinince cascade ile gider; "geri al" durum günceller.
revoke all on public.demand_property_matches from anon, authenticated;
grant select, insert, update on public.demand_property_matches to authenticated;
grant all on public.demand_property_matches to service_role;
