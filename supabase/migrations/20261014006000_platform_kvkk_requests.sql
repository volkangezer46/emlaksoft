-- DG6 KVKK veri sahibi talep akışı (platform düzeyi): herkese açık başvuru formu (/kvkk-basvuru) + e-posta doğrulama
-- kodu, admin kuyruğu (30 gün yasal süre sayacı), kimlik doğrulama adımı, veri paketi hazırlığı (dosya Raporlar >
-- "KVKK veri paketi"), silme (mevcut anonymize_customer akışı; yasal saklama kayıtları korunur), yanıt (AD7 kvkk_reply)
-- ve sonuç kaydı. Denetim izi platform_audit_logs'tadır (entity_type 'kvkk_request').
--
-- NE:
--   (1) platform_kvkk_requests: başvuru satırı. Ofislerin kendi kaydettiği kvkk_requests'ten AYRIDIR (o tablo ofisin
--       veri sorumlusu olduğu kayıtlar içindir; bu tablo EmlakSoft'a doğrudan gelen başvurulardır).
--       status: awaiting_email (kod bekleniyor; kuyrukta görünmez, 7 günde silinir) -> open -> in_progress ->
--       completed | rejected. due_at = başvuru + 30 gün (KVKK m.13), e-posta doğrulanınca yazılır.
--       Doğrulama kodu DÜZ SAKLANMAZ (HMAC özeti, otp-hmac.ts). E-posta yanıt gönderimi için düz tutulur; eşleşme
--       ve tekrar freni email_hash (SHA-256) ile yapılır.
--   (2) alert_rules: 'kvkk_sla' kuralı (AD10 uyarı motoru; eşik = kalan gün). CHECK kısıtı mevcut tanımdan türetilerek
--       genişletilir: başka bir paketin eklediği anahtarlar korunur (liste elle yeniden yazılmaz).
-- ERİŞİM: RLS açık + FORCE, politika yok, anon/authenticated REVOKE; yalnız service_role (sunucu eylemleri kapılıdır).
-- KOD: tablo yokken form "başvuru alınamıyor, e-posta ile yazın" der, admin kuyruğu "kurulum bekliyor" gösterir,
--      uyarı kuralı veri okuyamadığından değerlendirilmez.
-- GERİ ALMA: supabase/rollbacks/20261014006000_platform_kvkk_requests.rollback.sql.
-- RİSK: düşük (yeni tablo + alert_rules CHECK genişlemesi ve tek tohum satırı; mevcut veri değişmez).

set local lock_timeout = '5s';

create table if not exists public.platform_kvkk_requests (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  request_type text not null,
  status text not null default 'awaiting_email',
  requester_name text not null,
  email text not null,
  email_hash text not null,
  phone text,
  office_hint text,
  details text not null,
  verify_code_hash text,
  verify_expires_at timestamptz,
  verify_attempts integer not null default 0,
  verify_sent_count integer not null default 1,
  email_verified_at timestamptz,
  due_at timestamptz,
  identity_status text not null default 'pending',
  identity_method text,
  identity_note text,
  identity_checked_at timestamptz,
  identity_checked_by uuid references public.platform_staff(id) on delete set null,
  assignee_id uuid references public.platform_staff(id) on delete set null,
  package_prepared_at timestamptz,
  package_prepared_by uuid references public.platform_staff(id) on delete set null,
  package_summary jsonb,
  erasure_applied_at timestamptz,
  erasure_applied_by uuid references public.platform_staff(id) on delete set null,
  erasure_result jsonb,
  response_text text,
  response_sent_at timestamptz,
  response_delivery text,
  resolved_at timestamptz,
  resolved_by uuid references public.platform_staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_kvkk_requests_ref check (ref ~ '^KVKK-[0-9]{4}-[0-9A-Z]{6}$'),
  constraint platform_kvkk_requests_type check (request_type in ('access', 'rectification', 'erasure', 'portability', 'objection')),
  constraint platform_kvkk_requests_status check (status in ('awaiting_email', 'open', 'in_progress', 'completed', 'rejected')),
  constraint platform_kvkk_requests_name_len check (char_length(btrim(requester_name)) between 2 and 120),
  constraint platform_kvkk_requests_email_len check (char_length(email) between 5 and 254),
  constraint platform_kvkk_requests_email_hash check (email_hash ~ '^[0-9a-f]{64}$'),
  constraint platform_kvkk_requests_phone_len check (phone is null or char_length(phone) between 7 and 20),
  constraint platform_kvkk_requests_office_len check (office_hint is null or char_length(office_hint) <= 160),
  constraint platform_kvkk_requests_details_len check (char_length(details) between 10 and 4000),
  constraint platform_kvkk_requests_attempts check (verify_attempts between 0 and 50),
  constraint platform_kvkk_requests_sent check (verify_sent_count between 0 and 50),
  constraint platform_kvkk_requests_identity check (identity_status in ('pending', 'verified', 'failed')),
  constraint platform_kvkk_requests_identity_method check (
    identity_method is null or identity_method in ('email_document', 'e_signature', 'kep', 'notary', 'in_person', 'other')
  ),
  constraint platform_kvkk_requests_identity_note_len check (identity_note is null or char_length(identity_note) <= 1000),
  constraint platform_kvkk_requests_summary_obj check (package_summary is null or jsonb_typeof(package_summary) = 'object'),
  constraint platform_kvkk_requests_erasure_obj check (erasure_result is null or jsonb_typeof(erasure_result) = 'object'),
  constraint platform_kvkk_requests_response_len check (response_text is null or char_length(response_text) <= 4000),
  constraint platform_kvkk_requests_delivery check (
    response_delivery is null or response_delivery in ('sent', 'failed', 'disabled', 'suppressed')
  ),
  -- Doğrulanmış başvuruda son tarih zorunlu (SLA sayacı boş kalamaz).
  constraint platform_kvkk_requests_due check (status = 'awaiting_email' or due_at is not null)
);

create index if not exists platform_kvkk_requests_queue_idx
  on public.platform_kvkk_requests (status, due_at);
create index if not exists platform_kvkk_requests_email_idx
  on public.platform_kvkk_requests (email_hash, created_at desc);
create index if not exists platform_kvkk_requests_unverified_idx
  on public.platform_kvkk_requests (created_at) where status = 'awaiting_email';

alter table public.platform_kvkk_requests enable row level security;
alter table public.platform_kvkk_requests force row level security;
-- Politika bilerek yok: anon/authenticated hiçbir şey göremez; service_role RLS'i atlar.
revoke all privileges on table public.platform_kvkk_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_kvkk_requests to service_role;

-- (2) AD10 uyarı kuralı: KVKK yanıt süresi. CHECK kısıtı mevcut tanımdan genişletilir (başka paketlerin anahtarları kalır).
do $$
declare
  v_def text;
begin
  if to_regclass('public.alert_rules') is null then
    return; -- AD10 henüz yok: kural kod varsayılanıyla çalışır, tohum satırı AD10 sonrası gerekmez
  end if;
  select pg_catalog.pg_get_constraintdef(c.oid)
    into v_def
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.alert_rules'::regclass and c.conname = 'alert_rules_key';
  if v_def is not null and position('''kvkk_sla''' in v_def) = 0 then
    if position('ARRAY[' in v_def) = 0 then
      raise exception 'alert_rules_key beklenen biçimde değil: %', v_def;
    end if;
    alter table public.alert_rules drop constraint alert_rules_key;
    execute format('alter table public.alert_rules add constraint alert_rules_key %s', replace(v_def, 'ARRAY[', 'ARRAY[''kvkk_sla''::text, '));
  end if;
  insert into public.alert_rules (key, enabled, threshold, repeat_minutes) values
    ('kvkk_sla', true, 3, 1440)
  on conflict (key) do nothing;
end $$;

notify pgrst, 'reload schema';
