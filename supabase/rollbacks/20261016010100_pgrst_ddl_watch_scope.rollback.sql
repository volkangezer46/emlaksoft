-- Geri alma: 20261016010100_pgrst_ddl_watch_scope.sql
-- extensions.pgrst_ddl_watch / pgrst_drop_watch Supabase'in özgün gövdesine döner (her şemadaki DDL yeniden yükler).
-- Migration gibi YALNIZ fonksiyon sahibi (supabase_admin) ya da süper kullanıcı ile etkilidir; aksi halde NOTICE ve no-op.
-- Sunucuda: docker exec -i supabase-db-... psql -U supabase_admin -d postgres -1 -v ON_ERROR_STOP=1 < bu dosya. Veri değişmez.
set local lock_timeout = '5s';

do $outer$
declare
  v_owner_ok boolean;
begin
  if pg_catalog.to_regprocedure('extensions.pgrst_ddl_watch()') is null
     or pg_catalog.to_regprocedure('extensions.pgrst_drop_watch()') is null then
    return;
  end if;
  select bool_and(pg_catalog.pg_has_role(current_user, p.proowner, 'USAGE'))
         or coalesce((select r.rolsuper from pg_catalog.pg_roles r where r.rolname = current_user), false)
    into v_owner_ok
    from pg_catalog.pg_proc p
   where p.oid in ('extensions.pgrst_ddl_watch()'::regprocedure, 'extensions.pgrst_drop_watch()'::regprocedure);
  if not coalesce(v_owner_ok, false) then
    raise notice 'rollback 20261016010100: % pgrst_*_watch sahibi degil; supabase_admin ile calistirin.', current_user;
    return;
  end if;

  execute $ddl$
    create or replace function extensions.pgrst_ddl_watch()
    returns event_trigger
    language plpgsql
    as $f$
    declare
      cmd record;
    begin
      for cmd in select * from pg_event_trigger_ddl_commands()
      loop
        if cmd.command_tag in (
          'CREATE SCHEMA', 'ALTER SCHEMA'
        , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
        , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
        , 'CREATE VIEW', 'ALTER VIEW'
        , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
        , 'CREATE FUNCTION', 'ALTER FUNCTION'
        , 'CREATE TRIGGER'
        , 'CREATE TYPE', 'ALTER TYPE'
        , 'CREATE RULE'
        , 'COMMENT'
        )
        and cmd.schema_name is distinct from 'pg_temp'
        then
          notify pgrst, 'reload schema';
        end if;
      end loop;
    end;
    $f$
  $ddl$;

  execute $ddl$
    create or replace function extensions.pgrst_drop_watch()
    returns event_trigger
    language plpgsql
    as $f$
    declare
      obj record;
    begin
      for obj in select * from pg_event_trigger_dropped_objects()
      loop
        if obj.object_type in (
          'schema'
        , 'table'
        , 'foreign table'
        , 'view'
        , 'materialized view'
        , 'function'
        , 'trigger'
        , 'type'
        , 'rule'
        )
        and obj.is_temporary is false
        then
          notify pgrst, 'reload schema';
        end if;
      end loop;
    end;
    $f$
  $ddl$;

  execute $ddl$ comment on function extensions.pgrst_ddl_watch() is null $ddl$;
end
$outer$;
