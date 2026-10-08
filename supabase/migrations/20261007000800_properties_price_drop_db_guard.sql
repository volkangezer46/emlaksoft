-- MIGRATION 20261007000800_properties_price_drop_db_guard.sql (PB53, GUVENLIK_DENETIMI_3 "Ek: properties UPDATE RLS")
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261007000800_properties_price_drop_db_guard.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261007000800_properties_price_drop_db_guard.rollback.sql
--
-- NEDEN: Fiyat dusurme onay kapisi (`requestApprovalIfNeeded(..., "price_drop")`, updateProperty) YALNIZ uygulama
--   katmanindaydi. `identity_properties_update` yalniz tenant + properties:edit istedigi icin danisman PostgREST ile
--   dogrudan `PATCH properties {list_price}` gondererek kapiyi atlayabiliyordu. Ayrica `property_price_history`
--   uzerindeki `pph_tenant` (ALL) politikasi ayni kullanicinin fiyat izini silmesine/degistirmesine izin veriyordu.
--
-- NE YAPAR:
--   1. BEFORE UPDATE OF list_price tetikleyicisi (guard_property_list_price_drop). YALNIZ auth.role()='authenticated'
--      cagrida ve ancak:
--        * ofis `oversight_settings.approval_rules.price_drop` kurali ACIK ise (kapali/eksik kural = gecir),
--        * dusus yuzdesi esige (varsayilan 15, sinirlar 1..90; src/lib/oversight/settings.ts ile ayni) esit/ustundeyse,
--        * cagiran owner/gm DEGILSE (uygulamadaki isApprovalExemptRole ile ayni DAR muafiyet)
--      eslesen onayi arar: ayni talep sahibi, `[oversight:price_drop:<ilan_id>]` parmak izi, durum onaylandi,
--      48 saat icinde karar, yeni fiyat >= onaylanan fiyat (approvalCovers ile ayni). Bulursa:
--        a) tuketilmemis onayi ATOMIK tuketir (FOR UPDATE + consumed_at=now(); approval guard tetikleyicisi dogrular), veya
--        b) uygulama yolu zaten requestApprovalIfNeeded icinde onayi tuketmistir (consume -> sonra UPDATE): son 5 dakikada
--           ayni kullanici tarafindan tuketilmis eslesen onay kabul edilir (ayni ilan + >= onaylanan fiyat; daha derin
--           dusus veya baska ilan icin kullanilamaz).
--      Yoksa 42501 verir.
--   2. property_price_history: authenticated icin YALNIZ SELECT. pph_tenant (ALL) ve pph_tenant_insert DUSER;
--      INSERT/UPDATE/DELETE/TRUNCATE yetkisi authenticated'dan alinir. Kayit tetikleyicisi (log_property_price_change)
--      SECURITY DEFINER ve tablo sahibi olarak yazar; service_role etkilenmez.
-- KAPSAM DISI (ayri karar): identity_properties_update satir kapsami; commission_rate/min_price icin DB kapisi.
-- ETKI: service_role / migration / cron (auth.role() != authenticated) tetikleyiciden etkilenmez. Kural kapaliyken
--   davranis degismez. Kural aciksa dogrudan PostgREST fiyat dusurmesi artik onay ister.
-- RISK: dusuk-orta. Kural ACIK ofiste, onay akisini kullanmayan baska bir authenticated yol (eski istemci, bulk)
--   esik ustu fiyat dusurursse 42501 alir; bu istenen davranistir.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.properties') is null
     or pg_catalog.to_regclass('public.approval_requests') is null
     or pg_catalog.to_regclass('public.oversight_settings') is null
     or pg_catalog.to_regclass('public.property_price_history') is null
     or pg_catalog.to_regprocedure('public.current_profile_role()') is null
     or pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception '20261007000800: properties/approval_requests/oversight_settings/property_price_history veya yardimcilar yok.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'approval_requests' and column_name = 'consumed_at'
  ) then
    raise exception '20261007000800: approval_requests.consumed_at yok; once 20260823000100 uygulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Fiyat dusurme kapisi
-- ---------------------------------------------------------------------------
create or replace function public.guard_property_list_price_drop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rule jsonb;
  v_raw text;
  v_threshold numeric := 15;
  v_drop_pct numeric;
  v_ref numeric;
  v_approval uuid;
  v_rows integer;
begin
  -- service_role (cron/seed/admin), migration ve dogrudan DB oturumlari bu kurala tabi degil.
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;

  -- Degismeyen deger ve ARTIS gecer. Fiyatin BOSALTILMASI (NULL) dusus sayilir (NULL ara adimiyla atlama kapanir).
  if new.list_price is not distinct from old.list_price then
    return new;
  end if;
  if new.list_price is not null and old.list_price is not null and new.list_price >= old.list_price then
    return new;
  end if;

  -- Referans fiyat: mevcut deger ile son 30 gunluk tarihcedeki en yuksek liste fiyati. Esik altindaki ardisik
  -- kucuk dususler (kumulatif) ve "once NULL, sonra dusuk deger" yolu bu referansa gore olculur.
  select max(x.p) into v_ref
    from (
      select old.list_price as p
      union all
      select greatest(h.old_price, h.new_price)
        from public.property_price_history h
       where h.property_id = old.id
         and h.price_field = 'list_price'
         and h.created_at > now() - interval '30 days'
    ) x;
  if v_ref is null or v_ref <= 0 then
    return new;
  end if;
  if new.list_price is not null and new.list_price >= v_ref then
    return new;
  end if;

  select s.approval_rules -> 'price_drop' into v_rule
    from public.oversight_settings s
   where s.tenant_id = old.tenant_id;

  -- Kural yok/kapali: uygulama katmaniyla ayni (varsayilan KAPALI).
  if v_rule is null
     or jsonb_typeof(v_rule) <> 'object'
     or jsonb_typeof(v_rule -> 'enabled') is distinct from 'boolean'
     or (v_rule ->> 'enabled') <> 'true' then
    return new;
  end if;

  -- Esik: sayi ya da sayi metni (virgul/nokta); bozuksa varsayilan 15; 1..90 araligina sikistirilir.
  v_raw := case jsonb_typeof(v_rule -> 'threshold')
             when 'number' then v_rule ->> 'threshold'
             when 'string' then replace(btrim(v_rule ->> 'threshold'), ',', '.')
             else null
           end;
  if v_raw is not null and v_raw ~ '^[0-9]+([.][0-9]+)?$' then
    v_threshold := least(90, greatest(1, v_raw::numeric));
  end if;

  v_drop_pct := (v_ref - coalesce(new.list_price, 0)) / v_ref * 100;
  if v_drop_pct < v_threshold then
    return new;
  end if;

  -- Muafiyet: yalniz owner/gm (src/lib/team/assignable-roles.ts APPROVAL_EXEMPT_ROLES).
  if public.current_profile_role() in ('owner', 'gm') then
    return new;
  end if;

  if v_uid is null then
    raise exception 'Fiyat dusurmesi icin oturum gerekli.' using errcode = '42501';
  end if;

  -- (a) Tuketilmemis onayli talebi atomik tuket.
  select a.id into v_approval
    from public.approval_requests a
   where a.tenant_id = old.tenant_id
     and a.requested_by = v_uid
     and a.status = 'onaylandi'
     and a.consumed_at is null
     and a.decided_at is not null
     and a.decided_at > now() - interval '48 hours'
     and a.requested_value is not null
     and new.list_price >= a.requested_value
     and starts_with(coalesce(a.description, ''), '[oversight:price_drop:' || old.id::text || ']')
   order by a.decided_at desc
   limit 1
   for update;

  if v_approval is not null then
    update public.approval_requests
       set consumed_at = now()
     where id = v_approval and consumed_at is null;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      return new;
    end if;
  end if;

  -- (b) Uygulama yolu onayi bu UPDATE'ten hemen once tuketmistir (consume -> update).
  if exists (
    select 1
      from public.approval_requests a
     where a.tenant_id = old.tenant_id
       and a.requested_by = v_uid
       and a.status = 'onaylandi'
       and a.consumed_at is not null
       and a.consumed_at > now() - interval '5 minutes'
       and a.decided_at is not null
       and a.decided_at > now() - interval '48 hours'
       and a.requested_value is not null
       and new.list_price >= a.requested_value
       and starts_with(coalesce(a.description, ''), '[oversight:price_drop:' || old.id::text || ']')
  ) then
    return new;
  end if;

  raise exception 'Bu fiyat dusurmesi ofis kurali geregi yonetici onayi gerektirir (/app/onaylar).' using errcode = '42501';
end;
$$;

comment on function public.guard_property_list_price_drop() is
  'properties BEFORE UPDATE OF list_price: kural acik + esik ustu dusus + owner/gm degil => eslesen onayli talebi tuketir, yoksa 42501. Yalniz authenticated.';

revoke all on function public.guard_property_list_price_drop() from public, anon, authenticated;

drop trigger if exists trg_properties_price_drop_guard on public.properties;
create trigger trg_properties_price_drop_guard
  before update of list_price on public.properties
  for each row execute function public.guard_property_list_price_drop();

-- ---------------------------------------------------------------------------
-- 2) property_price_history: authenticated icin salt-okunur
-- ---------------------------------------------------------------------------
drop policy if exists pph_tenant on public.property_price_history;
drop policy if exists pph_tenant_insert on public.property_price_history;
drop policy if exists pph_select on public.property_price_history;

create policy pph_select on public.property_price_history
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

comment on policy pph_select on public.property_price_history is
  'Kiraci ici okuma. Yazma yok: kayit yalniz log_property_price_change (SECURITY DEFINER) tetikleyicisinden duser.';

revoke insert, update, delete, truncate on public.property_price_history from authenticated, anon;

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur, uygulamadan SONRA):
-- select polname, polcmd from pg_policy where polrelid = 'public.property_price_history'::regclass;
-- BEKLENEN: tek satir pph_select / r.
-- select tgname from pg_trigger where tgrelid = 'public.properties'::regclass and tgname = 'trg_properties_price_drop_guard';
