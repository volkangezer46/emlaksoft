-- Faz 2 / 01: `earnings_all` (başkasının kazancını görme) izninin permission_defaults seed'i.
--
-- NEDEN: src/lib/permissions.ts DEFAULT_MATRIX'te `earnings_all` var (owner ALL, gm VIEW,
-- accounting VIEW); DB kopyasında yok. 05 numaralı migration RLS'te
-- has_effective_permission('earnings_all','view') kullanacağı için seed ŞARTTIR; yoksa
-- fonksiyon false döner ve owner/gm/accounting bile kazançları göremez.
-- Şema değişikliği YOK; yalnız seed. Idempotent (on conflict do nothing).
-- GERİ ALMA: rollbacks/20260816000100_earnings_all_permission_defaults.rollback.sql
-- RİSK: düşük. Kullanıcı istisnaları (user_permission_overrides) ve tenant override'ları etkilenmez.

insert into public.permission_defaults (role, module, action)
select 'owner', 'earnings_all', a
from (values ('view'), ('create'), ('edit'), ('delete')) as acts(a)
on conflict do nothing;

insert into public.permission_defaults (role, module, action)
values ('gm', 'earnings_all', 'view'),
       ('accounting', 'earnings_all', 'view')
on conflict do nothing;
