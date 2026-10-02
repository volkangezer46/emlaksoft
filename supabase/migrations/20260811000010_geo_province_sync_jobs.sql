-- Province-scoped, lease-based geography synchronization.
--
-- The browser never writes this queue or geography tables directly. A platform
-- action enqueues exactly one selected province through a service-role RPC; a
-- bounded worker then leases one job, validates a complete provider snapshot,
-- and applies it atomically. Source rows are matched by stable source id first
-- and by a conservative normalized legacy name second. Records absent from the
-- provider snapshot are deliberately preserved: this migration never deletes,
-- deactivates, or reactivates geography maintained by an operator.

create table public.geo_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  province_id uuid not null
    references public.geo_provinces(id) on delete restrict,
  requested_by uuid
    references public.platform_staff(id) on delete set null,
  source text not null default 'turkiyeapi-v2'
    check (source in ('turkiyeapi-v2')),
  status text not null default 'queued'
    check (status in (
      'queued', 'running', 'retry', 'succeeded', 'partial',
      'dead_letter', 'paused'
    )),
  priority integer not null default 100
    check (priority between 0 and 1000),
  attempt_count integer not null default 0
    check (attempt_count between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_owner text
    check (lease_owner is null or char_length(lease_owner) between 3 and 120),
  lease_started_at timestamptz,
  source_version text
    check (source_version is null or char_length(source_version) between 1 and 100),
  source_last_updated text
    check (source_last_updated is null or char_length(source_last_updated) between 1 and 100),
  source_hash text
    check (source_hash is null or source_hash ~ '^[0-9a-f]{32,128}$'),
  before_count integer check (before_count is null or before_count >= 0),
  expected_count integer check (expected_count is null or expected_count >= 0),
  inserted_count integer check (inserted_count is null or inserted_count >= 0),
  updated_count integer check (updated_count is null or updated_count >= 0),
  unchanged_count integer check (unchanged_count is null or unchanged_count >= 0),
  conflict_count integer check (conflict_count is null or conflict_count >= 0),
  before_district_count integer
    check (before_district_count is null or before_district_count >= 0),
  before_neighborhood_count integer
    check (before_neighborhood_count is null or before_neighborhood_count >= 0),
  expected_district_count integer
    check (expected_district_count is null or expected_district_count >= 0),
  expected_neighborhood_count integer
    check (expected_neighborhood_count is null or expected_neighborhood_count >= 0),
  inserted_district_count integer
    check (inserted_district_count is null or inserted_district_count >= 0),
  updated_district_count integer
    check (updated_district_count is null or updated_district_count >= 0),
  unchanged_district_count integer
    check (unchanged_district_count is null or unchanged_district_count >= 0),
  conflict_district_count integer
    check (conflict_district_count is null or conflict_district_count >= 0),
  inserted_neighborhood_count integer
    check (inserted_neighborhood_count is null or inserted_neighborhood_count >= 0),
  updated_neighborhood_count integer
    check (updated_neighborhood_count is null or updated_neighborhood_count >= 0),
  unchanged_neighborhood_count integer
    check (unchanged_neighborhood_count is null or unchanged_neighborhood_count >= 0),
  conflict_neighborhood_count integer
    check (conflict_neighborhood_count is null or conflict_neighborhood_count >= 0),
  province_conflict_count integer
    check (province_conflict_count is null or province_conflict_count between 0 and 1),
  last_error_code text
    check (last_error_code is null or last_error_code ~ '^[a-z0-9_.:-]{1,100}$'),
  started_at timestamptz,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint geo_sync_jobs_lease_shape_check check (
    (status = 'running'
      and lease_token is not null
      and lease_owner is not null
      and lease_started_at is not null)
    or
    (status <> 'running'
      and lease_token is null
      and lease_owner is null
      and lease_started_at is null)
  ),
  constraint geo_sync_jobs_completion_shape_check check (
    (status in ('succeeded', 'partial') and completed_at is not null)
    or
    (status not in ('succeeded', 'partial'))
  ),
  constraint geo_sync_jobs_dead_letter_shape_check check (
    (status = 'dead_letter' and dead_lettered_at is not null)
    or
    (status <> 'dead_letter' and dead_lettered_at is null)
  ),
  constraint geo_sync_jobs_result_accounting_check check (
    status not in ('succeeded', 'partial')
    or (
      before_count is not null
      and expected_count is not null
      and inserted_count is not null
      and updated_count is not null
      and unchanged_count is not null
      and conflict_count is not null
      and source_version is not null
      and source_last_updated is not null
      and source_hash is not null
      and last_error_code is null
      and before_district_count is not null
      and before_neighborhood_count is not null
      and expected_district_count is not null
      and expected_neighborhood_count is not null
      and inserted_district_count is not null
      and updated_district_count is not null
      and unchanged_district_count is not null
      and conflict_district_count is not null
      and inserted_neighborhood_count is not null
      and updated_neighborhood_count is not null
      and unchanged_neighborhood_count is not null
      and conflict_neighborhood_count is not null
      and province_conflict_count is not null
      and before_count = before_district_count + before_neighborhood_count
      and expected_count = expected_district_count + expected_neighborhood_count
      and inserted_count = inserted_district_count + inserted_neighborhood_count
      and updated_count = updated_district_count + updated_neighborhood_count
      and unchanged_count = unchanged_district_count + unchanged_neighborhood_count
      and conflict_count = conflict_district_count + conflict_neighborhood_count
      and expected_count = inserted_count + updated_count + unchanged_count + conflict_count
      and expected_district_count
        = inserted_district_count + updated_district_count
          + unchanged_district_count + conflict_district_count
      and expected_neighborhood_count
        = inserted_neighborhood_count + updated_neighborhood_count
          + unchanged_neighborhood_count + conflict_neighborhood_count
      and (
        (status = 'succeeded' and conflict_count = 0 and province_conflict_count = 0)
        or
        (status = 'partial' and conflict_count + province_conflict_count > 0)
      )
    )
  )
);

-- A province may retain terminal history, but may never have two live jobs.
create unique index geo_sync_jobs_one_active_per_province
  on public.geo_sync_jobs(province_id)
  where status in ('queued', 'running', 'retry', 'paused');

create index geo_sync_jobs_claim_queue
  on public.geo_sync_jobs(priority desc, next_attempt_at, created_at, id)
  where status in ('queued', 'retry');

create index geo_sync_jobs_province_history
  on public.geo_sync_jobs(province_id, created_at desc, id desc);

create index geo_sync_jobs_dead_letter
  on public.geo_sync_jobs(dead_lettered_at desc)
  where status = 'dead_letter';

alter table public.geo_sync_jobs enable row level security;

-- No anon/authenticated policy is intentional. The service role bypasses RLS,
-- can read status, and mutates only through the lease/CAS RPCs below.
revoke all privileges on table public.geo_sync_jobs
  from public, anon, authenticated, service_role;
grant select on table public.geo_sync_jobs
  to service_role;

comment on table public.geo_sync_jobs is
  'Service-owned province geography sync queue and terminal run history.';
comment on column public.geo_sync_jobs.last_error_code is
  'Sanitized bounded machine code only; provider bodies and secrets must never be stored.';
comment on column public.geo_sync_jobs.conflict_count is
  'Source child rows preserved without mutation because identity or parent matching was ambiguous.';

-- Turkish-aware enough for conservative legacy matching. Accents are retained
-- deliberately: collapsing them could merge distinct operator-entered names.
create or replace function public.geo_sync_normalize_name(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select regexp_replace(
    lower(translate(btrim(p_value), 'IİŞĞÜÖÇÂÎÛ', 'ıişğüöçâîû')),
    '[[:space:]]+',
    ' ',
    'g'
  );
$$;

revoke all on function public.geo_sync_normalize_name(text)
  from public, anon, authenticated, service_role;

-- Select a province for immediate work. The advisory transaction lock makes
-- simultaneous UI selections deterministic. Running work is not interrupted;
-- all other queued/retry work is paused, and clicking a paused province resumes
-- that same active row instead of creating a duplicate.
create or replace function public.enqueue_geo_province_sync(
  p_province_id uuid,
  p_requested_by uuid,
  p_priority integer default 100
)
returns setof public.geo_sync_jobs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.geo_sync_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_province_id is null or p_priority is null
     or p_priority < 0 or p_priority > 1000 then
    raise exception 'Invalid province sync request.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.geo_provinces p
    where p.id = p_province_id and p.is_active = true
  ) then
    raise exception 'Active province not found.' using errcode = 'P0002';
  end if;
  if p_requested_by is not null and not exists (
    select 1
    from public.platform_staff s
    where s.id = p_requested_by and s.is_active = true
  ) then
    raise exception 'Active platform staff requester required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('geo-province-sync-enqueue-v1'));

  update public.geo_sync_jobs q
     set status = 'paused',
         lease_token = null,
         lease_owner = null,
         lease_started_at = null,
         updated_at = now()
   where q.province_id <> p_province_id
     and q.status in ('queued', 'retry');

  select q.*
    into v_job
  from public.geo_sync_jobs q
  where q.province_id = p_province_id
    and q.status in ('queued', 'running', 'retry', 'paused')
  for update;

  if found then
    if v_job.status <> 'running' then
      update public.geo_sync_jobs q
         set requested_by = p_requested_by,
             source = 'turkiyeapi-v2',
             status = 'queued',
             priority = p_priority,
             attempt_count = 0,
             next_attempt_at = now(),
             lease_token = null,
             lease_owner = null,
             lease_started_at = null,
             source_version = null,
             source_last_updated = null,
             source_hash = null,
             before_count = null,
             expected_count = null,
             inserted_count = null,
             updated_count = null,
             unchanged_count = null,
             conflict_count = null,
             before_district_count = null,
             before_neighborhood_count = null,
             expected_district_count = null,
             expected_neighborhood_count = null,
             inserted_district_count = null,
             updated_district_count = null,
             unchanged_district_count = null,
             conflict_district_count = null,
             inserted_neighborhood_count = null,
             updated_neighborhood_count = null,
             unchanged_neighborhood_count = null,
             conflict_neighborhood_count = null,
             province_conflict_count = null,
             last_error_code = null,
             started_at = null,
             completed_at = null,
             dead_lettered_at = null,
             updated_at = now()
       where q.id = v_job.id
       returning q.* into v_job;
    else
      update public.geo_sync_jobs q
         set requested_by = coalesce(p_requested_by, q.requested_by),
             priority = greatest(q.priority, p_priority),
             updated_at = now()
       where q.id = v_job.id
       returning q.* into v_job;
    end if;
  else
    insert into public.geo_sync_jobs (
      province_id, requested_by, source, status, priority
    ) values (
      p_province_id, p_requested_by, 'turkiyeapi-v2', 'queued', p_priority
    )
    returning * into v_job;
  end if;

  return next v_job;
end;
$$;

revoke all on function public.enqueue_geo_province_sync(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_geo_province_sync(uuid, uuid, integer)
  to service_role;

-- Recover stale leases, close exhausted rows, then atomically lease at most one
-- due job. SKIP LOCKED permits overlapping cron invocations without duplicates.
create or replace function public.claim_geo_sync_job(
  p_worker_id text,
  p_lease_minutes integer default 2
)
returns setof public.geo_sync_jobs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_worker_id text := btrim(coalesce(p_worker_id, ''));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if char_length(v_worker_id) < 3 or char_length(v_worker_id) > 120
     or p_lease_minutes is null
     or p_lease_minutes < 1 or p_lease_minutes > 15 then
    raise exception 'Invalid province sync claim.' using errcode = '22023';
  end if;

  -- Serialize the very small claim critical section so at most one province is
  -- running globally, even when two cron requests arrive simultaneously.
  perform pg_advisory_xact_lock(hashtext('geo-province-sync-claim-v1'));

  update public.geo_sync_jobs q
     set status = case
           when q.attempt_count >= 8 then 'dead_letter'
           when exists (
             select 1
             from public.geo_sync_jobs selected
             where selected.id <> q.id
               and selected.status in ('queued', 'retry')
           ) then 'paused'
           else 'retry'
         end,
         next_attempt_at = now(),
         lease_token = null,
         lease_owner = null,
         lease_started_at = null,
         last_error_code = 'stale_worker_lease',
         dead_lettered_at = case when q.attempt_count >= 8 then now() else null end,
         updated_at = now()
   where q.status = 'running'
     and q.lease_started_at <= now() - make_interval(mins => p_lease_minutes);

  update public.geo_sync_jobs q
     set status = 'dead_letter',
         dead_lettered_at = now(),
         last_error_code = 'inactive_province',
         updated_at = now()
   where q.status in ('queued', 'retry', 'paused')
     and not exists (
       select 1
       from public.geo_provinces p
       where p.id = q.province_id and p.is_active = true
     );

  update public.geo_sync_jobs q
     set status = 'dead_letter',
         dead_lettered_at = coalesce(q.dead_lettered_at, now()),
         last_error_code = coalesce(q.last_error_code, 'attempt_limit_reached'),
         updated_at = now()
   where q.status in ('queued', 'retry')
     and q.attempt_count >= 8;

  if exists (
    select 1 from public.geo_sync_jobs q where q.status = 'running'
  ) then
    return;
  end if;

  return query
  with candidate as (
    select q.id
    from public.geo_sync_jobs q
    where q.status in ('queued', 'retry')
      and q.attempt_count < 8
      and q.next_attempt_at <= now()
    order by q.priority desc, q.next_attempt_at, q.created_at, q.id
    limit 1
    for update skip locked
  )
  update public.geo_sync_jobs q
     set status = 'running',
         attempt_count = q.attempt_count + 1,
         lease_token = gen_random_uuid(),
         lease_owner = v_worker_id,
         lease_started_at = now(),
         started_at = coalesce(q.started_at, now()),
         last_error_code = null,
         updated_at = now()
    from candidate c
   where q.id = c.id
  returning q.*;
end;
$$;

revoke all on function public.claim_geo_sync_job(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_geo_sync_job(text, integer)
  to service_role;

-- Apply one complete provider snapshot under the exact lease that fetched it.
-- Expected payload (flat arrays make parent validation explicit):
-- {
--   "province": {"id":46,"name":"Kahramanmaraş","population":...,
--                "region":"Akdeniz","latitude":...,"longitude":...},
--   "expectedDistrictCount": 11,
--   "expectedNeighborhoodCount": 721,
--   "districts": [{"id":...,"provinceId":46,"name":..., ...}],
--   "neighborhoods": [{"id":...,"provinceId":46,"districtId":...,
--                      "name":...,"postalCode":..., ...}]
-- }
create or replace function public.apply_geo_province_sync(
  p_job_id uuid,
  p_lease_token uuid,
  p_payload jsonb,
  p_source_version text,
  p_source_last_updated text,
  p_source_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.geo_sync_jobs%rowtype;
  v_province public.geo_provinces%rowtype;
  v_source_plate integer;
  v_source_province_name text;
  v_source_province_population integer;
  v_source_province_region text;
  v_source_province_lat double precision;
  v_source_province_lng double precision;
  v_expected_districts integer;
  v_expected_neighborhoods integer;
  v_before_districts integer;
  v_before_neighborhoods integer;
  v_inserted_districts integer;
  v_updated_districts integer;
  v_unchanged_districts integer;
  v_conflict_districts integer;
  v_inserted_neighborhoods integer;
  v_updated_neighborhoods integer;
  v_unchanged_neighborhoods integer;
  v_conflict_neighborhoods integer;
  v_province_conflicts integer := 0;
  v_status text;
  v_source_version text := nullif(btrim(coalesce(p_source_version, '')), '');
  v_source_last_updated text := nullif(btrim(coalesce(p_source_last_updated, '')), '');
  v_source_hash text := lower(nullif(btrim(coalesce(p_source_hash, '')), ''));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_token is null
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 8388608 then
    raise exception 'Invalid province sync payload envelope.' using errcode = '22023';
  end if;
  if v_source_version is null or char_length(v_source_version) > 100
     or v_source_last_updated is null or char_length(v_source_last_updated) > 100
     or v_source_hash is null or v_source_hash !~ '^[0-9a-f]{32,128}$' then
    raise exception 'Invalid province sync source metadata.' using errcode = '22023';
  end if;

  select q.*
    into v_job
  from public.geo_sync_jobs q
  where q.id = p_job_id
    and q.status = 'running'
    and q.lease_token = p_lease_token
  for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'lease_lost');
  end if;

  select p.*
    into v_province
  from public.geo_provinces p
  where p.id = v_job.province_id
  for update;
  if not found then
    raise exception 'Province disappeared during sync.' using errcode = '40001';
  end if;
  if not v_province.is_active then
    raise exception 'Inactive province cannot be synchronized.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_payload -> 'province') is distinct from 'object'
     or jsonb_typeof(p_payload -> 'districts') is distinct from 'array'
     or jsonb_typeof(p_payload -> 'neighborhoods') is distinct from 'array' then
    raise exception 'Province sync payload shape is invalid.' using errcode = '22023';
  end if;

  begin
    v_source_plate := (p_payload #>> '{province,id}')::integer;
    v_source_province_name := btrim(p_payload #>> '{province,name}');
    v_source_province_population := nullif(p_payload #>> '{province,population}', '')::integer;
    v_source_province_region := nullif(btrim(p_payload #>> '{province,region}'), '');
    v_source_province_lat := nullif(p_payload #>> '{province,latitude}', '')::double precision;
    v_source_province_lng := nullif(p_payload #>> '{province,longitude}', '')::double precision;
    v_expected_districts := (p_payload ->> 'expectedDistrictCount')::integer;
    v_expected_neighborhoods := (p_payload ->> 'expectedNeighborhoodCount')::integer;
  exception when others then
    raise exception 'Province sync payload contains invalid scalar values.' using errcode = '22023';
  end;

  if v_source_plate is null
     or v_source_plate <> v_province.plate_code
     or v_source_plate < 1 or v_source_plate > 81
     or v_source_province_name is null
     or char_length(v_source_province_name) < 1
     or char_length(v_source_province_name) > 200
     or (v_source_province_population is not null and v_source_province_population < 0)
     or (v_source_province_region is not null and char_length(v_source_province_region) > 100)
     or (v_source_province_lat is not null and (v_source_province_lat < -90 or v_source_province_lat > 90))
     or (v_source_province_lng is not null and (v_source_province_lng < -180 or v_source_province_lng > 180))
     or v_expected_districts is null
     or v_expected_neighborhoods is null
     or v_expected_districts < 1 or v_expected_districts > 200
     or v_expected_neighborhoods < 1 or v_expected_neighborhoods > 10000
     or v_expected_neighborhoods < v_expected_districts
     or jsonb_array_length(p_payload -> 'districts') <> v_expected_districts
     or jsonb_array_length(p_payload -> 'neighborhoods') <> v_expected_neighborhoods then
    raise exception 'Province sync payload counts or province values are invalid.' using errcode = '22023';
  end if;

  drop table if exists pg_temp.geo_sync_source_neighborhoods;
  drop table if exists pg_temp.geo_sync_source_districts;

  create temporary table pg_temp.geo_sync_source_districts (
    source_id integer,
    source_province_id integer,
    name text,
    normalized_name text,
    population integer,
    lat double precision,
    lng double precision,
    source_match_count integer not null default 0,
    name_match_count integer not null default 0,
    target_id uuid,
    database_id uuid,
    is_canonical boolean not null default true,
    action text,
    conflict_code text
  ) on commit drop;

  create temporary table pg_temp.geo_sync_source_neighborhoods (
    source_id integer,
    source_province_id integer,
    source_district_id integer,
    name text,
    normalized_name text,
    population integer,
    postal_code text,
    lat double precision,
    lng double precision,
    database_district_id uuid,
    source_match_count integer not null default 0,
    name_match_count integer not null default 0,
    target_id uuid,
    is_canonical boolean not null default true,
    action text,
    conflict_code text
  ) on commit drop;

  begin
    insert into pg_temp.geo_sync_source_districts (
      source_id, source_province_id, name, normalized_name,
      population, lat, lng
    )
    select
      x.id,
      x."provinceId",
      btrim(x.name),
      public.geo_sync_normalize_name(x.name),
      x.population,
      x.latitude,
      x.longitude
    from jsonb_to_recordset(p_payload -> 'districts') as x(
      id integer,
      "provinceId" integer,
      name text,
      population integer,
      latitude double precision,
      longitude double precision
    );

    insert into pg_temp.geo_sync_source_neighborhoods (
      source_id, source_province_id, source_district_id, name,
      normalized_name, population, postal_code, lat, lng
    )
    select
      x.id,
      x."provinceId",
      x."districtId",
      btrim(x.name),
      public.geo_sync_normalize_name(x.name),
      x.population,
      nullif(btrim(x."postalCode"), ''),
      x.latitude,
      x.longitude
    from jsonb_to_recordset(p_payload -> 'neighborhoods') as x(
      id integer,
      "provinceId" integer,
      "districtId" integer,
      name text,
      population integer,
      "postalCode" text,
      latitude double precision,
      longitude double precision
    );
  exception when others then
    raise exception 'Province sync arrays contain invalid values.' using errcode = '22023';
  end;

  -- Fail closed on missing fields, invalid parents, duplicate provider ids, or
  -- ambiguous provider names. No database mutation occurs before these checks.
  if exists (
    select 1 from pg_temp.geo_sync_source_districts s
    where s.source_id is null or s.source_id <= 0
      or s.source_province_id is distinct from v_source_plate
      or s.name is null or char_length(s.name) < 1 or char_length(s.name) > 200
      or s.normalized_name = ''
      or (s.population is not null and s.population < 0)
      or (s.lat is not null and (s.lat < -90 or s.lat > 90))
      or (s.lng is not null and (s.lng < -180 or s.lng > 180))
  ) or exists (
    select 1 from pg_temp.geo_sync_source_neighborhoods s
    where s.source_id is null or s.source_id <= 0
      or s.source_province_id is distinct from v_source_plate
      or s.source_district_id is null or s.source_district_id <= 0
      or s.name is null or char_length(s.name) < 1 or char_length(s.name) > 200
      or s.normalized_name = ''
      or (s.population is not null and s.population < 0)
      or (s.postal_code is not null and char_length(s.postal_code) > 20)
      or (s.lat is not null and (s.lat < -90 or s.lat > 90))
      or (s.lng is not null and (s.lng < -180 or s.lng > 180))
  ) then
    raise exception 'Province sync source rows failed validation.' using errcode = '22023';
  end if;

  if exists (
    select s.source_id
    from pg_temp.geo_sync_source_districts s
    group by s.source_id having count(*) > 1
  ) or exists (
    select s.source_id
    from pg_temp.geo_sync_source_neighborhoods s
    group by s.source_id having count(*) > 1
  ) then
    raise exception 'Province sync source ids are not unique.' using errcode = '22023';
  end if;

  -- TurkiyeAPI has historically contained same-parent duplicate names with
  -- different source ids. Keep the highest id as a deterministic canonical row
  -- (matching the legacy sync's newest-row behavior) and account every other
  -- row as a conflict. The entire province remains usable and finishes partial.
  update pg_temp.geo_sync_source_districts s
     set is_canonical = false,
         conflict_code = 'duplicate_source_name'
   where exists (
     select 1
     from pg_temp.geo_sync_source_districts newer
     where newer.normalized_name = s.normalized_name
       and newer.source_id > s.source_id
   );

  update pg_temp.geo_sync_source_neighborhoods s
     set is_canonical = false,
         conflict_code = 'duplicate_source_name'
   where exists (
     select 1
     from pg_temp.geo_sync_source_neighborhoods newer
     where newer.source_district_id = s.source_district_id
       and newer.normalized_name = s.normalized_name
       and newer.source_id > s.source_id
   );

  if exists (
    select 1
    from pg_temp.geo_sync_source_neighborhoods n
    where not exists (
      select 1
      from pg_temp.geo_sync_source_districts d
      where d.source_id = n.source_district_id
        and d.source_province_id = n.source_province_id
    )
  ) then
    raise exception 'Province sync source contains an invalid district parent.' using errcode = '22023';
  end if;

  -- Keep classification and mutation stable against concurrent platform CRUD.
  -- Cross-province/source-id rows are also locked because they may become a
  -- reported identity conflict. A concurrent phantom still fails safely on the
  -- existing unique constraints and rolls back this entire RPC.
  perform d.id
  from public.geo_districts d
  where d.province_id = v_job.province_id
     or exists (
       select 1
       from pg_temp.geo_sync_source_districts s
       where s.source_id = d.source_id
     )
  order by d.id
  for update;

  perform n.id
  from public.geo_neighborhoods n
  where exists (
      select 1
      from public.geo_districts d
      where d.id = n.district_id
        and d.province_id = v_job.province_id
    )
     or exists (
       select 1
       from pg_temp.geo_sync_source_neighborhoods s
       where s.source_id = n.source_id
     )
  order by n.id
  for update;

  select count(*)::integer
    into v_before_districts
  from public.geo_districts d
  where d.province_id = v_job.province_id;

  select count(*)::integer
    into v_before_neighborhoods
  from public.geo_neighborhoods n
  inner join public.geo_districts d on d.id = n.district_id
  where d.province_id = v_job.province_id;

  -- Plate code is the province's stable provider identity. A conflicting name
  -- owned by another province is preserved and reported rather than overwritten.
  if exists (
    select 1
    from public.geo_provinces p
    where p.id <> v_job.province_id
      and public.geo_sync_normalize_name(p.name)
        = public.geo_sync_normalize_name(v_source_province_name)
  ) then
    v_province_conflicts := 1;
  end if;

  update public.geo_provinces p
     set name = case when v_province_conflicts = 0 then v_source_province_name else p.name end,
         population = coalesce(v_source_province_population, p.population),
         region = coalesce(v_source_province_region, p.region),
         lat = coalesce(v_source_province_lat, p.lat),
         lng = coalesce(v_source_province_lng, p.lng)
   where p.id = v_job.province_id;

  update pg_temp.geo_sync_source_districts s
     set source_match_count = (
           select count(*)::integer
           from public.geo_districts d
           where d.source_id = s.source_id
         ),
         name_match_count = (
           select count(*)::integer
           from public.geo_districts d
           where d.province_id = v_job.province_id
             and public.geo_sync_normalize_name(d.name) = s.normalized_name
         );

  update pg_temp.geo_sync_source_districts s
     set target_id = case
       when s.conflict_code is not null then null
       when s.source_match_count = 1 then (
         select d.id from public.geo_districts d where d.source_id = s.source_id
       )
       when s.source_match_count = 0 and s.name_match_count = 1 then (
         select d.id
         from public.geo_districts d
         where d.province_id = v_job.province_id
           and public.geo_sync_normalize_name(d.name) = s.normalized_name
       )
       else null
     end;

  update pg_temp.geo_sync_source_districts s
     set conflict_code = coalesce(s.conflict_code, case
       when s.source_match_count > 1 then 'duplicate_existing_source_id'
       when s.source_match_count = 0 and s.name_match_count > 1 then 'ambiguous_legacy_name'
       when s.source_match_count = 1 and exists (
         select 1 from public.geo_districts d
         where d.id = s.target_id and d.province_id <> v_job.province_id
       ) then 'source_id_owned_by_other_province'
       when s.target_id is not null and exists (
         select 1 from public.geo_districts d
         where d.id = s.target_id
           and d.source_id is not null
           and d.source_id <> s.source_id
       ) then 'legacy_name_has_other_source_id'
       when s.source_match_count = 1 and exists (
         select 1
         from public.geo_districts d
         where d.province_id = v_job.province_id
           and d.id <> s.target_id
           and public.geo_sync_normalize_name(d.name) = s.normalized_name
       ) then 'source_rename_collides'
       else null
     end);

  update pg_temp.geo_sync_source_districts s
     set action = case
       when s.conflict_code is not null then 'conflict'
       when s.target_id is null then 'inserted'
       when d.source_id is not distinct from s.source_id
        and d.name is not distinct from s.name
        and d.population is not distinct from coalesce(s.population, d.population)
        and d.lat is not distinct from coalesce(s.lat, d.lat)
        and d.lng is not distinct from coalesce(s.lng, d.lng)
         then 'unchanged'
       else 'updated'
     end
  from public.geo_districts d
  where d.id = s.target_id;

  update pg_temp.geo_sync_source_districts s
     set action = case when s.conflict_code is null then 'inserted' else 'conflict' end
   where s.action is null;

  update public.geo_districts d
     set source_id = s.source_id,
         name = s.name,
         population = coalesce(s.population, d.population),
         lat = coalesce(s.lat, d.lat),
         lng = coalesce(s.lng, d.lng)
  from pg_temp.geo_sync_source_districts s
  where s.target_id = d.id
    and s.action = 'updated';

  insert into public.geo_districts (
    province_id, source_id, name, population, lat, lng
  )
  select
    v_job.province_id, s.source_id, s.name, s.population, s.lat, s.lng
  from pg_temp.geo_sync_source_districts s
  where s.action = 'inserted';

  update pg_temp.geo_sync_source_districts s
     set database_id = d.id
  from public.geo_districts d
  where s.action <> 'conflict'
    and d.source_id = s.source_id
    and d.province_id = v_job.province_id;

  if exists (
    select 1
    from pg_temp.geo_sync_source_districts s
    where s.action <> 'conflict' and s.database_id is null
  ) then
    raise exception 'Province sync district identity binding failed.' using errcode = '40001';
  end if;

  update pg_temp.geo_sync_source_neighborhoods n
     set database_district_id = d.database_id,
         conflict_code = case
           when d.action = 'conflict' then 'parent_district_conflict'
           else null
         end
  from pg_temp.geo_sync_source_districts d
  where d.source_id = n.source_district_id;

  update pg_temp.geo_sync_source_neighborhoods s
     set source_match_count = (
           select count(*)::integer
           from public.geo_neighborhoods n
           where n.source_id = s.source_id
         ),
         name_match_count = case
           when s.database_district_id is null then 0
           else (
             select count(*)::integer
             from public.geo_neighborhoods n
             where n.district_id = s.database_district_id
               and public.geo_sync_normalize_name(n.name) = s.normalized_name
           )
         end;

  update pg_temp.geo_sync_source_neighborhoods s
     set target_id = case
       when s.conflict_code is not null then null
       when s.source_match_count = 1 then (
         select n.id from public.geo_neighborhoods n where n.source_id = s.source_id
       )
       when s.source_match_count = 0 and s.name_match_count = 1 then (
         select n.id
         from public.geo_neighborhoods n
         where n.district_id = s.database_district_id
           and public.geo_sync_normalize_name(n.name) = s.normalized_name
       )
       else null
     end;

  update pg_temp.geo_sync_source_neighborhoods s
     set conflict_code = coalesce(s.conflict_code, case
       when s.database_district_id is null then 'parent_district_unresolved'
       when s.source_match_count > 1 then 'duplicate_existing_source_id'
       when s.source_match_count = 0 and s.name_match_count > 1 then 'ambiguous_legacy_name'
       when s.source_match_count = 1 and exists (
         select 1 from public.geo_neighborhoods n
         where n.id = s.target_id
           and n.district_id <> s.database_district_id
       ) then 'source_id_owned_by_other_district'
       when s.target_id is not null and exists (
         select 1 from public.geo_neighborhoods n
         where n.id = s.target_id
           and n.source_id is not null
           and n.source_id <> s.source_id
       ) then 'legacy_name_has_other_source_id'
       when s.source_match_count = 1 and exists (
         select 1
         from public.geo_neighborhoods n
         where n.district_id = s.database_district_id
           and n.id <> s.target_id
           and public.geo_sync_normalize_name(n.name) = s.normalized_name
       ) then 'source_rename_collides'
       else null
     end);

  update pg_temp.geo_sync_source_neighborhoods s
     set action = case
       when s.conflict_code is not null then 'conflict'
       when s.target_id is null then 'inserted'
       when n.source_id is not distinct from s.source_id
        and n.name is not distinct from s.name
        and n.population is not distinct from coalesce(s.population, n.population)
        and n.postal_code is not distinct from coalesce(s.postal_code, n.postal_code)
        and n.lat is not distinct from coalesce(s.lat, n.lat)
        and n.lng is not distinct from coalesce(s.lng, n.lng)
         then 'unchanged'
       else 'updated'
     end
  from public.geo_neighborhoods n
  where n.id = s.target_id;

  update pg_temp.geo_sync_source_neighborhoods s
     set action = case when s.conflict_code is null then 'inserted' else 'conflict' end
   where s.action is null;

  update public.geo_neighborhoods n
     set source_id = s.source_id,
         name = s.name,
         population = coalesce(s.population, n.population),
         postal_code = coalesce(s.postal_code, n.postal_code),
         lat = coalesce(s.lat, n.lat),
         lng = coalesce(s.lng, n.lng)
  from pg_temp.geo_sync_source_neighborhoods s
  where s.target_id = n.id
    and s.action = 'updated';

  insert into public.geo_neighborhoods (
    district_id, source_id, name, population, postal_code, lat, lng
  )
  select
    s.database_district_id,
    s.source_id,
    s.name,
    s.population,
    s.postal_code,
    s.lat,
    s.lng
  from pg_temp.geo_sync_source_neighborhoods s
  where s.action = 'inserted';

  select
    (count(*) filter (where s.action = 'inserted'))::integer,
    (count(*) filter (where s.action = 'updated'))::integer,
    (count(*) filter (where s.action = 'unchanged'))::integer,
    (count(*) filter (where s.action = 'conflict'))::integer
  into
    v_inserted_districts,
    v_updated_districts,
    v_unchanged_districts,
    v_conflict_districts
  from pg_temp.geo_sync_source_districts s;

  select
    (count(*) filter (where s.action = 'inserted'))::integer,
    (count(*) filter (where s.action = 'updated'))::integer,
    (count(*) filter (where s.action = 'unchanged'))::integer,
    (count(*) filter (where s.action = 'conflict'))::integer
  into
    v_inserted_neighborhoods,
    v_updated_neighborhoods,
    v_unchanged_neighborhoods,
    v_conflict_neighborhoods
  from pg_temp.geo_sync_source_neighborhoods s;

  if v_inserted_districts + v_updated_districts
       + v_unchanged_districts + v_conflict_districts <> v_expected_districts
     or v_inserted_neighborhoods + v_updated_neighborhoods
       + v_unchanged_neighborhoods + v_conflict_neighborhoods <> v_expected_neighborhoods then
    raise exception 'Province sync result accounting failed.' using errcode = '40001';
  end if;

  v_status := case
    when v_province_conflicts + v_conflict_districts + v_conflict_neighborhoods > 0
      then 'partial'
    else 'succeeded'
  end;

  update public.geo_sync_jobs q
     set status = v_status,
         source_version = v_source_version,
         source_last_updated = v_source_last_updated,
         source_hash = v_source_hash,
         before_count = v_before_districts + v_before_neighborhoods,
         expected_count = v_expected_districts + v_expected_neighborhoods,
         inserted_count = v_inserted_districts + v_inserted_neighborhoods,
         updated_count = v_updated_districts + v_updated_neighborhoods,
         unchanged_count = v_unchanged_districts + v_unchanged_neighborhoods,
         conflict_count = v_conflict_districts + v_conflict_neighborhoods,
         before_district_count = v_before_districts,
         before_neighborhood_count = v_before_neighborhoods,
         expected_district_count = v_expected_districts,
         expected_neighborhood_count = v_expected_neighborhoods,
         inserted_district_count = v_inserted_districts,
         updated_district_count = v_updated_districts,
         unchanged_district_count = v_unchanged_districts,
         conflict_district_count = v_conflict_districts,
         inserted_neighborhood_count = v_inserted_neighborhoods,
         updated_neighborhood_count = v_updated_neighborhoods,
         unchanged_neighborhood_count = v_unchanged_neighborhoods,
         conflict_neighborhood_count = v_conflict_neighborhoods,
         province_conflict_count = v_province_conflicts,
         last_error_code = null,
         lease_token = null,
         lease_owner = null,
         lease_started_at = null,
         completed_at = now(),
         dead_lettered_at = null,
         updated_at = now()
   where q.id = v_job.id
     and q.status = 'running'
     and q.lease_token = p_lease_token;
  if not found then
    raise exception 'Province sync lease changed.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'applied', true,
    'jobId', v_job.id,
    'provinceId', v_job.province_id,
    'status', v_status,
    'beforeCount', v_before_districts + v_before_neighborhoods,
    'expectedCount', v_expected_districts + v_expected_neighborhoods,
    'insertedCount', v_inserted_districts + v_inserted_neighborhoods,
    'updatedCount', v_updated_districts + v_updated_neighborhoods,
    'unchangedCount', v_unchanged_districts + v_unchanged_neighborhoods,
    'conflictCount', v_conflict_districts + v_conflict_neighborhoods,
    'provinceConflictCount', v_province_conflicts,
    'districts', jsonb_build_object(
      'before', v_before_districts,
      'expected', v_expected_districts,
      'inserted', v_inserted_districts,
      'updated', v_updated_districts,
      'unchanged', v_unchanged_districts,
      'conflict', v_conflict_districts
    ),
    'neighborhoods', jsonb_build_object(
      'before', v_before_neighborhoods,
      'expected', v_expected_neighborhoods,
      'inserted', v_inserted_neighborhoods,
      'updated', v_updated_neighborhoods,
      'unchanged', v_unchanged_neighborhoods,
      'conflict', v_conflict_neighborhoods
    )
  );
end;
$$;

revoke all on function public.apply_geo_province_sync(
  uuid, uuid, jsonb, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_geo_province_sync(
  uuid, uuid, jsonb, text, text, text
) to service_role;

-- Release a failed lease using bounded exponential backoff. If another
-- province was explicitly queued while this job ran, the failed job pauses so
-- the selected province wins. Only sanitized machine codes are persisted; a
-- non-retryable failure (or attempt eight) enters dead-letter review.
create or replace function public.fail_geo_sync_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_retryable boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.geo_sync_jobs%rowtype;
  v_error_code text;
  v_terminal boolean;
  v_pause_for_selected boolean;
  v_status text;
  v_next_attempt_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_token is null then
    raise exception 'Invalid province sync failure transition.' using errcode = '22023';
  end if;

  v_error_code := left(
    regexp_replace(
      lower(btrim(left(coalesce(p_error_code, 'unknown_error'), 500))),
      '[^a-z0-9_.:-]+',
      '_',
      'g'
    ),
    100
  );
  if v_error_code = '' then
    v_error_code := 'unknown_error';
  end if;

  select q.*
    into v_job
  from public.geo_sync_jobs q
  where q.id = p_job_id
    and q.status = 'running'
    and q.lease_token = p_lease_token
  for update;

  if not found then
    return jsonb_build_object('applied', false, 'reason', 'lease_lost');
  end if;

  v_terminal := not coalesce(p_retryable, false) or v_job.attempt_count >= 8;
  select exists (
    select 1
    from public.geo_sync_jobs selected
    where selected.id <> v_job.id
      and selected.status in ('queued', 'retry')
  ) into v_pause_for_selected;
  v_status := case
    when v_terminal then 'dead_letter'
    when v_pause_for_selected then 'paused'
    else 'retry'
  end;
  v_next_attempt_at := case
    when v_terminal or v_pause_for_selected then now()
    else now() + case v_job.attempt_count
      when 1 then interval '1 minute'
      when 2 then interval '5 minutes'
      when 3 then interval '30 minutes'
      when 4 then interval '2 hours'
      else interval '12 hours'
    end
  end;

  update public.geo_sync_jobs q
     set status = v_status,
         next_attempt_at = v_next_attempt_at,
         lease_token = null,
         lease_owner = null,
         lease_started_at = null,
         last_error_code = v_error_code,
         dead_lettered_at = case when v_terminal then now() else null end,
         updated_at = now()
   where q.id = v_job.id
     and q.status = 'running'
     and q.lease_token = p_lease_token;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'lease_lost');
  end if;

  return jsonb_build_object(
    'applied', true,
    'jobId', v_job.id,
    'status', v_status,
    'attemptCount', v_job.attempt_count,
    'nextAttemptAt', v_next_attempt_at,
    'errorCode', v_error_code
  );
end;
$$;

revoke all on function public.fail_geo_sync_job(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_geo_sync_job(uuid, uuid, text, boolean)
  to service_role;

-- Aggregate UI read: one latest run per province, with no N+1 status queries.
-- The view is security-invoker and is granted only to the service role.
create or replace view public.geo_province_sync_status
with (security_invoker = true, security_barrier = true)
as
select distinct on (q.province_id)
  q.province_id,
  p.plate_code,
  p.name as province_name,
  q.id as job_id,
  q.requested_by,
  q.source,
  q.status,
  q.priority,
  q.attempt_count,
  q.next_attempt_at,
  q.lease_started_at,
  q.source_version,
  q.source_last_updated,
  q.source_hash,
  q.before_count,
  q.expected_count,
  q.inserted_count,
  q.updated_count,
  q.unchanged_count,
  q.conflict_count,
  q.before_district_count,
  q.before_neighborhood_count,
  q.expected_district_count,
  q.expected_neighborhood_count,
  q.inserted_district_count,
  q.updated_district_count,
  q.unchanged_district_count,
  q.conflict_district_count,
  q.inserted_neighborhood_count,
  q.updated_neighborhood_count,
  q.unchanged_neighborhood_count,
  q.conflict_neighborhood_count,
  q.province_conflict_count,
  q.last_error_code,
  q.started_at,
  q.completed_at,
  q.dead_lettered_at,
  q.created_at,
  q.updated_at
from public.geo_sync_jobs q
inner join public.geo_provinces p on p.id = q.province_id
order by q.province_id, q.created_at desc, q.id desc;

revoke all privileges on table public.geo_province_sync_status
  from public, anon, authenticated;
grant select on table public.geo_province_sync_status
  to service_role;

comment on view public.geo_province_sync_status is
  'Service-only latest province sync status projection for the platform geo screen.';
comment on function public.enqueue_geo_province_sync(uuid, uuid, integer) is
  'Queues/resumes one selected province and pauses other queued/retry geography jobs.';
comment on function public.claim_geo_sync_job(text, integer) is
  'Recovers stale leases and atomically leases at most one due province sync job.';
comment on function public.apply_geo_province_sync(uuid, uuid, jsonb, text, text, text) is
  'Validates and atomically applies one complete province snapshot under lease CAS without deleting/deactivating/reactivating records.';
comment on function public.fail_geo_sync_job(uuid, uuid, text, boolean) is
  'Releases a failed province sync lease into selected-job pause, bounded retry, or dead-letter state.';

notify pgrst, 'reload schema';
