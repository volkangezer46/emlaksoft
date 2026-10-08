-- Lig 2.0: ofis ayarlı puan kuralları + meydan okumalar (challenge).
--
-- NEDEN: Lig puanları koda gömülüydü (SCORE_RULES). Ofisler neyi ödüllendireceğini kendisi seçebilmeli; ayrıca
--   yöneticinin süreli, ödüllü ekip/bireysel yarışma açması gerekiyor. Veri kaynağı yeni tablo DEĞİL, mevcut kayıtlardır
--   (müşteri/randevu/teklif/portföy/anlaşma...); bu migration yalnız AYAR ve YARIŞMA TANIMI saklar.
-- NE: (1) league_settings (ofis başına tek satır: rules jsonb {kural: puan}, show_amounts bool varsayılan false);
--     (2) league_challenges (başlık, ölçüt, kapsam team|individual, hedef, tarih aralığı, ödül metni, durum, sonuç).
-- GİZLİLİK (P12): tutar bazlı sıralama (show_amounts) varsayılan KAPALI; yalnız yönetici açar. Tablolarda tutar saklanmaz.
-- RLS: okuma ofis geneli (lig şeffaftır); yazma 'targets' izni (create/edit/delete) ile.
-- GERI ALMA: rollbacks/20261008000600_league_v2.rollback.sql (iki tablo düşer; kod tablo yokken varsayılan kurallara düşer).
-- RISK: düşük (yalnız iki yeni tablo; mevcut tablo/politika değişmez).

set local lock_timeout = '5s';

create table if not exists public.league_settings (
  tenant_id    uuid        primary key references public.tenants(id) on delete cascade,
  rules        jsonb       not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object'),
  show_amounts boolean     not null default false,
  updated_by   uuid        references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now()
);

comment on table public.league_settings is 'Lig puan kuralları (ofis ayarı). rules: {kural_anahtari: puan}; 0 = kural kapalı; eksik anahtar varsayılan puana düşer. show_amounts=false (P12): ciro/komisyon tutarı ligde gösterilmez.';

create table if not exists public.league_challenges (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  title        text        not null check (length(btrim(title)) between 3 and 120),
  description  text        check (description is null or length(description) <= 500),
  reward_text  text        check (reward_text is null or length(reward_text) <= 200),
  metric       text        not null check (length(metric) between 2 and 40),
  scope        text        not null default 'team' check (scope in ('team', 'individual')),
  target_value int         not null check (target_value between 1 and 100000),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       text        not null default 'active' check (status in ('active', 'finished', 'cancelled')),
  result       jsonb,
  finished_at  timestamptz,
  created_by   uuid        references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint league_challenges_range check (ends_at > starts_at)
);

comment on table public.league_challenges is 'Süreli ekip/bireysel meydan okuma. metric = lig puan kuralı anahtarı (adet sayılır); ilerleme mevcut kayıtlardan hesaplanır, burada saklanmaz. result: bitişte mühürlenen sıralama/ulaşıldı bilgisi (tutar içermez).';

create index if not exists idx_league_challenges_tenant on public.league_challenges (tenant_id, status, ends_at desc);

alter table public.league_settings   enable row level security;
alter table public.league_challenges enable row level security;

drop policy if exists league_settings_select on public.league_settings;
create policy league_settings_select on public.league_settings
  for select to authenticated using (tenant_id = public.current_active_tenant_id());
drop policy if exists league_settings_insert on public.league_settings;
create policy league_settings_insert on public.league_settings
  for insert to authenticated with check (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('targets', 'edit'));
drop policy if exists league_settings_update on public.league_settings;
create policy league_settings_update on public.league_settings
  for update to authenticated
  using (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('targets', 'edit'))
  with check (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('targets', 'edit'));

drop policy if exists league_challenges_select on public.league_challenges;
create policy league_challenges_select on public.league_challenges
  for select to authenticated using (tenant_id = public.current_active_tenant_id());
drop policy if exists league_challenges_insert on public.league_challenges;
create policy league_challenges_insert on public.league_challenges
  for insert to authenticated with check (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('targets', 'create'));
drop policy if exists league_challenges_update on public.league_challenges;
create policy league_challenges_update on public.league_challenges
  for update to authenticated
  using (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('targets', 'edit'))
  with check (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('targets', 'edit'));
drop policy if exists league_challenges_delete on public.league_challenges;
create policy league_challenges_delete on public.league_challenges
  for delete to authenticated using (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('targets', 'delete'));

grant select, insert, update on public.league_settings to authenticated;
grant select, insert, update, delete on public.league_challenges to authenticated;
grant all on public.league_settings, public.league_challenges to service_role;
