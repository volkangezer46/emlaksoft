-- Public demo / geri aranma hunisi: kanıtlanabilir rıza, kullanıcı takip numarası
-- ve çift tıklama / ağ tekrarı için kalıcı idempotency sözleşmesi.

alter table public.demo_requests
  add column if not exists reference_code text,
  add column if not exists idempotency_key_hash text,
  add column if not exists consent_at timestamptz,
  add column if not exists consent_scope text,
  add column if not exists consent_version text;

-- Eski satış kayıtlarına da destek ekibinin kullanabileceği kararlı bir referans
-- ver; geçmiş satırlar için sonradan rıza varmış gibi veri üretme.
update public.demo_requests
set reference_code = 'DM-LEGACY-' || upper(substr(replace(id::text, '-', ''), 1, 16))
where reference_code is null;

alter table public.demo_requests
  alter column reference_code set default (
    'DM-' || to_char(current_date, 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
  ),
  alter column reference_code set not null;

create unique index if not exists idx_demo_requests_reference_code
  on public.demo_requests(reference_code);

create unique index if not exists idx_demo_requests_idempotency_hash
  on public.demo_requests(idempotency_key_hash)
  where idempotency_key_hash is not null;

alter table public.demo_requests
  drop constraint if exists demo_requests_reference_code_format,
  add constraint demo_requests_reference_code_format check (
    reference_code ~ '^DM-([0-9]{8}-[A-F0-9]{12}|LEGACY-[A-F0-9]{16})$'
  ),
  drop constraint if exists demo_requests_idempotency_hash_format,
  add constraint demo_requests_idempotency_hash_format check (
    idempotency_key_hash is null or idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  drop constraint if exists demo_requests_consent_complete,
  add constraint demo_requests_consent_complete check (
    (consent_at is null and consent_scope is null and consent_version is null)
    or
    (consent_at is not null and consent_scope is not null and consent_version is not null)
  ),
  drop constraint if exists demo_requests_callback_intake_complete,
  add constraint demo_requests_callback_intake_complete check (
    source <> 'demo_callback_form'
    or (
      idempotency_key_hash is not null
      and consent_at is not null
      and consent_scope = 'demo_callback'
      and consent_version is not null
    )
  );

comment on column public.demo_requests.reference_code is
  'Kullanıcıya gösterilen benzersiz demo talebi takip numarası';
comment on column public.demo_requests.idempotency_key_hash is
  'Form oturumu anahtarı + normalize telefonun SHA-256 özeti; ham anahtar saklanmaz';
comment on column public.demo_requests.consent_at is
  'Demo geri araması için açık rızanın sunucuda kaydedildiği zaman';
comment on column public.demo_requests.consent_scope is
  'Rızanın amaç kapsamı; public form için demo_callback';
comment on column public.demo_requests.consent_version is
  'Kullanıcının onayladığı açık rıza metni sürümü';
