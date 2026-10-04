-- P-HAVUZ / ilan sahibi: ilan sahibi (malik/müşteri) bilgileri — property_owner_info.
--
-- NEDEN: properties tablosunda ilan sahibi ile müşteri kaydı arasında bağ YOKTU (owner_customer_id yok);
-- yetki belgesi sütunları (authorization_*), min_price ve commission_rate zaten properties'te. Bu tablo yalnız EKSİK kalan,
-- yapılandırılmış alanları tutar: sahip müşteri bağı, ilişki türü, tapu durumu, komisyon türü, pazarlık payı, ilan kaynağı,
-- ilan için müşteri notu, görüşme geçmişi, KVKK/iletişim izni ve bilgi tamamlama puanı.
-- KİMLİK/VERGİ NO BİLEREK YOK: ihtiyaç doğarsa maskeli+şifreli ayrı karar gerekir (veri minimizasyonu).
-- Kodun şema yokken davranışı: createProperty tablo yoksa (42P01/PGRST205) özeti yeni müşterinin notuna yazar; yayın kapısı
-- ve ofis kartı tabloyu bulamazsa sessizce devre dışı kalır (mevcut portföy akışı bozulmaz).
-- Görünürlük (RLS): owner/gm/branch_manager (hasOfficeWideDataScope ile aynı küme) tüm ofisi görür; diğerleri yalnız
-- kendi atandığı/oluşturduğu ilanın satırını (properties.assigned_to / created_by) görür. Yazma: properties edit/create izni + aynı kapsam.
-- GERİ ALMA: rollbacks/20260819020100_property_owner_info.rollback.sql (tablo ve içerik düşer; properties verisi etkilenmez).
-- RİSK: düşük (yeni tablo; kod şema yokken okumaz). BAĞIMLILIK: idx_properties_id_tenant_unique, idx_customers_id_tenant_unique,
--   public.faz2_touch_updated_at (20260816000200), public.has_effective_permission (20260722000016).

create table if not exists public.property_owner_info (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null,
  customer_id uuid,
  relation text check (relation is null or relation in ('malik', 'vekil', 'mirasci', 'kurum')),
  deed_status text check (deed_status is null or deed_status in ('kat_mulkiyeti', 'kat_irtifaki', 'hisseli', 'arsa_tapusu', 'tapu_yok', 'bilinmiyor')),
  deed_note text check (deed_note is null or char_length(deed_note) <= 1000),
  commission_kind text check (commission_kind is null or commission_kind in ('yuzde', 'sabit')),
  negotiation_margin_pct numeric check (negotiation_margin_pct is null or (negotiation_margin_pct >= 0 and negotiation_margin_pct <= 100)),
  listing_source text check (listing_source is null or char_length(listing_source) <= 64),
  customer_notes text check (customer_notes is null or char_length(customer_notes) <= 4000),
  contact_history text check (contact_history is null or char_length(contact_history) <= 4000),
  kvkk_consent boolean not null default false,
  contact_permission boolean not null default false,
  consent_at timestamptz,
  completeness smallint not null default 0 check (completeness between 0 and 100),
  is_complete boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_owner_info_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties (id, tenant_id) on delete cascade,
  constraint property_owner_info_customer_tenant_fkey
    foreign key (customer_id, tenant_id) references public.customers (id, tenant_id) on delete set null (customer_id),
  constraint property_owner_info_one_per_property unique (property_id)
);
create index if not exists idx_property_owner_info_customer on public.property_owner_info (tenant_id, customer_id) where customer_id is not null;
create index if not exists idx_property_owner_info_incomplete on public.property_owner_info (tenant_id) where is_complete = false;

drop trigger if exists trg_property_owner_info_touch on public.property_owner_info;
create trigger trg_property_owner_info_touch before update on public.property_owner_info
for each row execute function public.faz2_touch_updated_at();

alter table public.property_owner_info enable row level security;

create policy property_owner_info_select on public.property_owner_info for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('properties', 'view'))
  and (
    (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
    or exists (
      select 1 from public.properties p
      where p.id = property_owner_info.property_id and p.tenant_id = property_owner_info.tenant_id
        and (p.assigned_to = (select auth.uid()) or p.created_by = (select auth.uid()))
    )
  )
);
create policy property_owner_info_insert on public.property_owner_info for insert to authenticated
with check (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('properties', 'create'))
  and exists (
    select 1 from public.properties p
    where p.id = property_owner_info.property_id and p.tenant_id = property_owner_info.tenant_id
      and ((select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
           or p.assigned_to = (select auth.uid()) or p.created_by = (select auth.uid()))
  )
);
create policy property_owner_info_update on public.property_owner_info for update to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('properties', 'edit'))
  and (
    (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
    or exists (
      select 1 from public.properties p
      where p.id = property_owner_info.property_id and p.tenant_id = property_owner_info.tenant_id
        and (p.assigned_to = (select auth.uid()) or p.created_by = (select auth.uid()))
    )
  )
)
with check (tenant_id = (select public.current_tenant_id()));
create policy property_owner_info_delete on public.property_owner_info for delete to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'));

revoke all on table public.property_owner_info from public, anon;
grant select, insert, update, delete on table public.property_owner_info to authenticated;
grant all on table public.property_owner_info to service_role;

comment on table public.property_owner_info is 'İlan sahibi (malik) yapılandırılmış bilgileri; müşteri kaydına bağlanır. Kimlik/vergi no tutulmaz.';
