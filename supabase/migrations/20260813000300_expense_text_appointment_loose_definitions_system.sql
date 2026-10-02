-- Serbest tanımlar: gider kategorisi text, randevu tipi gevşek kontrol, definitions.is_system.
--
-- (a) expenses.category: enum -> text. NOT: bu dönüşüm 20260729000128_expense_category_to_text.sql
--     ile ZATEN yapıldı (forward-only; o dosya değiştirilmez). Burada yalnız idempotent
--     güvence bırakılır: kolon hâlâ enum ise (ör. 128 uygulanmamış bir ortam) dönüştürülür.
--     Kolona bağlı view/function/policy/index/check bulunamadı (031 sonrası migration'lar
--     ve src taranmış; yalnız default 'diger' vardır) — yine de default düşürülüp yeniden kurulur.
-- (b) appointments.appointment_type: sabit liste CHECK'i kaldırılır, yerine boş olmayan
--     ve <= 64 karakter kontrolü konur. Kodun dallandığı sistem değerleri uygulama katmanında korunur.
-- (c) definitions.is_system: kodun dallandığı global anahtarlar işaretlenir; tenant kendi satırında
--     is_system'i true yapamaz/değiştiremez (guard trigger). RLS politikaları DEĞİŞMEZ.

-- (a) ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'expenses'
      and column_name = 'category' and data_type = 'USER-DEFINED'
  ) then
    alter table public.expenses alter column category drop default;
    alter table public.expenses alter column category type text using category::text;
    alter table public.expenses alter column category set default 'diger';
  end if;
end $$;

-- (b) ---------------------------------------------------------------------
alter table public.appointments
  drop constraint if exists appointments_appointment_type_check;

alter table public.appointments
  add constraint appointments_appointment_type_check
  check (char_length(btrim(appointment_type)) between 1 and 64);

-- (c) ---------------------------------------------------------------------
alter table public.definitions
  add column if not exists is_system boolean not null default false;

update public.definitions
   set is_system = true
 where tenant_id is null
   and is_system = false
   and (
        (category = 'property_status'  and value in ('active', 'sold', 'rented'))
     or (category = 'transaction_type' and value in ('Satılık', 'Kiralık'))
     or (category = 'appointment_type' and value in ('showing', 'office', 'valuation'))
     or (category = 'expense_category' and value = 'diger')
   );

-- Yalnız istemci rolleri (authenticated/anon) kısıtlanır; service_role ve migration (postgres) serbest.
create or replace function public.definitions_guard_is_system()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.is_system is distinct from false then
        raise exception 'definitions.is_system yalnız sistem tarafından belirlenir'
          using errcode = '42501';
      end if;
    elsif new.is_system is distinct from old.is_system then
      raise exception 'definitions.is_system değiştirilemez'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_definitions_guard_is_system on public.definitions;
create trigger trg_definitions_guard_is_system
  before insert or update on public.definitions
  for each row execute function public.definitions_guard_is_system();
