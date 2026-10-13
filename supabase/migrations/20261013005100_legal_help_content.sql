-- AD12 — Koda dokunmadan içerik: sürümlü yasal belgeler, yeniden onay kayıtları, tarihli mevzuat sabitleri, yardım merkezi.
--
-- NE: (1) `legal_documents`: 8 herkese açık yasal sayfanın sürümlü metni (slug + version; taslak > yayın > arşiv).
--         Yayında satır yoksa sayfa koddaki sürümü (v1) gösterir. Slug başına en çok BİR taslak.
--     (2) `legal_consents`: yeniden onay gerektiren sürümün kullanıcı onayı (belge + sürüm + an + IP + tarayıcı).
--         accepted_at sunucu/DB zamanıdır; IP yalnız sunucu eylemi yazar (tarayıcıdan alınmaz).
--     (3) `legal_constants`: mevzuat sabiti için geçerlilik tarihli değer geçmişi (key + valid_from tekil).
--         Kayıt yoksa koddaki değer (src/lib/legal-constants) geçerlidir; geleceğe tarihli kayıt o güne kadar uygulanmaz.
--     (4) `help_articles`: yardım merkezi makaleleri (rehber / SSS / sözlük); koddaki içeriği aynı slug ile geçersiz
--         kılar ya da gizler (status hidden), yenisini ekler. `draft` jsonb yayındaki metne dokunmadan bekleyen düzenlemedir.
--     (5) `help_article_votes`: "işe yaradı mı" oyu (kullanıcı başına makale başına tek oy; slug ile, kod makaleleri dahil).
-- ERİŞİM: hepsi RLS açık + FORCE, tüm roller REVOKE; yalnız service_role (platform personeli ve kullanıcı kapıları
--         uygulama katmanında: guardPlatformAction / getRequestUser).
-- KOD: tablolar yokken yasal sayfalar ve yardım merkezi koddaki içerikle (bugünkü haliyle) çalışır, yeniden onay
--      penceresi çıkmaz, admin ekranları "kurulum bekliyor" gösterir.
-- GERİ ALMA: rollbacks/20261013005100_legal_help_content.rollback.sql (UYARI: onay kayıtları ve makaleler silinir).
-- RİSK: düşük; yalnız yeni tablolar, mevcut nesnelere dokunmaz.

set local lock_timeout = '5s';

create table if not exists public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  version integer not null,
  status text not null default 'draft',
  title text not null,
  intro text not null default '',
  body text not null,
  requires_reconsent boolean not null default false,
  change_note text,
  published_at timestamptz,
  created_by uuid,
  published_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_documents_slug check (slug in (
    'kullanim-sartlari', 'gizlilik', 'kvkk-aydinlatma', 'cerez-politikasi',
    'mesafeli-satis', 'on-bilgilendirme', 'iptal-iade', 'davet-kosullari'
  )),
  constraint legal_documents_status check (status in ('draft', 'published', 'archived')),
  constraint legal_documents_version check (version between 1 and 100000),
  constraint legal_documents_title_len check (char_length(btrim(title)) between 1 and 200),
  constraint legal_documents_intro_len check (char_length(intro) <= 1000),
  constraint legal_documents_body_len check (char_length(body) between 1 and 200000),
  constraint legal_documents_note_len check (change_note is null or char_length(change_note) <= 500),
  constraint legal_documents_published_at check (status = 'draft' or published_at is not null),
  constraint legal_documents_slug_version unique (slug, version)
);

-- Slug başına tek taslak.
create unique index if not exists legal_documents_one_draft on public.legal_documents (slug) where status = 'draft';
create index if not exists legal_documents_slug_published on public.legal_documents (slug, version desc) where status <> 'draft';

create table if not exists public.legal_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  document text not null,
  version integer not null,
  accepted_at timestamptz not null default now(),
  ip text,
  user_agent text,
  constraint legal_consents_document check (char_length(document) between 1 and 60),
  constraint legal_consents_version check (version between 1 and 100000),
  constraint legal_consents_ip_len check (ip is null or char_length(ip) between 1 and 128),
  constraint legal_consents_ua_len check (user_agent is null or char_length(user_agent) <= 512),
  constraint legal_consents_unique unique (user_id, document, version)
);

create index if not exists legal_consents_document_idx on public.legal_consents (document, version, accepted_at desc);
create index if not exists legal_consents_tenant_idx on public.legal_consents (tenant_id);

comment on column public.legal_consents.accepted_at is 'Sunucu/DB zamanı; tarayıcıdan alınmaz.';
comment on column public.legal_consents.ip is 'Onay anındaki istemci IP (sunucu eylemi istek başlığından yazar).';

create table if not exists public.legal_constants (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value numeric not null,
  valid_from date not null,
  note text,
  source text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint legal_constants_key check (key ~ '^[A-Za-z][A-Za-z0-9_]{1,60}$'),
  constraint legal_constants_note_len check (note is null or char_length(note) <= 500),
  constraint legal_constants_source_len check (source is null or char_length(source) <= 500),
  constraint legal_constants_key_from unique (key, valid_from)
);

create index if not exists legal_constants_key_idx on public.legal_constants (key, valid_from desc);

create table if not exists public.help_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  kind text not null,
  category text,
  status text not null default 'draft',
  title text not null,
  summary text not null default '',
  body text not null default '',
  href text,
  href_label text,
  sort integer not null default 100,
  -- Yayındaki metne dokunmadan bekleyen düzenleme ({title, summary, body, category, href, href_label}).
  draft jsonb,
  published_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint help_articles_slug check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  constraint help_articles_kind check (kind in ('guide', 'faq', 'glossary')),
  constraint help_articles_status check (status in ('draft', 'published', 'hidden')),
  constraint help_articles_title_len check (char_length(btrim(title)) between 1 and 200),
  constraint help_articles_summary_len check (char_length(summary) <= 1000),
  constraint help_articles_body_len check (char_length(body) <= 20000),
  constraint help_articles_href check (href is null or href ~ '^/[^/]'),
  constraint help_articles_href_label_len check (href_label is null or char_length(href_label) <= 80),
  constraint help_articles_draft_obj check (draft is null or jsonb_typeof(draft) = 'object'),
  constraint help_articles_kind_slug unique (kind, slug)
);

create index if not exists help_articles_status_idx on public.help_articles (status, kind, sort);

create table if not exists public.help_article_votes (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  slug text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  helpful boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint help_article_votes_kind check (kind in ('guide', 'faq', 'glossary')),
  constraint help_article_votes_slug check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  constraint help_article_votes_unique unique (kind, slug, user_id)
);

create index if not exists help_article_votes_slug_idx on public.help_article_votes (kind, slug);
create index if not exists help_article_votes_tenant_idx on public.help_article_votes (tenant_id);

comment on table public.legal_documents is 'AD12: sürümlü yasal sayfa metinleri (taslak/yayın/arşiv). Yalnız service_role.';
comment on table public.legal_consents is 'AD12: yeniden onay kayıtları (belge, sürüm, an, IP). Yalnız service_role.';
comment on table public.legal_constants is 'AD12: mevzuat sabiti geçerlilik tarihli değer geçmişi. Yalnız service_role.';
comment on table public.help_articles is 'AD12: yardım merkezi makaleleri (kod içeriğini slug ile geçersiz kılar/gizler). Yalnız service_role.';
comment on table public.help_article_votes is 'AD12: yardım makalesi "işe yaradı mı" oyları. Yalnız service_role.';

do $$
declare t text;
begin
  foreach t in array array['legal_documents', 'legal_consents', 'legal_constants', 'help_articles', 'help_article_votes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
