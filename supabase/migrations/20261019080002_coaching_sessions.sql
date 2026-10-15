-- MIGRATION 20261019080002_coaching_sessions.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: tablolar yokken Danisman 360 > Birebir sekmesi "kurulum bekliyor" der.
-- Geri alma: supabase/rollbacks/20261019080002_coaching_sessions.rollback.sql (tablolar duser; gorusme notlari ve
--   taahhutler silinir, taahhutten acilan gorevler gorevler listesinde kalir).
-- BAGIMLILIK: current_active_tenant_id / current_profile_role son govdeleri, profiles, tasks.
--
-- NE (OA8, yonetici ile danisman arasi birebir gorusme):
--   coaching_sessions: gorusme (danisman, yonetici, tarih, not, o anki karne ozeti, sonraki gorusme).
--   coaching_commitments: gorusmede alinan taahhut (metin, termin, bagli gorev, tamamlandi).
--   GIZLILIK (KVKK, calisan verisi): satiri yalniz (a) gorusulen danisman, (b) gorusmeyi yapan yonetici, (c) ofis sahibi /
--   genel mudur, (d) danismanin subesindeki sube muduru okur. Ekip arkadaslari GOREMEZ. Rapor merkezine yalniz sayim girer.
--   Yazma: gorusmeyi yalniz yonetim rolu (owner/gm/branch_manager) kendi adina acar ve yalniz kendi gorusmesini duzenler;
--   danisman yalniz kendi taahhudunu tamamlandi isaretler (BEFORE trigger: baska alan degismez).
set local lock_timeout = '5s';

-- Okuma kapsami: tek yuklem (iki tablonun politikasi ve tetikleyici ayni kurali kullanir).
create or replace function public.coaching_can_view(p_profile_id uuid, p_manager_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and (
      auth.uid() = p_profile_id
      or auth.uid() = p_manager_id
      or public.current_profile_role() in ('owner', 'gm')
      or (
        public.current_profile_role() = 'branch_manager'
        and exists (
          select 1
            from public.profiles me
            join public.profiles adv on adv.id = p_profile_id
           where me.id = auth.uid()
             and me.branch_id is not null
             and adv.branch_id = me.branch_id
             and adv.tenant_id = me.tenant_id
        )
      )
    ),
    false
  );
$$;

revoke all on function public.coaching_can_view(uuid, uuid) from public, anon;
grant execute on function public.coaching_can_view(uuid, uuid) to authenticated, service_role;

comment on function public.coaching_can_view(uuid, uuid) is
  'OA8: birebir gorusme okuma kapsami (danisman, yonetici, owner/gm, ayni subenin muduru).';

create table if not exists public.coaching_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  manager_id uuid references public.profiles(id) on delete set null,
  held_at timestamptz not null default now(),
  notes text check (notes is null or char_length(notes) <= 5000),
  snapshot jsonb not null default '{}'::jsonb,
  next_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coaching_sessions_not_self check (manager_id is null or manager_id <> profile_id)
);

create index if not exists idx_coaching_sessions_profile on public.coaching_sessions (tenant_id, profile_id, held_at desc);
create index if not exists idx_coaching_sessions_manager on public.coaching_sessions (tenant_id, manager_id, held_at desc);

create table if not exists public.coaching_commitments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.coaching_sessions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 300),
  due_on date,
  task_id uuid references public.tasks(id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_coaching_commitments_session on public.coaching_commitments (session_id, created_at);
create index if not exists idx_coaching_commitments_open on public.coaching_commitments (tenant_id, profile_id) where done_at is null;

alter table public.coaching_sessions enable row level security;
alter table public.coaching_commitments enable row level security;

-- ---------------------------------------------------------------------------
-- coaching_sessions politikalari
-- ---------------------------------------------------------------------------
drop policy if exists coaching_sessions_select on public.coaching_sessions;
create policy coaching_sessions_select on public.coaching_sessions
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and public.coaching_can_view(profile_id, manager_id)
  );

drop policy if exists coaching_sessions_insert on public.coaching_sessions;
create policy coaching_sessions_insert on public.coaching_sessions
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and manager_id = (select auth.uid())
    and profile_id <> (select auth.uid())
    and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
    and public.coaching_can_view(coaching_sessions.profile_id, coaching_sessions.manager_id)
    and exists (
      select 1 from public.profiles p
       where p.id = coaching_sessions.profile_id and p.tenant_id = (select public.current_active_tenant_id())
    )
  );

drop policy if exists coaching_sessions_update on public.coaching_sessions;
create policy coaching_sessions_update on public.coaching_sessions
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and manager_id = (select auth.uid())
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and manager_id = (select auth.uid())
  );

drop policy if exists coaching_sessions_delete on public.coaching_sessions;
create policy coaching_sessions_delete on public.coaching_sessions
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and manager_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- coaching_commitments politikalari
-- ---------------------------------------------------------------------------
drop policy if exists coaching_commitments_select on public.coaching_commitments;
create policy coaching_commitments_select on public.coaching_commitments
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and exists (
      select 1 from public.coaching_sessions s
       where s.id = coaching_commitments.session_id and public.coaching_can_view(s.profile_id, s.manager_id)
    )
  );

drop policy if exists coaching_commitments_insert on public.coaching_commitments;
create policy coaching_commitments_insert on public.coaching_commitments
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and exists (
      select 1 from public.coaching_sessions s
       where s.id = coaching_commitments.session_id
         and s.tenant_id = coaching_commitments.tenant_id
         and s.manager_id = (select auth.uid())
         and s.profile_id = coaching_commitments.profile_id
    )
  );

-- Guncelleme: gorusmenin yoneticisi (tum alanlar) ya da danismanin kendisi (yalniz done_at; tetikleyici kilitler).
drop policy if exists coaching_commitments_update on public.coaching_commitments;
create policy coaching_commitments_update on public.coaching_commitments
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (
      profile_id = (select auth.uid())
      or exists (
        select 1 from public.coaching_sessions s
         where s.id = coaching_commitments.session_id and s.manager_id = (select auth.uid())
      )
    )
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (
      profile_id = (select auth.uid())
      or exists (
        select 1 from public.coaching_sessions s
         where s.id = coaching_commitments.session_id and s.manager_id = (select auth.uid())
      )
    )
  );

drop policy if exists coaching_commitments_delete on public.coaching_commitments;
create policy coaching_commitments_delete on public.coaching_commitments
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and exists (
      select 1 from public.coaching_sessions s
       where s.id = coaching_commitments.session_id and s.manager_id = (select auth.uid())
    )
  );

-- Danisman kendi taahhudunde yalniz tamamlandi alanini degistirir; kimlik/baglanti alanlari kimse icin degismez.
create or replace function public.guard_coaching_commitment_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_manager boolean;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.session_id is distinct from old.session_id
     or new.profile_id is distinct from old.profile_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Taahhut kimligi degistirilemez.' using errcode = '42501';
  end if;
  select exists (
    select 1 from public.coaching_sessions s where s.id = old.session_id and s.manager_id = v_uid
  ) into v_is_manager;
  if not v_is_manager then
    if new.body is distinct from old.body
       or new.due_on is distinct from old.due_on
       or new.task_id is distinct from old.task_id then
      raise exception 'Taahhut metnini yalniz gorusmeyi yapan yonetici degistirebilir.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_coaching_commitment_update() from public, anon, authenticated;

drop trigger if exists trg_coaching_commitments_guard on public.coaching_commitments;
create trigger trg_coaching_commitments_guard
  before update on public.coaching_commitments
  for each row execute function public.guard_coaching_commitment_update();

revoke all privileges on table public.coaching_sessions from public, anon;
revoke all privileges on table public.coaching_commitments from public, anon;
grant select, insert, update, delete on table public.coaching_sessions to authenticated, service_role;
grant select, insert, update, delete on table public.coaching_commitments to authenticated, service_role;

comment on table public.coaching_sessions is
  'OA8: birebir kocluk gorusmesi (danisman + yonetici + not + karne ozeti). Okuma coaching_can_view; yazma yalniz gorusmeyi yapan yonetici.';
comment on table public.coaching_commitments is
  'OA8: birebir gorusme taahhudu (termin, bagli gorev). Danisman yalniz tamamlandi isaretler.';
