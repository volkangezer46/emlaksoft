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
  created_at      timestamptz not null default now(),
  unique (tenant_id, event_key)
);

create index if not exists idx_survey_tasks_queue
  on public.survey_tasks (tenant_id, status, assigned_to, due_at);
create index if not exists idx_survey_tasks_event
  on public.survey_tasks (tenant_id, event_type, created_at desc);
create index if not exists idx_survey_tasks_agent
  on public.survey_tasks (tenant_id, agent_id);

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
do $$
declare t text;
begin
  foreach t in array array['survey_settings','survey_assignees','survey_templates','survey_questions',
                           'survey_triggers','survey_tasks','survey_answers','survey_attempts']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (tenant_id = (select public.current_tenant_id())) '
      'with check (tenant_id = (select public.current_tenant_id()))',
      t || '_tenant', t);
    execute format('grant all on public.%I to authenticated, service_role', t);
  end loop;
end $$;

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
