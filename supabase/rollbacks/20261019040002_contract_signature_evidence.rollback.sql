-- 20261019040002 geri alma: imza kanit alanlari, dogrulama kodu ve metin kilidi duser. Imzalar ve imza zamani/IP
--   (ip_address, signed_at, verified_at) korunur; dogrulama baglantilari calismaz.
set local lock_timeout = '5s';

drop trigger if exists contracts_guard_evidence_lock on public.contracts;
drop function if exists public.guard_contract_evidence_lock();
drop index if exists public.idx_contracts_verify_code;
alter table public.contracts drop constraint if exists contracts_body_sha256_check;
alter table public.contracts drop constraint if exists contracts_verify_code_check;
alter table public.contract_signers drop constraint if exists contract_signers_evidence_check;
alter table public.contracts drop column if exists body_sha256;
alter table public.contracts drop column if exists verify_code;
alter table public.contracts drop column if exists evidence_locked_at;
alter table public.contract_signers drop column if exists signed_body_sha256;
alter table public.contract_signers drop column if exists signed_user_agent;
alter table public.contract_signers drop column if exists signed_ip_hash;
alter table public.contract_signers drop column if exists otp_channel;
