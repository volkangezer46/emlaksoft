-- MIGRATION 20260825001000 (2026-10-05 terfi; eski taslak adi proposed/20260820000300_ai_credit_metering.sql).
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260825001000_ai_credit_metering.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260825001000_ai_credit_metering.rollback.sql (defter tablosu DUSURULMEZ).
-- AI kredi + degerleme raporu olcumu.
-- TEK defter karari: public.account_credit_ledger (organik buyume migration'indaki defterle AYNI tablo).
-- Bu dosya tabloyu "if not exists" ile kurar; 20260825000800_growth_referral_partner_attribution (eski 20260819000100)
-- once uygulandigi icin (yayin sirasi) yalniz eksik sutun/kisitlari ekler. Uygulama koduna gore tablo yokken olcum
-- "etkin degil" kalir, AI cagrilari aynen calisir.
-- Terfi duzeltmesi: tablo ayricaliklari authenticated'dan da temizlenip yalniz SELECT verilir (Supabase varsayilan
-- ayricaliklari yeni tabloya authenticated icin yazma + TRUNCATE verir; RLS TRUNCATE'i durdurmaz).
--
-- birim:   'ai'        = AI kredisi (aylik plan kotasi = 'grant', kullanim = 'spend' negatif tutar)
--          'valuation' = profesyonel degerleme raporu adedi (her rapor 1 birim)
--          'try'       = abonelik kredisi (growth taslagi; burada dokunulmaz)
-- Ham istem/kisisel veri YAZILMAZ: yalniz ozellik adi, model, jeton sayilari, tutar.

create table if not exists public.account_credit_ledger (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  unit          text not null,
  entry_type    text not null,
  amount        numeric(14,2) not null check (amount <> 0),
  source        text not null,
  source_id     uuid,
  idempotency_key text not null unique,
  available_at  timestamptz not null default now(),
  expires_at    timestamptz,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Olcum sutunlari (growth tablosu once kurulduysa eklenir).
alter table public.account_credit_ledger add column if not exists feature    text;
alter table public.account_credit_ledger add column if not exists model      text;
alter table public.account_credit_ledger add column if not exists tokens_in  integer;
alter table public.account_credit_ledger add column if not exists tokens_out integer;

-- Birim/kaynak kisitlarini genislet (isim sabit; varsa dusurulup yeniden eklenir).
alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_unit_check;
alter table public.account_credit_ledger add constraint account_credit_ledger_unit_check
  check (unit in ('try','ai','valuation'));
alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_source_check;
alter table public.account_credit_ledger add constraint account_credit_ledger_source_check
  check (source in ('referral','partner','campaign','manual','usage','plan'));
alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_entry_type_check;
alter table public.account_credit_ledger add constraint account_credit_ledger_entry_type_check
  check (entry_type in ('grant','spend','expire','adjust','reverse'));

create index if not exists idx_credit_ledger_tenant on public.account_credit_ledger(tenant_id, unit, created_at desc);
create index if not exists idx_credit_ledger_usage
  on public.account_credit_ledger(tenant_id, unit, available_at desc)
  where entry_type = 'spend';

create or replace function public.account_credit_ledger_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'account_credit_ledger append-only' using errcode = '42501';
end $$;
drop trigger if exists trg_credit_ledger_immutable on public.account_credit_ledger;
create trigger trg_credit_ledger_immutable before update or delete on public.account_credit_ledger
  for each row execute function public.account_credit_ledger_immutable();

alter table public.account_credit_ledger enable row level security;
drop policy if exists credit_ledger_own_select on public.account_credit_ledger;
create policy credit_ledger_own_select on public.account_credit_ledger for select
  using (tenant_id = public.current_tenant_id());
revoke all privileges on table public.account_credit_ledger from public, anon, authenticated;
grant select on table public.account_credit_ledger to authenticated;
grant all privileges on table public.account_credit_ledger to service_role;

-- Atomik olcum: (varsa) aylik plan hakkini ekler + kullanimi yazar + donem bakiyesini doner.
-- Tek tenant/birim/donem icin advisory kilit: es zamanli cagrilarda cift hak verilmez.
-- Kota artarsa yalniz FARK eklenir; kota bos (p_quota null) ise sinirsiz: hak yazilmaz, bakiye null doner.
-- Negatif bakiye ENGELLENMEZ (nazik asim): olcum ozelligi asla kirmaz.
create or replace function public.ai_credit_charge(
  p_tenant_id    uuid,
  p_unit         text,
  p_amount       numeric,
  p_feature      text,
  p_model        text,
  p_tokens_in    integer,
  p_tokens_out   integer,
  p_actor_id     uuid,
  p_idempotency_key text,
  p_period_start timestamptz,
  p_period_end   timestamptz,
  p_quota        numeric
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_granted numeric;
  v_delta   numeric;
  v_balance numeric;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_unit not in ('ai','valuation') then
    raise exception 'Invalid unit.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid amount.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_unit || ':' || p_period_start::text, 0));

  if p_quota is not null and p_quota > 0 then
    select coalesce(sum(amount), 0) into v_granted
      from public.account_credit_ledger
     where tenant_id = p_tenant_id and unit = p_unit and entry_type = 'grant' and source = 'plan'
       and available_at >= p_period_start and available_at < p_period_end;
    v_delta := p_quota - v_granted;
    if v_delta > 0 then
      insert into public.account_credit_ledger
        (tenant_id, unit, entry_type, amount, source, idempotency_key, available_at, expires_at, feature)
      values
        (p_tenant_id, p_unit, 'grant', v_delta, 'plan',
         'grant:' || p_unit || ':' || p_tenant_id::text || ':' || to_char(p_period_start at time zone 'UTC', 'YYYYMMDD') || ':' || p_quota::text,
         p_period_start, p_period_end, 'plan_quota')
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  insert into public.account_credit_ledger
    (tenant_id, unit, entry_type, amount, source, idempotency_key, available_at, created_by,
     feature, model, tokens_in, tokens_out)
  values
    (p_tenant_id, p_unit, 'spend', -p_amount, 'usage', p_idempotency_key, now(), p_actor_id,
     left(p_feature, 80), left(p_model, 80), p_tokens_in, p_tokens_out)
  on conflict (idempotency_key) do nothing;

  select coalesce(sum(amount), 0) into v_balance
    from public.account_credit_ledger
   where tenant_id = p_tenant_id and unit = p_unit
     and available_at >= p_period_start and available_at < p_period_end;

  return jsonb_build_object(
    'balance', case when p_quota is null then null else v_balance end,
    'unlimited', p_quota is null
  );
end $$;

revoke all on function public.ai_credit_charge(uuid, text, numeric, text, text, integer, integer, uuid, text, timestamptz, timestamptz, numeric) from public, anon, authenticated;
grant execute on function public.ai_credit_charge(uuid, text, numeric, text, text, integer, integer, uuid, text, timestamptz, timestamptz, numeric) to service_role;

-- Olcum hazir mi problamasi (uygulama tablo yokken 'etkin degil' der).
create or replace function public.ai_credit_metering_ready()
returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
revoke all on function public.ai_credit_metering_ready() from public, anon, authenticated;
grant execute on function public.ai_credit_metering_ready() to service_role;
