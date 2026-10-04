-- Rollback: 20260823000500_sec3_advisor_private_pii_format_guard
-- UYARI: güvenlik bulgusu #13 yeniden açılır (*_enc sütunlarına açık değer yazılabilir). Veri değişmez.

alter table public.advisor_private drop constraint if exists advisor_private_national_id_enc_format_chk;
alter table public.advisor_private drop constraint if exists advisor_private_iban_enc_format_chk;
alter table public.advisor_private drop constraint if exists advisor_private_national_id_pair_chk;
alter table public.advisor_private drop constraint if exists advisor_private_iban_pair_chk;
