-- Faz 3 / 02: danışman iş/yetki profili (advisor_profiles) ve KİŞİSEL/KİMLİK verisi (advisor_private).
--
-- KARAR: profiles GENİŞLETİLMEDİ. Gerekçe: profiles sıcak tablodur, ekip içinde geniş okunur, kullanıcıya "self_update"
-- verir ve public kartvizit sütunlarını (bio, public_slug...) taşır; TC/IBAN gibi hassas alanlar oraya konursa her
-- profiles sorgusu/embed'i ve select('*') sızdırma yüzeyi olur. İki 1:1 tablo:
--   advisor_profiles: hassas OLMAYAN iş verisi (işe giriş, yetki belgesi no/bitiş, kapasite, mesai, havuz katılımı).
--     Yazma yalnız owner/gm; ekip görüntüleme izni olanlar okur (atama motoru ve listeler için).
--   advisor_private : kimlik/kişisel veri. Okuma/yazma yalnız owner/gm + KENDİSİ (branch_manager/accounting DAHİL DEĞİL).
-- TC KİMLİK NO ve IBAN: yalnız UYGULAMA KATMANI ŞİFRELİ metin (national_id_enc / iban_enc, AES-256-GCM; anahtar ortam
--   değişkeni, SAHİBİN KARARI) + liste için son 4 hane (…_last4). Açık değer DB'ye, loga, audit'e, AI bağlamına, CSV'ye
--   varsayılan girmez. Anahtar yoksa kod bu iki alanı gizler (sütunlar null kalır); şema anahtarsız da güvenle uygulanır.
--   pgcrypto/pgp_sym_encrypt tercih edilmedi: anahtarı SQL parametresi olarak taşır (sorgu logu sızıntı yüzeyi).
-- DENETİM: advisor_private değişince trigger audit_logs'a YALNIZ değişen alan ADLARINI yazar (değer asla).
-- GERİ ALMA: rollbacks/20260816001300_advisor_profiles_private.rollback.sql (iki tablo + fonksiyon düşer; kişisel veri silinir).
-- RİSK: düşük-orta (yeni tablolar; KVKK aydınlatma/rıza metni SAHİBİN KARARI, bu dosya hukuki metin içermez).
-- BAĞIMLILIK: 20260816000200 (faz2_touch_updated_at), idx_profiles_id_tenant_unique (mevcut).

create table if not exists public.advisor_profiles (
  profile_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employment_type text check (employment_type is null or employment_type in ('kadrolu', 'komisyon', 'stajyer', 'ortak')),
  hired_at date,
  left_at date,
  authority_cert_no text check (authority_cert_no is null or char_length(authority_cert_no) <= 64),
  authority_cert_expires_on date,
  spk_cert_no text check (spk_cert_no is null or char_length(spk_cert_no) <= 64),
  spk_cert_expires_on date,
  max_active_listings integer check (max_active_listings is null or max_active_listings between 0 and 10000),
  max_active_demands integer check (max_active_demands is null or max_active_demands between 0 and 10000),
  work_days smallint[] not null default '{1,2,3,4,5}'
    check (work_days <@ array[1,2,3,4,5,6,7]::smallint[]),
  work_start time,
  work_end time,
  accepts_pool boolean not null default true,
  pool_paused_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advisor_profiles_profile_tenant_fkey
    foreign key (profile_id, tenant_id) references public.profiles (id, tenant_id) on delete cascade
);
create index if not exists idx_advisor_profiles_tenant on public.advisor_profiles (tenant_id);
create index if not exists idx_advisor_profiles_cert_expiry
  on public.advisor_profiles (tenant_id, authority_cert_expires_on) where authority_cert_expires_on is not null;

create table if not exists public.advisor_private (
  profile_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  national_id_enc text,
  national_id_last4 text check (national_id_last4 is null or national_id_last4 ~ '^[0-9]{4}$'),
  enc_key_version smallint not null default 1,
  birth_date date,
  address_line text check (address_line is null or char_length(address_line) <= 400),
  province_id uuid references public.geo_provinces(id),
  district_id uuid references public.geo_districts(id),
  emergency_name text check (emergency_name is null or char_length(emergency_name) <= 120),
  emergency_phone text check (emergency_phone is null or char_length(emergency_phone) <= 20),
  emergency_relation text check (emergency_relation is null or char_length(emergency_relation) <= 60),
  bank_name text check (bank_name is null or char_length(bank_name) <= 80),
  iban_holder text check (iban_holder is null or char_length(iban_holder) <= 120),
  iban_enc text,
  iban_last4 text check (iban_last4 is null or iban_last4 ~ '^[0-9A-Za-z]{4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advisor_private_profile_tenant_fkey
    foreign key (profile_id, tenant_id) references public.profiles (id, tenant_id) on delete cascade
);
create index if not exists idx_advisor_private_tenant on public.advisor_private (tenant_id);

drop trigger if exists trg_advisor_profiles_touch on public.advisor_profiles;
create trigger trg_advisor_profiles_touch before update on public.advisor_profiles
for each row execute function public.faz2_touch_updated_at();
drop trigger if exists trg_advisor_private_touch on public.advisor_private;
create trigger trg_advisor_private_touch before update on public.advisor_private
for each row execute function public.faz2_touch_updated_at();

-- Değer YAZMAZ: yalnız hangi alanların değiştiği (KVKK: denetim izi, sızıntı yok).
create or replace function public.audit_advisor_private_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[] := '{}';
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := to_jsonb(new);
  k text;
begin
  for k in select jsonb_object_keys(v_new) loop
    if k in ('created_at', 'updated_at') then continue; end if;
    if v_new -> k is distinct from v_old -> k then v_fields := v_fields || k; end if;
  end loop;
  if array_length(v_fields, 1) is null then return new; end if;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (new.tenant_id, (select auth.uid()), 'advisor_private.change', 'profile', new.profile_id,
          jsonb_build_object('fields', to_jsonb(v_fields)));
  return new;
end;
$$;
revoke all on function public.audit_advisor_private_change() from public, anon, authenticated;

drop trigger if exists trg_advisor_private_audit on public.advisor_private;
create trigger trg_advisor_private_audit after insert or update on public.advisor_private
for each row execute function public.audit_advisor_private_change();

alter table public.advisor_profiles enable row level security;
alter table public.advisor_private enable row level security;

-- advisor_profiles: kendi satırı veya ekip görüntüleme izni okur; yazma owner/gm.
create policy advisor_profiles_select on public.advisor_profiles for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (profile_id = (select auth.uid()) or (select public.has_effective_permission('team', 'view')))
);
create policy advisor_profiles_insert on public.advisor_profiles for insert to authenticated
with check (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'));
create policy advisor_profiles_update on public.advisor_profiles for update to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'))
with check (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'));
create policy advisor_profiles_delete on public.advisor_profiles for delete to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'));

-- advisor_private: yalnız owner/gm + kendisi (ekip izni yetmez).
create policy advisor_private_select on public.advisor_private for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (profile_id = (select auth.uid()) or (select public.current_profile_role()) in ('owner', 'gm'))
);
create policy advisor_private_insert on public.advisor_private for insert to authenticated
with check (
  tenant_id = (select public.current_tenant_id())
  and (profile_id = (select auth.uid()) or (select public.current_profile_role()) in ('owner', 'gm'))
);
create policy advisor_private_update on public.advisor_private for update to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (profile_id = (select auth.uid()) or (select public.current_profile_role()) in ('owner', 'gm'))
)
with check (
  tenant_id = (select public.current_tenant_id())
  and (profile_id = (select auth.uid()) or (select public.current_profile_role()) in ('owner', 'gm'))
);
create policy advisor_private_delete on public.advisor_private for delete to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'));

revoke all on table public.advisor_profiles from public, anon;
revoke all on table public.advisor_private from public, anon;
grant select, insert, update, delete on table public.advisor_profiles to authenticated;
grant select, insert, update, delete on table public.advisor_private to authenticated;
grant all on table public.advisor_profiles to service_role;
grant all on table public.advisor_private to service_role;
