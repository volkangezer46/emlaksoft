-- ============================================================
-- Anket modülü (anketör kuyruğu) — TASLAK, UYGULANMAZ
-- ============================================================
-- Amaç: yayından kalkan, yetki süresi uzayan, işlem gören, kaybedilen ve
-- ziyaret edilen işlemler için ANKETÖR (atanabilir görev, rol değil) kuyruğu.
-- Mevcut `surveys` tablosu (20260727000104, kapanış NPS anketi) AYNEN kalır.
--
-- Tablolar:
--   survey_settings   : ofis başına atama modu, gecikme eşiği, yeniden deneme saati
--   survey_assignees  : anketör olarak atanan kullanıcılar (rol DEĞİL)
--   survey_triggers   : olay türü başına aç/kapa, bekleme günü, en çok deneme
--   survey_templates  : olay x muhatap şablonları; survey_questions: soruları
--   survey_tasks      : üretilen anket görevleri (unique(tenant_id,event_key) = mükerrer yok)
--   survey_answers    : soru bazlı cevaplar; survey_attempts: arama denemeleri günlüğü
--
-- Kod bu tablolar YOKKEN "modül etkin değil" uyarısı gösterir; mevcut memnuniyet
-- anketi etkilenmez. Bu yüzden kod migration'dan ÖNCE yayınlanabilir.
-- Uygulama: yalnız restore edilebilir yedek/PITR doğrulandıktan sonra, dry-run ve
-- ledger denetiminden geçip supabase/migrations altına taşınarak.
-- GERİ ALMA: 20260820010000_survey_module.rollback.sql (anket görev verisi silinir).
-- RİSK: düşük (yalnız yeni tablolar + permission_defaults seed; mevcut tabloya dokunmaz).
-- GÜVENLİK (denetim 3 / #7, taslak yerinde düzeltildi): tek `for all` tenant politikası yerine rol/atama
--   bazlı politikalar + survey_tasks sütun koruma trigger'ı + yardımcı fonksiyonlar (survey_is_manager,
--   survey_can_work_task). Ayrıntı RLS bölümünde. survey_tasks.created_by eklendi (default auth.uid()).

-- ---------------------------------------------------------------- ayarlar
create table if not exists public.survey_settings (
  tenant_id        uuid        primary key references public.tenants(id) on delete cascade,
  assignment_mode  text        not null default 'balanced'
                               check (assignment_mode in ('balanced', 'selected', 'manual')),
  fixed_assignee   uuid        references public.profiles(id) on delete set null,
  overdue_hours    int         not null default 48 check (overdue_hours between 1 and 720),
  retry_hours      int         not null default 24 check (retry_hours between 1 and 336),
  low_score_max    int         not null default 6 check (low_score_max between 1 and 9),
  updated_by       uuid        references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now()
);

create table if not exists public.survey_assignees (
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  created_by  uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- --------------------------------------------------------------- şablonlar
create table if not exists public.survey_templates (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  event_type  text        not null check (event_type in
              ('property_unpublished','authority_extended','deal_won','deal_lost','demand_lost','appointment_done')),
  audience    text        not null check (audience in
              ('owner','buyer','seller','tenant','landlord','customer','visitor')),
  name        text        not null check (char_length(name) between 2 and 120),
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, event_type, audience)
);

create table if not exists public.survey_questions (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  template_id  uuid        not null references public.survey_templates(id) on delete cascade,
  position     int         not null default 0,
  kind         text        not null check (kind in ('score','choice','yesno','text')),
  label        text        not null check (char_length(label) between 2 and 300),
  options      jsonb       not null default '[]'::jsonb,
  required     boolean     not null default false,
  -- 'primary': puan sorusu görevin ana puanıdır; 'reason': neden/şikayet dağılımına girer.
  tag          text        check (tag in ('primary','reason')),
  created_at   timestamptz not null default now()
);

create index if not exists idx_survey_questions_template
  on public.survey_questions (template_id, position);

create table if not exists public.survey_triggers (
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  event_type    text        not null check (event_type in
                ('property_unpublished','authority_extended','deal_won','deal_lost','demand_lost','appointment_done')),
  enabled       boolean     not null default false,
  delay_days    int         not null default 2 check (delay_days between 0 and 60),
  max_attempts  int         not null default 3 check (max_attempts between 1 and 10),
  -- Açıldığı an: bundan ÖNCEKİ olaylar için geriye dönük anket üretilmez.
  enabled_since timestamptz,
  updated_by    uuid        references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, event_type)
);

-- ----------------------------------------------------------------- görevler
create table if not exists public.survey_tasks (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,
  event_type      text        not null check (event_type in
                  ('property_unpublished','authority_extended','deal_won','deal_lost','demand_lost','appointment_done')),
  audience        text        not null check (audience in
                  ('owner','buyer','seller','tenant','landlord','customer','visitor')),
  -- Mükerrer önleme anahtarı: aynı olay için ikinci görev üretilemez (23505 yutulur).
  event_key       text        not null check (char_length(event_key) between 3 and 200),
  event_summary   text        not null default '',
  event_at        timestamptz not null default now(),
  template_id     uuid        references public.survey_templates(id) on delete set null,
  customer_id     uuid        references public.customers(id) on delete set null,
  property_id     uuid        references public.properties(id) on delete set null,
  deal_id         uuid        references public.deals(id) on delete set null,
  -- Malik gibi müşteri kaydı olmayan muhataplar için ad/telefon (saklama: parsePhoneStrict).
  contact_name    text,
  contact_phone   text,
  agent_id        uuid        references public.profiles(id) on delete set null,
  assigned_to     uuid        references public.profiles(id) on delete set null,
  status          text        not null default 'pending'
                  check (status in ('pending','completed','refused','unreachable','cancelled')),
  due_at          timestamptz not null default now(),
  next_attempt_at timestamptz,
  attempts        int         not null default 0,
  max_attempts    int         not null default 3,
  last_outcome    text,
  public_token    uuid        not null unique default gen_random_uuid(),
  score           int         check (score between 0 and 10),
  comment         text,
  answered_via    text        check (answered_via in ('phone','link')),
  completed_at    timestamptz,
  completed_by    uuid        references public.profiles(id) on delete set null,
  low_score_handled boolean   not null default false,
  -- Görevi kullanıcı oturumuyla yazan kişi (ör. yetki uzatma kancası); cron/service_role için NULL.
  -- RLS: INSERT ... RETURNING satırı yazan kişiye görünür kalsın diye SELECT kuralında kullanılır.
  created_by      uuid        references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (tenant_id, event_key)
);

create index if not exists idx_survey_tasks_queue
  on public.survey_tasks (tenant_id, status, assigned_to, due_at);
create index if not exists idx_survey_tasks_event
  on public.survey_tasks (tenant_id, event_type, created_at desc);
create index if not exists idx_survey_tasks_agent
  on public.survey_tasks (tenant_id, agent_id);
create index if not exists idx_survey_tasks_creator
  on public.survey_tasks (tenant_id, created_by) where created_by is not null;

create table if not exists public.survey_answers (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  task_id     uuid        not null references public.survey_tasks(id) on delete cascade,
  question_id uuid        references public.survey_questions(id) on delete set null,
  -- Şablon sonradan değişse de cevap okunabilsin: soru metni ve etiketi kopyalanır.
  question_label text     not null,
  tag         text,
  value_num   numeric,
  value_text  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_survey_answers_task on public.survey_answers (task_id);
create index if not exists idx_survey_answers_reason
  on public.survey_answers (tenant_id, tag, value_text) where tag = 'reason';

create table if not exists public.survey_attempts (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,
  task_id    uuid        not null references public.survey_tasks(id) on delete cascade,
  user_id    uuid        references public.profiles(id) on delete set null,
  outcome    text        not null check (outcome in
             ('no_answer','busy','wrong_number','refused','completed','reassigned')),
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists idx_survey_attempts_task on public.survey_attempts (task_id, created_at desc);

-- --------------------------------------------------------------------- RLS
-- Güvenlik denetimi 3 / #7: önceki taslakta 8 tabloda tek `for all ... using tenant` politikası vardı (her üye
-- ayarları, şablonları, anketör atamasını, görevleri ve cevapları yazabiliyor; contact_phone ofis geneline açıktı).
-- Kurallar uygulama kapısını (src/lib/surveys/access.ts, src/app/actions/surveys.ts) DB'de karşılar:
--   * Yönetici (survey_is_manager) = ofis geneli rol (owner/gm/branch_manager; hasOfficeWideDataScope) VE
--     surveys:edit — access.ts `canManage` ile aynı küme.
--   * Ayar/şablon/soru/tetikleyici/anketör yazımı: yalnız yönetici. Okuma: ofis içi (yetki uzatma kancası
--     danışman oturumuyla tetikleyici/ayar/şablon okur).
--   * survey_tasks okuma: ofis geneli rol + surveys:view, atanan anketör, ilgili danışman (agent_id) +
--     surveys:view veya kaydı yazan kişi. Böylece contact_phone yalnız atanan anketör, yönetici ve kaydın
--     sahibi danışmana görünür (diğer üyeler satırı göremez).
--     SINIR: RLS satır düzeyidir; ilgili danışman (agent_id) kendi ilanının malik telefonunu görmeye devam eder.
--     Sütun düzeyi kısıt (contact_phone'u ayrı tabloya/RPC'ye almak) kuyruk sayfasının select'ini değiştirmeyi
--     gerektirir (TS, sahibi onayı).
--   * survey_tasks yazma: yönetici her alanı; atanan anketör yalnız arama/tamamlama alanlarını
--     (guard_survey_task_update trigger); yönetici olmayanın INSERT'i yalnız yetki uzatma kancası biçiminde.
--   * survey_answers / survey_attempts: yalnız INSERT (görevi çalıştırabilen: atanan anketör veya yönetici);
--     okuma görev görünürlüğüne bağlı. UPDATE/DELETE politikası YOK (salt eklenir).
--   * service_role (cron, public /anket/[token] akışı) RLS dışındadır.

create or replace function public.survey_is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.current_profile_role() in ('owner', 'gm', 'branch_manager')
      and public.has_effective_permission('surveys', 'edit'),
    false
  );
$$;

comment on function public.survey_is_manager() is
  'Anket yöneticisi: ofis geneli rol + surveys:edit (src/lib/surveys/access.ts canManage ile aynı).';

revoke all on function public.survey_is_manager() from public, anon;
grant execute on function public.survey_is_manager() to authenticated, service_role;

create or replace function public.survey_can_work_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.survey_tasks t
      where t.id = p_task_id
        and t.tenant_id = public.current_tenant_id()
        and (t.assigned_to = auth.uid() or public.survey_is_manager())
    ),
    false
  );
$$;

comment on function public.survey_can_work_task(uuid) is
  'Görevi çalıştırabilir mi: atanan anketör veya anket yöneticisi (src/lib/surveys/access.ts canWorkTask).';

revoke all on function public.survey_can_work_task(uuid) from public, anon;
grant execute on function public.survey_can_work_task(uuid) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['survey_settings','survey_assignees','survey_templates','survey_questions',
                           'survey_triggers','survey_tasks','survey_answers','survey_attempts']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant', t);
    -- Supabase varsayılan ayrıcalıkları yeni tabloya authenticated için ALL verir; önce temizle, sonra dar ver.
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;

  -- Yapılandırma tabloları: ofis içi okuma, yalnız yönetici yazar.
  foreach t in array array['survey_settings','survey_assignees','survey_templates','survey_questions','survey_triggers']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using (tenant_id = (select public.current_tenant_id()))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated '
      'with check (tenant_id = (select public.current_tenant_id()) and (select public.survey_is_manager()))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated '
      'using (tenant_id = (select public.current_tenant_id()) and (select public.survey_is_manager())) '
      'with check (tenant_id = (select public.current_tenant_id()) and (select public.survey_is_manager()))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated '
      'using (tenant_id = (select public.current_tenant_id()) and (select public.survey_is_manager()))',
      t || '_delete', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- survey_tasks -------------------------------------------------------------
drop policy if exists survey_tasks_select on public.survey_tasks;
create policy survey_tasks_select on public.survey_tasks
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      ((select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
        and (select public.has_effective_permission('surveys', 'view')))
      or assigned_to = (select auth.uid())
      or created_by = (select auth.uid())
      or (agent_id = (select auth.uid()) and (select public.has_effective_permission('surveys', 'view')))
    )
  );

-- Yönetici her biçimde yazar. Yönetici olmayan yalnız yetki uzatma kancasının ürettiği biçimi yazabilir
-- (src/lib/surveys/events.ts → queueSingleCandidate; updatePropertyAuthorization properties:edit kapısı).
drop policy if exists survey_tasks_insert on public.survey_tasks;
create policy survey_tasks_insert on public.survey_tasks
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.survey_is_manager())
      or (
        event_type = 'authority_extended'
        and (select public.has_effective_permission('properties', 'edit'))
        and created_by = (select auth.uid())
        and status = 'pending'
        and attempts = 0
        and last_outcome is null
        and score is null
        and comment is null
        and answered_via is null
        and completed_at is null
        and completed_by is null
        and low_score_handled = false
        and property_id is not null
        and exists (
          select 1 from public.properties p
          where p.id = survey_tasks.property_id and p.tenant_id = survey_tasks.tenant_id
        )
        and (
          assigned_to is null
          or exists (
            select 1 from public.survey_assignees a
            where a.tenant_id = survey_tasks.tenant_id and a.user_id = survey_tasks.assigned_to
          )
        )
      )
    )
  );

drop policy if exists survey_tasks_update on public.survey_tasks;
create policy survey_tasks_update on public.survey_tasks
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and ((select public.survey_is_manager()) or assigned_to = (select auth.uid()))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and ((select public.survey_is_manager()) or assigned_to = (select auth.uid()))
  );

-- Silme: politika yok (görevler iptal edilir, silinmez; tenant silinince cascade).
grant select, insert, update on public.survey_tasks to authenticated;

-- Atanan anketör (yönetici olmayan) yalnız arama/tamamlama alanlarını değiştirebilir.
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
         new.due_at, new.max_attempts, new.public_token, new.created_by, new.created_at)
     is distinct from
     row(old.id, old.tenant_id, old.event_type, old.audience, old.event_key, old.event_summary, old.event_at,
         old.template_id, old.customer_id, old.property_id, old.deal_id, old.agent_id, old.assigned_to,
         old.due_at, old.max_attempts, old.public_token, old.created_by, old.created_at) then
    raise exception 'Anketor yalnizca arama ve cevap alanlarini guncelleyebilir.' using errcode = '42501';
  end if;

  if new.completed_by is not null
     and new.completed_by is distinct from old.completed_by
     and new.completed_by is distinct from v_uid then
    raise exception 'Gorevi baskasi adina tamamlayamazsiniz.' using errcode = '42501';
  end if;

  -- Kapanmış görevde sonuç alanları donar; yalnız iletişim bilgisi (updateSurveyTaskContact durum bakmaz) ve
  -- düşük puan takibi işareti (false -> true) yazılabilir.
  if old.status <> 'pending' then
    if row(new.status, new.attempts, new.next_attempt_at, new.last_outcome,
           new.score, new.comment, new.answered_via, new.completed_at, new.completed_by)
       is distinct from
       row(old.status, old.attempts, old.next_attempt_at, old.last_outcome,
           old.score, old.comment, old.answered_via, old.completed_at, old.completed_by)
       or (old.low_score_handled and not new.low_score_handled) then
      raise exception 'Kapanmis anket gorevi degistirilemez.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_survey_task_update() from public, anon, authenticated;

drop trigger if exists trg_survey_tasks_guard on public.survey_tasks;
create trigger trg_survey_tasks_guard
  before update on public.survey_tasks
  for each row execute function public.guard_survey_task_update();

-- survey_answers / survey_attempts: yalnız ekleme ------------------------------
drop policy if exists survey_answers_select on public.survey_answers;
create policy survey_answers_select on public.survey_answers
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    -- survey_tasks RLS'i çağıran adına uygulanır: cevap yalnız görevi görünen kullanıcıya görünür.
    and exists (select 1 from public.survey_tasks t where t.id = survey_answers.task_id)
  );

drop policy if exists survey_answers_insert on public.survey_answers;
create policy survey_answers_insert on public.survey_answers
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and public.survey_can_work_task(task_id)
  );

drop policy if exists survey_attempts_select on public.survey_attempts;
create policy survey_attempts_select on public.survey_attempts
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (select 1 from public.survey_tasks t where t.id = survey_attempts.task_id)
  );

drop policy if exists survey_attempts_insert on public.survey_attempts;
create policy survey_attempts_insert on public.survey_attempts
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
    and public.survey_can_work_task(task_id)
  );

grant select, insert on public.survey_answers to authenticated;
grant select, insert on public.survey_attempts to authenticated;

-- ------------------------------------------------- permission_defaults seed
-- src/lib/permissions.ts DEFAULT_MATRIX ile BİREBİR: owner/gm tam; şube müdürü ekle/düzenle;
-- takım lideri, danışman, çağrı merkezi, muhasebe ve salt okunur: görüntüle.
-- Anketör kuyruğuna erişim yetkiyle değil survey_assignees atamasıyla gelir.
insert into public.permission_defaults (role, module, action)
select r, 'surveys', a
from (values ('owner'), ('gm')) as roles(r),
     (values ('view'), ('create'), ('edit'), ('delete')) as acts(a)
on conflict do nothing;

insert into public.permission_defaults (role, module, action)
values ('branch_manager', 'surveys', 'view'),
       ('branch_manager', 'surveys', 'create'),
       ('branch_manager', 'surveys', 'edit'),
       ('team_lead',      'surveys', 'view'),
       ('advisor',        'surveys', 'view'),
       ('call_center',    'surveys', 'view'),
       ('accounting',     'surveys', 'view'),
       ('readonly',       'surveys', 'view')
on conflict do nothing;
