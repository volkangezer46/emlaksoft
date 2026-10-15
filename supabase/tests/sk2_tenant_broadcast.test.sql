-- pgTAP: SK2 20261016020000_tenant_broadcast_changes (+ 20261016020100 kapisi)
-- Calistirma (golge, CANLIYA DEGIL): scripts/db-shadow-replay.sh <dizin> --keep ile kurulan konteynerde
--   docker exec -i <golge> psql -h /var/run/postgresql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/tests/sk2_tenant_broadcast.test.sql
--   Cikti "not ok" satiri icermemeli. Tek islem, sonda ROLLBACK.
-- Realtime servisi kurulu degilse (golge) realtime.messages / realtime.send / realtime.topic, canlidaki govdeyle ayni
-- davranan saplarla islem icinde kurulur (realtime.send yuke 'id' yoksa uuid ekler; canli 2026-10-15 govdesi).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if to_regclass('realtime.messages') is null then
    create schema if not exists realtime;
    create table realtime.messages (
      id uuid not null default gen_random_uuid(),
      topic text not null,
      extension text not null,
      payload jsonb,
      event text,
      private boolean default false,
      inserted_at timestamp not null default now()
    );
    create or replace function realtime.topic() returns text language sql stable
      as $f$ select nullif(current_setting('realtime.topic', true), '')::text $f$;
    create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
      returns void language plpgsql as $f$
      declare
        generated_id uuid := gen_random_uuid();
        final_payload jsonb;
      begin
        begin
          if payload ? 'id' then final_payload := payload;
          else final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
          end if;
          execute format('SET LOCAL realtime.topic TO %L', topic);
          insert into realtime.messages (id, payload, event, topic, private, extension)
          values (generated_id, final_payload, event, topic, private, 'broadcast');
        exception when others then
          raise warning 'WarnSendingBroadcastMessage: %', sqlerrm;
        end;
      end $f$;
  end if;
end $$;

-- Bu testte uretilen mesajlar: her adimdan sonra "yeni" mesajlar okunur ve gorulmus sayilir.
create temp table rt_seen (id uuid primary key) on commit drop;
insert into rt_seen select id from realtime.messages;
create temp table rt_last (topic text, event text, private boolean, payload jsonb) on commit drop;
-- Realtime yuku sikistirilmis JSON gonderir (Jason); jsonb metnindeki ': ' ve ', ' bosluklari sayilmaz (degerlerde yok).
create or replace function pg_temp.rt_bytes(p jsonb) returns integer language sql immutable as $$
  select octet_length(replace(replace(p::text, '": ', '":'), ', ', ','))
$$;
create or replace function pg_temp.rt_take() returns integer language plpgsql as $$
declare n integer;
begin
  delete from rt_last;
  insert into rt_last select m.topic, m.event, m.private, m.payload from realtime.messages m
    where not exists (select 1 from rt_seen s where s.id = m.id);
  insert into rt_seen select m.id from realtime.messages m
    where not exists (select 1 from rt_seen s where s.id = m.id);
  get diagnostics n = row_count;
  return n;
end $$;

select plan(33);

-- ---------- kurulum: fonksiyonlar ve tetikleyiciler ----------
select ok((select prosecdef from pg_proc where oid = 'public.rt_emit_tenant_change()'::regprocedure), 'rt_emit_tenant_change SECURITY DEFINER');
select ok((select prosecdef from pg_proc where oid = 'public.rt_emit_notification()'::regprocedure), 'rt_emit_notification SECURITY DEFINER');
select ok(not has_function_privilege('authenticated', 'public.rt_emit_tenant_change()', 'EXECUTE')
          and not has_function_privilege('anon', 'public.rt_emit_tenant_change()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.rt_emit_notification()', 'EXECUTE'),
  'tetikleyici fonksiyonlari istemci rollerine kapali');
select is((select count(*)::int from pg_trigger where tgname in ('zz_rt_change_ins', 'zz_rt_change_upd', 'zz_rt_change_del') and not tgisinternal),
  90, '30 tabloda 3 deyim tetikleyicisi');
select is((select count(*)::int from pg_trigger
           where tgname like 'zz_rt_change_%' and ((tgtype & 1) = 1 or (tgoldtable is null and tgnewtable is null))),
  0, 'hepsi FOR EACH STATEMENT + gecis tablosu');
select ok((select (tgtype & 1) = 1 from pg_trigger where tgname = 'zz_rt_notification' and tgrelid = 'public.notifications'::regclass),
  'notifications satir duzeyinde');

-- ---------- fikstur (guvenilir sunucu akisi: service_role) ----------
do $$ begin perform set_config('request.jwt.claims', '{"role":"service_role"}', true); end $$;
insert into public.tenants (id, name, slug) values
  ('5a2a0000-0000-4000-8000-0000000000a1', 'SK2 Test A', 'sk2-test-a'),
  ('5a2a0000-0000-4000-8000-0000000000a2', 'SK2 Test B', 'sk2-test-b');
insert into auth.users (id) values ('5a2a0000-0000-4000-8000-0000000000b1');
insert into public.profiles (id, tenant_id, full_name) values ('5a2a0000-0000-4000-8000-0000000000b1', '5a2a0000-0000-4000-8000-0000000000a1', 'SK2 Danisman');
insert into public.support_tickets (id, tenant_id, subject, body) values
  ('5a2a0000-0000-4000-8000-0000000000d1', '5a2a0000-0000-4000-8000-0000000000a1', 'SK2 talep', 'SK2 talep govdesi');
do $$ begin perform pg_temp.rt_take(); end $$;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"5a2a0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true); end $$;

-- ---------- tek satir: tek mesaj, PII yok ----------
insert into public.customers (id, tenant_id, full_name, phone)
values ('5a2a0000-0000-4000-8000-0000000000c1', '5a2a0000-0000-4000-8000-0000000000a1', 'Ayse Yilmaz', '05321234567');
select is(pg_temp.rt_take(), 1, 'tek satirlik INSERT: tek mesaj');
select results_eq($$select topic, event, private from rt_last$$,
  $$values ('tenant:5a2a0000-0000-4000-8000-0000000000a1'::text, 'change'::text, true)$$, 'konu tenant:<ofis>, olay change, ozel kanal');
select is((select payload - 'id' from rt_last),
  '{"t":"customers","op":"INSERT","ids":["5a2a0000-0000-4000-8000-0000000000c1"],"by":"5a2a0000-0000-4000-8000-0000000000b1"}'::jsonb,
  'yuk {t, op, ids, by} (+ kisa id); ad/telefon YOK');
select ok((select payload ->> 'id' ~ '^[0-9a-f]{8}$' from rt_last), 'ileti kimligi 8 hex (realtime.send uuid eklemez)');
select cmp_ok((select pg_temp.rt_bytes(payload) from rt_last), '<=', 200, 'tek satir yuku <= 200 B');

-- ---------- ilgili kayit: ust kimlik (r) ----------
insert into public.tasks (tenant_id, title, customer_id)
values ('5a2a0000-0000-4000-8000-0000000000a1', 'Ara', '5a2a0000-0000-4000-8000-0000000000c1');
select is(pg_temp.rt_take(), 1, 'gorev INSERT: tek mesaj');
select is((select payload -> 'r' from rt_last), '["5a2a0000-0000-4000-8000-0000000000c1"]'::jsonb, 'r = musteri kimligi (detay suzgeci)');
select cmp_ok((select pg_temp.rt_bytes(payload) from rt_last), '<=', 200, 'ust kimlikli tek satir yuku <= 200 B');

-- ---------- cok ofisli deyim: ofis basina bir mesaj ----------
insert into public.tasks (tenant_id, title) values
  ('5a2a0000-0000-4000-8000-0000000000a1', 'A1'), ('5a2a0000-0000-4000-8000-0000000000a1', 'A2'),
  ('5a2a0000-0000-4000-8000-0000000000a2', 'B1');
select is(pg_temp.rt_take(), 2, 'iki ofise dokunan deyim: ofis basina bir mesaj');
select is((select jsonb_array_length(payload -> 'ids') from rt_last where topic = 'tenant:5a2a0000-0000-4000-8000-0000000000a1'), 2,
  'A ofisi mesaji iki kimlik tasir');

-- ---------- toplu: 50'den fazla satir tek bulk mesaj ----------
insert into public.tasks (tenant_id, title)
select '5a2a0000-0000-4000-8000-0000000000a1', 'Toplu ' || g from generate_series(1, 60) g;
select is(pg_temp.rt_take(), 1, '60 satirlik deyim: tek mesaj');
select is((select payload - 'id' from rt_last), '{"t":"tasks","op":"INSERT","bulk":true}'::jsonb, 'bulk yuk kimlik tasimaz');

-- ---------- bos deyim ve guncelleme/silme ----------
update public.tasks set title = title where false;
select is(pg_temp.rt_take(), 0, 'satir degistirmeyen deyim mesaj uretmez');
update public.customers set full_name = 'Ayse Kaya' where id = '5a2a0000-0000-4000-8000-0000000000c1';
select is(pg_temp.rt_take(), 1, 'UPDATE: tek mesaj');
select is((select payload ->> 'op' from rt_last), 'UPDATE', 'UPDATE: op UPDATE');
delete from public.tasks where tenant_id = '5a2a0000-0000-4000-8000-0000000000a2';
select is(pg_temp.rt_take(), 1, 'DELETE: tek mesaj');
select is((select payload ->> 'op' from rt_last), 'DELETE', 'DELETE: op DELETE (eski satirdan)');

-- ---------- profiles: yalniz gurultu kolonu degisince mesaj yok ----------
update public.profiles set ui_state = coalesce(ui_state, '{}'::jsonb) || '{"tur":1}'::jsonb where id = '5a2a0000-0000-4000-8000-0000000000b1';
select is(pg_temp.rt_take(), 0, 'profiles.ui_state degisimi mesaj uretmez');
update public.profiles set full_name = 'SK2 Danisman 2' where id = '5a2a0000-0000-4000-8000-0000000000b1';
select is(pg_temp.rt_take(), 1, 'profiles.full_name degisimi mesaj uretir');

-- ---------- destek: ic not konuya yazilmaz; acik mesaj talebin ofisine ----------
insert into public.support_ticket_messages (ticket_id, body, author_kind, visibility)
values ('5a2a0000-0000-4000-8000-0000000000d1', 'Ic not metni', 'staff', 'internal');
select is(pg_temp.rt_take(), 0, 'ic not (internal) mesaj uretmez');
insert into public.support_ticket_messages (ticket_id, body, author_kind, visibility)
values ('5a2a0000-0000-4000-8000-0000000000d1', 'Merhaba destek', 'tenant', 'public');
select is(pg_temp.rt_take(), 1, 'acik mesaj: tek mesaj');
select is((select topic || '|' || (payload -> 'r' ->> 0) from rt_last),
  'tenant:5a2a0000-0000-4000-8000-0000000000a1|5a2a0000-0000-4000-8000-0000000000d1', 'konu talebin ofisi, r = talep kimligi');

-- En uzun tablo adi + ust kimlik + aktor (en kotu tek satir): yine <= 200 B.
select cmp_ok(pg_temp.rt_bytes(jsonb_build_object('t', 'support_ticket_attachments', 'op', 'INSERT',
  'ids', jsonb_build_array(gen_random_uuid()), 'r', jsonb_build_array(gen_random_uuid()), 'by', gen_random_uuid(), 'id', 'ffffffff')),
  '<=', 200, 'en kotu tek satir yuku <= 200 B');

-- ---------- bildirimler: kisisel inbox, ortak yalniz kimlik ----------
insert into public.notifications (tenant_id, user_id, title, body, href, kind)
values ('5a2a0000-0000-4000-8000-0000000000a1', '5a2a0000-0000-4000-8000-0000000000b1', 'Yeni randevu', 'Yarin 10:00', '/app/randevular', 'info');
select is(pg_temp.rt_take(), 1, 'kisisel bildirim: tek mesaj');
select results_eq($$select topic, event, (select array_agg(k order by k) from jsonb_object_keys(payload) k) from rt_last$$,
  $$values ('inbox:5a2a0000-0000-4000-8000-0000000000b1'::text, 'notification'::text,
            array['body','created_at','href','id','kind','read_at','tenant_id','title','user_id'])$$,
  'kisisel bildirim: inbox:<kullanici>, NotificationInsertRow alanlari');
insert into public.notifications (tenant_id, user_id, title, kind)
values ('5a2a0000-0000-4000-8000-0000000000a1', null, 'Ofis duyurusu', 'system');
select is(pg_temp.rt_take(), 1, 'ortak bildirim: tek mesaj');
select results_eq($$select topic, (select array_agg(k) from jsonb_object_keys(payload) k) from rt_last$$,
  $$values ('tenant:5a2a0000-0000-4000-8000-0000000000a1'::text, array['id'])$$, 'ortak bildirim: ofis konusu, yalniz id');

select * from finish();
rollback;
