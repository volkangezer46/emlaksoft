-- MIGRATION 20261023040001_expense_claims.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod tablo/RPC yokken "Masraf bildir" formu "henuz etkin degil" der ve
--   kayit acmaz; tablo varken eski kod hicbir sey yazmaz.
-- Geri alma: supabase/rollbacks/20261023040001_expense_claims.rollback.sql
-- BAGIMLILIK: 20260823000100 (approval_requests + consumed_at), 20261014001000 (finance_open_items, finance_parties),
--   20261017010300 (finance_accrual_party), 20261023040000 (approval_actor_can_decide WP2 govdesi).
--
-- NE (WP2, sahip karari 2026-10-16: danisman masrafi "Masraf bildir" ile onaya gider, onaylaninca deftere islenir):
--   expense_claims       : danismanin is masrafi (tutar, harcama gunu, kategori, aciklama, fis fotografi yolu, istege bagli
--                          portfoy/anlasma). Okuma: talep sahibi, muhasebe goren (expenses:view) ya da onay karari verebilen.
--                          authenticated YAZAMAZ: tek giris expense_claim_submit RPC'si, tek durum degisimi onay tetigi.
--   expense_claim_submit : SECURITY DEFINER; talep + approval_requests satirini TEK islemde acar ('gider' turu,
--                          `[oversight:expense_claim:<id>]` parmak izi: politika otomatik onayi bu izi onaylamaz).
--   expense_claim_on_decision: approval_requests 'bekliyor' -> karar tetigi. ONAY: danisman carisine (kind danisman, user_id)
--                          ODENECEK acik kalem (finance_open_items, source_type 'expense_claim') yazar ve talebi 'onaylandi'
--                          isaretler; RET / IPTAL talebi ayni duruma ceker. Islem atomik: kalem yazilamazsa karar da yazilmaz.
--   expense-claims kovasi: ozel; yalniz gorsel (jpeg/png/webp/heic) ve PDF, en fazla 5 MB. Yukleme tek nesnelik imzali
--                          jetonla (sunucu uretir), okuma kisa omurlu imzali baglantiyla (sunucu, ayni okuma kurali).
-- RISK: dusuk (yeni tablo + yeni tetik; mevcut onay akisi degismez, yalniz bagli masraf talebi olan satirda is yapar).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.approval_requests') is null
     or pg_catalog.to_regclass('public.finance_open_items') is null
     or pg_catalog.to_regclass('public.finance_parties') is null then
    raise exception 'approval_requests / finance_open_items / finance_parties yok; once onay ve finans v2 migrationlari uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.finance_accrual_party(uuid,text,text,uuid,uuid)') is null
     or pg_catalog.to_regprocedure('public.approval_actor_can_decide()') is null then
    raise exception 'finance_accrual_party / approval_actor_can_decide yok; once 20261017010300 ve 20261023040000 uygulanmali.';
  end if;
end $$;

create table if not exists public.expense_claims (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  claimant_id         uuid references public.profiles(id) on delete set null,
  amount              numeric(14,2) not null check (amount >= 0.01 and amount <= 9999999999.99),
  spent_on            date not null check (spent_on between date '2000-01-01' and date '2100-12-31'),
  category            text not null check (category in ('ulasim', 'reklam', 'portal', 'ofis', 'diger_gider')),
  description         text not null check (char_length(description) between 3 and 300),
  receipt_path        text not null check (char_length(receipt_path) between 10 and 300),
  receipt_mime        text not null check (receipt_mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')),
  property_id         uuid references public.properties(id) on delete set null,
  deal_id             uuid references public.deals(id) on delete set null,
  status              text not null default 'bekliyor' check (status in ('bekliyor', 'onaylandi', 'reddedildi', 'iptal')),
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  open_item_id        uuid references public.finance_open_items(id) on delete set null,
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.expense_claims is
  'WP2: danisman masraf bildirimi (fisli). Onay /app/onaylar; onaylaninca danisman carisine odenecek acik kalem (source_type expense_claim).';

create index if not exists idx_expense_claims_tenant_claimant on public.expense_claims (tenant_id, claimant_id, created_at desc);
create index if not exists idx_expense_claims_approval on public.expense_claims (approval_request_id) where approval_request_id is not null;
create index if not exists idx_expense_claims_property on public.expense_claims (property_id) where property_id is not null;
create index if not exists idx_expense_claims_deal on public.expense_claims (deal_id) where deal_id is not null;

alter table public.expense_claims enable row level security;

drop policy if exists expense_claims_select on public.expense_claims;
create policy expense_claims_select on public.expense_claims
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (
      claimant_id = (select auth.uid())
      or (select public.has_effective_permission('expenses', 'view'))
      or (select public.approval_actor_can_decide())
    )
  );

revoke all on table public.expense_claims from anon, authenticated;
grant select on table public.expense_claims to authenticated;
grant all on table public.expense_claims to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Talep acma (tek giris)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.expense_claim_submit(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_active_tenant_id();
  v_role text := coalesce(public.current_profile_role(), '');
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_amount numeric;
  v_spent date;
  v_cat text := pg_catalog.btrim(coalesce(p ->> 'category', ''));
  v_desc text := pg_catalog.btrim(coalesce(p ->> 'description', ''));
  v_path text := pg_catalog.btrim(coalesce(p ->> 'receipt_path', ''));
  v_mime text := pg_catalog.lower(pg_catalog.btrim(coalesce(p ->> 'receipt_mime', '')));
  v_property uuid;
  v_deal uuid;
  v_claim uuid;
  v_approval uuid;
  v_exists boolean;
  v_name text;
begin
  if v_uid is null or v_tenant is null or v_role in ('', 'readonly') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  begin
    v_amount := nullif(p ->> 'amount', '')::numeric;
    v_spent := nullif(p ->> 'spent_on', '')::date;
    v_property := nullif(p ->> 'property_id', '')::uuid;
    v_deal := nullif(p ->> 'deal_id', '')::uuid;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    return jsonb_build_object('outcome', 'invalid_input');
  end;
  if v_amount is null or v_amount < 0.01 or v_amount > 9999999999.99 or pg_catalog.round(v_amount, 2) <> v_amount
     or v_spent is null or v_spent > v_today or v_spent < v_today - 366
     or v_cat not in ('ulasim', 'reklam', 'portal', 'ofis', 'diger_gider')
     or char_length(v_desc) not between 3 and 300
     or v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  -- Fis yolu: yalniz bu ofisin bu kullanicisinin klasoru, sunucunun urettigi uuid adi.
  if v_path !~ ('^' || v_tenant::text || '/' || v_uid::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|pdf)$') then
    return jsonb_build_object('outcome', 'invalid_receipt');
  end if;
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects o where o.bucket_id = $1 and o.name = $2)'
      into v_exists using 'expense-claims', v_path;
    if not coalesce(v_exists, false) then return jsonb_build_object('outcome', 'receipt_missing'); end if;
  end if;
  if exists (select 1 from public.expense_claims c where c.tenant_id = v_tenant and c.receipt_path = v_path) then
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  if v_property is not null and not exists (
    select 1 from public.properties pr where pr.id = v_property and pr.tenant_id = v_tenant
  ) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if v_deal is not null and not exists (
    select 1 from public.deals d
     where d.id = v_deal and d.tenant_id = v_tenant
       and (v_role in ('owner', 'gm', 'branch_manager', 'accounting') or d.assigned_to = v_uid)
  ) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  insert into public.expense_claims (tenant_id, claimant_id, amount, spent_on, category, description, receipt_path, receipt_mime,
    property_id, deal_id)
  values (v_tenant, v_uid, v_amount, v_spent, v_cat, v_desc, v_path, v_mime, v_property, v_deal)
  returning id into v_claim;

  select pr.full_name into v_name from public.profiles pr where pr.id = v_uid;

  insert into public.approval_requests (tenant_id, kind, title, description, amount, current_value, requested_value,
    entity_type, entity_id, status, requested_by)
  values (v_tenant, 'gider',
    pg_catalog.left('Masraf bildirimi: ' || v_desc, 200),
    pg_catalog.left('[oversight:expense_claim:' || v_claim::text || '] '
      || coalesce(nullif(pg_catalog.btrim(v_name), ''), 'Danışman') || ' · harcama günü '
      || pg_catalog.to_char(v_spent, 'DD.MM.YYYY') || '. Onaylanınca danışmana ödenecek açık kalem olarak deftere işlenir. Fiş: /app/finans/kayit/masraf/'
      || v_claim::text, 2000),
    v_amount, null, v_amount, 'expense', v_claim, 'bekliyor', v_uid)
  returning id into v_approval;

  update public.expense_claims set approval_request_id = v_approval where id = v_claim;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, v_uid, 'expense_claim.submit', 'expense_claim', v_claim,
    jsonb_build_object('amount', v_amount, 'category', v_cat, 'approval_request_id', v_approval));

  return jsonb_build_object('outcome', 'created', 'claim_id', v_claim, 'approval_id', v_approval);
end;
$$;

comment on function public.expense_claim_submit(jsonb) is
  'WP2: masraf bildirimi + onay talebi tek islemde. Cikti outcome: created | forbidden | invalid_input | invalid_receipt | receipt_missing | duplicate.';

revoke all on function public.expense_claim_submit(jsonb) from public, anon;
grant execute on function public.expense_claim_submit(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Karar tetigi: onayda deftere yaz, ret/iptalde durumu cek.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.expense_claim_on_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.expense_claims%rowtype;
  v_party uuid;
  v_name text;
  v_item uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
begin
  if old.status is distinct from 'bekliyor' or new.status = 'bekliyor' then
    return new;
  end if;
  select * into v_claim from public.expense_claims c
   where c.approval_request_id = new.id and c.tenant_id = new.tenant_id
   for update;
  if not found or v_claim.status <> 'bekliyor' then
    return new;
  end if;

  if new.status = 'onaylandi' then
    select pr.full_name into v_name from public.profiles pr where pr.id = v_claim.claimant_id;
    v_party := case when v_claim.claimant_id is null then null
      else public.finance_accrual_party(v_claim.tenant_id, 'danisman', v_name, null, v_claim.claimant_id) end;
    insert into public.finance_open_items (tenant_id, direction, party_id, title, category, amount, currency, issue_date, due_date,
      source_type, source_id, property_id, note, created_by)
    values (v_claim.tenant_id, 'payable', v_party,
      pg_catalog.left('Masraf: ' || v_claim.description, 160), v_claim.category, v_claim.amount, 'TRY', v_today, v_today,
      'expense_claim', v_claim.id, v_claim.property_id,
      pg_catalog.left('Danışman masraf bildirimi (harcama günü ' || pg_catalog.to_char(v_claim.spent_on, 'DD.MM.YYYY') || ').', 1000),
      coalesce(new.decided_by, v_claim.claimant_id))
    returning id into v_item;
    update public.expense_claims
       set status = 'onaylandi', open_item_id = v_item, decided_at = coalesce(new.decided_at, pg_catalog.now()), updated_at = pg_catalog.now()
     where id = v_claim.id;
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (v_claim.tenant_id, new.decided_by, 'expense_claim.posted', 'expense_claim', v_claim.id,
      jsonb_build_object('open_item_id', v_item, 'amount', v_claim.amount, 'approval_request_id', new.id));
  elsif new.status in ('reddedildi', 'iptal') then
    update public.expense_claims
       set status = new.status, decided_at = coalesce(new.decided_at, pg_catalog.now()), updated_at = pg_catalog.now()
     where id = v_claim.id;
  end if;
  return new;
end;
$$;

revoke all on function public.expense_claim_on_decision() from public, anon, authenticated;

drop trigger if exists trg_approval_requests_expense_claim on public.approval_requests;
create trigger trg_approval_requests_expense_claim
  after update of status on public.approval_requests
  for each row
  when (old.status = 'bekliyor' and new.status is distinct from 'bekliyor' and new.entity_type = 'expense')
  execute function public.expense_claim_on_decision();

-- ---------------------------------------------------------------------------------------------------------------
-- Fis kovasi (ozel)
-- ---------------------------------------------------------------------------------------------------------------
do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('expense-claims', 'expense-claims', false, 5242880,
      array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']::text[])
    on conflict (id) do update
      set public = false,
          file_size_limit = 5242880,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
