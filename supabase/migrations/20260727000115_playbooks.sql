-- ============================================================
-- İş akışı şablonları (playbook) — "bu olay olunca şu görev listesi açılsın"
-- ============================================================
-- `automations` tablosu olay başına TEKİL aksiyon üretir (tek görev, tek SMS).
-- Eksik olan parça: çok adımlı, sıralı, GÖRELİ VADELİ görev paketi.
--
-- Örnek (yeni satılık portföy alındı):
--   Tapu fotokopisi iste ............ bugün
--   Profesyonel fotoğraf çek ........ +2 gün
--   Portallara yükle ................ +3 gün
--   Komşulara haber ver ............. +5 gün
--   İlk fiyat değerlendirmesi ....... +14 gün
--
-- Motor: src/lib/playbook-engine.ts (runPlaybooksForEvent) — kayıt açma
-- akışının SONUNDA fire-and-forget çağrılır, hata ana işlemi asla kırmaz.
-- Yönetim ekranı: /app/ayarlar/is-akislari (settings modülü altında yaşar).

-- ------------------------------------------------------------
-- 1) playbooks — şablon başlığı + tetikleyici + basit filtre
-- ------------------------------------------------------------
create table if not exists public.playbooks (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  name          text        not null,
  description   text,
  -- Türkçe olay sözlüğü (automation-engine'in İngilizce trigger_type'ından
  -- BİLİNÇLİ olarak ayrı: bu tablo son kullanıcıya doğrudan gösteriliyor).
  trigger_event text        not null check (trigger_event in (
                              'yeni_musteri',
                              'yeni_portfoy',
                              'anlasma_kazanildi',
                              'kira_sozlesmesi',
                              'talep_olusturuldu'
                            )),
  -- Basit anahtar/değer EŞİTLİK filtresi, örn. {"transaction_type":"Satılık"}.
  -- null / {} = filtresiz (her olayda çalışır). Operatör yok — otomasyonlardaki
  -- conditions dizisinden kasıtlı olarak daha basit tutuldu.
  filter        jsonb,
  -- Varsayılan PASİF: şablon kopyalandıktan sonra adımlar gözden geçirilip
  -- elle açılsın; yanlışlıkla 5 görev açan bir kopya istenmiyor.
  is_active     boolean     not null default false,
  created_by    uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.playbooks is
  'İş akışı şablonu: bir olay gerçekleşince sıralı, göreli vadeli görev paketi açar (playbook_steps)';
comment on column public.playbooks.filter is
  'Basit anahtar/değer eşitlik filtresi, örn {"transaction_type":"Satılık"}; null/boş = filtresiz';
comment on column public.playbooks.is_active is
  'Varsayılan false — hazır şablon kopyalandıktan sonra elle açılır';

create index if not exists idx_playbooks_tenant
  on public.playbooks(tenant_id, updated_at desc);
-- Motorun sıcak sorgusu: tenant + olay + aktif
create index if not exists idx_playbooks_trigger
  on public.playbooks(tenant_id, trigger_event) where is_active;

-- ------------------------------------------------------------
-- 2) playbook_steps — paketteki her bir görev satırı
-- ------------------------------------------------------------
create table if not exists public.playbook_steps (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  playbook_id uuid        not null references public.playbooks(id) on delete cascade,
  sort_order  int         not null default 0,
  title       text        not null,
  -- tasks.kind ile AYNI sözlük (bkz. 20260722000022_tasks.sql)
  kind        text        not null default 'followup'
                          check (kind in ('followup','call','visit','document','other')),
  priority    text        not null default 'normal'
                          check (priority in ('low','normal','high')),
  -- Tetiklemeden kaç gün sonra vade (0 = bugün). Negatif anlamsız.
  offset_days int         not null default 0 check (offset_days >= 0 and offset_days <= 365),
  -- owner   = olayın kaydının sorumlusu (customers/properties.assigned_to)
  -- creator = işlemi yapan kullanıcı
  -- specific= assignee_id'deki kişi
  assign_to   text        not null default 'owner'
                          check (assign_to in ('owner','creator','specific')),
  assignee_id uuid        references public.profiles(id) on delete set null,
  note        text
);

comment on table public.playbook_steps is
  'Playbook adımı — açılacak görevin başlığı, türü, önceliği, göreli vadesi ve atama kuralı';
comment on column public.playbook_steps.offset_days is
  'Tetiklemeden kaç gün sonra vade (0 = bugün)';
comment on column public.playbook_steps.assign_to is
  'owner: kaydın sorumlusu · creator: işlemi yapan · specific: assignee_id';

create index if not exists idx_playbook_steps_playbook
  on public.playbook_steps(playbook_id, sort_order);
create index if not exists idx_playbook_steps_tenant
  on public.playbook_steps(tenant_id);

-- ------------------------------------------------------------
-- 3) playbook_runs — çalışma kaydı + MÜKERRER FRENİ
-- ------------------------------------------------------------
create table if not exists public.playbook_runs (
  id               uuid        primary key default gen_random_uuid(),
  tenant_id        uuid        not null references public.tenants(id) on delete cascade,
  playbook_id      uuid        not null references public.playbooks(id) on delete cascade,
  entity_type      text        not null,
  entity_id        uuid        not null,
  created_task_ids uuid[]      not null default '{}',
  created_at       timestamptz not null default now()
);

comment on table public.playbook_runs is
  'Playbook çalışma kaydı; (playbook_id, entity_id) unique → aynı kayıt için ikinci kez çalışmaz';

-- Mükerrer freni: aynı playbook aynı kayıt için YALNIZ BİR KEZ çalışır.
-- Motor önce select ile bakar, yarış durumunda 23505 insert hatası son kaledir.
create unique index if not exists idx_playbook_runs_unique
  on public.playbook_runs(playbook_id, entity_id);
create index if not exists idx_playbook_runs_tenant
  on public.playbook_runs(tenant_id, created_at desc);

-- ============================================================
-- RLS — kiracı izolasyonu (helper: public.current_tenant_id())
-- ============================================================
alter table public.playbooks      enable row level security;
alter table public.playbook_steps enable row level security;
alter table public.playbook_runs  enable row level security;

drop policy if exists playbooks_tenant on public.playbooks;
create policy playbooks_tenant on public.playbooks
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists playbook_steps_tenant on public.playbook_steps;
create policy playbook_steps_tenant on public.playbook_steps
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists playbook_runs_tenant on public.playbook_runs;
create policy playbook_runs_tenant on public.playbook_runs
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on policy playbooks_tenant on public.playbooks is
  'Kiracı izolasyonu — current_tenant_id(). Motor service_role ile yazar.';

grant all on public.playbooks      to authenticated, service_role;
grant all on public.playbook_steps to authenticated, service_role;
grant all on public.playbook_runs  to authenticated, service_role;
