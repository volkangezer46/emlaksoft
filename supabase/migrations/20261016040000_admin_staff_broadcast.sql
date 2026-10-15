-- MIGRATION 20261016040000_admin_staff_broadcast.sql
-- SK4 / B006 (2026-10-16): admin paneline canli veri. Personel kiraci RLS'ine girmedigi icin postgres_changes uygun degil;
--   bunun yerine Broadcast from Database (realtime.send) ile OZEL konulara yalniz kimlik iceren kucuk olay yazilir.
-- Geri alma: supabase/rollbacks/20261016040000_admin_staff_broadcast.rollback.sql
-- BAGIMLILIK: public.is_platform_staff() + public.growth_flag_on(text) (20260826000600), Supabase Realtime semasi
--   (realtime.send, realtime.topic, realtime.messages). Realtime semasi yoksa (yalin Postgres) politika adimi atlanir,
--   tetikleyiciler yine kurulur ve gonderim sessizce gecer (yazma ASLA bozulmaz).
--
-- KONULAR (ozel kanal, private=true):
--   'admin:staff'      <- support_tickets, support_ticket_messages, invoices, subscriptions, alert_events
--                         (DEYIM duzeyi tetikleyici: toplu guncelleme tek olay uretir)
--   'staff:<staff_id>' <- platform_notifications INSERT (SATIR duzeyi: alici personel basina tek olay)
-- YUK SOZLESMESI (SK2 kiraci olaylariyla ayni): {t, op, by, ids?}
--   t   : tablo adi; op: INSERT | UPDATE | DELETE; by: auth.uid() (service_role yazimlarinda null)
--   ids : etkilenen kayit kimlikleri (support_ticket_messages'ta BILET kimligi = ticket_id), en cok 50; yalniz TAMAMI
--         200 bayt butceye sigarsa eklenir (realtime.send'in ekledigi "id" dahil). ids yoksa istemci "cok kayit" sayar.
--   Kisisel veri (konu, govde, e-posta, tutar) YUKE GIRMEZ; istemci olayi alinca sayfayi sunucudan tazeler.
-- ERISIM: realtime.messages SELECT politikasi yalniz AKTIF platform personeline (impersonation oturumu haric,
--   platform.mfa_enforced acikken aal2) ve yalniz bu iki konu ailesine izin verir; baska politikalarla OR'lanir,
--   kiraci konularina dokunmaz.
-- Idempotent: fonksiyonlar create or replace, tetikleyiciler/politikalar drop if exists + create.
set local lock_timeout = '5s';

-- Ortak gonderici: realtime.send yoksa (yalin Postgres) ya da hata verirse yazma bozulmaz.
create or replace function public.rt_staff_send(p_payload jsonb, p_topic text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(p_payload, 'change', p_topic, true);
  exception when undefined_function or invalid_schema_name or undefined_table then
    null;
  end;
end;
$$;

revoke all on function public.rt_staff_send(jsonb, text) from public;
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.rt_staff_send(jsonb, text) from anon';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.rt_staff_send(jsonb, text) from authenticated';
  end if;
end $$;

-- Yuk kurucu (saf): ids yalniz tamami butceye sigarsa eklenir. 46 = realtime.send'in ekledigi `, "id": "<uuid>"`.
create or replace function public.rt_staff_payload(p_table text, p_op text, p_by uuid, p_ids text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_base jsonb := jsonb_build_object('t', p_table, 'op', p_op, 'by', p_by);
  v_full jsonb;
  v_ids text[] := coalesce(p_ids, array[]::text[]);
begin
  if cardinality(v_ids) between 1 and 50 then
    v_full := v_base || jsonb_build_object('ids', to_jsonb(v_ids));
    if octet_length(v_full::text) + 46 <= 200 then
      return v_full;
    end if;
  end if;
  return v_base;
end;
$$;

-- Deyim duzeyi: gecis tablosundan farkli kimlikler (TG_ARGV[0] = kimlik sutunu, varsayilan id). Satir yoksa olay yok.
create or replace function public.rt_emit_staff_change()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_col text := coalesce(nullif(tg_argv[0], ''), 'id');
  v_ids text[];
  v_n integer;
  v_by uuid;
begin
  if tg_op = 'DELETE' then
    execute format('select array_agg(distinct (r.%I)::text), count(*) from rt_old_rows r', v_col) into v_ids, v_n;
  else
    execute format('select array_agg(distinct (r.%I)::text), count(*) from rt_new_rows r', v_col) into v_ids, v_n;
  end if;
  if coalesce(v_n, 0) = 0 then
    return null;
  end if;
  begin
    v_by := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  exception when others then
    v_by := null;
  end;
  if v_by is null then
    begin
      v_by := nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid;
    exception when others then
      v_by := null;
    end;
  end if;
  perform public.rt_staff_send(
    public.rt_staff_payload(tg_table_name, tg_op, v_by, case when cardinality(v_ids) <= 50 then v_ids end),
    'admin:staff'
  );
  return null;
end;
$$;

-- Satir duzeyi: alici personelin kendi konusuna tek olay.
create or replace function public.rt_emit_staff_notification()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.staff_id is not null then
    perform public.rt_staff_send(
      public.rt_staff_payload(tg_table_name, tg_op, null, array[new.id::text]),
      'staff:' || new.staff_id::text
    );
  end if;
  return null;
end;
$$;

revoke all on function public.rt_emit_staff_change() from public;
revoke all on function public.rt_emit_staff_notification() from public;

-- Tetikleyiciler (tablo yoksa atlanir). Her tablo icin uc deyim tetikleyicisi: gecis tablosu olay basina tek tanim.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('support_tickets', 'id'),
      ('support_ticket_messages', 'ticket_id'),
      ('invoices', 'id'),
      ('subscriptions', 'id'),
      ('alert_events', 'id')
    ) as v(tbl, col)
  loop
    if pg_catalog.to_regclass('public.' || r.tbl) is null then
      raise notice 'SK4 B006: public.% yok, tetikleyici atlandi', r.tbl;
      continue;
    end if;
    execute format('drop trigger if exists rt_staff_ins on public.%I', r.tbl);
    execute format('drop trigger if exists rt_staff_upd on public.%I', r.tbl);
    execute format('drop trigger if exists rt_staff_del on public.%I', r.tbl);
    execute format(
      'create trigger rt_staff_ins after insert on public.%I referencing new table as rt_new_rows '
      'for each statement execute function public.rt_emit_staff_change(%L)', r.tbl, r.col);
    execute format(
      'create trigger rt_staff_upd after update on public.%I referencing new table as rt_new_rows '
      'for each statement execute function public.rt_emit_staff_change(%L)', r.tbl, r.col);
    execute format(
      'create trigger rt_staff_del after delete on public.%I referencing old table as rt_old_rows '
      'for each statement execute function public.rt_emit_staff_change(%L)', r.tbl, r.col);
  end loop;

  if pg_catalog.to_regclass('public.platform_notifications') is not null then
    execute 'drop trigger if exists rt_staff_notify on public.platform_notifications';
    execute 'create trigger rt_staff_notify after insert on public.platform_notifications '
      'for each row execute function public.rt_emit_staff_notification()';
  end if;
end $$;

-- Ozel konu erisimi: yalniz aktif personel; 'admin:staff' ortak, 'staff:<uid>' yalniz kendi kimligi.
do $$
begin
  if pg_catalog.to_regclass('realtime.messages') is null then
    raise notice 'SK4 B006: realtime.messages yok, politika adimi atlandi';
    return;
  end if;
  execute 'drop policy if exists rt_admin_staff_read on realtime.messages';
  execute 'drop policy if exists rt_staff_self_read on realtime.messages';
  execute $p$
    create policy rt_admin_staff_read on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension in ('broadcast')
        and (select realtime.topic()) = 'admin:staff'
        and (select public.is_platform_staff())
        and (select not public.growth_flag_on('platform.mfa_enforced') or (auth.jwt() ->> 'aal') = 'aal2')
      )
  $p$;
  execute $p$
    create policy rt_staff_self_read on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension in ('broadcast')
        and (select realtime.topic()) = 'staff:' || (select auth.uid())::text
        and (select public.is_platform_staff())
        and (select not public.growth_flag_on('platform.mfa_enforced') or (auth.jwt() ->> 'aal') = 'aal2')
      )
  $p$;
end $$;
