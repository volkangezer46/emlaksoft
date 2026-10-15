-- MIGRATION 20261019040002_contract_signature_evidence.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: sutunlar yokken imza akisi aynen calisir; kanit alanlari yazilmaz,
--   sertifika sayfasi "icerik ozeti kaydedilmemis" der, dogrulama sayfasi kodu bulamaz.
-- Geri alma: supabase/rollbacks/20261019040002_contract_signature_evidence.rollback.sql
-- BAGIMLILIK: public.contracts, public.contract_signers.
--
-- NE (SP8, imza tamamlama sertifikasi):
--   contracts.body_sha256: imzaya gonderimde kilitlenen icerik ozeti (baslik + govde, normalize; kod: src/lib/contract-evidence.ts).
--   contracts.verify_code: herkese acik dogrulama kodu (12 karakter, Crockford base32; tahmin edilemez, benzersiz).
--   contract_signers.signed_body_sha256 / signed_user_agent / signed_ip_hash / otp_channel: imzaci basina kanit.
--   Kilit tetigi: ozet yazildiktan sonra baslik/govde ozet birlikte degismeden degistirilemez (service_role dahil).
--   Metin hukuki gecerlilik iddiasi tasimaz: SMS OTP basit elektronik imzadir, nitelikli e-imza degildir.
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.contracts') is null or pg_catalog.to_regclass('public.contract_signers') is null then
    raise exception 'contracts/contract_signers yok; once temel migrationlar uygulanmali.';
  end if;
end $$;

alter table public.contracts add column if not exists body_sha256 text;
alter table public.contracts add column if not exists verify_code text;
alter table public.contracts add column if not exists evidence_locked_at timestamptz;
alter table public.contract_signers add column if not exists signed_body_sha256 text;
alter table public.contract_signers add column if not exists signed_user_agent text;
alter table public.contract_signers add column if not exists signed_ip_hash text;
alter table public.contract_signers add column if not exists otp_channel text;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'contracts_body_sha256_check') then
    alter table public.contracts add constraint contracts_body_sha256_check
      check (body_sha256 is null or body_sha256 ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'contracts_verify_code_check') then
    alter table public.contracts add constraint contracts_verify_code_check
      check (verify_code is null or verify_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'contract_signers_evidence_check') then
    alter table public.contract_signers add constraint contract_signers_evidence_check
      check (
        (signed_body_sha256 is null or signed_body_sha256 ~ '^[0-9a-f]{64}$')
        and (signed_ip_hash is null or signed_ip_hash ~ '^[0-9a-f]{64}$')
        and (signed_user_agent is null or char_length(signed_user_agent) <= 400)
        and (otp_channel is null or otp_channel in ('sms', 'none'))
      );
  end if;
end $$;

create unique index if not exists idx_contracts_verify_code on public.contracts (verify_code) where verify_code is not null;

create or replace function public.guard_contract_evidence_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.body_sha256 is not null
     and (new.body is distinct from old.body or new.title is distinct from old.title)
     and new.body_sha256 is not distinct from old.body_sha256 then
    raise exception 'Imzaya gonderilmis sozlesmenin metni degistirilemez; yeni surum olusturun.' using errcode = '42501';
  end if;
  if old.verify_code is not null and new.verify_code is distinct from old.verify_code then
    raise exception 'Dogrulama kodu degistirilemez.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists contracts_guard_evidence_lock on public.contracts;
create trigger contracts_guard_evidence_lock
before update of body, title, body_sha256, verify_code on public.contracts
for each row execute function public.guard_contract_evidence_lock();

comment on column public.contracts.body_sha256 is 'SP8: imzaya gonderimde kilitlenen icerik ozeti (SHA-256, baslik + govde normalize).';
comment on column public.contracts.verify_code is 'SP8: herkese acik dogrulama kodu (/imza/dogrula/<kod>); kisisel veri gostermez.';
comment on column public.contract_signers.signed_ip_hash is 'SP8: imza anindaki IP adresinin HMAC/SHA-256 ozeti (ham IP ip_address sutununda ofis icin kalir).';
