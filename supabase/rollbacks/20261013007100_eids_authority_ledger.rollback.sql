-- 20261013007100 geri alma: EİDS yetki defteri, aday fonksiyonu ve genişletilmiş durum kaldırılır.
-- UYARI: olay geçmişi (kim, ne zaman, hangi kaynak), istisna bayrakları, maskeli malik adı, kaynak ve teyit/e-posta
-- zamanları SİLİNİR. Durumlar eski üçlüye indirgenir: unknown/expired -> pending, revoked -> rejected.
-- customers.full_name trigram indeksi BIRAKILIR (canlıda bu migration'dan önce de vardı).
set local lock_timeout = '5s';

drop function if exists public.eids_authority_candidates(uuid, text, integer);
drop function if exists public.eids_undo_authority_event(uuid, uuid, text);
drop function if exists public.eids_apply_authority_event(uuid, uuid, jsonb);

drop table if exists public.eids_authority_events;
drop function if exists public.eids_authority_events_append_only();

alter table public.properties drop constraint if exists properties_authority_eids_status_check;
update public.properties
   set authority_eids_status = case authority_eids_status when 'revoked' then 'rejected' else 'pending' end
 where authority_eids_status in ('unknown', 'expired', 'revoked');
alter table public.properties alter column authority_eids_status set default 'pending';
alter table public.properties
  add constraint properties_authority_eids_status_check
  check (authority_eids_status in ('pending', 'approved', 'rejected'));

alter table public.properties drop constraint if exists properties_authority_eids_source_check;
alter table public.properties drop constraint if exists properties_eids_exempt_reason_check;
alter table public.properties drop constraint if exists properties_authority_grantor_masked_len_check;
alter table public.properties
  drop column if exists authority_eids_source,
  drop column if exists authority_eids_verified_at,
  drop column if exists authority_grantor_masked,
  drop column if exists eids_exempt_reason,
  drop column if exists authority_last_email_at;
