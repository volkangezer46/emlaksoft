-- ============================================================
-- Anket modulu genisletmesi: kitle x tetik matrisi, otomatik gonderim kanali, dusuk puan zinciri, ekip nabzi
-- MIGRATION 20261007000400 (PB49). UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261007000400_survey_matrix_channels.sql` ile uygular.
-- ============================================================
-- KAPSAM (hepsi ek; kod bu dosya yokken eski davranisla calisir):
--  1) Olay/kitle CHECK'leri genisler: yeni olaylar `rent_renewal` (kira bitisinden 60 gun once), `tenant_annual`
--     (kiracinin yillik anketi), `advisor_pulse` (danisman ic anketi, ayda bir, ANONIM); yeni kitle `advisor`;
--     soru etiketi `advisor` (danisman puani). Sutunlar text + CHECK oldugu icin ENUM ADD VALUE YOK (087/087b kurali
--     uygulanmaz; deger ekleme ve kullanimi ayni dosyada guvenli).
--  2) survey_settings: otomatik gonderim (auto_send, varsayilan KAPALI), WhatsApp sablon adi/dili, destekleyene
--     tavsiye daveti (promoter_invite).
--  3) survey_tasks: gonderim izi (sent_via/sent_at/send_attempts; dedupe + sinir), dusuk puan zinciri
--     (followup_task_id, escalation_level, low_score_note/handled_at/handled_by). `low_score_handled` artik
--     "aksiyon notuyla KAPANDI" demektir (eski satirlar oldugu gibi kalir).
--  4) guard_survey_task_update yeniden: yeni zincir/gonderim sutunlari anketore kapali; dusuk puan kapanisi yalniz
--     not >= 10 karakter + kapatan = cagiran; takip gorevi baglantisi yalniz bostan doluya ve ayni ofisin gorevi.
--  5) RPC `survey_close_low_score` (JWT kimlikli DEFINER): yonetici, ilgili danisman, takip gorevinin atanani veya
--     danismanin takim lideri kapatir; ayni islemde takip gorevi `done` olur.
--  6) Ekip nabzi: `survey_pulse_responses` (kim bu ay cevapladi; CEVAPLA BAGLANTI TUTULMAZ) + RPC
--     `survey_submit_advisor_pulse` (cevap satiri kisiye baglanmadan yazilir: agent/assigned/created_by NULL,
--     event_key rastgele, tamamlanma gune yuvarlanir).
--  7) Veri: mevcut soru metinlerinde "1-10 arasi" -> "0-10 arasi" (olcek 0-10 tekledi; cevap gecmisi kopyasina
--     DOKUNULMAZ); mevcut deal_won sablonlarina "Danisman puani" sorusu (yoksa) eklenir.
-- BAGIMLILIK: 20260825000700_survey_module (tablolar, survey_is_manager), tasks, profiles. teams (PB34) OPSIYONEL
--   (yoksa takim lideri dali atlanir).
-- GERI ALMA: supabase/rollbacks/20261007000400_survey_matrix_channels.rollback.sql (yeni olay/kitle satirlari silinir).
-- RISK: dusuk-orta (CHECK yeniden yazimi tablo taramasi yapar; anket tablolari kucuk). Kilit bekleme 5 sn.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.survey_tasks') is null
     or pg_catalog.to_regclass('public.survey_settings') is null
     or pg_catalog.to_regprocedure('public.survey_is_manager()') is null then
    raise exception 'Anket modulu (20260825000700) uygulanmamis; once o migration.';
  end if;
  if pg_catalog.to_regclass('public.tasks') is null then
    raise exception 'tasks tablosu yok.';
  end if;
end $$;

-- ------------------------------------------------------- 1) CHECK genisletme
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.conname
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'c'
       and pg_catalog.array_length(c.conkey, 1) = 1
       and (
            (c.conrelid = 'public.survey_templates'::regclass and a.attname in ('event_type', 'audience'))
         or (c.conrelid = 'public.survey_triggers'::regclass and a.attname = 'event_type')
         or (c.conrelid = 'public.survey_tasks'::regclass and a.attname in ('event_type', 'audience'))
         or (c.conrelid = 'public.survey_questions'::regclass and a.attname = 'tag')
       )
  loop
    execute pg_catalog.format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.survey_templates
  add constraint survey_templates_event_type_check check (event_type in
    ('property_unpublished','authority_extended','deal_won','deal_lost','demand_lost','appointment_done',
     'rent_renewal','tenant_annual','advisor_pulse')),
  add constraint survey_templates_audience_check check (audience in
    ('owner','buyer','seller','tenant','landlord','customer','visitor','advisor'));

alter table public.survey_triggers
  add constraint survey_triggers_event_type_check check (event_type in
    ('property_unpublished','authority_extended','deal_won','deal_lost','demand_lost','appointment_done',
     'rent_renewal','tenant_annual','advisor_pulse'));

alter table public.survey_tasks
  add constraint survey_tasks_event_type_check check (event_type in
    ('property_unpublished','authority_extended','deal_won','deal_lost','demand_lost','appointment_done',
     'rent_renewal','tenant_annual','advisor_pulse')),
  add constraint survey_tasks_audience_check check (audience in
    ('owner','buyer','seller','tenant','landlord','customer','visitor','advisor'));

alter table public.survey_questions
  add constraint survey_questions_tag_check check (tag in ('primary','reason','advisor'));

-- ---------------------------------------------------------- 2) ofis ayarlari
alter table public.survey_settings
  add column if not exists auto_send boolean not null default false,
  add column if not exists whatsapp_template text,
  add column if not exists whatsapp_language text not null default 'tr',
  add column if not exists promoter_invite boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'survey_settings_whatsapp_template_check') then
    alter table public.survey_settings
      add constraint survey_settings_whatsapp_template_check
      check (whatsapp_template is null or whatsapp_template ~ '^[a-z0-9_]{1,512}$');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'survey_settings_whatsapp_language_check') then
    alter table public.survey_settings
      add constraint survey_settings_whatsapp_language_check
      check (whatsapp_language ~ '^[a-z]{2}(_[A-Z]{2})?$');
  end if;
end $$;

comment on column public.survey_settings.auto_send is
  'Bagli anket linki vadesi gelince ofisin kendi SMS (Netgsm) / WhatsApp saglayicisiyla otomatik gonderilir (IYS izni sart). Varsayilan kapali.';
comment on column public.survey_settings.promoter_invite is
  '9-10 veren musteriye tesekkur ekraninda tavsiye baglantisi sunulur ve danismana bildirim gider.';

-- ----------------------------------------------------- 3) gorev sutunlari
alter table public.survey_tasks
  add column if not exists sent_via text,
  add column if not exists sent_at timestamptz,
  add column if not exists send_attempts int not null default 0,
  add column if not exists followup_task_id uuid references public.tasks(id) on delete set null,
  add column if not exists escalation_level smallint not null default 0,
  add column if not exists low_score_note text,
  add column if not exists low_score_handled_at timestamptz,
  add column if not exists low_score_handled_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'survey_tasks_sent_via_check') then
    alter table public.survey_tasks add constraint survey_tasks_sent_via_check check (sent_via in ('sms', 'whatsapp'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'survey_tasks_send_attempts_check') then
    alter table public.survey_tasks add constraint survey_tasks_send_attempts_check check (send_attempts between 0 and 10);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'survey_tasks_escalation_level_check') then
    alter table public.survey_tasks add constraint survey_tasks_escalation_level_check check (escalation_level between 0 and 2);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'survey_tasks_low_score_note_check') then
    alter table public.survey_tasks
      add constraint survey_tasks_low_score_note_check
      check (low_score_note is null or char_length(low_score_note) between 10 and 2000);
  end if;
end $$;

-- Dusuk puan zinciri taramasi (cron) ve gonderim kuyrugu icin kismi indeksler (anket tablolari kucuk).
create index if not exists idx_survey_tasks_low_open
  on public.survey_tasks (tenant_id, completed_at)
  where status = 'completed' and low_score_handled = false and score is not null;
create index if not exists idx_survey_tasks_unsent
  on public.survey_tasks (tenant_id, due_at)
  where status = 'pending' and sent_at is null;

-- --------------------------------------------------- 4) guard yeniden tanim
create or replace function public.guard_survey_task_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.survey_is_manager() then
    return new;
  end if;

  if row(new.id, new.tenant_id, new.event_type, new.audience, new.event_key, new.event_summary, new.event_at,
         new.template_id, new.customer_id, new.property_id, new.deal_id, new.agent_id, new.assigned_to,
         new.due_at, new.max_attempts, new.public_token, new.created_by, new.created_at,
         new.escalation_level, new.sent_via, new.sent_at, new.send_attempts)
     is distinct from
     row(old.id, old.tenant_id, old.event_type, old.audience, old.event_key, old.event_summary, old.event_at,
         old.template_id, old.customer_id, old.property_id, old.deal_id, old.agent_id, old.assigned_to,
         old.due_at, old.max_attempts, old.public_token, old.created_by, old.created_at,
         old.escalation_level, old.sent_via, old.sent_at, old.send_attempts) then
    raise exception 'Anketor yalnizca arama ve cevap alanlarini guncelleyebilir.' using errcode = '42501';
  end if;

  if new.completed_by is not null
     and new.completed_by is distinct from old.completed_by
     and new.completed_by is distinct from v_uid then
    raise exception 'Gorevi baskasi adina tamamlayamazsiniz.' using errcode = '42501';
  end if;

  -- Takip gorevi baglantisi yalniz bostan doluya (dusuk puan zinciri acilisi) ve ayni ofisin gorevine.
  if new.followup_task_id is distinct from old.followup_task_id then
    if old.followup_task_id is not null
       or new.followup_task_id is null
       or not exists (select 1 from public.tasks k where k.id = new.followup_task_id and k.tenant_id = new.tenant_id) then
      raise exception 'Takip gorevi baglantisi degistirilemez.' using errcode = '42501';
    end if;
  end if;

  -- Kapanmis gorevde sonuc alanlari donar (iletisim bilgisi ve dusuk puan kapanisi haric).
  if old.status <> 'pending' then
    if row(new.status, new.attempts, new.next_attempt_at, new.last_outcome,
           new.score, new.comment, new.answered_via, new.completed_at, new.completed_by)
       is distinct from
       row(old.status, old.attempts, old.next_attempt_at, old.last_outcome,
           old.score, old.comment, old.answered_via, old.completed_at, old.completed_by) then
      raise exception 'Kapanmis anket gorevi degistirilemez.' using errcode = '42501';
    end if;
  end if;

  -- Dusuk puan kapanisi: yalniz false -> true, aksiyon notu zorunlu, kapatan cagiranin kendisi; geri acilmaz.
  if row(new.low_score_handled, new.low_score_note, new.low_score_handled_at, new.low_score_handled_by)
     is distinct from
     row(old.low_score_handled, old.low_score_note, old.low_score_handled_at, old.low_score_handled_by) then
    if old.low_score_handled
       or not new.low_score_handled
       or new.low_score_handled_by is distinct from v_uid
       or new.low_score_handled_at is null
       or char_length(btrim(coalesce(new.low_score_note, ''))) < 10 then
      raise exception 'Dusuk puan takibi yalniz aksiyon notuyla kapatilabilir.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_survey_task_update() from public, anon, authenticated;

-- ------------------------------------------- 5) dusuk puan kapanisi (RPC)
create or replace function public.survey_close_low_score(p_task_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_note text := btrim(coalesce(p_note, ''));
  v_task record;
  v_allowed boolean := false;
  v_lead boolean := false;
begin
  if v_uid is null or v_tenant is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;
  if char_length(v_note) < 10 or char_length(v_note) > 2000 then
    return jsonb_build_object('ok', false, 'code', 'note_required');
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.tenant_id = v_tenant and p.is_active) then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;

  select t.id, t.agent_id, t.followup_task_id, t.status, t.score, t.low_score_handled, t.event_type
    into v_task
    from public.survey_tasks t
   where t.id = p_task_id and t.tenant_id = v_tenant
   for update;
  if v_task.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_task.event_type = 'advisor_pulse' or v_task.status <> 'completed' or v_task.score is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if v_task.low_score_handled then
    return jsonb_build_object('ok', false, 'code', 'already');
  end if;

  v_allowed := public.survey_is_manager()
    or v_task.agent_id = v_uid
    or exists (
      select 1 from public.tasks k
       where k.id = v_task.followup_task_id and k.tenant_id = v_tenant and k.assigned_to = v_uid
    );
  -- Danismanin takim lideri (takim modeli PB34 uygulanmissa).
  if not v_allowed and v_task.agent_id is not null and pg_catalog.to_regclass('public.teams') is not null then
    execute 'select exists (select 1 from public.profiles p join public.teams tm on tm.id = p.team_id '
            'where p.id = $1 and p.tenant_id = $2 and tm.lead_user_id = $3 and tm.is_active)'
      into v_lead using v_task.agent_id, v_tenant, v_uid;
    v_allowed := coalesce(v_lead, false);
  end if;
  if not v_allowed then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  update public.survey_tasks
     set low_score_handled = true,
         low_score_note = v_note,
         low_score_handled_at = now(),
         low_score_handled_by = v_uid
   where id = v_task.id and tenant_id = v_tenant and low_score_handled = false;

  if v_task.followup_task_id is not null then
    update public.tasks
       set status = 'done', completed_at = now()
     where id = v_task.followup_task_id and tenant_id = v_tenant and status = 'open';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.survey_close_low_score(uuid, text) is
  'Dusuk puan takibini aksiyon notuyla kapatir (yonetici, ilgili danisman, takip gorevi atanani veya takim lideri); takip gorevi done olur.';

revoke all on function public.survey_close_low_score(uuid, text) from public, anon;
grant execute on function public.survey_close_low_score(uuid, text) to authenticated, service_role;

-- ------------------------------------------------------- 6) ekip nabzi
-- Kim bu donem cevapladi (ayda bir kural). Cevap satiriyla BAGLANTI tutulmaz; zaman damgasi yok (yalniz donem).
create table if not exists public.survey_pulse_responses (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  period     text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  primary key (tenant_id, user_id, period)
);

alter table public.survey_pulse_responses enable row level security;
revoke all on public.survey_pulse_responses from public, anon, authenticated;
grant all on public.survey_pulse_responses to service_role;

drop policy if exists survey_pulse_responses_select on public.survey_pulse_responses;
create policy survey_pulse_responses_select on public.survey_pulse_responses
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()));
-- Yazma politikasi YOK: yalniz survey_submit_advisor_pulse (DEFINER) yazar.
grant select on public.survey_pulse_responses to authenticated;

create or replace function public.survey_submit_advisor_pulse(p_template_id uuid, p_period text, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_period text := pg_catalog.to_char(pg_catalog.timezone('Europe/Istanbul', now()), 'YYYY-MM');
  v_month_start timestamptz := pg_catalog.date_trunc('month', pg_catalog.timezone('Europe/Istanbul', now())) at time zone 'Europe/Istanbul';
  v_item jsonb;
  v_q record;
  v_qid uuid;
  v_num numeric;
  v_text text;
  v_score int;
  v_comment text;
  v_qids uuid[] := '{}';
  v_labels text[] := '{}';
  v_tags text[] := '{}';
  v_nums numeric[] := '{}';
  v_texts text[] := '{}';
  v_rows int;
  v_task_id uuid;
begin
  if v_uid is null or v_tenant is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;
  if p_period is distinct from v_period then
    return jsonb_build_object('ok', false, 'code', 'period');
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.tenant_id = v_tenant and p.is_active) then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;
  if not exists (
    select 1 from public.survey_triggers g
     where g.tenant_id = v_tenant and g.event_type = 'advisor_pulse' and g.enabled
  ) then
    return jsonb_build_object('ok', false, 'code', 'disabled');
  end if;
  if not exists (
    select 1 from public.survey_templates s
     where s.id = p_template_id and s.tenant_id = v_tenant and s.event_type = 'advisor_pulse'
       and s.audience = 'advisor' and s.active
  ) then
    return jsonb_build_object('ok', false, 'code', 'template');
  end if;
  if p_answers is null or pg_catalog.jsonb_typeof(p_answers) <> 'array'
     or pg_catalog.jsonb_array_length(p_answers) = 0 or pg_catalog.jsonb_array_length(p_answers) > 20 then
    return jsonb_build_object('ok', false, 'code', 'answers');
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_answers) loop
    if coalesce(v_item->>'question_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('ok', false, 'code', 'answers');
    end if;
    v_qid := (v_item->>'question_id')::uuid;
    if v_qid = any (v_qids) then
      return jsonb_build_object('ok', false, 'code', 'answers');
    end if;
    select q.kind, q.label, q.tag, q.options into v_q
      from public.survey_questions q
     where q.id = v_qid and q.template_id = p_template_id and q.tenant_id = v_tenant;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'answers');
    end if;
    v_num := null;
    v_text := null;
    if v_q.kind = 'score' then
      if coalesce(v_item->>'value_num', '') !~ '^[0-9]{1,2}$' then
        return jsonb_build_object('ok', false, 'code', 'answers');
      end if;
      v_num := (v_item->>'value_num')::numeric;
      if v_num < 0 or v_num > 10 then
        return jsonb_build_object('ok', false, 'code', 'answers');
      end if;
      if v_q.tag = 'primary' and v_score is null then
        v_score := v_num::int;
      end if;
    elsif v_q.kind = 'yesno' then
      if coalesce(v_item->>'value_num', '') not in ('0', '1') then
        return jsonb_build_object('ok', false, 'code', 'answers');
      end if;
      v_num := (v_item->>'value_num')::numeric;
      v_text := case when v_num = 1 then 'Evet' else 'Hayır' end;
    elsif v_q.kind = 'choice' then
      v_text := v_item->>'value_text';
      if v_text is null or not (v_q.options ? v_text) then
        return jsonb_build_object('ok', false, 'code', 'answers');
      end if;
    else
      v_text := pg_catalog.left(btrim(coalesce(v_item->>'value_text', '')), 2000);
      if v_text = '' then
        return jsonb_build_object('ok', false, 'code', 'answers');
      end if;
      if v_comment is null then
        v_comment := v_text;
      end if;
    end if;
    v_qids := v_qids || v_qid;
    v_labels := v_labels || v_q.label;
    v_tags := v_tags || v_q.tag;
    v_nums := v_nums || v_num;
    v_texts := v_texts || v_text;
  end loop;

  if exists (
    select 1 from public.survey_questions q
     where q.template_id = p_template_id and q.tenant_id = v_tenant and q.required and not (q.id = any (v_qids))
  ) then
    return jsonb_build_object('ok', false, 'code', 'required');
  end if;

  insert into public.survey_pulse_responses (tenant_id, user_id, period)
  values (v_tenant, v_uid, v_period)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('ok', false, 'code', 'already');
  end if;

  -- Cevap satiri KISIYE BAGLANMAZ: agent/assigned/created_by/completed_by NULL, anahtar rastgele, zaman gune yuvarli.
  insert into public.survey_tasks (
    tenant_id, event_type, audience, event_key, event_summary, event_at, template_id,
    agent_id, assigned_to, status, due_at, attempts, max_attempts, score, comment, answered_via,
    completed_at, completed_by, created_by
  ) values (
    v_tenant, 'advisor_pulse', 'advisor', 'advisor_pulse:' || v_period || ':' || gen_random_uuid()::text,
    'Ekip nabzı ' || v_period, v_month_start, p_template_id,
    null, null, 'completed', v_month_start, 0, 1, v_score, v_comment, 'link',
    pg_catalog.date_trunc('day', now()), null, null
  )
  returning id into v_task_id;

  insert into public.survey_answers (tenant_id, task_id, question_id, question_label, tag, value_num, value_text)
  select v_tenant, v_task_id, a.qid, a.label, a.tag, a.num, a.txt
    from unnest(v_qids, v_labels, v_tags, v_nums, v_texts) as a(qid, label, tag, num, txt);

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.survey_submit_advisor_pulse(uuid, text, jsonb) is
  'Ekip nabzi (danisman ic anketi) cevabi: ayda bir, cevap satiri kisiye baglanmadan yazilir; yalniz toplu sonuc gosterilir.';

revoke all on function public.survey_submit_advisor_pulse(uuid, text, jsonb) from public, anon;
grant execute on function public.survey_submit_advisor_pulse(uuid, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- 7) veri
-- Olcek 0-10 tekledi: sablon soru metinleri (cevap kopyalari degil).
update public.survey_questions
   set label = replace(label, '1-10 arası', '0-10 arası')
 where kind = 'score' and label like '%1-10 arası%';

-- Islem goren anlasma sablonlarina danisman puani sorusu (yoksa; idempotent).
insert into public.survey_questions (tenant_id, template_id, position, kind, label, options, required, tag)
select t.tenant_id, t.id,
       coalesce((select max(q.position) from public.survey_questions q where q.template_id = t.id), 0) + 1,
       'score', 'Danışmanınızı 0-10 arası puanlar mısınız?', '[]'::jsonb, false, 'advisor'
  from public.survey_templates t
 where t.event_type = 'deal_won'
   and not exists (select 1 from public.survey_questions q where q.template_id = t.id and q.tag = 'advisor');

notify pgrst, 'reload schema';
