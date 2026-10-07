-- Rollback: 20261007000720_contract_signer_reminder
-- RPC'ler ve hatırlatma sütunları düşer. Daha önce SMS ile gönderilmiş kısa bağlantılar (`/imza/k/<kod>`) çalışmaz hâle gelir;
-- imzacı tam bağlantıyla (WhatsApp/kopyala) imzalamaya devam eder. Kod RPC yokken "SMS ile hatırlat" düğmesini gizler.

set local lock_timeout = '5s';

drop function if exists public.contract_signer_resolve_short(text);
drop function if exists public.contract_signer_reminder_payload(uuid, uuid);
drop index if exists public.uq_contract_signers_short_code;
alter table public.contract_signers drop constraint if exists contract_signers_short_code_format;
alter table public.contract_signers
  drop column if exists last_reminded_at,
  drop column if exists reminder_count,
  drop column if exists short_code;

notify pgrst, 'reload schema';
