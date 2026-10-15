-- MIGRATION 20261017010200_finance_accrual_triggers.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Tasarim: docs/design/FINANS_ENTEGRASYON_2026-10.md, WP2 "Tahakkuk tetikleyicileri".
-- Geri alma: supabase/rollbacks/20261017010200_finance_accrual_triggers.rollback.sql (ONCE 20261017010400 ve 010300 geri alinir;
--   tetikleyiciler + fonksiyonlar duser, finance_open_item_recompute 20261017010000 govdesine doner, offbook_amount kolonu duser;
--   acilmis tahakkuk kalemleri ve cariler YERINDE KALIR: silme yok).
-- BAGIMLILIK: 20261017010000_finance_posting_core (finance_post_internal / finance_reverse_internal / posting_key /
--   'payout.approved' kurali) + 20261017010100 (v3 gorunum: posting_key'li kalemi olan kaynak hesaplanmis kolda tekrar etmez),
--   20260816000200/000400 (commission_splits / commission_payouts), 20261008001700 (building_charges / building_payments).
--
-- 'payout.approved' kurali (onceden 010000'a yazilmisti; o dosya canlida uygulandigi icin buraya tasindi).
insert into public.finance_posting_rules
  (event_type, label, key_prefix, source_type, source_required, item_mode, item_direction, item_category,
   cash_mode, cash_direction, cash_category, account_scope, pnl, perm_module, perm_action, owner_gm_only, tdhp)
values
  ('payout.approved', 'Hakediş tahakkuku', 'payout', 'commission_payout', true, 'required', 'payable', 'danisman_hakedis',
   'none', null, null, 'office', 'expense', 'commissions', 'edit', true, '740/770 / 335')
on conflict (event_type) do nothing;

-- NE (kural: TETIKLEYICI YALNIZ TAHAKKUK yazar; nakit yalniz acik RPC'lerle):
--  1) finance_open_items.offbook_amount: kaynakta "odendi" isaretli ama kasa/banka hareketi olmayan tutar (kasa disi).
--     finance_open_item_recompute: odenen = greatest(bagli hareketler + ayna kalemler, offbook_amount). Nakit UYDURULMAZ;
--     mutabakat kuyrugu offbook_amount > bagli nakit olan kalemleri listeler. Kalem notuna 'kasa dışı' duser.
--  2) Kaynak -> tahakkuk esitleme (idempotent; istenen durum ile mevcut etkin kalem karsilastirilir):
--       commissions          -> commission.accrued       `commission:{id}`            musteri alacagi = brut + KDV
--       commission_splits    -> commission.split_accrued `split:{id}`                 ofis disi pay: danisman/dis taraf borcu
--       commission_payouts   -> payout.approved          `payout:{id}:approved`       YALNIZ payi (split) olmayan hakedis,
--                                                                                     onaylaninca (approved/paid) borc
--       building_charges     -> building.charged         `building_charge:{id}`       daire sahibi/kiraci alacagi (emanet)
--     Tutar/KDV degisirse: etkin kalem ters kayitla kapanir (acik donemde iptal, kilitli donemde ilk acik aya ayna) ve
--     yeni surum anahtariyla (`<anahtar>:r{n}`, keys.ts revisedKey) yeniden yazilir. Yalniz cari degisirse kalem yerinde
--     guncellenir (parasal olmayan alan). Silme / iptal (commissions.status='cancelled', building_charges.voided_at,
--     hakedis 'cancelled') / ornek veri -> finance_reverse_internal. Tahsilat/odeme gormus (bagli nakit) kalem degistirilemez:
--     kaynak yazimi anlamli hata ile durur (para izi korunur).
--     Kasa disi kapanis: komisyon 'paid'/'collected' -> tum tutar; pay -> odenmis hakedislerin toplami; payi olmayan hakedis
--     'paid' -> tutar; bina aidati -> building_charges.paid_amount.
--  3) Eski yol tahsilat hareketlerinin baglanmasi: source_type 'commission' (source_id = komisyon) ve 'building'
--     (source_id = building_payments -> charge) giris hareketi, posting_key'siz ve open_item_id bos ise etkin tahakkuk
--     kalemine baglanir (BEFORE INSERT + esitlemede mevcut satirlar). Ayna (reversal_of) hareket asliyla ayni kaleme baglanir.
--  4) Cari: finance_accrual_party (musteri -> customer_id, danisman -> user_id kind 'danisman', dis taraf -> ad). Ayni adli
--     baska kayit varsa kisa ek ile ayrilir (ad benzersizligi). P12: danisman carisi ve kalemleri earnings_all yoksa yalniz
--     kendisine gorunur (mevcut RLS, 20261014011000).
-- GUVENLIK: tum fonksiyonlar SECURITY DEFINER + search_path=''; kiraci DAIMA kaynak satirin tenant_id'si (oturum girdisi yok);
--   yetki kaynak tablonun yazma kapisinda (RLS / RPC) zaten uygulanir, tetikleyici ek yetki VERMEZ. Fonksiyonlar istemciye
--   kapali (yalniz service_role). Kayit eden: auth.uid() profiles'ta varsa o, yoksa null.
-- ETKI: davranis (komisyon/pay/bina aidati yazimi tahakkuk kalemi de yazar; tahsil edilmis kalem tutari degistirilemez).
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.finance_post_internal(uuid,uuid,jsonb)') is null
     or pg_catalog.to_regprocedure('public.finance_reverse_internal(uuid,uuid,uuid,text,date)') is null
     or pg_catalog.to_regprocedure('public.finance_open_item_recompute(uuid)') is null
     or pg_catalog.to_regprocedure('public.finance_account_is_office(uuid)') is null
     or pg_catalog.to_regclass('public.finance_posting_rules') is null
     or pg_catalog.to_regclass('public.commissions') is null
     or pg_catalog.to_regclass('public.commission_splits') is null
     or pg_catalog.to_regclass('public.commission_payouts') is null
     or pg_catalog.to_regclass('public.building_charges') is null
     or pg_catalog.to_regclass('public.building_payments') is null
     or pg_catalog.to_regclass('public.deals') is null
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.finance_open_items'::regclass and attname = 'posting_key' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.commissions'::regclass and attname = 'is_sample' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.building_payments'::regclass and attname = 'charge_id' and not attisdropped) then
    raise exception '20261017010200: once 20261017010000 (kayit cekirdegi), 20261017010100, 20260816000400 ve 20261008001700 uygulanmali.';
  end if;
  if not exists (select 1 from public.finance_posting_rules where event_type = 'payout.approved') then
    raise exception '20261017010200: finance_posting_rules ''payout.approved'' kurali yok (20261017010000 guncel surumu uygulanmali).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Kasa disi kapanis tutari + odeme ilerlemesi
-- ---------------------------------------------------------------------------
alter table public.finance_open_items add column if not exists offbook_amount numeric(14,2) not null default 0;
alter table public.finance_open_items drop constraint if exists finance_open_items_offbook_amount_check;
alter table public.finance_open_items add constraint finance_open_items_offbook_amount_check check (offbook_amount >= 0);
comment on column public.finance_open_items.offbook_amount is
  'Kasa disi kapanis: kaynakta odendi isaretli ama bagli kasa/banka hareketi olmayan tutar (nakit uydurulmaz). Odenen = greatest(bagli hareketler, bu tutar). Tahakkuk tetikleyicisi yazar.';

-- 20261017010000 govdesi + kasa disi taban (greatest). Ayna kalem daima kapali.
create or replace function public.finance_open_item_recompute(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.finance_open_items%rowtype;
  v_paid numeric;
  v_status text;
begin
  if p_id is null then return; end if;
  select * into v_item from public.finance_open_items o where o.id = p_id for update;
  if not found then return; end if;
  if v_item.reversal_of is not null then
    v_paid := v_item.amount;
  else
    select coalesce(sum(case when (e.direction = 'in') = (v_item.direction = 'receivable') then 1 else -1 end
                        * (e.amount + coalesce(e.withholding_amount, 0))), 0)
      into v_paid
      from public.cash_entries e where e.open_item_id = p_id and e.tenant_id = v_item.tenant_id and e.voided_at is null;
    v_paid := v_paid + coalesce((select sum(m.amount) from public.finance_open_items m
                                  where m.reversal_of = p_id and m.tenant_id = v_item.tenant_id and m.status <> 'cancelled'), 0);
    v_paid := greatest(v_paid, 0, coalesce(v_item.offbook_amount, 0));
  end if;
  v_status := case when v_item.status = 'cancelled' then 'cancelled'
                   when v_paid >= v_item.amount then 'paid'
                   when v_paid > 0 then 'partial'
                   else 'open' end;
  update public.finance_open_items
     set paid_amount = v_paid, status = v_status
   where id = p_id and (paid_amount is distinct from v_paid or status is distinct from v_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Yardimcilar (istemciye kapali)
-- ---------------------------------------------------------------------------
-- Kayit eden: oturum kullanicisi profiles'ta varsa o (created_by FK), yoksa null (cron, service_role, migration).
create or replace function public.finance_accrual_actor()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p where p.id = auth.uid();
$$;

-- Cari cozumu: kullanici (danisman, user_id) / musteri (customer_id) / yalniz ad. Ayni bag + tur varsa o; ayni ad + tur
-- bagsizsa ona baglanir; ayni ad baska kayda bagliysa kisa ek ile yeni cari acilir. ON CONFLICT DO NOTHING (yaris guvenli).
create or replace function public.finance_accrual_party(p_tenant uuid, p_kind text, p_name text, p_customer uuid, p_user uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text;
  v_cust uuid;
  v_usr uuid;
begin
  if p_tenant is null or p_kind is null or p_kind not in ('musteri', 'malik', 'kiraci', 'tedarikci', 'danisman', 'diger') then
    return null;
  end if;
  if p_user is not null then
    select p.id into v_id from public.finance_parties p
     where p.tenant_id = p_tenant and p.user_id = p_user and p.kind = p_kind and p.archived_at is null
     order by p.created_at, p.id limit 1;
  elsif p_customer is not null then
    select p.id into v_id from public.finance_parties p
     where p.tenant_id = p_tenant and p.customer_id = p_customer and p.kind = p_kind and p.archived_at is null
     order by p.created_at, p.id limit 1;
  end if;
  if v_id is not null then return v_id; end if;

  v_name := pg_catalog.left(pg_catalog.btrim(coalesce(p_name, '')), 120);
  if v_name = '' then
    if p_user is null and p_customer is null then return null; end if;
    v_name := case when p_kind = 'danisman' then 'Danışman' else 'Cari' end;
  end if;
  select p.id, p.customer_id, p.user_id into v_id, v_cust, v_usr from public.finance_parties p
   where p.tenant_id = p_tenant and pg_catalog.lower(p.name) = pg_catalog.lower(v_name) and p.kind = p_kind and p.archived_at is null
   limit 1;
  if v_id is not null then
    if p_user is null and p_customer is null then return v_id; end if;
    if v_cust is null and v_usr is null then
      update public.finance_parties
         set customer_id = p_customer, user_id = p_user, updated_at = pg_catalog.now()
       where id = v_id;
      return v_id;
    end if;
    v_name := pg_catalog.left(v_name, 110) || ' #' || pg_catalog.left(coalesce(p_user, p_customer)::text, 6);
  end if;
  insert into public.finance_parties (tenant_id, kind, name, customer_id, user_id)
  values (p_tenant, p_kind, v_name, p_customer, p_user)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select p.id into v_id from public.finance_parties p
     where p.tenant_id = p_tenant and pg_catalog.lower(p.name) = pg_catalog.lower(v_name) and p.kind = p_kind and p.archived_at is null
     limit 1;
  end if;
  return v_id;
end;
$$;

-- Anahtar ailesi: taban anahtar ya da surumu (`<taban>:r{n}`); ayna (`:rev`) disarida.
create or replace function public.finance_accrual_key_match(p_key text, p_base text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_key is not null and p_base is not null
     and (p_key = p_base
          or (pg_catalog.left(p_key, char_length(p_base) + 2) = p_base || ':r'
              and pg_catalog.substr(p_key, char_length(p_base) + 3) ~ '^[0-9]+$'));
$$;

-- Etkin tahakkuk kalemi: iptal edilmemis, aynasi olmayan, anahtar ailesindeki en yeni kalem.
create or replace function public.finance_accrual_active_item(p_tenant uuid, p_event_type text, p_base_key text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id from public.finance_open_items o
   where o.tenant_id = p_tenant and o.event_type = p_event_type and o.reversal_of is null and o.status <> 'cancelled'
     and public.finance_accrual_key_match(o.posting_key, p_base_key)
     and not exists (select 1 from public.finance_open_items m where m.reversal_of = o.id)
   order by o.created_at desc, o.id desc
   limit 1;
$$;

-- Esitleme cekirdegi: istenen tahakkuk (p_event: finance_post_internal olayi, event_type/posting_key haric; null = tahakkuk
-- olmamali) ile etkin kalemi karsilastirir. Ayni tutar/KDV -> yalniz cari guncellenir; farkli ya da artik yok -> ters kayit
-- (+ gerekiyorsa yeni surum anahtariyla yeniden kayit). Etkin kalem kimligini (ya da null) doner.
create or replace function public.finance_accrual_sync(p_tenant uuid, p_event_type text, p_base_key text, p_event jsonb, p_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.finance_accrual_actor();
  v_cur public.finance_open_items%rowtype;
  v_amount numeric;
  v_vat numeric;
  v_party uuid;
  v_n integer;
  v_res jsonb;
begin
  if p_tenant is null or p_event_type is null or p_base_key is null then return null; end if;
  -- Ayni kaynak icin eszamanli esitlemeler sirayla (surum numarasi tekil kalir).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_tenant::text || '|accrual|' || p_base_key));
  select * into v_cur from public.finance_open_items o
   where o.id = public.finance_accrual_active_item(p_tenant, p_event_type, p_base_key);

  if p_event is not null then
    v_amount := (p_event #>> '{item,amount}')::numeric;
    v_vat := coalesce(nullif(p_event #>> '{item,vat_amount}', '')::numeric, 0);
    v_party := nullif(p_event ->> 'party_id', '')::uuid;
  end if;

  if v_cur.id is not null then
    if p_event is not null and v_cur.amount = v_amount and coalesce(v_cur.vat_amount, 0) = v_vat then
      if v_party is not null and v_cur.party_id is distinct from v_party then
        update public.finance_open_items set party_id = v_party where id = v_cur.id;
      end if;
      return v_cur.id;
    end if;
    -- Kasa disi taban ters kaydi engellemez (nakit yok); bagli nakit varsa engeller.
    if v_cur.offbook_amount <> 0 then
      update public.finance_open_items set offbook_amount = 0 where id = v_cur.id;
      perform public.finance_open_item_recompute(v_cur.id);
    end if;
    begin
      -- Tarih verilmez: acik donemde iptal; kilitli donemde ayna, yeni surumle ayni ilk acik aya duser (K/Z simetrik).
      perform public.finance_reverse_internal(p_tenant, v_actor, v_cur.id, p_reason, null);
    exception when sqlstate 'P0001' then
      if sqlerrm = 'FN:has_settlements' then
        raise exception 'Tahsilat ya da ödeme görmüş tahakkuk değiştirilemez; önce bağlı kasa/banka hareketini geri alın.'
          using errcode = 'P0001', hint = 'finance_accrual:' || p_base_key;
      end if;
      raise;
    end;
  end if;

  if p_event is null then return null; end if;
  select count(*)::integer + 1 into v_n from public.finance_open_items o
   where o.tenant_id = p_tenant and public.finance_accrual_key_match(o.posting_key, p_base_key);
  v_res := public.finance_post_internal(p_tenant, v_actor,
    p_event || jsonb_build_object('event_type', p_event_type,
                                  'posting_key', case when v_n = 1 then p_base_key else p_base_key || ':r' || v_n::text end));
  return nullif(v_res ->> 'open_item_id', '')::uuid;
end;
$$;

-- Kasa disi taban + not. Taban, kalemin tutarini asamaz; bagli nakit tabandan azsa nota 'kasa dışı' duser (bir kez).
create or replace function public.finance_accrual_apply_offbook(p_item uuid, p_offbook numeric)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item public.finance_open_items%rowtype;
  v_off numeric;
  v_cash numeric;
begin
  if p_item is null then return; end if;
  select * into v_item from public.finance_open_items o where o.id = p_item for update;
  if not found then return; end if;
  v_off := least(greatest(coalesce(p_offbook, 0), 0), v_item.amount);
  if v_item.offbook_amount is distinct from v_off then
    update public.finance_open_items set offbook_amount = v_off where id = p_item;
  end if;
  perform public.finance_open_item_recompute(p_item);
  if v_off > 0 then
    select coalesce(sum(e.amount + coalesce(e.withholding_amount, 0)), 0) into v_cash
      from public.cash_entries e where e.open_item_id = p_item and e.tenant_id = v_item.tenant_id and e.voided_at is null;
    if v_cash < v_off and coalesce(v_item.note, '') not like '%kasa dışı%' then
      update public.finance_open_items
         set note = pg_catalog.left(concat_ws(' · ', nullif(pg_catalog.btrim(coalesce(note, '')), ''), 'kasa dışı'), 1000)
       where id = p_item;
    end if;
  end if;
end;
$$;

-- Eski yol tahsilat hareketinin hedef kalemi: komisyon (source_id = komisyon) ya da bina tahsilati (source_id = building_payments).
create or replace function public.finance_accrual_cash_target(p_tenant uuid, p_source_type text, p_source_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_charge uuid;
begin
  if p_tenant is null or p_source_id is null then return null; end if;
  if p_source_type = 'commission' then
    return public.finance_accrual_active_item(p_tenant, 'commission.accrued', 'commission:' || p_source_id::text);
  elsif p_source_type = 'building' then
    select bp.charge_id into v_charge from public.building_payments bp where bp.id = p_source_id and bp.tenant_id = p_tenant;
    if v_charge is null then return null; end if;
    return public.finance_accrual_active_item(p_tenant, 'building.charged', 'building_charge:' || v_charge::text);
  end if;
  return null;
end;
$$;

-- Mevcut eski yol hareketlerini (ve aynalarini) kaleme baglar. Yalniz parasal olmayan alan (open_item_id) yazilir:
-- kilitli ayda da serbest; bagli hareket tetigi kalemi yeniden hesaplar.
create or replace function public.finance_accrual_link_cash(p_item uuid, p_source_type text, p_source_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item public.finance_open_items%rowtype;
  v_n integer := 0;
  v_m integer := 0;
begin
  if p_item is null or p_source_ids is null or pg_catalog.cardinality(p_source_ids) = 0 then return 0; end if;
  select * into v_item from public.finance_open_items o where o.id = p_item;
  if not found then return 0; end if;
  update public.cash_entries e
     set open_item_id = p_item
   where e.tenant_id = v_item.tenant_id and e.source_type = p_source_type and e.source_id = any (p_source_ids)
     and e.open_item_id is null and e.reversal_of is null and e.posting_key is null
     and e.direction = 'in' and e.currency = v_item.currency and public.finance_account_is_office(e.account_id);
  get diagnostics v_n = row_count;
  update public.cash_entries m
     set open_item_id = p_item
    from public.cash_entries s
   where m.reversal_of = s.id and s.open_item_id = p_item and m.open_item_id is null and m.tenant_id = v_item.tenant_id;
  get diagnostics v_m = row_count;
  return v_n + v_m;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Kaynak esitleyicileri
-- ---------------------------------------------------------------------------
-- Pay (split): ofis disi pay -> danisman (user_id) ya da dis taraf (ad) borcu; komisyon tarihinde.
create or replace function public.finance_split_accrual_sync(p_split uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_party uuid;
  v_date date;
  v_paid numeric;
  v_ev jsonb;
  v_id uuid;
begin
  if p_split is null then return null; end if;
  select s.id, s.tenant_id, s.kind, s.profile_id, s.label, s.amount, c.created_at as c_created, c.is_sample as c_sample,
         c.status as c_status, d.property_id, pf.full_name
    into r
    from public.commission_splits s
    join public.commissions c on c.id = s.commission_id and c.tenant_id = s.tenant_id
    left join public.deals d on d.id = c.deal_id and d.tenant_id = c.tenant_id
    left join public.profiles pf on pf.id = s.profile_id
   where s.id = p_split;
  if not found then return null; end if;

  if not r.c_sample and coalesce(r.c_status, '') <> 'cancelled' and r.kind <> 'office' and pg_catalog.round(r.amount, 2) >= 0.01 then
    v_party := case when r.profile_id is not null
                    then public.finance_accrual_party(r.tenant_id, 'danisman', r.full_name, null, r.profile_id)
                    else public.finance_accrual_party(r.tenant_id, 'diger', r.label, null, null) end;
    v_date := (r.c_created at time zone 'Europe/Istanbul')::date;
    v_ev := jsonb_build_object(
      'date', v_date, 'source_id', r.id, 'party_id', v_party, 'property_id', r.property_id,
      'title', pg_catalog.left('Hakediş — ' || coalesce(nullif(pg_catalog.btrim(r.label), ''), 'Pay'), 160),
      'item', jsonb_build_object('amount', pg_catalog.round(r.amount, 2), 'due_date', v_date));
  end if;
  v_id := public.finance_accrual_sync(r.tenant_id, 'commission.split_accrued', 'split:' || r.id::text, v_ev,
                                      'Pay tutarı, tarafı ya da komisyon durumu değişti');
  if v_id is not null then
    select coalesce(sum(cp.amount), 0) into v_paid from public.commission_payouts cp
     where cp.split_id = r.id and cp.tenant_id = r.tenant_id and cp.status = 'paid';
    perform public.finance_accrual_apply_offbook(v_id, v_paid);
  end if;
  return v_id;
end;
$$;

-- Komisyon: musteri alacagi = brut (KDV haric matrah) + KDV, olusturma gunu. Paylar da esitlenir (durum/ornek degisimi).
create or replace function public.finance_commission_accrual_sync(p_commission uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_vat numeric;
  v_amount numeric;
  v_date date;
  v_party uuid;
  v_ev jsonb;
  v_id uuid;
  s record;
begin
  if p_commission is null then return null; end if;
  select c.id, c.tenant_id, c.gross_amount, c.vat_amount, c.status, c.is_sample, c.created_at, d.customer_id, d.property_id,
         cu.full_name
    into r
    from public.commissions c
    left join public.deals d on d.id = c.deal_id and d.tenant_id = c.tenant_id
    left join public.customers cu on cu.id = d.customer_id
   where c.id = p_commission;
  if not found then return null; end if;

  v_vat := pg_catalog.round(greatest(coalesce(r.vat_amount, 0), 0), 2);
  v_amount := pg_catalog.round(greatest(coalesce(r.gross_amount, 0), 0), 2) + v_vat;
  if not r.is_sample and coalesce(r.status, '') <> 'cancelled' and v_amount >= 0.01 then
    v_date := (r.created_at at time zone 'Europe/Istanbul')::date;
    v_party := public.finance_accrual_party(r.tenant_id, 'musteri', r.full_name, r.customer_id, null);
    v_ev := jsonb_build_object(
      'date', v_date, 'source_id', r.id, 'party_id', v_party, 'property_id', r.property_id,
      'title', 'Komisyon alacağı',
      'item', jsonb_build_object('amount', v_amount, 'vat_amount', nullif(v_vat, 0),
                                 'vat_rate', case when r.gross_amount > 0 and v_vat > 0
                                                  then least(pg_catalog.round(v_vat / r.gross_amount * 100, 2), 100) end,
                                 'due_date', v_date));
  end if;
  v_id := public.finance_accrual_sync(r.tenant_id, 'commission.accrued', 'commission:' || r.id::text, v_ev,
                                      'Komisyon tutarı ya da durumu değişti');
  if v_id is not null then
    perform public.finance_accrual_link_cash(v_id, 'commission', array[r.id]);
    perform public.finance_accrual_apply_offbook(v_id, case when r.status in ('paid', 'collected') then v_amount else 0 end);
  end if;
  for s in select x.id from public.commission_splits x where x.commission_id = r.id and x.tenant_id = r.tenant_id order by x.id loop
    perform public.finance_split_accrual_sync(s.id);
  end loop;
  return v_id;
end;
$$;

-- Hakedis: payi olan hakedisin borcu pay tahakkukudur (yalniz kasa disi taban guncellenir). Payi OLMAYAN hakedis onaylaninca
-- (approved / paid) danismana borc yazilir; iptal / beklemeye donus ters kayit.
create or replace function public.finance_payout_accrual_sync(p_payout uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_party uuid;
  v_date date;
  v_ev jsonb;
  v_id uuid;
begin
  if p_payout is null then return null; end if;
  select cp.id, cp.tenant_id, cp.split_id, cp.profile_id, cp.amount, cp.status, cp.approved_at, cp.paid_at, cp.created_at,
         pf.full_name, coalesce(c.is_sample, false) as c_sample, d.property_id
    into r
    from public.commission_payouts cp
    left join public.profiles pf on pf.id = cp.profile_id
    left join public.commissions c on c.id = cp.commission_id and c.tenant_id = cp.tenant_id
    left join public.deals d on d.id = c.deal_id and d.tenant_id = c.tenant_id
   where cp.id = p_payout;
  if not found then return null; end if;
  if r.split_id is not null then perform public.finance_split_accrual_sync(r.split_id); end if;

  if r.split_id is null and not r.c_sample and r.status in ('approved', 'paid') and pg_catalog.round(r.amount, 2) >= 0.01 then
    v_party := public.finance_accrual_party(r.tenant_id, 'danisman', r.full_name, null, r.profile_id);
    v_date := (coalesce(r.approved_at, r.paid_at, r.created_at) at time zone 'Europe/Istanbul')::date;
    v_ev := jsonb_build_object(
      'date', v_date, 'source_id', r.id, 'party_id', v_party, 'property_id', r.property_id,
      'title', 'Danışman hakedişi',
      'item', jsonb_build_object('amount', pg_catalog.round(r.amount, 2), 'due_date', v_date));
  end if;
  v_id := public.finance_accrual_sync(r.tenant_id, 'payout.approved', 'payout:' || r.id::text || ':approved', v_ev,
                                      'Hakediş tutarı ya da durumu değişti');
  if v_id is not null then
    perform public.finance_accrual_apply_offbook(v_id, case when r.status = 'paid' then r.amount else 0 end);
  end if;
  return v_id;
end;
$$;

-- Bina aidati: ödeyen daire sahibi (malik) / kiraci alacagi (emanet; K/Z disi). Duzenleme = olusturma gunu (vadeden gec
-- olamaz), vade = due_date. Kasa disi taban = building_charges.paid_amount.
create or replace function public.finance_building_accrual_sync(p_charge uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_party uuid;
  v_issue date;
  v_ev jsonb;
  v_id uuid;
  v_pay uuid[];
begin
  if p_charge is null then return null; end if;
  select bc.id, bc.tenant_id, bc.amount, bc.paid_amount, bc.due_date, bc.payer_role, bc.payer_customer_id, bc.voided_at,
         bc.created_at, b.name as building_name, u.unit_no, cu.full_name
    into r
    from public.building_charges bc
    left join public.buildings b on b.id = bc.building_id and b.tenant_id = bc.tenant_id
    left join public.building_units u on u.id = bc.unit_id and u.tenant_id = bc.tenant_id
    left join public.customers cu on cu.id = bc.payer_customer_id
   where bc.id = p_charge;
  if not found then return null; end if;

  if r.voided_at is null and pg_catalog.round(r.amount, 2) >= 0.01 then
    if r.payer_customer_id is not null then
      v_party := public.finance_accrual_party(r.tenant_id, case when r.payer_role = 'tenant' then 'kiraci' else 'malik' end,
                                              r.full_name, r.payer_customer_id, null);
    end if;
    v_issue := least((r.created_at at time zone 'Europe/Istanbul')::date, r.due_date);
    v_ev := jsonb_build_object(
      'date', v_issue, 'source_id', r.id, 'party_id', v_party,
      'title', pg_catalog.left('Aidat ' || coalesce(r.building_name, '') || ' / ' || coalesce(r.unit_no, ''), 160),
      'item', jsonb_build_object('amount', pg_catalog.round(r.amount, 2), 'due_date', r.due_date));
  end if;
  v_id := public.finance_accrual_sync(r.tenant_id, 'building.charged', 'building_charge:' || r.id::text, v_ev,
                                      'Aidat tahakkuku iptal edildi ya da tutarı değişti');
  if v_id is not null then
    select pg_catalog.array_agg(bp.id) into v_pay from public.building_payments bp where bp.charge_id = r.id and bp.tenant_id = r.tenant_id;
    perform public.finance_accrual_link_cash(v_id, 'building', v_pay);
    perform public.finance_accrual_apply_offbook(v_id, r.paid_amount);
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Tetikleyiciler (AFTER; kiraci = satirin tenant_id'si)
-- ---------------------------------------------------------------------------
create or replace function public.finance_accrual_source_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Kiraci silinirken (zincirleme) defter de siliniyor: ters kayit yazilmaz.
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then return null; end if;
    if tg_table_name = 'commissions' then
      perform public.finance_accrual_sync(old.tenant_id, 'commission.accrued', 'commission:' || old.id::text, null, 'Komisyon silindi');
    elsif tg_table_name = 'commission_splits' then
      perform public.finance_accrual_sync(old.tenant_id, 'commission.split_accrued', 'split:' || old.id::text, null, 'Pay silindi');
    elsif tg_table_name = 'commission_payouts' then
      perform public.finance_accrual_sync(old.tenant_id, 'payout.approved', 'payout:' || old.id::text || ':approved', null, 'Hakediş silindi');
      if old.split_id is not null then perform public.finance_split_accrual_sync(old.split_id); end if;
    elsif tg_table_name = 'building_charges' then
      perform public.finance_accrual_sync(old.tenant_id, 'building.charged', 'building_charge:' || old.id::text, null, 'Aidat tahakkuku silindi');
    end if;
    return null;
  end if;

  if tg_table_name = 'commissions' then
    perform public.finance_commission_accrual_sync(new.id);
  elsif tg_table_name = 'commission_splits' then
    perform public.finance_split_accrual_sync(new.id);
  elsif tg_table_name = 'commission_payouts' then
    perform public.finance_payout_accrual_sync(new.id);
    if tg_op = 'UPDATE' and old.split_id is not null and old.split_id is distinct from new.split_id then
      perform public.finance_split_accrual_sync(old.split_id);
    end if;
  elsif tg_table_name = 'building_charges' then
    perform public.finance_building_accrual_sync(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_commissions_finance_accrual on public.commissions;
create trigger trg_commissions_finance_accrual
  after insert or delete or update of gross_amount, vat_amount, status, is_sample, deal_id, created_at on public.commissions
  for each row execute function public.finance_accrual_source_trg();
drop trigger if exists trg_commission_splits_finance_accrual on public.commission_splits;
create trigger trg_commission_splits_finance_accrual
  after insert or delete or update of amount, kind, profile_id, label, commission_id on public.commission_splits
  for each row execute function public.finance_accrual_source_trg();
drop trigger if exists trg_commission_payouts_finance_accrual on public.commission_payouts;
create trigger trg_commission_payouts_finance_accrual
  after insert or delete or update of status, amount, split_id, profile_id, approved_at on public.commission_payouts
  for each row execute function public.finance_accrual_source_trg();
drop trigger if exists trg_building_charges_finance_accrual on public.building_charges;
create trigger trg_building_charges_finance_accrual
  after insert or delete or update of amount, paid_amount, voided_at, payer_customer_id, payer_role, due_date on public.building_charges
  for each row execute function public.finance_accrual_source_trg();

-- Yeni eski yol tahsilat hareketi (posting_key'siz, kalemsiz) etkin tahakkuk kalemine baglanir; bagli hareket tetigi kalemi
-- yeniden hesaplar. Kayit servisi (posting_key) satirlari kendi `settles` bagini tasir; dokunulmaz.
create or replace function public.cash_entries_accrual_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item uuid;
begin
  if new.open_item_id is null and new.reversal_of is null and new.posting_key is null and new.direction = 'in'
     and new.source_type in ('commission', 'building') and new.source_id is not null
     and public.finance_account_is_office(new.account_id) then
    v_item := public.finance_accrual_cash_target(new.tenant_id, new.source_type, new.source_id);
    if v_item is not null and exists (select 1 from public.finance_open_items o where o.id = v_item and o.currency = new.currency) then
      new.open_item_id := v_item;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cash_entries_accrual_link on public.cash_entries;
create trigger trg_cash_entries_accrual_link
  before insert on public.cash_entries
  for each row when (new.open_item_id is null and new.source_type in ('commission', 'building'))
  execute function public.cash_entries_accrual_link();

-- ---------------------------------------------------------------------------
-- 5) Yetkiler: hepsi istemciye kapali
-- ---------------------------------------------------------------------------
revoke all on function public.finance_open_item_recompute(uuid) from public, anon, authenticated;
revoke all on function public.finance_accrual_actor() from public, anon, authenticated;
revoke all on function public.finance_accrual_party(uuid, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.finance_accrual_key_match(text, text) from public, anon, authenticated;
revoke all on function public.finance_accrual_active_item(uuid, text, text) from public, anon, authenticated;
revoke all on function public.finance_accrual_sync(uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.finance_accrual_apply_offbook(uuid, numeric) from public, anon, authenticated;
revoke all on function public.finance_accrual_cash_target(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.finance_accrual_link_cash(uuid, text, uuid[]) from public, anon, authenticated;
revoke all on function public.finance_split_accrual_sync(uuid) from public, anon, authenticated;
revoke all on function public.finance_commission_accrual_sync(uuid) from public, anon, authenticated;
revoke all on function public.finance_payout_accrual_sync(uuid) from public, anon, authenticated;
revoke all on function public.finance_building_accrual_sync(uuid) from public, anon, authenticated;
revoke all on function public.finance_accrual_source_trg() from public, anon, authenticated;
revoke all on function public.cash_entries_accrual_link() from public, anon, authenticated;
grant execute on function public.finance_open_item_recompute(uuid) to service_role;
grant execute on function public.finance_accrual_actor() to service_role;
grant execute on function public.finance_accrual_party(uuid, text, text, uuid, uuid) to service_role;
grant execute on function public.finance_accrual_key_match(text, text) to service_role;
grant execute on function public.finance_accrual_active_item(uuid, text, text) to service_role;
grant execute on function public.finance_accrual_sync(uuid, text, text, jsonb, text) to service_role;
grant execute on function public.finance_accrual_apply_offbook(uuid, numeric) to service_role;
grant execute on function public.finance_accrual_cash_target(uuid, text, uuid) to service_role;
grant execute on function public.finance_accrual_link_cash(uuid, text, uuid[]) to service_role;
grant execute on function public.finance_split_accrual_sync(uuid) to service_role;
grant execute on function public.finance_commission_accrual_sync(uuid) to service_role;
grant execute on function public.finance_payout_accrual_sync(uuid) to service_role;
grant execute on function public.finance_building_accrual_sync(uuid) to service_role;

comment on function public.finance_accrual_sync(uuid, text, text, jsonb, text) is
  'WP2 tahakkuk esitleme cekirdegi: istenen tahakkuk ile etkin kalem (anahtar ailesi <taban>[:r{n}]) karsilastirilir; degisiklikte ters kayit + yeni surum. Yalniz tetikleyici/geri doldurma cagirir.';
comment on function public.finance_accrual_source_trg() is
  'WP2: commissions / commission_splits / commission_payouts / building_charges -> tahakkuk (finance_post_internal). Tetikleyici yalniz tahakkuk yazar; nakit RPC ile.';
