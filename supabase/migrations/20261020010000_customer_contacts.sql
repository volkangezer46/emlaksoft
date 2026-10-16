-- MIGRATION 20261020010000_customer_contacts.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE uygulanir: yeni kod musteri aramasinda customers.contacts_fold sutununu okur ve 360'ta
--   customer_contacts tablosunu listeler (tablo yokken kart "kurulum bekliyor" der; arama sutunu ise zorunludur).
-- Geri alma: supabase/rollbacks/20261020010000_customer_contacts.rollback.sql (ek numaralar ve e-postalar silinir;
--   birincil telefon/e-posta customers satirinda oldugu icin kaybolmaz).
-- BAGIMLILIK: 20261016070000 (customers.phone_digits, pg_trgm, lookup_customer_by_phone), fold_tr (20260725000055),
--   customers(id, tenant_id) benzersiz indeksi (20260809000020).
--
-- NE (CRM-G7, musteri basina birden cok telefon / e-posta / WhatsApp numarasi):
--   1) customer_contacts: musterinin EK iletisim bilgileri (tur: phone | email, etiket: cep | is | ev | whatsapp | diger).
--      BIRINCIL telefon/e-posta customers.phone / customers.email olarak kalir (tum mevcut sorgular, kampanya, IYS ve
--      cagri eslemesi bozulmaz). "Birincil yap" islemi iki degeri yer degistirir (customer_contact_make_primary).
--      Telefon saklama kurali uygulama katmaninda parsePhoneStrict (TR 05XXXXXXXXX, yabanci +E.164); e-posta kucuk harf.
--   2) customers.contacts_fold: ek telefonlarin rakamlari + ek e-postalarin Turkce katlamali hali (tetikleyiciyle
--      esitlenir). Arama cekirdegi (src/lib/pgrst.ts searchTermFilter) bu sutunda da arar: ikinci numarayla arayan
--      musteri bulunur.
--   3) lookup_customer_by_phone: tam telefon eslesmesi ek numaralara da bakar (gelen cagri / mukerrer ipucu).
--   4) KVKK: anonimlestirme (kvkk_erasure_log satiri) musterinin ek iletisim bilgilerini de siler.
--
-- GUVENLIK: RLS — oturum ofisi + customers:view (okuma) / customers:edit (yazma) + musteri satiri oturuma gorunur
--   (customers RLS'i alt sorguda uygulanir: kapsam disi musterinin numarasi okunamaz). Tetikleyici fonksiyonlari
--   SECURITY DEFINER + search_path '' ve yalniz turetilmis sutunu yazar; customer_contact_make_primary SECURITY
--   INVOKER (RLS gecerli) ve musteri satirini kilitler.
set local lock_timeout = '5s';

create table if not exists public.customer_contacts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  customer_id  uuid not null,
  kind         text not null check (kind in ('phone', 'email')),
  value        text not null check (char_length(btrim(value)) between 3 and 254),
  label        text not null default 'cep' check (label in ('cep', 'is', 'ev', 'whatsapp', 'diger')),
  value_digits text generated always as (
    case when kind = 'phone' then regexp_replace(value, '[^0-9]', '', 'g') else null end
  ) stored,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint customer_contacts_customer_fkey foreign key (customer_id, tenant_id) references public.customers(id, tenant_id) on delete cascade,
  constraint customer_contacts_email_lower check (kind <> 'email' or value = lower(value))
);

comment on table public.customer_contacts is
  'CRM-G7: musterinin ek telefon / e-posta / WhatsApp numaralari. Birincil deger customers.phone/email''de kalir.';
comment on column public.customer_contacts.value_digits is
  'Telefonun yalniz rakamlari (tam eslesme: lookup_customer_by_phone, mukerrer kontrolu). Uretilir.';

-- Ayni musteride ayni deger iki kez yok (birlestirme cekirdegi bu indeksi gorup satir satir tasir, cakismayi atlar).
create unique index if not exists customer_contacts_value_uidx on public.customer_contacts (customer_id, kind, value);
create index if not exists idx_customer_contacts_tenant_digits
  on public.customer_contacts (tenant_id, value_digits) where kind = 'phone';
create index if not exists idx_customer_contacts_tenant_email
  on public.customer_contacts (tenant_id, value) where kind = 'email';
create index if not exists idx_customer_contacts_created_by on public.customer_contacts (created_by);

alter table public.customer_contacts enable row level security;

drop policy if exists customer_contacts_select on public.customer_contacts;
create policy customer_contacts_select on public.customer_contacts
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('customers', 'view'))
    and exists (select 1 from public.customers c where c.id = customer_contacts.customer_id and c.deleted_at is null)
  );

drop policy if exists customer_contacts_insert on public.customer_contacts;
create policy customer_contacts_insert on public.customer_contacts
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('customers', 'edit'))
    and exists (select 1 from public.customers c where c.id = customer_contacts.customer_id and c.deleted_at is null)
  );

drop policy if exists customer_contacts_update on public.customer_contacts;
create policy customer_contacts_update on public.customer_contacts
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('customers', 'edit'))
    and exists (select 1 from public.customers c where c.id = customer_contacts.customer_id and c.deleted_at is null)
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('customers', 'edit'))
    and exists (select 1 from public.customers c where c.id = customer_contacts.customer_id and c.deleted_at is null)
  );

drop policy if exists customer_contacts_delete on public.customer_contacts;
create policy customer_contacts_delete on public.customer_contacts
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('customers', 'edit'))
    and exists (select 1 from public.customers c where c.id = customer_contacts.customer_id)
  );

-- ---------------------------------------------------------------------------
-- Arama sutunu: ek numaralar + ek e-postalar (tetikleyiciyle esitlenir)
-- ---------------------------------------------------------------------------
alter table public.customers add column if not exists contacts_fold text;

comment on column public.customers.contacts_fold is
  'CRM-G7: ek telefonlarin rakamlari + ek e-postalarin fold_tr hali (customer_contacts tetikleyicisi yazar; elle yazilmaz). '
  'Arama: src/lib/pgrst.ts searchTermFilter.';

do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_trgm') then
    execute 'create index if not exists idx_customers_contacts_fold_trgm on public.customers using gin (contacts_fold public.gin_trgm_ops) where contacts_fold is not null';
  end if;
end;
$$;

create or replace function public.customer_contacts_fold_of(p_customer_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(btrim(coalesce(string_agg(
           case when cc.kind = 'phone' then cc.value_digits else public.fold_tr(cc.value) end,
           ' ' order by cc.created_at, cc.id), '')), '')
  from public.customer_contacts cc
  where cc.customer_id = p_customer_id;
$$;

revoke all on function public.customer_contacts_fold_of(uuid) from public, anon, authenticated;
grant execute on function public.customer_contacts_fold_of(uuid) to service_role;

create or replace function public.customer_contacts_sync_fold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'DELETE' then
    v_ids := array[old.customer_id];
  elsif tg_op = 'INSERT' then
    v_ids := array[new.customer_id];
  else
    v_ids := array[old.customer_id, new.customer_id];
  end if;
  update public.customers c
     set contacts_fold = public.customer_contacts_fold_of(c.id)
   where c.id = any (v_ids)
     and c.contacts_fold is distinct from public.customer_contacts_fold_of(c.id);
  return null;
end;
$$;

revoke all on function public.customer_contacts_sync_fold() from public, anon, authenticated;

drop trigger if exists trg_customer_contacts_sync_fold on public.customer_contacts;
create trigger trg_customer_contacts_sync_fold
  after insert or update or delete on public.customer_contacts
  for each row execute function public.customer_contacts_sync_fold();

-- ---------------------------------------------------------------------------
-- Birincil yap: ek deger ile customers.phone/email yer degistirir (RLS gecerli, tek transaction)
-- ---------------------------------------------------------------------------
create or replace function public.customer_contact_make_primary(p_contact_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_c   public.customer_contacts%rowtype;
  v_old text;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if not public.has_effective_permission('customers', 'edit') then
    raise exception 'Bu işlem için yetkiniz yok.' using errcode = '42501';
  end if;

  select * into v_c from public.customer_contacts
   where id = p_contact_id and tenant_id = public.current_active_tenant_id()
   for update;
  if not found then
    raise exception 'İletişim bilgisi bulunamadı.';
  end if;

  if v_c.kind = 'phone' then
    select phone into v_old from public.customers
     where id = v_c.customer_id and tenant_id = v_c.tenant_id and deleted_at is null for update;
    if not found then
      raise exception 'Müşteri bulunamadı.';
    end if;
    update public.customers set phone = v_c.value, updated_at = now()
     where id = v_c.customer_id and tenant_id = v_c.tenant_id;
  else
    select email into v_old from public.customers
     where id = v_c.customer_id and tenant_id = v_c.tenant_id and deleted_at is null for update;
    if not found then
      raise exception 'Müşteri bulunamadı.';
    end if;
    update public.customers set email = v_c.value, updated_at = now()
     where id = v_c.customer_id and tenant_id = v_c.tenant_id;
  end if;

  if coalesce(btrim(v_old), '') = '' then
    delete from public.customer_contacts where id = v_c.id;
  else
    -- Eski birincil ek kayit olur (etiket korunur: "is" numarasi birincil olursa eski cep "cep" kalir).
    update public.customer_contacts
       set value = case when v_c.kind = 'email' then lower(btrim(v_old)) else btrim(v_old) end,
           label = case when v_c.label = 'whatsapp' then 'cep' else v_c.label end
     where id = v_c.id;
  end if;

  return jsonb_build_object('ok', true, 'customer_id', v_c.customer_id, 'kind', v_c.kind);
end;
$$;

revoke all on function public.customer_contact_make_primary(uuid) from public, anon;
grant execute on function public.customer_contact_make_primary(uuid) to authenticated, service_role;

comment on function public.customer_contact_make_primary(uuid) is
  'CRM-G7: ek telefon/e-postayi birincil yapar (customers.phone/email ile yer degistirir). SECURITY INVOKER: RLS gecerli.';

-- ---------------------------------------------------------------------------
-- KVKK: anonimlestirilen musterinin ek iletisim bilgileri de silinir
-- ---------------------------------------------------------------------------
create or replace function public.kvkk_erasure_purge_customer_extras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.customer_contacts
   where customer_id = new.customer_id and tenant_id = new.tenant_id;
  return null;
end;
$$;

revoke all on function public.kvkk_erasure_purge_customer_extras() from public, anon, authenticated;

drop trigger if exists trg_kvkk_erasure_purge_customer_extras on public.kvkk_erasure_log;
create trigger trg_kvkk_erasure_purge_customer_extras
  after insert on public.kvkk_erasure_log
  for each row execute function public.kvkk_erasure_purge_customer_extras();

-- ---------------------------------------------------------------------------
-- Arayan tanima: ek numaralar da (maskeli; imza ve donus ayni)
-- ---------------------------------------------------------------------------
create or replace function public.lookup_customer_by_phone(p_phone text, p_exclude uuid[] default '{}'::uuid[])
returns table (full_name text, phone_masked text, advisor_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_digits text;
begin
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null or not public.has_effective_permission('customers', 'view') then
    return;
  end if;

  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if length(v_digits) = 14 and left(v_digits, 4) = '0090' then
    v_digits := '0' || substr(v_digits, 5);
  elsif length(v_digits) = 12 and left(v_digits, 2) = '90' then
    v_digits := '0' || substr(v_digits, 3);
  elsif length(v_digits) = 10 and left(v_digits, 1) <> '0' then
    v_digits := '0' || v_digits;
  end if;
  if length(v_digits) < 7 then
    return;
  end if;

  return query
    with hits as (
      select c.id, c.full_name as name, c.assigned_to, c.created_at,
             case
               when c.phone_digits = v_digits then c.phone
               else (
                 select cc.value from public.customer_contacts cc
                  where cc.customer_id = c.id and cc.tenant_id = v_tenant
                    and cc.kind = 'phone' and cc.value_digits = v_digits
                  limit 1
               )
             end as matched
      from public.customers c
      where c.tenant_id = v_tenant
        and c.deleted_at is null
        and not (c.id = any(coalesce(p_exclude, '{}'::uuid[])))
        and (
          c.phone_digits = v_digits
          or exists (
            select 1 from public.customer_contacts cc
             where cc.customer_id = c.id and cc.tenant_id = v_tenant
               and cc.kind = 'phone' and cc.value_digits = v_digits
          )
        )
    )
    select
      h.name,
      case
        when length(h.matched) >= 7 then left(h.matched, 4) || ' *** ** ' || right(h.matched, 2)
        else '***'
      end,
      p.full_name
    from hits h
    left join public.profiles p on p.id = h.assigned_to and p.tenant_id = v_tenant
    order by h.created_at desc
    limit 5;
end;
$$;

comment on function public.lookup_customer_by_phone(text, uuid[]) is
  'SK7/B059 + CRM-G7: kapsam disi tam telefon eslesmesi (birincil + ek numaralar) — yalniz ad, maskeli telefon, danisman adi. '
  'Kiraci + customers:view sartli.';

revoke all on function public.lookup_customer_by_phone(text, uuid[]) from public, anon;
grant execute on function public.lookup_customer_by_phone(text, uuid[]) to authenticated;
grant execute on function public.lookup_customer_by_phone(text, uuid[]) to service_role;
