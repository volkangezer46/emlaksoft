-- MIGRATION 20260825000200 (2026-10-05 terfi; eski taslak adı proposed/20261005000600_geo_central_management.sql).
-- UYGULANMADI: yalnız restore edilebilir backup/PITR doğrulandıktan sonra SAHİBİ
-- `npm run db:migrate -- --only 20260825000200_geo_central_management.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260825000200_geo_central_management.rollback.sql (sürüm/alias/bildirim verisi silinir).
-- Terfi düzeltmesi: geo_change_requests INSERT politikası durum/çözüm alanlarını kilitler (ofis üyesi 'approved'
-- durumunda ya da başkası adına bildirim yazamaz; kod insert'i bu alanları göndermez → davranış değişmez).
--
-- COĞRAFYA TEK MERKEZ YÖNETİMİ.
--
-- Amaç: il/ilçe/mahalle verisini admin panelinden TAM yönetilebilir yapmak:
--   * sürüm kaydı (geo_data_versions): kim, ne zaman, hangi kaynak, fark özeti, geri alma bilgisi
--   * alias / yazım varyantı / eski ad (geo_aliases, valid_to)
--   * ofis "eksik/yanlış mahalle bildir" kuyruğu (geo_change_requests, tenant RLS)
--   * kullanım sayısı + birleştirme + taşıma RPC'leri (FK kataloğundan dinamik: yeni FK eklenince
--     kod değişmeden kapsanır)
--
-- GÜVENLİK: geo_* tabloları GLOBAL veridir (tenant_id yok). Okuma authenticated (aliases) ya da
-- yalnız service_role (versions, RPC'ler). Yazma yalnız service_role (admin paneli server action'ları).
-- Ofis verisi (geo_change_requests) tenant_id + RLS ile ayrıdır.
-- SİLME YOK: birleştirilen/pasife alınan kayıt tabloda kalır (is_active=false); referanslar kırılmaz.
-- UYGULAMA ÖNCESİ: backup/PITR doğrulaması + `npm run check:migrations -- --database`.
-- Tablolar/sütunlar yokken uygulama bugünkü gibi çalışır (okuyucular yalnız mevcut sütunları seçer).

-- ===== Ek sütunlar (nullable, geriye uyumlu) =====
alter table public.geo_provinces
  add column if not exists description text,
  add column if not exists deactivated_at timestamptz,
  add column if not exists source text,
  add column if not exists version_id uuid;
alter table public.geo_districts
  add column if not exists description text,
  add column if not exists deactivated_at timestamptz,
  add column if not exists source text,
  add column if not exists version_id uuid;
alter table public.geo_neighborhoods
  add column if not exists description text,
  add column if not exists deactivated_at timestamptz,
  add column if not exists source text,
  add column if not exists version_id uuid;

-- Serbest metin il alanlarına karşılık gelen nullable kimlik sütunları (uygulanmayan kayıt bozulmaz).
alter table public.demo_requests
  add column if not exists province_id uuid references public.geo_provinces(id),
  add column if not exists district_id uuid references public.geo_districts(id);

-- ===== Sürümler =====
create table if not exists public.geo_data_versions (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'import'
    check (kind in ('import', 'manual', 'merge', 'move', 'rollback')),
  source text,
  source_version text,
  source_date date,
  file_name text,
  mode text check (mode is null or mode in ('merge', 'full')),
  actor_id uuid references public.platform_staff(id) on delete set null,
  actor_label text,
  summary jsonb not null default '{}'::jsonb,
  -- Geri alma bilgisi: { inserted: {province:[id],...}, updated:[{level,id,before}], deactivated:[{level,id}], ... }
  changes jsonb not null default '{}'::jsonb,
  status text not null default 'applied' check (status in ('applied', 'rolled_back', 'failed')),
  rolled_back_at timestamptz,
  rolled_back_by uuid references public.platform_staff(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_geo_data_versions_created on public.geo_data_versions (created_at desc);
alter table public.geo_data_versions enable row level security;
-- politika yok: yalnız service_role (RLS'i atlar) okur/yazar.
revoke all on public.geo_data_versions from anon, authenticated;
grant select, insert, update on public.geo_data_versions to service_role;

-- ===== Alias / eski ad / yazım varyantı =====
create table if not exists public.geo_aliases (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('province', 'district', 'neighborhood')),
  entity_id uuid not null,
  alias text not null check (char_length(alias) between 1 and 160),
  alias_key text not null,
  kind text not null default 'variant' check (kind in ('old_name', 'variant', 'merged')),
  valid_to date,
  version_id uuid references public.geo_data_versions(id) on delete set null,
  created_by uuid references public.platform_staff(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (level, entity_id, alias_key)
);
create index if not exists idx_geo_aliases_key on public.geo_aliases (level, alias_key);
alter table public.geo_aliases enable row level security;
drop policy if exists geo_aliases_read on public.geo_aliases;
create policy geo_aliases_read on public.geo_aliases for select to authenticated using (true);
grant select on public.geo_aliases to authenticated;
grant select, insert, update, delete on public.geo_aliases to service_role;

-- ===== Ofis düzeltme bildirimleri =====
create table if not exists public.geo_change_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  kind text not null default 'missing' check (kind in ('missing', 'wrong')),
  province_id uuid references public.geo_provinces(id),
  district_id uuid references public.geo_districts(id),
  neighborhood_id uuid references public.geo_neighborhoods(id),
  proposed_name text not null check (char_length(proposed_name) between 2 and 160),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  resolution_note text,
  resolved_by uuid references public.platform_staff(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_geo_change_requests_status on public.geo_change_requests (status, created_at desc);
create index if not exists idx_geo_change_requests_tenant on public.geo_change_requests (tenant_id);
alter table public.geo_change_requests enable row level security;
drop policy if exists geo_change_requests_select on public.geo_change_requests;
create policy geo_change_requests_select on public.geo_change_requests
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists geo_change_requests_insert on public.geo_change_requests;
create policy geo_change_requests_insert on public.geo_change_requests
  for insert with check (
    tenant_id = public.current_tenant_id()
    and (requested_by is null or requested_by = (select auth.uid()))
    and status = 'pending'
    and resolved_by is null
    and resolved_at is null
    and resolution_note is null
  );
grant select, insert on public.geo_change_requests to authenticated;
grant select, insert, update on public.geo_change_requests to service_role;

-- ===== Kullanım sayımı (FK kataloğundan dinamik) =====
-- geo_usage_counts: bir kaydı hangi tabloda kaç satır kullanıyor (alt coğrafya kayıtları dahil).
create or replace function public.geo_usage_counts(p_level text, p_id uuid)
returns table (table_name text, column_name text, n bigint)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  target regclass;
  rec record;
  cnt bigint;
begin
  target := case p_level
    when 'province' then 'public.geo_provinces'::regclass
    when 'district' then 'public.geo_districts'::regclass
    when 'neighborhood' then 'public.geo_neighborhoods'::regclass
    else null end;
  if target is null then raise exception 'geo_usage_counts: gecersiz seviye'; end if;
  for rec in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = target and array_length(c.conkey, 1) = 1
    order by 1, 2
  loop
    execute format('select count(*) from %s where %I = $1', rec.tbl, rec.col) into cnt using p_id;
    if cnt > 0 then
      table_name := regexp_replace(rec.tbl, '^public\.', '');
      column_name := rec.col;
      n := cnt;
      return next;
    end if;
  end loop;
end;
$$;

-- geo_usage_totals: liste ekranı için kayıt başına kullanım (tek çağrı). Aynı kimlik birden çok tabloda
-- geçebilir; çağıran taraf satırları kimliğe göre toplar.
create or replace function public.geo_usage_totals(p_level text, p_ids uuid[])
returns table (id uuid, n bigint)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  target regclass;
  rec record;
begin
  target := case p_level
    when 'province' then 'public.geo_provinces'::regclass
    when 'district' then 'public.geo_districts'::regclass
    when 'neighborhood' then 'public.geo_neighborhoods'::regclass
    else null end;
  if target is null then raise exception 'geo_usage_totals: gecersiz seviye'; end if;
  for rec in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = target and array_length(c.conkey, 1) = 1
  loop
    return query execute format('select %I, count(*)::bigint from %s where %I = any($1) group by 1', rec.col, rec.tbl, rec.col) using p_ids;
  end loop;
end;
$$;

-- geo_usage_rows: sayıya tıklayınca filtreli liste (yalnız FK ile bağlı tablolar).
create or replace function public.geo_usage_rows(p_level text, p_id uuid, p_table text, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  target regclass;
  rec record;
  out jsonb;
begin
  target := case p_level
    when 'province' then 'public.geo_provinces'::regclass
    when 'district' then 'public.geo_districts'::regclass
    when 'neighborhood' then 'public.geo_neighborhoods'::regclass
    else null end;
  if target is null then raise exception 'geo_usage_rows: gecersiz seviye'; end if;
  for rec in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = target and array_length(c.conkey, 1) = 1
      and regexp_replace(c.conrelid::regclass::text, '^public\.', '') = p_table
  loop
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''id'', r.j->>''id'', ''tenant_id'', r.j->>''tenant_id'', ''label'', coalesce(r.j->>''title'', r.j->>''name'', r.j->>''full_name'', r.j->>''id''), ''created_at'', r.j->>''created_at'')), ''[]''::jsonb) '
      'from (select to_jsonb(t) as j from %s t where t.%I = $1 limit $2) r', rec.tbl, rec.col)
      into out using p_id, least(greatest(p_limit, 1), 200);
    return coalesce(out, '[]'::jsonb);
  end loop;
  return '[]'::jsonb;
end;
$$;

-- ===== Birleştirme (A -> B): referanslar TEK işlemde taşınır =====
-- Yalnız ilçe ve mahalle. Eski kayıt silinmez: alias olarak B'ye eklenir, A pasife alınır.
-- Geri alma bilgisi (hangi tablodan hangi satırlar taşındı) sürüm kaydına yazılır.
create or replace function public.geo_merge(p_level text, p_from uuid, p_to uuid, p_actor uuid, p_actor_label text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target regclass;
  rec record;
  moved jsonb := '[]'::jsonb;
  ids uuid[];
  has_id boolean;
  from_name text;
  to_name text;
  to_parent uuid;
  to_grand uuid;
  vid uuid;
  total bigint := 0;
begin
  if p_level not in ('district', 'neighborhood') then raise exception 'geo_merge: yalniz ilce ve mahalle'; end if;
  if p_from = p_to then raise exception 'geo_merge: ayni kayit'; end if;
  target := case p_level when 'district' then 'public.geo_districts'::regclass else 'public.geo_neighborhoods'::regclass end;

  if p_level = 'district' then
    select name, province_id into from_name, to_parent from geo_districts where id = p_from;
    select name, province_id into to_name, to_parent from geo_districts where id = p_to;
    if from_name is null or to_name is null then raise exception 'geo_merge: kayit bulunamadi'; end if;
  else
    select name into from_name from geo_neighborhoods where id = p_from;
    select name, district_id into to_name, to_parent from geo_neighborhoods where id = p_to;
    if from_name is null or to_name is null then raise exception 'geo_merge: kayit bulunamadi'; end if;
    select province_id into to_grand from geo_districts where id = to_parent;
  end if;

  insert into geo_data_versions (kind, source, actor_id, actor_label, summary)
  values ('merge', 'manual', p_actor, p_actor_label,
          jsonb_build_object('level', p_level, 'from', p_from, 'to', p_to, 'from_name', from_name, 'to_name', to_name))
  returning id into vid;

  for rec in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = target and array_length(c.conkey, 1) = 1
  loop
    select exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = regexp_replace(rec.tbl, '^public\.', '') and column_name = 'id')
      into has_id;
    if has_id then
      execute format('with u as (update %s set %I = $1 where %I = $2 returning id) select array_agg(id) from u', rec.tbl, rec.col, rec.col)
        into ids using p_to, p_from;
    else
      execute format('update %s set %I = $1 where %I = $2', rec.tbl, rec.col, rec.col) using p_to, p_from;
      ids := null;
    end if;
    if ids is not null then
      total := total + array_length(ids, 1);
      moved := moved || jsonb_build_object('table', rec.tbl, 'column', rec.col, 'ids', to_jsonb(ids));
    end if;
  end loop;

  -- Mahalle birleşiminde, hedef mahalleye geçen kayıtların ilçe/il sütunları da hedefle tutarlı olmalı.
  if p_level = 'neighborhood' then
    for rec in
      select distinct c.conrelid::regclass::text as tbl
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = target and array_length(c.conkey, 1) = 1
        and c.conrelid::regclass::text not like '%geo_%'
    loop
      if exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = regexp_replace(rec.tbl, '^public\.', '') and column_name = 'district_id') then
        execute format('update %s set district_id = $1 where neighborhood_id = $2 and district_id is distinct from $1', rec.tbl) using to_parent, p_to;
      end if;
      if exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = regexp_replace(rec.tbl, '^public\.', '') and column_name = 'province_id') then
        execute format('update %s set province_id = $1 where neighborhood_id = $2 and province_id is distinct from $1', rec.tbl) using to_grand, p_to;
      end if;
    end loop;
  end if;

  insert into geo_aliases (level, entity_id, alias, alias_key, kind, version_id, created_by)
  values (p_level, p_to, from_name,
          lower(translate(from_name, 'İIıŞşĞğÜüÖöÇç', 'iiisSgguuoocc')), 'merged', vid, p_actor)
  on conflict (level, entity_id, alias_key) do nothing;

  if p_level = 'district' then
    update geo_districts set is_active = false, deactivated_at = now(), version_id = vid where id = p_from;
  else
    update geo_neighborhoods set is_active = false, deactivated_at = now(), version_id = vid where id = p_from;
  end if;

  update geo_data_versions
     set changes = jsonb_build_object('level', p_level, 'from', p_from, 'to', p_to, 'moved', moved),
         summary = summary || jsonb_build_object('moved_rows', total)
   where id = vid;

  return jsonb_build_object('version_id', vid, 'moved_rows', total);
exception
  when unique_violation then
    raise exception 'geo_merge_conflict: hedefte ayni ada/anahtara sahip kayit var (%)', sqlerrm;
end;
$$;

-- Birleştirmeyi geri al: taşınan satırlar eski kimliğe döner, kaynak yeniden etkinleşir, alias silinir.
create or replace function public.geo_merge_undo(p_version uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v record;
  m jsonb;
  ids uuid[];
  lvl text;
  restored bigint := 0;
begin
  select * into v from geo_data_versions where id = p_version and kind = 'merge' and status = 'applied' for update;
  if not found then raise exception 'geo_merge_undo: uygulanmis birlestirme surumu bulunamadi'; end if;
  lvl := v.changes->>'level';
  for m in select * from jsonb_array_elements(v.changes->'moved') loop
    select array_agg(x::uuid) into ids from jsonb_array_elements_text(m->'ids') x;
    execute format('update %s set %I = $1 where id = any($2)', m->>'table', m->>'column')
      using (v.changes->>'from')::uuid, ids;
    restored := restored + coalesce(array_length(ids, 1), 0);
  end loop;
  if lvl = 'district' then
    update geo_districts set is_active = true, deactivated_at = null where id = (v.changes->>'from')::uuid;
  else
    update geo_neighborhoods set is_active = true, deactivated_at = null where id = (v.changes->>'from')::uuid;
  end if;
  delete from geo_aliases where version_id = p_version;
  update geo_data_versions set status = 'rolled_back', rolled_back_at = now(), rolled_back_by = p_actor where id = p_version;
  return jsonb_build_object('restored_rows', restored);
end;
$$;

-- ===== Taşıma (mahalle -> başka ilçe, ilçe -> başka il) =====
-- Bağlı kayıtların denormalize ilçe/il sütunları aynı işlemde güncellenir.
create or replace function public.geo_move(p_level text, p_id uuid, p_new_parent uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  rec record;
  new_prov uuid;
  n bigint := 0;
  c bigint;
begin
  if p_level = 'neighborhood' then
    select province_id into new_prov from geo_districts where id = p_new_parent;
    if new_prov is null then raise exception 'geo_move: hedef ilce bulunamadi'; end if;
    update geo_neighborhoods set district_id = p_new_parent where id = p_id;
    for rec in
      select distinct c2.conrelid::regclass::text as tbl
      from pg_constraint c2
      join pg_attribute a on a.attrelid = c2.conrelid and a.attnum = c2.conkey[1]
      where c2.contype = 'f' and c2.confrelid = 'public.geo_neighborhoods'::regclass
        and array_length(c2.conkey, 1) = 1 and c2.conrelid::regclass::text not like '%geo_%'
    loop
      if exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = regexp_replace(rec.tbl, '^public\.', '') and column_name = 'district_id') then
        execute format('update %s set district_id = $1 where neighborhood_id = $2', rec.tbl) using p_new_parent, p_id;
        get diagnostics c = row_count; n := n + c;
      end if;
      if exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = regexp_replace(rec.tbl, '^public\.', '') and column_name = 'province_id') then
        execute format('update %s set province_id = $1 where neighborhood_id = $2', rec.tbl) using new_prov, p_id;
      end if;
    end loop;
  elsif p_level = 'district' then
    if not exists (select 1 from geo_provinces where id = p_new_parent) then raise exception 'geo_move: hedef il bulunamadi'; end if;
    update geo_districts set province_id = p_new_parent where id = p_id;
    for rec in
      select distinct c2.conrelid::regclass::text as tbl
      from pg_constraint c2
      join pg_attribute a on a.attrelid = c2.conrelid and a.attnum = c2.conkey[1]
      where c2.contype = 'f' and c2.confrelid = 'public.geo_districts'::regclass
        and array_length(c2.conkey, 1) = 1 and c2.conrelid::regclass::text not like '%geo_%'
    loop
      if exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = regexp_replace(rec.tbl, '^public\.', '') and column_name = 'province_id') then
        execute format('update %s set province_id = $1 where district_id = $2', rec.tbl) using p_new_parent, p_id;
        get diagnostics c = row_count; n := n + c;
      end if;
    end loop;
  else
    raise exception 'geo_move: gecersiz seviye';
  end if;
  return jsonb_build_object('updated_rows', n);
exception
  when unique_violation then
    raise exception 'geo_move_conflict: hedefte ayni ada sahip kayit var';
end;
$$;

-- ===== Yetki: yalnız service_role çağırır =====
revoke execute on function public.geo_usage_counts(text, uuid) from public, anon, authenticated;
revoke execute on function public.geo_usage_totals(text, uuid[]) from public, anon, authenticated;
revoke execute on function public.geo_usage_rows(text, uuid, text, int) from public, anon, authenticated;
revoke execute on function public.geo_merge(text, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.geo_merge_undo(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.geo_move(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.geo_usage_counts(text, uuid) to service_role;
grant execute on function public.geo_usage_totals(text, uuid[]) to service_role;
grant execute on function public.geo_usage_rows(text, uuid, text, int) to service_role;
grant execute on function public.geo_merge(text, uuid, uuid, uuid, text) to service_role;
grant execute on function public.geo_merge_undo(uuid, uuid) to service_role;
grant execute on function public.geo_move(text, uuid, uuid) to service_role;
