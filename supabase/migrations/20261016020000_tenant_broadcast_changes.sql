-- MIGRATION 20261016020000_tenant_broadcast_changes.sql
-- SK2 REALTIME-1: ofis ekranlarinda canli veri DEYIM DUZEYINDE Broadcast ile (postgres_changes yerine).
-- Geri alma: supabase/rollbacks/20261016020000_tenant_broadcast_changes.rollback.sql
-- Test (golge, CANLIYA DEGIL): supabase/tests/sk2_tenant_broadcast.test.sql
--
-- NEDEN (saha olcumu 2026-10-15, bulgular B002/B014/B015):
--   * postgres_changes her abonelik icin WAL'i realtime.list_changes ile yokluyordu: DB yurutme suresinin %37-39'u.
--   * Olay yuku tum satiri tasiyordu (customers 2,7 KB / 31 alan, properties 4,3 KB / 50 alan; telefon, e-posta dahil).
--   * 17 tablo tek kanalda: bir tablonun baglama hatasi tum kanali dusuruyordu.
-- NE:
--   (1) public.rt_emit_tenant_change(): AFTER INSERT/UPDATE/DELETE FOR EACH STATEMENT, gecis tablolariyla (REFERENCING
--       NEW/OLD TABLE). Deyim basina, deyimin dokundugu her ofis icin TEK mesaj: konu 'tenant:<tenant_id>', olay 'change',
--       yuk {t, op, ids (en cok 50), r (ust kimlik, detay suzgeci), by (auth.uid())}; 50'den fazla satirda
--       {t, op, bulk:true}. KISISEL VERI YOK (yalniz kimlikler). realtime.send ozel (private) kanala yazar.
--       Tetikleyici argumanlari: [0] ust kimlik kolonu (customer_id / deal_id / ticket_id; detay rotasi suzgeci),
--       [1] mod: 'tenant' (satirin tenant_id'si) | 'ticket' (tenant_id support_tickets'tan; ic not 'internal' gitmez) |
--       'public_only' (visibility='internal' satir gitmez), [2] UPDATE'te gurultu sayilmayan kolonlar (virgullu; ornek
--       profiles.ui_state / public_view_count: yalniz bunlar degistiyse mesaj gitmez).
--   (2) public.rt_emit_notification(): notifications INSERT SATIR duzeyinde. Kisisel bildirim (user_id dolu) alicinin
--       KENDI alanlariyla 'inbox:<user_id>' konusuna (olay 'notification'; yuk NotificationInsertRow); ortak bildirim
--       (user_id bos) 'tenant:<tenant_id>' konusuna YALNIZ kimlikle ({id}); istemci satiri RLS'li okur (sozlesme j).
--   (3) realtime.messages SELECT politikalari: 'tenant:' konusu = current_tenant_id(), 'inbox:' konusu = auth.uid().
--       realtime.messages'in sahibi supabase_realtime_admin'dir; Supabase'te `postgres` superuser DEGIL ve bu role uye
--       degil (canli salt-okunur kontrol 2026-10-16). Migration rolu politika kuramiyorsa adim ATLANIR ve NOTICE yazilir;
--       canlida supabase_admin ile scripts/sunucu/realtime-policies.sql calistirilir (YAYIN NOTU, ZORUNLU: politika
--       yokken ozel kanal katilimi reddedilir, istemci geri cekilmeyle yeniden dener ve 'Canli baglanti yok' gosterir).
-- KAPSAM (31 tablo): mevcut yayin tablolari (21; notifications satir duzeyinde) + approval_requests, targets, calls,
--   communications, deal_notes, contracts, support_tickets, profiles, branches, teams. Istemci tablo listesi tek kaynak:
--   src/lib/realtime-throttle.ts (BROADCAST_TABLES; sozlesme testi bu dosyanin listesiyle iki yonlu esler).
-- MALIYET: deyim basina bir dinamik toplama sorgusu + en cok (ofis sayisi kadar) realtime.messages satiri. Bos deyim
--   (0 satir) mesaj uretmez; ucuz bos kontrolu statik sorguyla yapilir (FK basamakli silmelerde cok sayida bos deyim).
--   Tetikleyici HATASI kullanici yazimini ASLA dusurmez (ic blok WARNING'e cevirir).
-- IDEMPOTENT: fonksiyonlar create or replace, tetikleyiciler drop if exists + create, politikalar drop if exists + create.
-- BAGIMLILIK: realtime.send (Realtime servisi migration'lari); yoksa (yalin Postgres/golge) cagri calisma aninda WARNING
--   verir, yazim etkilenmez.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- (1) Deyim duzeyinde ofis degisikligi
-- ---------------------------------------------------------------------------
create or replace function public.rt_emit_tenant_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text := nullif(tg_argv[0], '');
  v_mode text := coalesce(nullif(tg_argv[1], ''), 'tenant');
  v_ignore text[] := case when coalesce(tg_argv[2], '') = '' then null else string_to_array(tg_argv[2], ',') end;
  v_rel text := case when tg_op = 'DELETE' then 'rt_old' else 'rt_new' end;
  v_tenant text := 't.tenant_id';
  v_from text;
  v_where text;
  v_refs text;
  v_by uuid;
  r record;
begin
  begin
    -- Ucuz bos kontrolu (dinamik SQL'den once): FK basamakli islemler cok sayida 0 satirli deyim atar.
    if tg_op = 'DELETE' then
      perform 1 from rt_old limit 1;
    else
      perform 1 from rt_new limit 1;
    end if;
    if not found then
      return null;
    end if;

    v_by := auth.uid();
    v_from := pg_catalog.format('%I t', v_rel);
    if v_mode = 'ticket' then
      v_from := v_from || ' join public.support_tickets st on st.id = t.ticket_id';
      v_tenant := 'st.tenant_id';
    end if;
    v_where := v_tenant || ' is not null';
    if v_mode in ('ticket', 'public_only') then
      v_where := v_where || ' and coalesce(t.visibility, ''public'') <> ''internal''';
    end if;
    if tg_op = 'UPDATE' and v_ignore is not null then
      v_from := v_from || ' join rt_old o on o.id = t.id';
      v_where := v_where || pg_catalog.format(
        ' and (pg_catalog.to_jsonb(t) - %1$L::text[]) is distinct from (pg_catalog.to_jsonb(o) - %1$L::text[])', v_ignore);
    end if;
    v_refs := case
      when v_ref is null then 'null::uuid[]'
      else pg_catalog.format('(array_agg(distinct t.%1$I) filter (where t.%1$I is not null))[1:50]', v_ref)
    end;

    for r in execute pg_catalog.format(
      'select %1$s as tenant_id, count(*)::int as n, (array_agg(t.id))[1:50] as ids, %2$s as refs'
      ' from %3$s where %4$s group by 1',
      v_tenant, v_refs, v_from, v_where)
    loop
      perform realtime.send(
        case
          when r.n > 50 then pg_catalog.jsonb_build_object('t', tg_table_name, 'op', tg_op, 'bulk', true)
          else pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            't', tg_table_name, 'op', tg_op, 'ids', pg_catalog.to_jsonb(r.ids), 'r', pg_catalog.to_jsonb(r.refs), 'by', v_by))
        end,
        'change',
        'tenant:' || r.tenant_id::text,
        true
      );
    end loop;
  exception when others then
    -- Canli veri yardimcidir: hata kullanicinin yazimini geri almaz.
    raise warning 'rt_emit_tenant_change(%.%): %', tg_table_name, tg_op, sqlerrm;
  end;
  return null;
end
$$;

comment on function public.rt_emit_tenant_change() is
  'SK2: deyim duzeyinde ofis degisikligi Broadcast (tenant:<id>, change, {t,op,ids<=50,r,by} | {t,op,bulk}). PII yok.';

revoke all on function public.rt_emit_tenant_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- (2) Bildirimler: kisisel -> inbox:<uid> (alicinin kendi alanlari), ortak -> tenant:<id> (yalniz kimlik)
-- ---------------------------------------------------------------------------
create or replace function public.rt_emit_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.user_id is not null then
      -- Yuk = istemcideki NotificationInsertRow (src/lib/realtime.ts); 'id' anahtari oldugu icin realtime.send yeni id eklemez.
      perform realtime.send(
        pg_catalog.jsonb_build_object(
          'id', new.id,
          'tenant_id', new.tenant_id,
          'user_id', new.user_id,
          'title', new.title,
          'body', new.body,
          'href', new.href,
          'kind', new.kind,
          'read_at', new.read_at,
          'created_at', new.created_at
        ),
        'notification',
        'inbox:' || new.user_id::text,
        true
      );
    elsif new.tenant_id is not null then
      perform realtime.send(pg_catalog.jsonb_build_object('id', new.id), 'notification', 'tenant:' || new.tenant_id::text, true);
    end if;
  exception when others then
    raise warning 'rt_emit_notification: %', sqlerrm;
  end;
  return null;
end
$$;

comment on function public.rt_emit_notification() is
  'SK2: bildirim Broadcast (kisisel inbox:<uid> alicinin kendi alanlari; ortak tenant:<id> yalniz {id}).';

revoke all on function public.rt_emit_notification() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tetikleyiciler (tablo, ust kimlik kolonu, mod, UPDATE gurultu kolonlari)
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
begin
  for s in
    select * from (values
      ('appointments', 'customer_id', 'tenant', ''),
      ('approval_requests', '', 'tenant', ''),
      ('branches', '', 'tenant', ''),
      ('calls', 'customer_id', 'tenant', ''),
      ('cash_entries', '', 'tenant', ''),
      ('commissions', 'deal_id', 'tenant', ''),
      ('communications', 'customer_id', 'tenant', ''),
      ('contracts', '', 'tenant', ''),
      ('customer_demands', 'customer_id', 'tenant', ''),
      ('customers', '', 'tenant', ''),
      ('deal_notes', 'deal_id', 'tenant', ''),
      ('deals', 'customer_id', 'tenant', ''),
      ('finance_open_items', '', 'tenant', ''),
      ('finance_parties', '', 'tenant', ''),
      ('fsbo_leads', '', 'tenant', ''),
      ('listing_control_events', '', 'tenant', ''),
      ('listing_pool_entries', '', 'tenant', ''),
      ('offers', 'customer_id', 'tenant', ''),
      ('portal_listings', '', 'tenant', ''),
      ('profiles', '', 'tenant', 'ui_state,public_view_count,notification_prefs,two_factor_version,two_factor_sms'),
      ('properties', '', 'tenant', ''),
      ('property_keys', '', 'tenant', ''),
      ('rent_charges', '', 'tenant', ''),
      ('rent_payments', '', 'tenant', ''),
      ('support_ticket_attachments', 'ticket_id', 'public_only', ''),
      ('support_ticket_messages', 'ticket_id', 'ticket', ''),
      ('support_tickets', '', 'tenant', ''),
      ('targets', '', 'tenant', ''),
      ('tasks', 'customer_id', 'tenant', ''),
      ('teams', '', 'tenant', '')
    ) as v(tbl, ref, mode, ignore_cols)
  loop
    if pg_catalog.to_regclass('public.' || s.tbl) is null then
      raise notice 'SK2: public.% yok, Broadcast tetikleyicisi atlandi', s.tbl;
      continue;
    end if;
    -- Sema sapmasi erken yakalansin: ust kimlik / tenant / gorunurluk kolonu yoksa migration DURUR.
    if s.ref <> '' and not exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = ('public.' || s.tbl)::regclass and attname = s.ref and attnum > 0 and not attisdropped
    ) then
      raise exception 'SK2: public.%.% kolonu yok', s.tbl, s.ref;
    end if;
    if s.mode <> 'ticket' and not exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = ('public.' || s.tbl)::regclass and attname = 'tenant_id' and attnum > 0 and not attisdropped
    ) then
      raise exception 'SK2: public.%.tenant_id kolonu yok', s.tbl;
    end if;

    execute pg_catalog.format('drop trigger if exists zz_rt_change_ins on public.%I', s.tbl);
    execute pg_catalog.format('drop trigger if exists zz_rt_change_upd on public.%I', s.tbl);
    execute pg_catalog.format('drop trigger if exists zz_rt_change_del on public.%I', s.tbl);
    execute pg_catalog.format(
      'create trigger zz_rt_change_ins after insert on public.%I referencing new table as rt_new '
      'for each statement execute function public.rt_emit_tenant_change(%L, %L, %L)', s.tbl, s.ref, s.mode, s.ignore_cols);
    execute pg_catalog.format(
      'create trigger zz_rt_change_upd after update on public.%I referencing old table as rt_old new table as rt_new '
      'for each statement execute function public.rt_emit_tenant_change(%L, %L, %L)', s.tbl, s.ref, s.mode, s.ignore_cols);
    execute pg_catalog.format(
      'create trigger zz_rt_change_del after delete on public.%I referencing old table as rt_old '
      'for each statement execute function public.rt_emit_tenant_change(%L, %L, %L)', s.tbl, s.ref, s.mode, s.ignore_cols);
  end loop;

  if pg_catalog.to_regclass('public.notifications') is not null then
    drop trigger if exists zz_rt_notification on public.notifications;
    create trigger zz_rt_notification after insert on public.notifications
      for each row execute function public.rt_emit_notification();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- (3) Ozel kanal okuma politikalari (realtime.messages)
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner oid;
begin
  if pg_catalog.to_regclass('realtime.messages') is null then
    raise notice 'SK2: realtime.messages yok (Realtime servisi kurulmamis); politikalar atlandi';
    return;
  end if;
  select c.relowner into v_owner from pg_catalog.pg_class c where c.oid = 'realtime.messages'::regclass;
  if not (
    coalesce((select rolsuper from pg_catalog.pg_roles where rolname = current_user), false)
    or pg_catalog.pg_has_role(current_user, v_owner, 'USAGE')
  ) then
    raise notice 'SK2: % realtime.messages sahibi degil; politikalar ATLANDI. YAYIN NOTU: supabase_admin ile scripts/sunucu/realtime-policies.sql calistirin.', current_user;
    return;
  end if;
  execute 'drop policy if exists rt_tenant_topic_read on realtime.messages';
  execute $p$create policy rt_tenant_topic_read on realtime.messages for select to authenticated
    using (
      extension = 'broadcast'
      and (select realtime.topic()) = 'tenant:' || (select public.current_tenant_id())::text
    )$p$;
  execute 'drop policy if exists rt_inbox_topic_read on realtime.messages';
  execute $p$create policy rt_inbox_topic_read on realtime.messages for select to authenticated
    using (
      extension = 'broadcast'
      and (select realtime.topic()) = 'inbox:' || (select auth.uid())::text
    )$p$;
end
$$;
