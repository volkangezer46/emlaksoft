-- AD5 Ofis CRM katmani ve saglik skoru (platform personeli; ofis kullanicilari HICBIR satiri goremez).
--
-- Tablolar (hepsi yalniz service_role; RLS acik, politika yok -> anon/authenticated erisemez, site_issues deseni):
--   tenant_tags            : renkli ofis etiketleri (adminden CRUD).
--   tenant_tag_links       : ofis <-> etiket (ofis/etiket silinince baglanti da silinir).
--   platform_tenant_crm    : ofis basina 1 satir: sorumlu personel (CSM), yasam dongusu asamasi, son saglik skoru.
--                            BILEREK tenants tablosuna sutun EKLENMEDI: tenants ofis kullanicilarina RLS ile acik ve
--                            ofis sahibi kendi satirini guncelleyebilir; CRM alanlari (asama, skor, sorumlu) yalniz platformundur.
--   platform_tenant_notes  : yapilandirilmis dahili notlar (kategori, sabitleme, duzenleme).
--   platform_tasks         : takip gorevi + hatirlatma tarihi; vadesi gelince sorumluya platform_notifications (cron).
--   tenant_health_daily    : gunluk saglik skoru trendi (gun x ofis tek satir; ayni gun tekrar = guncelleme).
--   admin_saved_views      : personel kayitli liste gorunumleri (saved_views'un admin kapsamli esi; staff_id bazli).
-- Fonksiyon: platform_tenant_health_inputs(p_since, p_now) -> ofis basina saglik girdileri (tek tur toplulastirma;
--   yalniz service_role). Skor hesabi uygulamada (src/lib/admin/health-score.ts, testli).
-- KOD DAVRANISI: tablolar/fonksiyon yokken liste "CRM kurulumu bekliyor" der, kolonlar bos kalir, cron adimi 'skipped' gecer.
-- GERI ALMA: supabase/rollbacks/20261013004400_platform_crm.rollback.sql
-- RISK: dusuk (yeni nesneler; mevcut tablo/politika/veri degismez; FK'ler tenants ve platform_staff'a).

create table if not exists public.tenant_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null default 'brand' check (color in ('brand', 'gold', 'success', 'warn', 'danger', 'neutral')),
  created_by uuid references public.platform_staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tenant_tags_name_uidx on public.tenant_tags (lower(btrim(name)));

create table if not exists public.tenant_tag_links (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tag_id uuid not null references public.tenant_tags(id) on delete cascade,
  created_by uuid references public.platform_staff(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, tag_id)
);
create index if not exists tenant_tag_links_tag_idx on public.tenant_tag_links (tag_id);

create table if not exists public.platform_tenant_crm (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  account_owner_staff_id uuid references public.platform_staff(id) on delete set null,
  lifecycle_stage text check (lifecycle_stage is null or lifecycle_stage in ('onboarding', 'aktif', 'risk', 'genisleme', 'kayip')),
  health_score smallint check (health_score is null or health_score between 0 and 100),
  health_scored_at timestamptz,
  updated_by uuid references public.platform_staff(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists platform_tenant_crm_owner_idx on public.platform_tenant_crm (account_owner_staff_id) where account_owner_staff_id is not null;
create index if not exists platform_tenant_crm_score_idx on public.platform_tenant_crm (health_score) where health_score is not null;

create table if not exists public.platform_tenant_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category text not null default 'genel' check (category in ('genel', 'gorusme', 'teknik', 'ticari', 'risk')),
  body text not null check (char_length(btrim(body)) between 3 and 2000),
  pinned boolean not null default false,
  author_staff_id uuid references public.platform_staff(id) on delete set null,
  edited_by uuid references public.platform_staff(id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists platform_tenant_notes_tenant_idx on public.platform_tenant_notes (tenant_id, pinned desc, created_at desc);

create table if not exists public.platform_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 160),
  body text check (body is null or char_length(body) <= 1000),
  assignee_staff_id uuid references public.platform_staff(id) on delete set null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done')),
  done_at timestamptz,
  notified_at timestamptz,
  created_by uuid references public.platform_staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists platform_tasks_tenant_idx on public.platform_tasks (tenant_id, status, due_at);
create index if not exists platform_tasks_assignee_idx on public.platform_tasks (assignee_staff_id, status, due_at);
-- Cron: vadesi gelmis, bildirilmemis acik gorevler.
create index if not exists platform_tasks_due_idx on public.platform_tasks (due_at) where status = 'open' and notified_at is null;

create table if not exists public.tenant_health_daily (
  day date not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  usage_score smallint not null check (usage_score between 0 and 100),
  payment_score smallint not null check (payment_score between 0 and 100),
  support_score smallint not null check (support_score between 0 and 100),
  inputs jsonb not null default '{}'::jsonb,
  weights jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  primary key (day, tenant_id)
);
create index if not exists tenant_health_daily_tenant_idx on public.tenant_health_daily (tenant_id, day desc);

create table if not exists public.admin_saved_views (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.platform_staff(id) on delete cascade,
  route text not null check (char_length(route) between 1 and 120),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists admin_saved_views_name_uidx on public.admin_saved_views (staff_id, route, lower(btrim(name)));

alter table public.tenant_tags enable row level security;
alter table public.tenant_tag_links enable row level security;
alter table public.platform_tenant_crm enable row level security;
alter table public.platform_tenant_notes enable row level security;
alter table public.platform_tasks enable row level security;
alter table public.tenant_health_daily enable row level security;
alter table public.admin_saved_views enable row level security;
alter table public.tenant_tags force row level security;
alter table public.tenant_tag_links force row level security;
alter table public.platform_tenant_crm force row level security;
alter table public.platform_tenant_notes force row level security;
alter table public.platform_tasks force row level security;
alter table public.tenant_health_daily force row level security;
alter table public.admin_saved_views force row level security;

-- Politika bilerek yok: yalniz service_role (sunucu, platform kapisindan sonra) okur/yazar.
revoke all privileges on table public.tenant_tags, public.tenant_tag_links, public.platform_tenant_crm, public.platform_tenant_notes,
  public.platform_tasks, public.tenant_health_daily, public.admin_saved_views from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_tags, public.tenant_tag_links, public.platform_tenant_crm,
  public.platform_tenant_notes, public.platform_tasks, public.tenant_health_daily, public.admin_saved_views to service_role;

-- Saglik girdileri: iptal edilmemis her ofis icin tek satir. Pencere [p_since, p_now].
--   login_days      : basarili girisin oldugu farkli TR gunu sayisi
--   active_users    : aktif profil sayisi (koltuk dolulugu payi)
--   extra_seats     : abonelikteki ek koltuk (koltuk tavani = paket koltugu + ek; paket koltugu uygulamada)
--   module_areas    : denetim kaydinda farkli is alani (eylem oneki; platform/oturum/disa aktarma onekleri haric)
--   open_tickets    : acik destek talebi (open, in_progress, waiting)
--   csat_avg/csat_n : pencere icindeki CSAT ortalamasi (1-5) ve adedi
--   overdue_invoices / max_overdue_days : vadesi gecmis acik fatura sayisi ve en eski gecikme (gun)
create or replace function public.platform_tenant_health_inputs(p_since timestamptz, p_now timestamptz)
returns table (
  tenant_id uuid,
  status text,
  plan text,
  sub_status text,
  login_days integer,
  active_users integer,
  extra_seats integer,
  module_areas integer,
  open_tickets integer,
  csat_avg numeric,
  csat_n integer,
  overdue_invoices integer,
  max_overdue_days integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select x.id, x.status, x.plan from public.tenants x where x.status <> 'cancelled'
  ),
  lg as (
    select l.tenant_id, count(distinct (l.created_at at time zone 'Europe/Istanbul')::date)::int as days
    from public.login_events l
    where l.result = 'success' and l.created_at >= p_since and l.created_at <= p_now and l.tenant_id is not null
    group by l.tenant_id
  ),
  pr as (
    select p.tenant_id, count(*)::int as n from public.profiles p where p.is_active = true group by p.tenant_id
  ),
  sb as (
    select distinct on (s.tenant_id) s.tenant_id, s.status, coalesce(s.extra_seats, 0)::int as extra
    from public.subscriptions s
    order by s.tenant_id, (s.status = 'active') desc, s.updated_at desc nulls last
  ),
  au as (
    select a.tenant_id, count(distinct split_part(a.action, '.', 1))::int as n
    from public.audit_logs a
    where a.created_at >= p_since and a.created_at <= p_now and a.tenant_id is not null
      and split_part(a.action, '.', 1) not in ('ops', 'export', 'sample_data', 'settings', 'team', 'tenant', 'billing', 'subscription', 'kvkk', 'auth', 'ticket', 'referral', 'referral_link')
    group by a.tenant_id
  ),
  tk as (
    select k.tenant_id, count(*)::int as n from public.support_tickets k
    where k.status in ('open', 'in_progress', 'waiting') group by k.tenant_id
  ),
  cs as (
    select c.tenant_id, avg(c.score)::numeric(4,2) as avg_score, count(*)::int as n from public.support_ticket_csat c
    where c.created_at >= p_since and c.created_at <= p_now group by c.tenant_id
  ),
  iv as (
    select i.tenant_id, count(*)::int as n,
      max(greatest(0, floor(extract(epoch from (p_now - i.due_at)) / 86400)))::int as max_days
    from public.invoices i
    where i.status = 'open' and i.due_at is not null and i.due_at < p_now
    group by i.tenant_id
  )
  select t.id, t.status, t.plan, sb.status,
    coalesce(lg.days, 0), coalesce(pr.n, 0), coalesce(sb.extra, 0), coalesce(au.n, 0), coalesce(tk.n, 0),
    cs.avg_score, coalesce(cs.n, 0), coalesce(iv.n, 0), coalesce(iv.max_days, 0)
  from t
  left join lg on lg.tenant_id = t.id
  left join pr on pr.tenant_id = t.id
  left join sb on sb.tenant_id = t.id
  left join au on au.tenant_id = t.id
  left join tk on tk.tenant_id = t.id
  left join cs on cs.tenant_id = t.id
  left join iv on iv.tenant_id = t.id
  order by t.id;
$$;

revoke all on function public.platform_tenant_health_inputs(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.platform_tenant_health_inputs(timestamptz, timestamptz) to service_role;

comment on table public.tenant_tags is 'AD5 Ofis CRM: renkli ofis etiketleri (yalniz platform personeli, service_role).';
comment on table public.platform_tenant_crm is 'AD5 Ofis CRM: sorumlu personel, yasam dongusu asamasi, son saglik skoru (ofis goremez).';
comment on table public.platform_tasks is 'AD5 Ofis CRM: platform takip gorevleri; vadesi gelen sorumlunun bildirim kutusuna duser.';
comment on table public.tenant_health_daily is 'AD5 Ofis CRM: gunluk bilesik saglik skoru trendi (0-100).';
comment on table public.admin_saved_views is 'AD5 Ofis CRM: personel kayitli liste gorunumleri (admin kapsami).';

notify pgrst, 'reload schema';
