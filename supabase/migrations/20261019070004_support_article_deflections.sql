-- MIGRATION 20261019070004_support_article_deflections.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: tablo yokken yeni talep formundaki makale onerileri yine gorunur,
--   "Bu sorunumu cozdu" kaydi yazilmaz (kullanici yine yonlendirilir) ve destek raporundaki "makaleyle cozulen" karti
--   "olcum kurulum bekliyor" der.
-- Geri alma: supabase/rollbacks/20261019070004_support_article_deflections.rollback.sql (tablo duser; olcum gecmisi silinir).
-- BAGIMLILIK: 20261013005100 (help_articles kind/slug bicimi; FK yok, kod makaleleri de slug ile anilir).
--
-- NE (PA-7, Zendesk Answer Bot / Intercom "deflection"): ofis kullanicisi yeni talep yazarken onerilen yardim makalesi
--   sorununu cozdugunde talep ACILMADAN kaydedilir: hangi makale (kind, slug), hangi ofis/kullanici, konu metninin ilk
--   200 karakteri (kisisel veri girilmemesi formda soylenir). Yalniz service_role yazar/okur (sunucu eylemi
--   support:create yetkisini dogrular); RLS + FORCE, politika yok.
set local lock_timeout = '5s';

create table if not exists public.support_article_deflections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null,
  slug text not null,
  query text,
  created_at timestamptz not null default now(),
  constraint support_article_deflections_kind check (kind in ('guide', 'faq')),
  constraint support_article_deflections_slug check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  constraint support_article_deflections_query check (query is null or char_length(query) <= 200)
);

create index if not exists idx_support_article_deflections_created on public.support_article_deflections (created_at desc);
create index if not exists idx_support_article_deflections_tenant on public.support_article_deflections (tenant_id, created_at desc);
create index if not exists idx_support_article_deflections_article on public.support_article_deflections (kind, slug);

alter table public.support_article_deflections enable row level security;
alter table public.support_article_deflections force row level security;
revoke all privileges on table public.support_article_deflections from public, anon, authenticated;
grant select, insert, delete on table public.support_article_deflections to service_role;

comment on table public.support_article_deflections is 'PA-7: yeni talep formunda yardim makalesiyle cozulen (acilmayan) talepler. Yalniz service_role.';
