-- MIGRATION 20261013002000_portal_rules_core.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261013002000_portal_rules_core.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261013002000_portal_rules_core.rollback.sql
-- BAGIMLILIK: tenants, profiles, platform_staff, portal_transfer_sessions (20261012002700), public.current_tenant_id(),
--   public.has_effective_permission(), public.current_profile_role(), public.block_readonly_identity_writes().
--
-- AMAC: "Ogrenen eklenti 0.6.0" veri modeli. Eklenti motoru kodda, KURAL VERIDE: surumlu, imzali kural setleri
--   (portal_rule_sets), oneriler (portal_rule_proposals), ofis basina tek oy (portal_rule_votes), ofis uygunlugu
--   (portal_rule_tenant_trust), form alan katalogu (portal_form_fields), form surumleri (portal_form_versions) ve
--   kiraci duzeyinde ham gozlem (portal_form_reports, portal_fill_events).
-- GUVENLIK (elestirmen K1/K2):
--   * Platform tablolarinin SELECT politikasi `pt_rules_is_operator()`: aktif platform personeli VE rol super_admin|ops
--     (destek/faturalama rolu gormez; `is_platform_staff()` role bakmadigi icin yetmez). Kimlige burunurken kapali.
--   * Hicbir tabloda dogrudan INSERT/UPDATE/DELETE politikasi YOK; yazma yalniz SECURITY DEFINER RPC'lerle (002010/002020).
--   * Yayinlanan setin icerigi, sha'si, imzasi ve surumu DEGISMEZ (tetikleyici); yalniz durum gecisi serbest.
--   * Icerik SQL tarafinda da semadan gecer (`pt_rules_validate_content`; TS validateRuleSet'in SQL kopyasi, kaba).
--     Imza VERITABANINDA URETILMEZ: ozel anahtar yalniz sunucu ortaminda; imza yayin aninda TS'te uretilip satira yazilir.
-- GIZLILIK: kullanici DEGERI hic saklanmaz; yalniz katlanmis etiket/secenek (kisisel desen suzgecinden gecmis) ve sonuc turu.
--   Katalogda etiket ve secenek metni yalniz >=2 farkli uygun ofiste gorulunce acik (k>=2; elestirmen Y2).
-- RISK: dusuk (yalniz yeni tablo + fonksiyon; mevcut tablo/politika/veri degismez).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.portal_transfer_sessions') is null then
    raise exception 'portal_transfer_sessions yok; once 20261012002700 uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.platform_staff') is null then
    raise exception 'platform_staff yok.';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'block_readonly_identity_writes') then
    raise exception 'block_readonly_identity_writes yok.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Rol kapilari (K1): yonetim ekrani /admin/sistem "sistem" modulu ile ayni roller.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_rules_is_operator()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.platform_staff ps
     where ps.id = auth.uid() and ps.is_active = true and ps.role in ('super_admin', 'ops')
       and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
  );
$$;

create or replace function public.pt_rules_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.platform_staff ps
     where ps.id = auth.uid() and ps.is_active = true and ps.role = 'super_admin'
       and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
  );
$$;

revoke all on function public.pt_rules_is_operator() from public, anon;
revoke all on function public.pt_rules_is_super_admin() from public, anon;
grant execute on function public.pt_rules_is_operator() to authenticated;
grant execute on function public.pt_rules_is_super_admin() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Icerik semasi (K2): TS `validateRuleSet`'in SQL kopyasi. Null = gecerli, aksi halde ret nedeni.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_rules_validate_content(p_portal text, p_content jsonb)
returns text
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_keys text[] := array['title','description','price','currency','gross_sqm','net_sqm','rooms','building_age','floor',
    'total_floors','heating','bathrooms','balcony','elevator','parking','furnished','usage_status','in_site','site_name',
    'dues','credit_eligible','deed_status','facade','swap','eids_property_no','authority_doc_no','parcel_block',
    'parcel_lot','virtual_tour_url'];
  v_f jsonb;
  v_x jsonb;
  v_seen text[] := '{}';
  v_k text;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then return 'not_object'; end if;
  if pg_column_size(p_content) > 65536 then return 'too_large'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(p_content) k)
     <> array['expiresAt','fields','fingerprints','form','format','issuedAt','minExtension','placeholders','portal','version'] then
    return 'root_key_set';
  end if;
  if p_content -> 'format' <> '1'::jsonb then return 'format'; end if;
  if p_content ->> 'portal' is distinct from p_portal or p_portal not in ('sahibinden', 'hepsiemlak', 'emlakjet') then return 'portal'; end if;
  if jsonb_typeof(p_content -> 'version') <> 'number' or coalesce(p_content ->> 'version', '') !~ '^[0-9]{1,10}$' then return 'version'; end if;
  if coalesce(p_content ->> 'issuedAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
     or coalesce(p_content ->> 'expiresAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$' then
    return 'dates';
  end if;
  begin
    if (p_content ->> 'expiresAt')::timestamptz <= (p_content ->> 'issuedAt')::timestamptz then return 'dates'; end if;
  exception when others then
    return 'dates';
  end;
  if coalesce(p_content ->> 'minExtension', '') !~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$' then return 'min_extension'; end if;
  if jsonb_typeof(p_content -> 'form') <> 'object' or jsonb_typeof(p_content -> 'fields') <> 'array'
     or jsonb_typeof(p_content -> 'placeholders') <> 'array' or jsonb_typeof(p_content -> 'fingerprints') <> 'array' then
    return 'types';
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(p_content -> 'form') k) <> array['maxPhotos','recommended','required','titleMax'] then
    return 'form_key_set';
  end if;
  if jsonb_array_length(p_content -> 'fields') > 60 or jsonb_array_length(p_content -> 'fingerprints') > 40
     or jsonb_array_length(p_content -> 'placeholders') > 20 then
    return 'counts';
  end if;
  for v_x in select * from jsonb_array_elements(p_content -> 'fingerprints') loop
    if jsonb_typeof(v_x) <> 'string' or (v_x #>> '{}') !~ '^[0-9a-f]{64}$' then return 'fingerprint_text'; end if;
  end loop;
  for v_x in select * from jsonb_array_elements(p_content -> 'placeholders') loop
    if jsonb_typeof(v_x) <> 'string' or (v_x #>> '{}') !~ '^[a-z0-9 ]{1,40}$' then return 'placeholder_text'; end if;
  end loop;
  for v_f in select * from jsonb_array_elements(p_content -> 'fields') loop
    if jsonb_typeof(v_f) <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(v_f) k) <> array['anchors','confidence','control','exact','key','labels','options','state'] then
      return 'field_key_set';
    end if;
    v_k := v_f ->> 'key';
    if v_k is null or not (v_k = any (v_keys)) or v_k = any (v_seen) then return 'field_key'; end if;
    v_seen := v_seen || v_k;
    if coalesce(v_f ->> 'control', '') not in ('text', 'number', 'textarea', 'choice', 'bool') then return 'field_control'; end if;
    if coalesce(v_f ->> 'state', '') not in ('verified', 'unverified', 'degraded', 'disabled') then return 'field_state'; end if;
    if jsonb_typeof(v_f -> 'confidence') <> 'number' then return 'field_confidence'; end if;
    if (v_f ->> 'confidence')::numeric not between 0 and 1 then return 'field_confidence'; end if;
    if jsonb_typeof(v_f -> 'labels') <> 'array' or jsonb_array_length(v_f -> 'labels') > 12
       or jsonb_typeof(v_f -> 'exact') <> 'array' or jsonb_array_length(v_f -> 'exact') > 6
       or jsonb_typeof(v_f -> 'anchors') <> 'array' or jsonb_array_length(v_f -> 'anchors') > 8
       or jsonb_typeof(v_f -> 'options') <> 'object' then
      return 'field_lists';
    end if;
    for v_x in select * from jsonb_array_elements((v_f -> 'labels') || (v_f -> 'exact')) loop
      if jsonb_typeof(v_x) <> 'string' or (v_x #>> '{}') !~ '^[a-z0-9+ ]{3,60}$' or (v_x #>> '{}') !~ '[a-z]' then return 'field_label_text'; end if;
    end loop;
    for v_x in select * from jsonb_array_elements(v_f -> 'anchors') loop
      if jsonb_typeof(v_x) <> 'string' or (v_x #>> '{}') !~ '^[0-9a-f]{16}$' then return 'field_anchor_text'; end if;
    end loop;
    if (select count(*) from jsonb_object_keys(v_f -> 'options')) > 40 then return 'field_options_count'; end if;
    if exists (select 1 from jsonb_each(v_f -> 'options') o
                where o.key !~ '^[a-z0-9+ ]{1,60}$' or jsonb_typeof(o.value) <> 'array'
                   or jsonb_array_length(o.value) not between 1 and 8
                   or exists (select 1 from jsonb_array_elements(o.value) a
                               where jsonb_typeof(a) <> 'string' or (a #>> '{}') !~ '^[a-z0-9+ ]{1,60}$')) then
      return 'field_option_text';
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.pt_rules_validate_content(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Platform tablolari (tenant_id yok; votes haric)
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.portal_rule_sets (
  id uuid primary key default gen_random_uuid(),
  portal text not null check (portal in ('sahibinden', 'hepsiemlak', 'emlakjet')),
  version integer not null check (version between 1 and 2147483647),
  format smallint not null default 1 check (format = 1),
  status text not null default 'published' check (status in ('draft', 'published', 'superseded', 'rejected')),
  kind text not null check (kind in ('seed', 'auto', 'staff', 'rollback')),
  content jsonb not null check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 65536),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  signature text not null check (signature ~ '^[A-Za-z0-9_-]{80,100}$'),
  kid text not null check (kid ~ '^[A-Za-z0-9._-]{1,40}$'),
  expires_at timestamptz not null,
  parent_id uuid references public.portal_rule_sets(id) on delete set null,
  rolls_back_to uuid references public.portal_rule_sets(id) on delete set null,
  change_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(change_summary) = 'object' and pg_column_size(change_summary) <= 16384),
  min_extension text not null default '0.6.0' check (min_extension ~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$'),
  created_by uuid references public.platform_staff(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  superseded_at timestamptz,
  unique (portal, version),
  check (kind <> 'rollback' or rolls_back_to is not null)
);
create unique index if not exists uq_portal_rule_sets_published on public.portal_rule_sets (portal) where status = 'published';

create table if not exists public.portal_rule_proposals (
  id uuid primary key default gen_random_uuid(),
  portal text not null check (portal in ('sahibinden', 'hepsiemlak', 'emlakjet')),
  proposal_key text not null check (proposal_key ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('label_map', 'option_map', 'field_demote', 'field_disable', 'new_field', 'form_meta')),
  field_key text check (field_key is null or field_key ~ '^[a-z_]{2,40}$'),
  field_sig text check (field_sig is null or field_sig ~ '^[0-9a-f]{64}$'),
  proposal jsonb not null default '{}'::jsonb check (jsonb_typeof(proposal) = 'object' and pg_column_size(proposal) <= 4096),
  source text not null check (source in ('corrections', 'unmatched', 'ai', 'staff')),
  support_tenants integer not null default 0,
  contradict_tenants integer not null default 0,
  support_sessions integer not null default 0,
  weeks_n integer not null default 0,
  confidence numeric(4, 3) not null default 0 check (confidence between 0 and 1),
  state text not null default 'collecting'
    check (state in ('collecting', 'ready', 'auto_approved', 'approved', 'rejected', 'superseded', 'expired')),
  ai_model text check (ai_model is null or length(ai_model) <= 80),
  ai_unverified boolean not null default false,
  first_seen timestamptz not null default now(),
  last_evaluated timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.platform_staff(id) on delete set null,
  decision_reason text check (decision_reason is null or length(decision_reason) <= 500),
  rule_set_id uuid references public.portal_rule_sets(id) on delete set null,
  unique (portal, proposal_key)
);
create index if not exists idx_portal_rule_proposals_state on public.portal_rule_proposals (portal, state);

create table if not exists public.portal_rule_votes (
  proposal_key text not null check (proposal_key ~ '^[0-9a-f]{64}$'),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stance smallint not null check (stance in (-1, 0, 1)),
  sessions_n integer not null default 0 check (sessions_n between 0 and 20),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  eligible boolean not null default false,
  primary key (proposal_key, tenant_id)
);
create index if not exists idx_portal_rule_votes_tenant on public.portal_rule_votes (tenant_id);

create table if not exists public.portal_rule_tenant_trust (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  eligible boolean not null,
  reason text check (reason is null or length(reason) <= 500),
  set_by uuid references public.platform_staff(id) on delete set null,
  set_at timestamptz not null default now()
);

create table if not exists public.portal_form_fields (
  portal text not null check (portal in ('sahibinden', 'hepsiemlak', 'emlakjet')),
  field_sig text not null check (field_sig ~ '^[0-9a-f]{64}$'),
  control text not null check (control in ('text', 'number', 'textarea', 'choice', 'bool')),
  -- Acik metin yalniz distinct_tenants >= 2 iken (k>=2); aksi halde null / bos.
  label_folded text check (label_folded is null or length(label_folded) <= 60),
  options_folded text[] not null default '{}' check (cardinality(options_folded) <= 60),
  distinct_tenants integer not null default 0,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  mapped_key text check (mapped_key is null or mapped_key ~ '^[a-z_]{2,40}$'),
  primary key (portal, field_sig),
  check (distinct_tenants >= 2 or (label_folded is null and cardinality(options_folded) = 0))
);

create table if not exists public.portal_form_versions (
  portal text not null check (portal in ('sahibinden', 'hepsiemlak', 'emlakjet')),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  field_count integer not null default 0,
  tenants_n integer not null default 0,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'known', 'dominant', 'retired')),
  jaccard_prev numeric(4, 3),
  alert_state text not null default 'none' check (alert_state in ('none', 'info', 'warning')),
  primary key (portal, fingerprint)
);

-- ---------------------------------------------------------------------------------------------------------------------
-- Kiraci tablolari (ham gozlem; dogrudan yazma kapali)
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.portal_form_reports (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day date not null,
  portal text not null check (portal in ('sahibinden', 'hepsiemlak', 'emlakjet')),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  field_sig text not null check (field_sig ~ '^[0-9a-f]{64}$'),
  control text not null check (control in ('text', 'number', 'textarea', 'choice', 'bool')),
  label_folded text not null check (length(label_folded) between 1 and 60),
  options_folded text[] not null default '{}' check (cardinality(options_folded) <= 60),
  required boolean not null default false,
  matched_key text check (matched_key is null or matched_key ~ '^[a-z_]{2,40}$'),
  rule_version integer not null default 0,
  n integer not null default 1,
  primary key (tenant_id, day, portal, fingerprint, field_sig)
);
create index if not exists idx_portal_form_reports_portal on public.portal_form_reports (portal, field_sig);

create table if not exists public.portal_fill_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.portal_transfer_sessions(id) on delete cascade,
  portal text not null check (portal in ('sahibinden', 'hepsiemlak', 'emlakjet')),
  rule_version integer not null default 0,
  form_fp text check (form_fp is null or form_fp ~ '^[0-9a-f]{64}$'),
  field_key text check (field_key is null or field_key ~ '^[a-z_]{2,40}$'),
  field_sig text not null check (field_sig ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('filled', 'accepted', 'corrected', 'cleared', 'not_found', 'no_option', 'already_filled', 'unmatched')),
  correction_kind text check (correction_kind is null or correction_kind in ('other_option', 'value_edited', 'cleared')),
  corrected_option_folded text check (corrected_option_folded is null or length(corrected_option_folded) <= 60),
  value_key text check (value_key is null or value_key ~ '^[a-z0-9 ]{1,40}$'),
  value_category text check (value_category is null or value_category in ('format', 'rewritten')),
  phase text not null check (phase in ('filled', 'checked', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, field_sig)
);
create index if not exists idx_portal_fill_events_tenant on public.portal_fill_events (tenant_id, created_at desc);
create index if not exists idx_portal_fill_events_portal on public.portal_fill_events (portal, field_key, created_at desc);

-- ---------------------------------------------------------------------------------------------------------------------
-- Tetikleyiciler
-- ---------------------------------------------------------------------------------------------------------------------
-- Yayinlanan set degismez: icerik/sha/imza/surum/portal/tur ayni kalir; yalniz published -> superseded gecisi serbest.
create or replace function public.pt_rule_sets_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then
      raise exception 'Yayinlanmis kural seti silinemez.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.published_at is not null or old.status in ('published', 'superseded') then
    if new.content is distinct from old.content or new.content_sha256 is distinct from old.content_sha256
       or new.signature is distinct from old.signature or new.kid is distinct from old.kid
       or new.version is distinct from old.version or new.portal is distinct from old.portal
       or new.kind is distinct from old.kind or new.expires_at is distinct from old.expires_at
       or new.published_at is distinct from old.published_at then
      raise exception 'Yayinlanmis kural setinin icerigi degistirilemez; yeni surum yayinlayin.' using errcode = '42501';
    end if;
    if new.status <> old.status and not (old.status = 'published' and new.status = 'superseded') then
      raise exception 'Gecersiz kural seti durum gecisi: % -> %', old.status, new.status using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_portal_rule_sets_immutable on public.portal_rule_sets;
create trigger trg_portal_rule_sets_immutable
  before update or delete on public.portal_rule_sets
  for each row execute function public.pt_rule_sets_immutable();

drop trigger if exists trg_block_readonly_identity_writes on public.portal_form_reports;
create trigger trg_block_readonly_identity_writes
  before insert or update or delete on public.portal_form_reports
  for each row execute function public.block_readonly_identity_writes();
drop trigger if exists trg_block_readonly_identity_writes on public.portal_fill_events;
create trigger trg_block_readonly_identity_writes
  before insert or update or delete on public.portal_fill_events
  for each row execute function public.block_readonly_identity_writes();

-- ---------------------------------------------------------------------------------------------------------------------
-- RLS + GRANT
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.portal_rule_sets enable row level security;
alter table public.portal_rule_proposals enable row level security;
alter table public.portal_rule_votes enable row level security;
alter table public.portal_rule_tenant_trust enable row level security;
alter table public.portal_form_fields enable row level security;
alter table public.portal_form_versions enable row level security;
alter table public.portal_form_reports enable row level security;
alter table public.portal_fill_events enable row level security;

drop policy if exists portal_rule_sets_select on public.portal_rule_sets;
create policy portal_rule_sets_select on public.portal_rule_sets for select to authenticated
  using ((select public.pt_rules_is_operator()));
drop policy if exists portal_rule_proposals_select on public.portal_rule_proposals;
create policy portal_rule_proposals_select on public.portal_rule_proposals for select to authenticated
  using ((select public.pt_rules_is_operator()));
drop policy if exists portal_rule_votes_select on public.portal_rule_votes;
create policy portal_rule_votes_select on public.portal_rule_votes for select to authenticated
  using ((select public.pt_rules_is_operator()));
drop policy if exists portal_rule_tenant_trust_select on public.portal_rule_tenant_trust;
create policy portal_rule_tenant_trust_select on public.portal_rule_tenant_trust for select to authenticated
  using ((select public.pt_rules_is_operator()));
drop policy if exists portal_form_fields_select on public.portal_form_fields;
create policy portal_form_fields_select on public.portal_form_fields for select to authenticated
  using ((select public.pt_rules_is_operator()));
drop policy if exists portal_form_versions_select on public.portal_form_versions;
create policy portal_form_versions_select on public.portal_form_versions for select to authenticated
  using ((select public.pt_rules_is_operator()));

drop policy if exists portal_form_reports_select on public.portal_form_reports;
create policy portal_form_reports_select on public.portal_form_reports for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('portals', 'view'))
  and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
);
drop policy if exists portal_fill_events_select on public.portal_fill_events;
create policy portal_fill_events_select on public.portal_fill_events for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('portals', 'view'))
  and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
);

revoke all on table public.portal_rule_sets, public.portal_rule_proposals, public.portal_rule_votes,
  public.portal_rule_tenant_trust, public.portal_form_fields, public.portal_form_versions,
  public.portal_form_reports, public.portal_fill_events
  from public, anon, authenticated;
grant select on table public.portal_rule_sets, public.portal_rule_proposals, public.portal_rule_votes,
  public.portal_rule_tenant_trust, public.portal_form_fields, public.portal_form_versions,
  public.portal_form_reports, public.portal_fill_events
  to authenticated;
grant all on table public.portal_rule_sets, public.portal_rule_proposals, public.portal_rule_votes,
  public.portal_rule_tenant_trust, public.portal_form_fields, public.portal_form_versions,
  public.portal_form_reports, public.portal_fill_events
  to service_role;

notify pgrst, 'reload schema';
