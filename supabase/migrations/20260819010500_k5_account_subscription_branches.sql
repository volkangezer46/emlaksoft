-- K5: ofis hesabi / abonelik / sube (forward-only, yeniden calistirilabilir).
-- 1) subscriptions: donem sonunda iptal talebi (cancel_at_period_end).
--    Kod bu kolonlar yokken ozelligi gizler; abonelik-kontrol cron'u dolunca iptal eder.
-- 2) branches.phone: sube telefonu (TR 05XXXXXXXXX veya +E.164; dogrulama sunucuda).
-- Mevcut RLS politikalari degismez; iptal talebi sunucuda service_role ile, tenant filtreli yazilir.

alter table public.subscriptions
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_reason text;

alter table public.branches
  add column if not exists phone text;

comment on column public.subscriptions.cancel_at_period_end is
  'true: ofis iptal talep etti; donem sonuna kadar kullanim surer, sonra abonelik iptal edilir.';
comment on column public.branches.phone is
  'Sube telefonu (TR cep 05XXXXXXXXX veya +E.164).';

notify pgrst, 'reload schema';
