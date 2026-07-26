-- Sözleşme imzalayanları için SMS OTP doğrulama alanları (/imza/[token] akışı).
-- Kod düz metin SAKLANMAZ: yalnızca sha256 hex hash'i (otp_hash) tutulur.
-- otp_expires_at : kodun geçerlilik sonu (5 dk)
-- otp_attempts   : hatalı deneme sayacı (5'te kilit — yeni kod istenir)
-- verified_at    : doluysa imzalayan telefonunu SMS koduyla doğrulamıştır
--                  ("SMS ile doğrulandı" rozeti bu alandan okunur)
alter table public.contract_signers
  add column if not exists otp_hash       text,
  add column if not exists otp_expires_at timestamptz,
  add column if not exists otp_attempts   integer not null default 0,
  add column if not exists verified_at    timestamptz;
