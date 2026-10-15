-- MIGRATION 20261018090200_kvkk_subject_exports.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: tablo yokken "Veri dokumu olustur" dugmesi "bu ortamda etkin degil" der.
-- Geri alma: supabase/rollbacks/20261018090200_kvkk_subject_exports.rollback.sql (tablo duser; dokumler silinir,
--   islem izi audit_logs'ta kalir).
-- BAGIMLILIK: 20260819010600 (kvkk_requests), current_active_tenant_id / has_effective_permission son govdeleri.
--
-- NE (arastirma 7, KVKK veri sahibi erisim / tasinabilirlik dokumu):
--   kvkk_subject_exports: talebe bagli, DEGISMEZ dokum anlik goruntusu (JSON) + SHA-256 + bolum sayilari.
--   - Yazma YALNIZ service_role (sunucu eylemi compliance:edit yetkisini dogrular, sonra yazar); guncelleme/silme yok.
--   - Okuma: ayni ofis + compliance:view (RLS) ve yalniz suresi dolmamis dokum.
--   - Saklama: dokum kisisel veri icerir; 90 gun sonra okunmaz (expires_at), yeni dokum uretilirken ofisin suresi
--     dolmus dokumleri silinir. Talep kaydi ve islem izi (audit_logs) kalir.
set local lock_timeout = '5s';

create table if not exists public.kvkk_subject_exports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null references public.kvkk_requests(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  payload jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  item_counts jsonb not null default '{}'::jsonb,
  constraint kvkk_subject_exports_expiry_order check (expires_at > generated_at)
);

create index if not exists idx_kvkk_subject_exports_request
  on public.kvkk_subject_exports (tenant_id, request_id, generated_at desc);
create index if not exists idx_kvkk_subject_exports_expiry
  on public.kvkk_subject_exports (tenant_id, expires_at);

alter table public.kvkk_subject_exports enable row level security;

drop policy if exists kvkk_subject_exports_tenant_select on public.kvkk_subject_exports;
create policy kvkk_subject_exports_tenant_select on public.kvkk_subject_exports
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('compliance'::text, 'view'::text))
    and expires_at > now()
  );

revoke all privileges on table public.kvkk_subject_exports from public, anon, authenticated, service_role;
grant select on table public.kvkk_subject_exports to authenticated;
grant select, insert, delete on table public.kvkk_subject_exports to service_role;

comment on table public.kvkk_subject_exports is
  'Arastirma 7: KVKK veri sahibi dokumu (degismez JSON + SHA-256), talebe bagli; yazma yalniz service_role, okuma compliance:view; 90 gun saklama.';
