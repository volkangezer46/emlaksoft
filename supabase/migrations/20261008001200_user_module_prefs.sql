-- MOD1 Modül paketleri: danışmanın KİŞİSEL modül gizlemesi (yalnız görünürlük).
--
-- Kavram: ofis modülü açık tutar (tenant_modules); kullanıcı kendi menü/ana ekran/palet görünümünden
-- kullanmadığı modülü gizleyebilir. YETKİYİ DEĞİŞTİRMEZ ve ofis düzeyindeki kapatma/yazma reddini etkilemez.
-- SATIR YOKSA gizli değildir. Anahtar doğrulaması uygulamada (src/lib/modules/registry.ts), DB'de biçim denetlenir.
-- RLS: yalnız kendi satırı (user_id = auth.uid() ve kendi ofisi); silme dahil.
-- GERİ ALMA: rollbacks/20261008001200_user_module_prefs.rollback.sql (kişisel gizlemeler silinir; her şey görünür döner).
-- RİSK: düşük (yeni tablo; kod tablo yokken hiçbir şey gizlemez).

create table if not exists public.user_module_prefs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  module_key text not null check (module_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  hidden boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, module_key)
);

create index if not exists user_module_prefs_tenant_idx on public.user_module_prefs (tenant_id);

alter table public.user_module_prefs enable row level security;

create policy user_module_prefs_select on public.user_module_prefs for select to authenticated
using (user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id()));

create policy user_module_prefs_insert on public.user_module_prefs for insert to authenticated
with check (user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id()));

create policy user_module_prefs_update on public.user_module_prefs for update to authenticated
using (user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id()))
with check (user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id()));

create policy user_module_prefs_delete on public.user_module_prefs for delete to authenticated
using (user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id()));

revoke all on table public.user_module_prefs from public, anon;
grant select, insert, update, delete on table public.user_module_prefs to authenticated;
grant all on table public.user_module_prefs to service_role;
