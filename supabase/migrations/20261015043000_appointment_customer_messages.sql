-- MIGRATION 20261015043000_appointment_customer_messages.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261015043000_appointment_customer_messages.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261015043000_appointment_customer_messages.rollback.sql
-- BAGIMLILIK: public.appointments. On-kosul blogu eksikse HICBIR sey yazmaz.
--
-- AMAC (YD3): musteriye giden islem amacli randevu iletilerinin izi. Yalniz IKI nullable sutun eklenir:
--   customer_confirm_sent_at: randevu acilirken musteriye teyit SMS'i gitti (ofis ayari acik + SMS kanali bagli).
--   customer_reminded_at:     randevu-hatirlat cron'u musteriye 24 saat icindeki hatirlatma SMS'ini gonderdi. Cron satiri
--                             `customer_reminded_at is null` kosuluyla ATOMIK kapar (iki paralel calisma ayni SMS'i atmaz).
-- Mevcut satir/davranis degismez; RLS/politika degismez (sutunlar tablonun mevcut politikalarini izler).
-- Kod sutunlar yokken zarifce atlar: musteri hatirlatma adimi calismaz, danisman hatirlatmasi aynen surer.
-- Idempotent: ikinci calistirmada degisiklik yok.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.appointments') is null then
    raise exception 'appointments yok; once temel migrationlar uygulanmali.';
  end if;
end $$;

alter table public.appointments add column if not exists customer_confirm_sent_at timestamptz;
alter table public.appointments add column if not exists customer_reminded_at timestamptz;

comment on column public.appointments.customer_confirm_sent_at is
  'YD3: musteriye randevu teyit SMS''i gonderildigi an (islem amacli ileti; IYS muaf).';
comment on column public.appointments.customer_reminded_at is
  'YD3: musteriye randevu hatirlatma SMS''i gonderildigi an; randevu-hatirlat cron''u bu sutun bosken atomik kapar.';
