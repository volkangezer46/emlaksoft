-- Ö-1 Modüller (aç/kapa): ofis başına kapatılabilir modül durumu.
--
-- Kavram: yetki = kim, paket = ne satın alındı, modül = ofiste açık mı. Etkin erişim üçünün birleşimidir.
-- SATIR YOKSA MODÜL AÇIK (varsayılan mevcut davranış); yalnız değişiklik satır yazar. Veri silinmez: kapatma
-- yalnız görünürlüğü ve otomatik işi durdurur. Anahtar doğrulaması uygulamada (src/lib/modules/registry.ts),
-- DB'de yalnız biçim denetlenir.
-- RLS: ofis kendi satırlarını okur; yazma yalnız owner/gm ve platform kilidi OLMAYAN satırdır
--   (locked_by_platform=true satırı ofis ne güncelleyebilir ne de yeni kilitli satır açabilir).
--   Platform kilidi service_role (admin paneli) ile yazılır. Silme politikası yok.
-- GERİ ALMA: rollbacks/20260816001700_tenant_modules.rollback.sql (tüm modül tercihleri silinir; modüller açık döner).
-- RİSK: düşük (yeni tablo; kod tablo yokken tüm modülleri açık sayar, bu yüzden kod migration'dan önce yayınlanabilir).

create table if not exists public.tenant_modules (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  module_key text not null check (module_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  enabled boolean not null,
  locked_by_platform boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, module_key)
);

alter table public.tenant_modules enable row level security;

create policy tenant_modules_select on public.tenant_modules for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy tenant_modules_insert on public.tenant_modules for insert to authenticated
with check (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
  and not locked_by_platform
);

create policy tenant_modules_update on public.tenant_modules for update to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and not locked_by_platform
  and (select public.current_profile_role()) in ('owner', 'gm')
)
with check (
  tenant_id = (select public.current_tenant_id())
  and not locked_by_platform
  and (select public.current_profile_role()) in ('owner', 'gm')
);

revoke all on table public.tenant_modules from public, anon;
grant select, insert, update on table public.tenant_modules to authenticated;
grant all on table public.tenant_modules to service_role;
