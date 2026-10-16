-- MIGRATION 20261020050005_recruiting_onboarding.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: tablolar yokken Ekip > Danisman adaylari "kurulum bekliyor" der,
--   /kariyer/[token] 404 verir, Danisman 360 oryantasyon karti gizlenir.
-- Geri alma: supabase/rollbacks/20261020050005_recruiting_onboarding.rollback.sql (tablolar duser; aday kayitlari,
--   basvuru formu ayari ve oryantasyon listeleri silinir; oryantasyondan acilan gorevler gorevler listesinde kalir).
-- BAGIMLILIK: current_active_tenant_id / has_effective_permission / current_profile_role son govdeleri, profiles,
--   tasks, tenants, notifications.
--
-- NE (OA9, danisman adayi ise alim hatti + yeni danisman oryantasyonu):
--   recruit_settings: ofis basina herkese acik basvuru formu (token, acik/kapali, giris metni, KVKK saklama suresi).
--   recruit_candidates: aday (asama basvuru|gorusme|teklif|katildi|red, kaynak, sorumlu, gorusme gorevi, bagli uye).
--   recruit_candidate_events: aday zaman cizelgesi (not, asama degisimi, gorusme, basvuru).
--   onboarding_template_items: ofisin oryantasyon sablonu (yoksa kod varsayilani kullanilir).
--   onboarding_items: uyeye kopyalanmis oryantasyon adimlari (termin, bagli gorev, tamamlandi).
--   GIZLILIK (KVKK, aday verisi): aday tablolari yalniz team:edit (varsayilan ofis sahibi + genel mudur) okur/yazar.
--   Herkese acik basvuru yalniz iki DEFINER RPC ile: recruit_public_form (ofis adi/logo; kisisel veri yok) ve
--   recruit_public_apply (token + acik riza + kiraci durumu + saatlik tavan; tekrarlayan telefon yeni satir acmaz).
--   Saklama: recruit_purge_expired (yalniz service_role; operational-retention cron adimi) sonuclanan adayi ofisin
--   saklama suresi (30-730 gun, varsayilan 180) dolunca, hareketsiz acik basvuruyu ayni sure sonra siler.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Ayar: herkese acik basvuru formu
-- ---------------------------------------------------------------------------
create table if not exists public.recruit_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  form_token uuid not null unique default gen_random_uuid(),
  form_enabled boolean not null default false,
  intro text check (intro is null or char_length(intro) <= 600),
  retention_days integer not null default 180 check (retention_days between 30 and 730),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Aday
-- ---------------------------------------------------------------------------
create table if not exists public.recruit_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  phone text check (phone is null or phone ~ '^(0[0-9]{10}|\+[1-9][0-9]{6,14})$'),
  email text check (email is null or (char_length(email) <= 254 and email like '%_@_%')),
  source text not null default 'diger'
    check (source in ('form', 'tavsiye', 'sosyal_medya', 'ilan', 'transfer', 'diger')),
  stage text not null default 'basvuru'
    check (stage in ('basvuru', 'gorusme', 'teklif', 'katildi', 'red')),
  owner_id uuid references public.profiles(id) on delete set null,
  experience_years smallint check (experience_years is null or experience_years between 0 and 60),
  current_office text check (current_office is null or char_length(current_office) <= 160),
  message text check (message is null or char_length(message) <= 2000),
  reject_reason text check (reject_reason is null or char_length(reject_reason) <= 300),
  interview_at timestamptz,
  interview_task_id uuid references public.tasks(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  kvkk_consent_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  stage_changed_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recruit_candidates_stage on public.recruit_candidates (tenant_id, stage, stage_changed_at desc);
create index if not exists idx_recruit_candidates_phone on public.recruit_candidates (tenant_id, phone) where phone is not null;
create index if not exists idx_recruit_candidates_profile on public.recruit_candidates (tenant_id, profile_id) where profile_id is not null;

create table if not exists public.recruit_candidate_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  candidate_id uuid not null references public.recruit_candidates(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('note', 'stage', 'interview', 'applied', 'created', 'joined')),
  body text check (body is null or char_length(body) <= 2000),
  from_stage text,
  to_stage text,
  created_at timestamptz not null default now()
);

create index if not exists idx_recruit_events_candidate on public.recruit_candidate_events (candidate_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Oryantasyon
-- ---------------------------------------------------------------------------
create table if not exists public.onboarding_template_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text check (description is null or char_length(description) <= 500),
  offset_days smallint not null default 0 check (offset_days between 0 and 180),
  sort smallint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_onboarding_template_tenant on public.onboarding_template_items (tenant_id, sort);

create table if not exists public.onboarding_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text check (description is null or char_length(description) <= 500),
  due_on date,
  sort smallint not null default 0,
  task_id uuid references public.tasks(id) on delete set null,
  done_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_onboarding_items_profile on public.onboarding_items (tenant_id, profile_id, sort);

alter table public.recruit_settings enable row level security;
alter table public.recruit_candidates enable row level security;
alter table public.recruit_candidate_events enable row level security;
alter table public.onboarding_template_items enable row level security;
alter table public.onboarding_items enable row level security;

-- ---------------------------------------------------------------------------
-- Politikalar: aday tarafi yalniz team:edit
-- ---------------------------------------------------------------------------
drop policy if exists recruit_settings_all on public.recruit_settings;
create policy recruit_settings_all on public.recruit_settings
  for all to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
  );

drop policy if exists recruit_candidates_all on public.recruit_candidates;
create policy recruit_candidates_all on public.recruit_candidates
  for all to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
  );

drop policy if exists recruit_events_select on public.recruit_candidate_events;
create policy recruit_events_select on public.recruit_candidate_events
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
  );

drop policy if exists recruit_events_insert on public.recruit_candidate_events;
create policy recruit_events_insert on public.recruit_candidate_events
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
    and actor_id = (select auth.uid())
    and exists (
      select 1 from public.recruit_candidates c
       where c.id = recruit_candidate_events.candidate_id and c.tenant_id = recruit_candidate_events.tenant_id
    )
  );

-- Not silme: yalniz kendi notu (zaman cizelgesi denetim izidir; asama satirlari silinmez).
drop policy if exists recruit_events_delete on public.recruit_candidate_events;
create policy recruit_events_delete on public.recruit_candidate_events
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
    and actor_id = (select auth.uid())
    and kind = 'note'
  );

drop policy if exists onboarding_template_all on public.onboarding_template_items;
create policy onboarding_template_all on public.onboarding_template_items
  for all to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
  );

-- Oryantasyon adimi: uye kendi listesini, ekip yoneticisi (team:edit) ve ofis geneli yonetim rolu herkesinkini gorur.
drop policy if exists onboarding_items_select on public.onboarding_items;
create policy onboarding_items_select on public.onboarding_items
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (
      profile_id = (select auth.uid())
      or (select public.has_effective_permission('team'::text, 'edit'::text))
      or (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
    )
  );

drop policy if exists onboarding_items_insert on public.onboarding_items;
create policy onboarding_items_insert on public.onboarding_items
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
    and exists (
      select 1 from public.profiles p
       where p.id = onboarding_items.profile_id and p.tenant_id = onboarding_items.tenant_id
    )
  );

drop policy if exists onboarding_items_update on public.onboarding_items;
create policy onboarding_items_update on public.onboarding_items
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (profile_id = (select auth.uid()) or (select public.has_effective_permission('team'::text, 'edit'::text)))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (profile_id = (select auth.uid()) or (select public.has_effective_permission('team'::text, 'edit'::text)))
  );

drop policy if exists onboarding_items_delete on public.onboarding_items;
create policy onboarding_items_delete on public.onboarding_items
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
  );

-- Uye kendi adiminda yalniz tamamlandi alanlarini degistirir; kimlik alanlari kimse icin degismez.
create or replace function public.guard_onboarding_item_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.profile_id is distinct from old.profile_id
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'Oryantasyon adiminin kimligi degistirilemez.' using errcode = '42501';
  end if;
  if not public.has_effective_permission('team'::text, 'edit'::text) then
    if new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.due_on is distinct from old.due_on
       or new.sort is distinct from old.sort
       or new.task_id is distinct from old.task_id then
      raise exception 'Oryantasyon adimini yalniz ekip yoneticisi duzenler.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_onboarding_item_update() from public, anon, authenticated;

drop trigger if exists trg_onboarding_items_guard on public.onboarding_items;
create trigger trg_onboarding_items_guard
  before update on public.onboarding_items
  for each row execute function public.guard_onboarding_item_update();

-- Aday: asama degisince stage_changed_at/closed_at, her guncellemede updated_at; bagli uye ayni ofisten olmali.
create or replace function public.recruit_candidate_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    new.closed_at := case when new.stage in ('katildi', 'red') then now() else null end;
  end if;
  if new.profile_id is not null and (tg_op = 'INSERT' or new.profile_id is distinct from old.profile_id) then
    if not exists (
      select 1 from public.profiles p where p.id = new.profile_id and p.tenant_id = new.tenant_id
    ) then
      raise exception 'Bagli uye bu ofisten olmali.' using errcode = '23514';
    end if;
  end if;
  if new.owner_id is not null and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    if not exists (
      select 1 from public.profiles p where p.id = new.owner_id and p.tenant_id = new.tenant_id
    ) then
      raise exception 'Sorumlu bu ofisten olmali.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.recruit_candidate_touch() from public, anon, authenticated;

drop trigger if exists trg_recruit_candidates_touch on public.recruit_candidates;
create trigger trg_recruit_candidates_touch
  before insert or update on public.recruit_candidates
  for each row execute function public.recruit_candidate_touch();

-- ---------------------------------------------------------------------------
-- Herkese acik basvuru formu (oturum yok): yalniz token ile, kisisel veri dondurmez.
-- ---------------------------------------------------------------------------
create or replace function public.recruit_public_form(p_token uuid)
returns table (office_name text, logo_url text, brand_color text, phone text, intro text, accepting boolean, retention_days integer, tenant_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.name::text,
         t.logo_url::text,
         t.brand_color::text,
         t.phone::text,
         s.intro,
         s.form_enabled,
         s.retention_days,
         t.status::text
    from public.recruit_settings s
    join public.tenants t on t.id = s.tenant_id
   where s.form_token = p_token
     and t.status in ('trial', 'active', 'past_due');
$$;

revoke all on function public.recruit_public_form(uuid) from public;
grant execute on function public.recruit_public_form(uuid) to anon, authenticated, service_role;

comment on function public.recruit_public_form(uuid) is
  'OA9: /kariyer/[token] icin ofis markasi + form acik mi (kisisel veri yok). Kiraci yayinda degilse satir donmez.';

create or replace function public.recruit_public_apply(
  p_token uuid,
  p_full_name text,
  p_phone text,
  p_email text,
  p_experience smallint,
  p_current_office text,
  p_message text,
  p_consent boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_enabled boolean;
  v_existing uuid;
  v_id uuid;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_recent integer;
begin
  if coalesce(p_consent, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'consent');
  end if;
  if char_length(v_name) not between 2 and 160 then
    return jsonb_build_object('ok', false, 'error', 'name');
  end if;
  if v_phone is null or v_phone !~ '^(0[0-9]{10}|\+[1-9][0-9]{6,14})$' then
    return jsonb_build_object('ok', false, 'error', 'phone');
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email not like '%_@_%') then
    return jsonb_build_object('ok', false, 'error', 'email');
  end if;

  select s.tenant_id, s.form_enabled into v_tenant, v_enabled
    from public.recruit_settings s
    join public.tenants t on t.id = s.tenant_id
   where s.form_token = p_token
     and t.status in ('trial', 'active', 'past_due');
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if not v_enabled then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  -- Ayni telefon acik bir aday olarak varsa yeni satir acilmaz; zaman cizelgesine yeniden basvuru notu duser.
  select c.id into v_existing
    from public.recruit_candidates c
   where c.tenant_id = v_tenant and c.phone = v_phone and c.stage not in ('katildi', 'red')
   limit 1;
  if v_existing is not null then
    insert into public.recruit_candidate_events (tenant_id, candidate_id, kind, body)
    values (v_tenant, v_existing, 'applied', 'Aday basvuru formunu yeniden doldurdu.');
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  -- Ofis basina saatlik tavan (token sizarsa toplu sahte basvuru engeli).
  select count(*) into v_recent
    from public.recruit_candidates c
   where c.tenant_id = v_tenant and c.source = 'form' and c.created_at > now() - interval '1 hour';
  if v_recent >= 30 then
    return jsonb_build_object('ok', false, 'error', 'rate');
  end if;

  insert into public.recruit_candidates (
    tenant_id, full_name, phone, email, source, stage, experience_years, current_office, message, kvkk_consent_at
  ) values (
    v_tenant,
    v_name,
    v_phone,
    v_email,
    'form',
    'basvuru',
    case when p_experience between 0 and 60 then p_experience else null end,
    nullif(left(btrim(coalesce(p_current_office, '')), 160), ''),
    nullif(left(btrim(coalesce(p_message, '')), 2000), ''),
    now()
  )
  returning id into v_id;

  insert into public.recruit_candidate_events (tenant_id, candidate_id, kind, body, to_stage)
  values (v_tenant, v_id, 'applied', 'Basvuru formundan geldi (acik riza alindi).', 'basvuru');

  -- Bildirim: ise alimi yoneten aktif ofis sahibi / genel mudur (danismanlar aday verisini gormez).
  insert into public.notifications (tenant_id, user_id, title, body, href, kind)
  select v_tenant, p.id, 'Yeni danisman adayi basvurusu', v_name || ' kariyer formundan basvurdu.',
         '/app/ekip/adaylar/' || v_id::text, 'info'
    from public.profiles p
   where p.tenant_id = v_tenant and p.is_active = true and p.role in ('owner', 'gm');

  return jsonb_build_object('ok', true, 'duplicate', false);
end;
$$;

revoke all on function public.recruit_public_apply(uuid, text, text, text, smallint, text, text, boolean) from public;
grant execute on function public.recruit_public_apply(uuid, text, text, text, smallint, text, text, boolean) to anon, authenticated, service_role;

comment on function public.recruit_public_apply(uuid, text, text, text, smallint, text, text, boolean) is
  'OA9: herkese acik danisman adayi basvurusu (token + acik riza + kiraci yayinda + ofis basina saatlik 30 tavan; ayni telefon tekrar satir acmaz).';

-- ---------------------------------------------------------------------------
-- KVKK saklama: yalniz service_role (operational-retention cron adimi).
-- ---------------------------------------------------------------------------
create or replace function public.recruit_purge_expired()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with doomed as (
    select c.id
      from public.recruit_candidates c
      left join public.recruit_settings s on s.tenant_id = c.tenant_id
     where (
             c.closed_at is not null
             and c.closed_at < now() - make_interval(days => coalesce(s.retention_days, 180))
           )
        or (
             c.closed_at is null
             and c.updated_at < now() - make_interval(days => coalesce(s.retention_days, 180))
           )
     limit 5000
  )
  delete from public.recruit_candidates c using doomed d where c.id = d.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.recruit_purge_expired() from public, anon, authenticated;
grant execute on function public.recruit_purge_expired() to service_role;

revoke all privileges on table public.recruit_settings from public, anon;
revoke all privileges on table public.recruit_candidates from public, anon;
revoke all privileges on table public.recruit_candidate_events from public, anon;
revoke all privileges on table public.onboarding_template_items from public, anon;
revoke all privileges on table public.onboarding_items from public, anon;
grant select, insert, update, delete on table public.recruit_settings to authenticated, service_role;
grant select, insert, update, delete on table public.recruit_candidates to authenticated, service_role;
grant select, insert, delete on table public.recruit_candidate_events to authenticated;
grant select, insert, update, delete on table public.recruit_candidate_events to service_role;
grant select, insert, update, delete on table public.onboarding_template_items to authenticated, service_role;
grant select, insert, update, delete on table public.onboarding_items to authenticated, service_role;

comment on table public.recruit_settings is 'OA9: ofisin herkese acik danisman adayi basvuru formu (token, acik/kapali, KVKK saklama suresi). team:edit.';
comment on table public.recruit_candidates is 'OA9: danisman adayi (ise alim hatti). Okuma/yazma yalniz team:edit; saklama recruit_purge_expired.';
comment on table public.recruit_candidate_events is 'OA9: aday zaman cizelgesi (not, asama, gorusme, basvuru).';
comment on table public.onboarding_template_items is 'OA9: ofisin yeni danisman oryantasyon sablonu (bos ise kod varsayilani).';
comment on table public.onboarding_items is 'OA9: uyeye kopyalanan oryantasyon adimi; uye yalniz tamamlandi isaretler (tetik).';
