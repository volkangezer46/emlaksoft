-- MIGRATION 20260825000600 (2026-10-05 terfi; eski taslak adi proposed/20261005000900_seat_purchase_fulfillment.sql).
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260825000600_seat_purchase_fulfillment.sql` ile uygular.
-- NUMARA NOTU: fonksiyon GOVDELERI icindeki yorumlarda eski taslak numaralari (20261005000500/800/900) bilerek
-- korunmustur: govde md5'leri (asagidaki BEKLENEN SONRA tablosu) bu metne baglidir. Eski -> yeni:
-- 20261005000500 = 20260825000300, 20261005000800 = 20260825000500, 20261005000900 = 20260825000600,
-- 20261005000400 = 20260825000400.
-- Ek kullanici (koltuk) satisinin SQL tarafi.
-- TAM GOVDELI yeniden tanim. pg_get_functiondef + replace ile canli govde YAMALANMAZ; her govde asagidaki
-- kaynak dosyadaki son tanimdan turetilip butunuyle yazilmistir (bkz. TABAN).
--
-- NEDEN
--   Kod (src/lib/billing/seat-purchase.ts, src/app/actions/billing.ts startSeatPurchase) ek kullanici icin
--   oransal tutari sunucuda hesaplayip `meta.kind = 'extra_seats'` faturasi keser ve iyzico'ya yonlendirir.
--   Bugunku SQL bu faturayi PLAN YENILEMESI gibi isler: fulfill_billing_payment aboneligi yeniden aktive eder,
--   amount_try'yi plan fiyatina yazar, fulfill_billing_payment_v2 donemi 1 ay/yil UZATIR ve extra_seats hic
--   artmaz. Ayrica profiles koltuk tetikleyicisi plan limitini dogrudan okudugu icin satin alinan koltuk
--   kullanilamaz. Bu yuzden kod, `seat_purchase_ready()` true donmedikce satis yapmaz (bu dosya o RPC'yi ekler).
--
-- NE DEGISIR
--   1. enforce_plan_capacity() (profiles/customers/properties/branches tetikleyici fonksiyonu; kaynak
--      20260802000320): yalniz 'seats' metriginde kapasite = public.effective_seat_limit(tenant)
--      (= plan_entitlements.seat_limit + subscriptions.extra_seats). Fonksiyon yoksa/NULL donerse eski plan
--      limiti; etkin limit plan limitinin altina inmez. Diger metrikler ve hata metni bicimi AYNEN
--      ('PLAN_LIMIT_EXCEEDED:seats:<etkin limit>'; koltuk baglantisi ipucu kodda eklenir).
--   2. enforce_tenant_plan_capacity() (tenants.plan degisimi; kaynak 20260802000320): koltuk kapasitesi =
--      YENI planin seat_limit'i + extra_seats (BEFORE UPDATE'te tenants.plan henuz eski oldugundan
--      effective_seat_limit(new.id) burada eski plani okurdu; ayni formul dogrudan uygulanir). Diger
--      metrikler AYNEN.
--   3. fulfill_billing_payment (10 arg): TABAN 20260825000300 (eski 20261005000500) tam govdesi. Fatura meta.kind = 'extra_seats':
--      plan yenilemesi SAYILMAZ; subscriptions satiri FOR UPDATE kilitlenir, extra_seats = meta.toExtraSeats
--      (yalniz ARTIS, yalniz mevcut extra_seats = meta.fromExtraSeats iken; aksi halde 22023 ile reddedilir ve
--      tahsilat kaydi refund_required'a duser), current_period_*, plan, amount_try, price_lock_* ve tenants
--      DEGISMEZ, fatura 'paid' olur (donem: simdi -> mevcut donem sonu). Tek sefer: billing_fulfillment_events
--      tekil claim'i + 'paid' fatura kontrolu + `where extra_seats = from` kosullu guncelleme.
--      Bilinmeyen meta.kind reddedilir (bugun kind yazan tek yer extra_seats). kind YOKSA davranis 000500 ile
--      birebir ayni (tutar plan tanimindan, yillik x10 yedek, fiyat kilidi, business).
--   4. fulfill_billing_payment_v2 (kaynak 20260810000100): ic sonuc kind = 'extra_seats' ise donem UZATILMAZ;
--      yalniz checkout_status = 'fulfilled'. Diger her sey AYNEN.
--   5. public.seat_purchase_ready() (YENI, service_role-only, boolean, hata firlatmaz): extra_seats sutunu,
--      effective_seat_limit(uuid), iki koltuk tetikleyicisinin etkin ve bu dosyanin govdesine (seat-capacity:v1)
--      bagli olmasi ve fulfill + v2'nin extra_seats destegi (seat-fulfillment:v1) varsa TRUE; aksi halde FALSE.
--   Tablo/sutun/veri degisikligi YOK; tetikleyiciler yeniden olusturulmaz (fonksiyon yerinde degisir; tablo
--   kilidi alinmaz). Yeniden calistirilabilir (create or replace; on-kosul kendi govdesini tanir).
--
-- KOD SOZLESMESI (adlar sabit): SEAT_READY_RPC = 'seat_purchase_ready' (seat-purchase.ts); meta alanlari
--   kind, conversationId, plan, cycle, source, fromExtraSeats, toExtraSeats, targetTotalSeats, chargeNetTry,
--   quotedPeriodTry (createSeatInvoice). Kod effective_seat_limit'i p_tenant_id adiyla cagirir (000800 ile ayni).
--
-- BAGIMLILIK (bu dosya SU taslaklardan SONRA uygulanmali; asagidaki on-kosul blogu eksikse HICBIR sey yazmadan
-- DURUR). Bu dosya extra_seats sutununu ve effective_seat_limit(uuid)'i YENIDEN TANIMLAMAZ:
--   supabase/migrations/20260825000300_billing_plan_amount_integrity.sql   plan_* yardimcilari + fulfill TABANI
--   supabase/migrations/20260825000500_billing_pause_proration_business_seats.sql
--        (D bolumu CIKARILMIS halde; A = extra_seats sutunu, E = effective_seat_limit(uuid))
--   Canlida olan: 20260802000320 (tetikleyiciler), 20260809000000 + 20260810000100 (fulfill/v2, events,
--   checkout_status), 20260817000220 (price_lock_*; 000500 zaten gerektirir).
--   GEREKMEZ: 20260825000400 (koltuk fiyat kilidi sutunlari; bu dosya onlara dokunmaz).
--   Sira: 20260825000300 -> 20260825000500 (D'siz) -> 20260825000600 (terfi 2026-10-05, sira korundu).
--
-- TABAN (md5(replace(prosrc, E'\r', '')); on-kosul blogu canli govdeyi bununla karsilastirir, SAPMA = DUR):
--   fulfill_billing_payment (10 arg)  a69a76095ddeafb4524bdcc634b25507  (20260825000300 govdesi; terfide degismedi, dogrulandi)
--   fulfill_billing_payment_v2        58632405633c6b701b7b330460e88f69  (20260810000100)
--   enforce_plan_capacity()           15a0a848fde39a1cb8271b0ff4a53f2a  (20260802000320)
--   enforce_tenant_plan_capacity()    55e3e409a53ba3140aa749e4a974ec37  (20260802000320)
--   20260825000300'in fulfill govdesi DEGISIRSE bu dosya o yeni govdeden YENIDEN TURETILMELI (aksi halde
--   on-kosul blogu durur; bu bilerek boyle: eski tabanin ustune yazip 000500 duzeltmesini silmesin).
--
-- CANLI UYGULAMA: restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular. Sira:
--   (1) asagidaki SALT-OKUNUR dogrulama sorgusu -> BEKLENEN (ONCE) ile karsilastir, sapma varsa DUR;
--   (2) 20260825000300 ve 20260825000500 (D'siz) uygulanmis olmali;
--   (3) `npm run check:migrations -- --database`; (4) `npm run db:migrate -- --dry-run`;
--   (5) `npm run db:migrate -- --only 20260825000600_seat_purchase_fulfillment.sql`; (6) dogrulama sorgusunu tekrar
--   calistir (BEKLENEN SONRA); (7) koltuk satisi kodda en gec 60 sn icinde (getSeatSupport onbellegi) acilir;
--   ilk satisi test ofisinde dene.
-- GERI ALMA: supabase/rollbacks/20260825000600_seat_purchase_fulfillment.rollback.sql (once seat_purchase_ready
--   kaldirilir -> satis kapanir; sonra dort fonksiyon TABAN govdelerine doner). Bu dosyanin artirdigi extra_seats
--   DEGERLERI geri alinmaz. Rollback 20260825000300 / 20260825000500 rollback'lerinden ONCE calistirilmalidir.
--
-- BILINEN BOSLUKLAR (bu dosyanin kapsami disi; raporlandi):
--   * Yenileme faturasi ek koltuk ucretini icermiyor (kodda extra_seats yalniz satis/gosterimde); ek koltuk ilk
--     donemden sonra ucretsiz kalir. Yenileme tutari kararlastirilmadan genis satis acilmamali.
--   * Koltuk fiyat kilidi (20260825000400 seat_price_lock_*) fulfill'de YAZILMAZ: fatura meta'si kademe tasimiyor.
--   * Kod "dahil koltuk"u plan tanimindan (getPlanDefinition().limits.seats), DB plan_entitlements.seat_limit'ten
--     okur; ikisi ayrisirsa satin alinan toplam ile DB etkin limiti farkli olur (admin "onerilen katalogu uygula").
--   * effective_seat_limit (20260825000500) abonelik durumuna bakmaz: past_due/cancelled abonelikte ek koltuk sayilmaya
--     devam eder. billing_plan_change_preflight extra_seats'i saymaz (daha temkinli; tetikleyici son karardir).
--
-- ---------------------------------------------------------------------------
-- SALT-OKUNUR CANLI GOVDE DOGRULAMA (uygulamadan ONCE ve SONRA; hicbir sey yazmaz)
-- ---------------------------------------------------------------------------
-- select p.proname,
--        pg_catalog.pg_get_function_identity_arguments(p.oid)                 as args,
--        md5(replace(p.prosrc, E'\r', ''))                                     as body_md5,
--        position('seat-capacity:v1' in p.prosrc) > 0                         as seat_capacity_v1,
--        position('seat-fulfillment:v1' in p.prosrc) > 0                      as seat_fulfillment_v1,
--        position('public.effective_seat_limit(' in p.prosrc) > 0             as uses_effective_limit,
--        position('public.plan_monthly_amount(' in p.prosrc) > 0              as uses_000500_helper
-- from pg_catalog.pg_proc p
-- join pg_catalog.pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('enforce_plan_capacity', 'enforce_tenant_plan_capacity', 'fulfill_billing_payment',
--                     'fulfill_billing_payment_v2', 'effective_seat_limit', 'seat_purchase_ready')
-- order by 1, 2;
--
-- select
--   exists (select 1 from information_schema.columns
--           where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'extra_seats') as extra_seats_col,
--   (select string_agg(t.tgname || '=' || t.tgfoid::regprocedure::text || ':' || t.tgenabled, ', ' order by t.tgname)
--      from pg_catalog.pg_trigger t
--     where t.tgname in ('trg_profiles_plan_capacity', 'trg_tenants_plan_capacity')) as seat_triggers;
--
-- BEKLENEN (ONCE; 20260825000300 + 20260825000500 D'siz uygulanmis, bu dosya uygulanmamis):
--   enforce_plan_capacity            | ''            | 15a0a848fde39a1cb8271b0ff4a53f2a | f | f | f | f
--   enforce_tenant_plan_capacity     | ''            | 55e3e409a53ba3140aa749e4a974ec37 | f | f | f | f
--   effective_seat_limit             | p_tenant_id uuid | (20260825000500 govdesi)  | f | f | f | f
--   fulfill_billing_payment          | 10 arg        | a69a76095ddeafb4524bdcc634b25507 | f | f | f | t
--   fulfill_billing_payment          | 9 arg (ESKI, 20260731000138) | degismez       | f | f | f | f
--   fulfill_billing_payment_v2       | 10 arg        | 58632405633c6b701b7b330460e88f69 | f | f | f | f
--   seat_purchase_ready              | (satir YOK)
--   extra_seats_col = t; seat_triggers = trg_profiles_plan_capacity=enforce_plan_capacity():O,
--                                        trg_tenants_plan_capacity=enforce_tenant_plan_capacity():O
--   SAPMA = DUR: body_md5 farkliysa canli govde baska bir yolla degismis; bu dosya uygulanmaz (on-kosul da durur).
-- BEKLENEN (SONRA):
--   enforce_plan_capacity            | ''            | e7cdf30c88c0ff4ef67077e5c3f1cdd7 | t | f | t | f
--   enforce_tenant_plan_capacity     | ''            | bf75fbeb7e4336a8dcf42babd77d0917 | t | f | t | f
--   fulfill_billing_payment          | 10 arg        | 0f5b4589c3608509d3c7390e08c7834d | f | t | f | t
--   fulfill_billing_payment_v2       | 10 arg        | 5fc1c6552b2fe6f963fb72ea3264e03e | f | t | f | f
--   seat_purchase_ready              | ''            | (yeni)                           | f | f | f | f
--   9 argumanli ESKI fulfill overload'u degismez. Uygulama kodu (service_role) `select public.seat_purchase_ready()`
--   icin TRUE gorur; SQL editorunde (auth.role() service_role degil) FALSE donmesi BEKLENIR, hata degildir.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 0. On-kosul denetimi (eksik bagimlilik ya da beklenmeyen canli govdede HICBIR sey yazmadan durur;
--    runner her dosyayi tek transaction'da calistirir, bu blok ilk deyimdir)
-- ---------------------------------------------------------------------------
do $$
declare
  v_src text;
begin
  -- 20260825000500 (eski 20261005000800; A ve E bolumleri, D bolumu CIKARILMIS halde)
  if pg_catalog.to_regclass('public.subscriptions') is null or not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.subscriptions'::regclass
      and a.attname = 'extra_seats'
      and a.attnum > 0
      and not a.attisdropped
  ) then
    raise exception '20260825000600: subscriptions.extra_seats yok; once 20260825000500 (D bolumu cikarilmis) uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.effective_seat_limit(uuid)') is null then
    raise exception '20260825000600: public.effective_seat_limit(uuid) yok; once 20260825000500 uygulanmali.';
  end if;

  -- 20260825000300 (eski 20261005000500; plan tutari yardimcilari + tam govdeli fulfill)
  if pg_catalog.to_regprocedure('public.plan_monthly_amount(text)') is null
    or pg_catalog.to_regprocedure('public.plan_period_amount(text, text)') is null
    or pg_catalog.to_regprocedure('public.plan_campaign_lock_amount(text)') is null then
    raise exception '20260825000600: plan tutari yardimcilari yok; once 20260825000300 uygulanmali.';
  end if;

  -- Tablolar / sutunlar (20260809000000, 20260810000100, 20260817000220)
  if pg_catalog.to_regclass('public.billing_fulfillment_events') is null
    or pg_catalog.to_regclass('public.invoices') is null
    or not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.invoices'::regclass and a.attname = 'checkout_status'
        and a.attnum > 0 and not a.attisdropped
    )
    or not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.subscriptions'::regclass and a.attname = 'price_lock_try'
        and a.attnum > 0 and not a.attisdropped
    ) then
    raise exception '20260825000600: faturalama tablolari/sutunlari eksik (20260809000000 / 20260810000100 / 20260817000220).';
  end if;

  -- Canli govde = beklenen TABAN (ya da bu dosyanin kendi govdesi: yeniden calistirma). Sapma = DUR:
  -- tam govde bu tabandan turetildi; farkli bir canli govdenin ustune yazmak oradaki degisikligi silerdi.
  select p.prosrc into v_src
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.fulfill_billing_payment(text, text, text, text, text, uuid, text, text, numeric, text)');
  if v_src is null then
    raise exception '20260825000600: fulfill_billing_payment (10 arg) yok.';
  end if;
  if position('seat-fulfillment:v1' in v_src) = 0
    and md5(replace(v_src, E'\r', '')) <> 'a69a76095ddeafb4524bdcc634b25507' then
    raise exception '20260825000600: fulfill_billing_payment (10 arg) canli govdesi 20260825000300 tabanindan farkli; govde yeniden turetilmeden uygulanmaz.';
  end if;

  v_src := null;
  select p.prosrc into v_src
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.fulfill_billing_payment_v2(text, text, text, text, text, uuid, text, text, numeric, text)');
  if v_src is null then
    raise exception '20260825000600: fulfill_billing_payment_v2 yok (20260810000100).';
  end if;
  if position('seat-fulfillment:v1' in v_src) = 0
    and md5(replace(v_src, E'\r', '')) <> '58632405633c6b701b7b330460e88f69' then
    raise exception '20260825000600: fulfill_billing_payment_v2 canli govdesi 20260810000100 tabanindan farkli; govde yeniden turetilmeden uygulanmaz.';
  end if;

  v_src := null;
  select p.prosrc into v_src
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.enforce_plan_capacity()');
  if v_src is null then
    raise exception '20260825000600: enforce_plan_capacity() yok (20260802000320).';
  end if;
  if position('seat-capacity:v1' in v_src) = 0
    and md5(replace(v_src, E'\r', '')) <> '15a0a848fde39a1cb8271b0ff4a53f2a' then
    raise exception '20260825000600: enforce_plan_capacity canli govdesi 20260802000320 tabanindan farkli; govde yeniden turetilmeden uygulanmaz.';
  end if;

  v_src := null;
  select p.prosrc into v_src
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.enforce_tenant_plan_capacity()');
  if v_src is null then
    raise exception '20260825000600: enforce_tenant_plan_capacity() yok (20260802000320).';
  end if;
  if position('seat-capacity:v1' in v_src) = 0
    and md5(replace(v_src, E'\r', '')) <> '55e3e409a53ba3140aa749e4a974ec37' then
    raise exception '20260825000600: enforce_tenant_plan_capacity canli govdesi 20260802000320 tabanindan farkli; govde yeniden turetilmeden uygulanmaz.';
  end if;

  -- Koltuk tetikleyicileri bu fonksiyonlara bagli olmali (yeniden olusturulmaz; fonksiyon yerinde degisir).
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.profiles'::regclass
      and t.tgname = 'trg_profiles_plan_capacity'
      and t.tgfoid = pg_catalog.to_regprocedure('public.enforce_plan_capacity()')
      and not t.tgisinternal
  ) or not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.tenants'::regclass
      and t.tgname = 'trg_tenants_plan_capacity'
      and t.tgfoid = pg_catalog.to_regprocedure('public.enforce_tenant_plan_capacity()')
      and not t.tgisinternal
  ) then
    raise exception '20260825000600: trg_profiles_plan_capacity / trg_tenants_plan_capacity beklenen fonksiyona bagli degil.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. enforce_plan_capacity (kaynak: 20260802000320; tam govde, koltukta effective_seat_limit)
-- ---------------------------------------------------------------------------
create or replace function public.enforce_plan_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tenant uuid;
  metric text;
  capacity integer;
  current_usage bigint;
  should_check boolean := false;
  v_effective integer;
begin
  target_tenant := new.tenant_id;

  case tg_table_name
    when 'profiles' then
      metric := 'seats';
      should_check := new.is_active and (
        tg_op = 'INSERT' or not old.is_active or new.tenant_id is distinct from old.tenant_id
      );
    when 'customers' then
      metric := 'customers';
      should_check := new.deleted_at is null and (
        tg_op = 'INSERT' or old.deleted_at is not null or new.tenant_id is distinct from old.tenant_id
      );
    when 'properties' then
      metric := 'active_properties';
      should_check := new.deleted_at is null
        and new.status in ('draft', 'live', 'reserved')
        and (
          tg_op = 'INSERT'
          or old.deleted_at is not null
          or old.status not in ('draft', 'live', 'reserved')
          or new.tenant_id is distinct from old.tenant_id
      );
    when 'branches' then
      metric := 'branches';
      should_check := new.is_active and (
        tg_op = 'INSERT' or not old.is_active or new.tenant_id is distinct from old.tenant_id
      );
    else
      return new;
  end case;

  if not should_check then
    return new;
  end if;

  -- Serialize every capacity-changing operation for the tenant. A tenant-wide
  -- lock also makes concurrent plan downgrades and inserts observe one another.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plan-capacity:' || target_tenant::text, 0)
  );

  select case metric
    when 'seats' then pe.seat_limit
    when 'customers' then pe.customer_limit
    when 'active_properties' then pe.active_property_limit
    when 'branches' then pe.branch_limit
  end
  into capacity
  from public.tenants t
  join public.plan_entitlements pe on pe.plan = t.plan
  where t.id = target_tenant;

  -- seat-capacity:v1 (20261005000900): koltuk limiti = plan limiti + satin alinmis ek kullanici
  -- (public.effective_seat_limit, 20261005000800). Fonksiyon yoksa ya da NULL donerse eski davranis
  -- (yalniz plan limiti) aynen korunur; etkin limit plan limitinin ALTINA hicbir kosulda inmez.
  if metric = 'seats'
    and capacity is not null
    and pg_catalog.to_regprocedure('public.effective_seat_limit(uuid)') is not null then
    v_effective := public.effective_seat_limit(target_tenant);
    if v_effective is not null and v_effective > capacity then
      capacity := v_effective;
    end if;
  end if;

  if capacity is null then
    return new;
  end if;

  case metric
    when 'seats' then
      select count(*) into current_usage from public.profiles
      where tenant_id = target_tenant and is_active = true;
    when 'customers' then
      select count(*) into current_usage from public.customers
      where tenant_id = target_tenant and deleted_at is null;
    when 'active_properties' then
      select count(*) into current_usage from public.properties
      where tenant_id = target_tenant
        and deleted_at is null
        and status in ('draft', 'live', 'reserved');
    when 'branches' then
      select count(*) into current_usage from public.branches
      where tenant_id = target_tenant and is_active = true;
  end case;

  if current_usage >= capacity then
    raise exception using
      errcode = 'P0001',
      message = 'PLAN_LIMIT_EXCEEDED:' || metric || ':' || capacity::text;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_plan_capacity() from public, anon, authenticated;

comment on function public.enforce_plan_capacity() is
  'Plan kota tetikleyicisi (profiles/customers/properties/branches). Koltuk: effective_seat_limit (plan + extra_seats); yoksa plan limiti.';

-- ---------------------------------------------------------------------------
-- 2. enforce_tenant_plan_capacity (kaynak: 20260802000320; tam govde, yeni plan limiti + extra_seats)
-- ---------------------------------------------------------------------------
create or replace function public.enforce_tenant_plan_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limits record;
  current_usage bigint;
  v_extra_seats integer;
  v_seat_capacity integer;
begin
  if new.plan is not distinct from old.plan then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plan-capacity:' || new.id::text, 0)
  );

  select
    pe.seat_limit,
    pe.customer_limit,
    pe.active_property_limit,
    pe.branch_limit
  into limits
  from public.plan_entitlements pe
  where pe.plan = new.plan;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'PLAN_ENTITLEMENT_NOT_FOUND:' || new.plan;
  end if;

  if limits.seat_limit is not null then
    v_seat_capacity := limits.seat_limit;
    -- seat-capacity:v1 (20261005000900): etkin koltuk = YENI planin limiti + satin alinmis ek kullanici.
    -- public.effective_seat_limit(new.id) ile AYNI formul; ancak BEFORE UPDATE aninda tenants.plan henuz ESKI
    -- plani gosterdigi icin fonksiyon burada eski plani okurdu. Bu yuzden ek kullanici dogrudan okunur.
    -- effective_seat_limit ya da extra_seats sutunu yoksa eski davranis (yalniz plan limiti) korunur.
    if pg_catalog.to_regprocedure('public.effective_seat_limit(uuid)') is not null
      and exists (
        select 1
        from pg_catalog.pg_attribute a
        where a.attrelid = 'public.subscriptions'::regclass
          and a.attname = 'extra_seats'
          and a.attnum > 0
          and not a.attisdropped
      ) then
      select s.extra_seats
        into v_extra_seats
      from public.subscriptions s
      where s.tenant_id = new.id;
      if coalesce(v_extra_seats, 0) > 0 then
        v_seat_capacity := limits.seat_limit + v_extra_seats;
      end if;
    end if;

    select count(*) into current_usage
    from public.profiles
    where tenant_id = new.id and is_active = true;
    if current_usage > v_seat_capacity then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:seats:' || v_seat_capacity::text;
    end if;
  end if;

  if limits.customer_limit is not null then
    select count(*) into current_usage
    from public.customers
    where tenant_id = new.id and deleted_at is null;
    if current_usage > limits.customer_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:customers:' || limits.customer_limit::text;
    end if;
  end if;

  if limits.active_property_limit is not null then
    select count(*) into current_usage
    from public.properties
    where tenant_id = new.id
      and deleted_at is null
      and status in ('draft', 'live', 'reserved');
    if current_usage > limits.active_property_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:active_properties:' || limits.active_property_limit::text;
    end if;
  end if;

  if limits.branch_limit is not null then
    select count(*) into current_usage
    from public.branches
    where tenant_id = new.id and is_active = true;
    if current_usage > limits.branch_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:branches:' || limits.branch_limit::text;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_tenant_plan_capacity() from public, anon, authenticated;

comment on function public.enforce_tenant_plan_capacity() is
  'Plan degisimi kapasite tetikleyicisi. Koltuk: yeni plan limiti + extra_seats (effective_seat_limit ile ayni formul).';

-- ---------------------------------------------------------------------------
-- 3. fulfill_billing_payment, 10 arg (TABAN: 20260825000300 tam govdesi; + meta.kind = 'extra_seats')
-- ---------------------------------------------------------------------------
create or replace function public.fulfill_billing_payment(
  p_provider text,
  p_conversation_id text,
  p_payment_id text default null,
  p_source text default 'webhook',
  p_target_type text default 'subscription',
  p_expected_tenant_id uuid default null,
  p_expected_plan text default null,
  p_expected_cycle text default null,
  p_expected_amount_try numeric default null,
  p_expected_currency text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_conversation_id text := btrim(coalesce(p_conversation_id, ''));
  v_payment_id text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_target_type text := lower(btrim(coalesce(p_target_type, '')));
  v_expected_currency text := upper(btrim(coalesce(p_expected_currency, '')));
  v_event_id uuid;
  v_completed_event_id uuid;
  v_existing_event public.billing_fulfillment_events%rowtype;
  v_match_count integer;
  v_now timestamptz := now();
  v_result jsonb;

  v_invoice_id uuid;
  v_tenant_id uuid;
  v_invoice_status text;
  v_amount_try numeric;
  v_invoice_currency text;
  v_invoice_meta jsonb;
  v_plan text;
  v_cycle text;
  v_period_end timestamptz;
  v_tax_try numeric;
  v_total_try numeric;
  v_monthly_amount numeric;
  v_subscription_id uuid;
  v_updated_invoice_id uuid;
  v_updated_tenant_id uuid;

  v_sub_plan text;
  v_old_lock_try numeric;
  v_old_lock_campaign text;
  v_meta_lock_try numeric;
  v_meta_lock_campaign text;
  v_lock_try numeric;
  v_lock_campaign text;
  v_subscription_amount numeric;

  -- seat-fulfillment:v1 (20261005000900) ek kullanici faturasi degiskenleri
  v_kind text;
  v_seat_from_num numeric;
  v_seat_to_num numeric;
  v_seat_total_num numeric;
  v_seat_charge_net numeric;
  v_seat_quoted_period numeric;
  v_seat_from integer;
  v_seat_to integer;
  v_seat_total integer;
  v_seat_sub_cycle text;
  v_seat_sub_status text;
  v_seat_sub_extra integer;
  v_seat_sub_period_end timestamptz;
  v_seat_invoice_sub_id uuid;
  v_seat_updated_sub_id uuid;

  v_link_token text;
  v_payment_link_id uuid;
  v_payment_link_tenant_id uuid;
  v_payment_link_commission_id uuid;
  v_payment_link_status text;
  v_payment_link_amount_try numeric;
  v_payment_link_expires_at timestamptz;
  v_updated_payment_link_id uuid;
  v_updated_commission_id uuid;
  v_notification_id uuid;
  v_commission_changed boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if v_provider not in ('iyzico', 'demo') then
    raise exception 'Unsupported payment provider.' using errcode = '22023';
  end if;

  if v_conversation_id = '' or char_length(v_conversation_id) > 512 then
    raise exception 'Invalid conversation identity.' using errcode = '22023';
  end if;

  if v_payment_id is not null and char_length(v_payment_id) > 512 then
    raise exception 'Invalid payment identity.' using errcode = '22023';
  end if;

  if v_source not in ('callback', 'webhook', 'demo')
    or (v_provider = 'demo' and v_source <> 'demo')
    or (v_provider = 'iyzico' and v_source = 'demo') then
    raise exception 'Invalid fulfillment source.' using errcode = '22023';
  end if;

  if v_target_type not in ('subscription', 'payment_link') then
    raise exception 'Invalid fulfillment target.' using errcode = '22023';
  end if;

  if p_expected_amount_try is null or p_expected_amount_try <= 0 then
    raise exception 'Expected payment amount is required.' using errcode = '22023';
  end if;

  if v_expected_currency <> 'TRY' then
    raise exception 'Expected payment currency must be TRY.' using errcode = '22023';
  end if;

  if (v_target_type = 'payment_link' and left(v_conversation_id, 6) <> 'plink-')
    or (v_target_type = 'subscription' and left(v_conversation_id, 6) = 'plink-') then
    raise exception 'Conversation and fulfillment target do not match.' using errcode = '22023';
  end if;

  -- The unique insert is the race winner. A downstream exception rolls the
  -- claim back together with every side effect, allowing a safe provider retry.
  begin
    insert into public.billing_fulfillment_events (
      provider,
      conversation_id,
      payment_id,
      source,
      target_type,
      status
    ) values (
      v_provider,
      v_conversation_id,
      v_payment_id,
      v_source,
      v_target_type,
      'processing'
    )
    returning id into v_event_id;
  exception when unique_violation then
    select count(*)
      into v_match_count
    from public.billing_fulfillment_events e
    where e.provider = v_provider
      and (
        e.conversation_id = v_conversation_id
        or (v_payment_id is not null and e.payment_id = v_payment_id)
      );

    if v_match_count <> 1 then
      raise exception 'Payment identity conflict.' using errcode = '23505';
    end if;

    select e.*
      into v_existing_event
    from public.billing_fulfillment_events e
    where e.provider = v_provider
      and (
        e.conversation_id = v_conversation_id
        or (v_payment_id is not null and e.payment_id = v_payment_id)
      )
    limit 1;

    if v_existing_event.conversation_id is distinct from v_conversation_id
      or v_existing_event.target_type is distinct from v_target_type
      or (
        v_payment_id is not null
        and v_existing_event.payment_id is not null
        and v_existing_event.payment_id is distinct from v_payment_id
      ) then
      raise exception 'Payment identity conflict.' using errcode = '23505';
    end if;

    if v_existing_event.status <> 'completed' then
      raise exception 'Payment fulfillment is not complete.' using errcode = '55000';
    end if;

    if p_expected_tenant_id is not null
      and v_existing_event.result ->> 'tenantId' is distinct from p_expected_tenant_id::text then
      raise exception 'Completed payment tenant does not match.' using errcode = '22023';
    end if;

    if p_expected_plan is not null
      and lower(btrim(v_existing_event.result ->> 'plan'))
        is distinct from lower(btrim(p_expected_plan)) then
      raise exception 'Completed payment plan does not match.' using errcode = '22023';
    end if;

    if p_expected_cycle is not null
      and lower(btrim(v_existing_event.result ->> 'cycle'))
        is distinct from lower(btrim(p_expected_cycle)) then
      raise exception 'Completed payment cycle does not match.' using errcode = '22023';
    end if;

    if nullif(v_existing_event.result ->> 'amountTry', '') is null
      or abs((v_existing_event.result ->> 'amountTry')::numeric - p_expected_amount_try) > 0.01 then
      raise exception 'Completed payment amount does not match.' using errcode = '22023';
    end if;

    if upper(coalesce(v_existing_event.result ->> 'currency', '')) <> v_expected_currency then
      raise exception 'Completed payment currency does not match.' using errcode = '22023';
    end if;

    if v_existing_event.payment_id is null and v_payment_id is not null then
      update public.billing_fulfillment_events
      set payment_id = v_payment_id
      where id = v_existing_event.id
      returning id into v_completed_event_id;

      if v_completed_event_id is null then
        raise exception 'Existing fulfillment claim could not be updated.' using errcode = '55000';
      end if;
    end if;

    return coalesce(v_existing_event.result, '{}'::jsonb)
      || jsonb_build_object('ok', true, 'already', true);
  end;

  if v_target_type = 'subscription' then
    select
      i.id,
      i.tenant_id,
      i.status,
      i.amount_try,
      i.currency,
      i.meta
    into
      v_invoice_id,
      v_tenant_id,
      v_invoice_status,
      v_amount_try,
      v_invoice_currency,
      v_invoice_meta
    from public.invoices i
    where i.meta ->> 'conversationId' = v_conversation_id
    order by i.created_at desc, i.id desc
    limit 1
    for update;

    if not found then
      raise exception 'Billing invoice not found.' using errcode = 'P0002';
    end if;

    if v_invoice_status not in ('open', 'paid') then
      raise exception 'Invoice is not payable.' using errcode = '22023';
    end if;

    if upper(btrim(coalesce(v_invoice_currency, ''))) <> v_expected_currency then
      raise exception 'Invoice currency does not match.' using errcode = '22023';
    end if;

    v_plan := coalesce(nullif(btrim(v_invoice_meta ->> 'plan'), ''), 'office');
    v_cycle := coalesce(nullif(btrim(v_invoice_meta ->> 'cycle'), ''), 'monthly');

    if v_plan not in ('advisor', 'office', 'professional', 'business', 'enterprise')
      or v_cycle not in ('monthly', 'yearly') then
      raise exception 'Invoice billing metadata is invalid.' using errcode = '22023';
    end if;

    if p_expected_tenant_id is not null and p_expected_tenant_id is distinct from v_tenant_id then
      raise exception 'Invoice tenant does not match.' using errcode = '22023';
    end if;

    if p_expected_plan is not null
      and lower(btrim(p_expected_plan)) is distinct from v_plan then
      raise exception 'Invoice plan does not match.' using errcode = '22023';
    end if;

    if p_expected_cycle is not null
      and lower(btrim(p_expected_cycle)) is distinct from v_cycle then
      raise exception 'Invoice billing cycle does not match.' using errcode = '22023';
    end if;

    -- seat-fulfillment:v1 (20261005000900) ------------------------------------------------------------
    -- Fatura turu: meta.kind YOKSA plan yenileme/aktivasyon (asagidaki mevcut akis, AYNEN).
    -- 'extra_seats' = ek kullanici satisi: plan yenilemesi SAYILMAZ (plan, amount_try, price_lock_*,
    -- current_period_* ve tenants DEGISMEZ; yalniz subscriptions.extra_seats artar ve fatura 'paid' olur).
    -- Bilinmeyen tur reddedilir: ileride eklenecek bir fatura turu yanlislikla tam plan yenilemesi gibi
    -- islenip donemi uzatmasin.
    v_kind := nullif(btrim(coalesce(v_invoice_meta ->> 'kind', '')), '');
    if v_kind is not null and v_kind <> 'extra_seats' then
      raise exception 'Unsupported invoice kind.' using errcode = '22023';
    end if;

    if v_kind = 'extra_seats' then
      -- Tutar YALNIZ faturadan (sunucu oransal hesapladi); plan donem tutari yedegi KULLANILMAZ.
      if v_amount_try is null or v_amount_try <= 0 then
        raise exception 'Seat invoice amount is required.' using errcode = '22023';
      end if;

      v_tax_try := round(v_amount_try * 0.20, 2);
      v_total_try := round(v_amount_try + v_tax_try, 2);

      if abs(v_total_try - p_expected_amount_try) > 0.01 then
        raise exception 'Invoice total does not match.' using errcode = '22023';
      end if;

      -- Meta sozlesmesi (src/lib/billing/seat-purchase.ts createSeatInvoice): conversationId, plan, cycle,
      -- source, fromExtraSeats, toExtraSeats, targetTotalSeats, chargeNetTry, quotedPeriodTry.
      if jsonb_typeof(v_invoice_meta -> 'fromExtraSeats') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'toExtraSeats') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'targetTotalSeats') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'chargeNetTry') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'quotedPeriodTry') is distinct from 'number' then
        raise exception 'Seat invoice metadata is invalid.' using errcode = '22023';
      end if;

      v_seat_from_num := (v_invoice_meta ->> 'fromExtraSeats')::numeric;
      v_seat_to_num := (v_invoice_meta ->> 'toExtraSeats')::numeric;
      v_seat_total_num := (v_invoice_meta ->> 'targetTotalSeats')::numeric;
      v_seat_charge_net := (v_invoice_meta ->> 'chargeNetTry')::numeric;
      v_seat_quoted_period := (v_invoice_meta ->> 'quotedPeriodTry')::numeric;

      -- extra_seats CHECK (0..500) ile ayni sinir; yalniz ARTIS (to > from); toplam koltuk ek koltuktan buyuk
      -- (pakete en az 1 kullanici dahil); fatura net tutari meta chargeNetTry ile ayni (kurus toleransi).
      if v_seat_from_num <> trunc(v_seat_from_num)
        or v_seat_from_num < 0 or v_seat_from_num > 500
        or v_seat_to_num <> trunc(v_seat_to_num)
        or v_seat_to_num < 1 or v_seat_to_num > 500
        or v_seat_to_num <= v_seat_from_num
        or v_seat_total_num <> trunc(v_seat_total_num)
        or v_seat_total_num <= v_seat_to_num or v_seat_total_num > 100000
        or v_seat_quoted_period < 0
        or abs(v_seat_charge_net - v_amount_try) > 0.01 then
        raise exception 'Seat invoice metadata is invalid.' using errcode = '22023';
      end if;

      v_seat_from := v_seat_from_num::integer;
      v_seat_to := v_seat_to_num::integer;
      v_seat_total := v_seat_total_num::integer;

      -- Olay tablosundan once 'paid' olmus eski satir: ikinci kez ARTIS YAPILMAZ (plan akisindaki kural).
      if v_invoice_status = 'paid' then
        v_result := jsonb_build_object(
          'ok', true,
          'already', true,
          'targetType', 'subscription',
          'kind', 'extra_seats',
          'tenantId', v_tenant_id::text,
          'invoiceId', v_invoice_id::text,
          'plan', v_plan,
          'cycle', v_cycle,
          'amountTry', v_total_try,
          'currency', v_expected_currency,
          'fromExtraSeats', v_seat_from,
          'toExtraSeats', v_seat_to,
          'targetTotalSeats', v_seat_total
        );

        update public.billing_fulfillment_events
        set
          status = 'completed',
          tenant_id = v_tenant_id,
          invoice_id = v_invoice_id,
          result = v_result,
          completed_at = v_now
        where id = v_event_id
        returning id into v_completed_event_id;

        if v_completed_event_id is null then
          raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
        end if;

        return v_result;
      end if;

      select s.id, s.plan, s.billing_cycle, s.status, s.extra_seats, s.current_period_end
        into v_subscription_id, v_sub_plan, v_seat_sub_cycle, v_seat_sub_status, v_seat_sub_extra,
             v_seat_sub_period_end
      from public.subscriptions s
      where s.tenant_id = v_tenant_id
      for update;

      if not found then
        raise exception 'Subscription not found.' using errcode = 'P0002';
      end if;

      select i.subscription_id
        into v_seat_invoice_sub_id
      from public.invoices i
      where i.id = v_invoice_id;

      if v_seat_invoice_sub_id is not null and v_seat_invoice_sub_id is distinct from v_subscription_id then
        raise exception 'Seat invoice subscription does not match.' using errcode = '22023';
      end if;

      -- Teklif ayni plan/donem icin hesaplandi; arada plan ya da donem degistiyse tutar gecersizdir.
      if v_sub_plan is distinct from v_plan or v_seat_sub_cycle is distinct from v_cycle then
        raise exception 'Seat invoice plan does not match subscription.' using errcode = '22023';
      end if;

      -- startSeatPurchase yalniz 'active' abonelikte satar; tahsilat aninda da ayni kosul aranir.
      if v_seat_sub_status is distinct from 'active' then
        raise exception 'Subscription is not active for seat purchase.' using errcode = '22023';
      end if;

      -- Yalniz teklif anindaki koltuk sayisindan ARTIS: arada baska bir koltuk satisi/degisikligi islendiyse
      -- tahsil edilen oransal tutar artik dogru degildir; reddedilir (tahsilat kaydi refund_required'a duser).
      -- toExtraSeats mevcut extra_seats'tan kucuk/esitse de bu kosulla reddedilir (to > from zorunlu).
      if coalesce(v_seat_sub_extra, 0) <> v_seat_from then
        raise exception 'Extra seat count changed since quote.' using errcode = '22023';
      end if;

      update public.subscriptions s
      set
        extra_seats = v_seat_to,
        updated_at = v_now
      where s.id = v_subscription_id
        and s.tenant_id = v_tenant_id
        and s.extra_seats = v_seat_from
      returning s.id into v_seat_updated_sub_id;

      if v_seat_updated_sub_id is null then
        raise exception 'Extra seats could not be updated.' using errcode = '55000';
      end if;

      -- Fatura donemi: simdi -> mevcut donem sonu (oransal tahsilatin kapsadigi aralik). Abonelik donemi DEGISMEZ.
      update public.invoices i
      set
        subscription_id = v_subscription_id,
        status = 'paid',
        amount_try = v_amount_try,
        tax_try = v_tax_try,
        total_try = v_total_try,
        period_start = v_now,
        period_end = greatest(coalesce(v_seat_sub_period_end, v_now), v_now),
        due_at = coalesce(i.due_at, v_now),
        paid_at = coalesce(i.paid_at, v_now),
        iyzico_payment_id = coalesce(i.iyzico_payment_id, v_payment_id),
        meta = i.meta || jsonb_build_object(
          'conversationId', v_conversation_id,
          'plan', v_plan,
          'cycle', v_cycle,
          'source', v_source,
          'provider', v_provider
        )
      where i.id = v_invoice_id and i.tenant_id = v_tenant_id
      returning i.id into v_updated_invoice_id;

      if v_updated_invoice_id is null then
        raise exception 'Invoice could not be updated.' using errcode = '55000';
      end if;

      v_result := jsonb_build_object(
        'ok', true,
        'already', false,
        'targetType', 'subscription',
        'kind', 'extra_seats',
        'tenantId', v_tenant_id::text,
        'invoiceId', v_invoice_id::text,
        'plan', v_plan,
        'cycle', v_cycle,
        'amountTry', v_total_try,
        'currency', v_expected_currency,
        'fromExtraSeats', v_seat_from,
        'toExtraSeats', v_seat_to,
        'targetTotalSeats', v_seat_total
      );

      update public.billing_fulfillment_events
      set
        status = 'completed',
        tenant_id = v_tenant_id,
        invoice_id = v_invoice_id,
        result = v_result,
        completed_at = v_now
      where id = v_event_id
      returning id into v_completed_event_id;

      if v_completed_event_id is null then
        raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
      end if;

      return v_result;
    end if;
    -- seat-fulfillment:v1 sonu: bundan sonrasi plan yenileme/aktivasyon (20261005000500 govdesi, AYNEN).

    -- Aylik liste fiyati plan tanimindan (platform katalogu; ayar yoksa onayli katalog).
    v_monthly_amount := public.plan_monthly_amount(v_plan);
    if v_monthly_amount is null or v_monthly_amount <= 0 then
      raise exception 'Plan amount could not be resolved.' using errcode = '22023';
    end if;

    -- Fatura tutari yoksa yedek: donem tutari (yillik = aylik * yillik odenen ay; 0.8 carpani yok).
    if v_amount_try is null or v_amount_try <= 0 then
      v_amount_try := public.plan_period_amount(v_plan, v_cycle);
    end if;

    v_tax_try := round(v_amount_try * 0.20, 2);
    v_total_try := round(v_amount_try + v_tax_try, 2);

    if abs(v_total_try - p_expected_amount_try) > 0.01 then
      raise exception 'Invoice total does not match.' using errcode = '22023';
    end if;

    -- Legacy paid rows may predate the event table. Claim them without extending
    -- the subscription period a second time.
    if v_invoice_status = 'paid' then
      v_result := jsonb_build_object(
        'ok', true,
        'already', true,
        'targetType', 'subscription',
        'tenantId', v_tenant_id::text,
        'invoiceId', v_invoice_id::text,
        'plan', v_plan,
        'cycle', v_cycle,
        'amountTry', v_total_try,
        'currency', v_expected_currency
      );

      update public.billing_fulfillment_events
      set
        status = 'completed',
        tenant_id = v_tenant_id,
        invoice_id = v_invoice_id,
        result = v_result,
        completed_at = v_now
      where id = v_event_id
      returning id into v_completed_event_id;

      if v_completed_event_id is null then
        raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
      end if;

      return v_result;
    end if;

    -- Fiyat kilidi (Founders). Kaynak sirasi: (1) sunucunun faturaya yazdigi teklif kilidi,
    -- (2) ayni planda mevcut kilit korunur, (3) plan degisiminde Founders uyesi yeni planin kampanya
    -- fiyatina yeniden kilitlenir (yoksa kilit kalkar).
    if v_invoice_meta ? 'priceLockTry' or v_invoice_meta ? 'priceLockCampaign' then
      if jsonb_typeof(v_invoice_meta -> 'priceLockTry') is distinct from 'number'
        or char_length(btrim(coalesce(v_invoice_meta ->> 'priceLockCampaign', ''))) not between 1 and 60 then
        raise exception 'Invoice price lock metadata is invalid.' using errcode = '22023';
      end if;
      v_meta_lock_try := (v_invoice_meta ->> 'priceLockTry')::numeric;
      v_meta_lock_campaign := btrim(v_invoice_meta ->> 'priceLockCampaign');
      if v_meta_lock_try <= 0 then
        raise exception 'Invoice price lock metadata is invalid.' using errcode = '22023';
      end if;
    end if;

    select s.plan, s.price_lock_try, s.price_lock_campaign
      into v_sub_plan, v_old_lock_try, v_old_lock_campaign
    from public.subscriptions s
    where s.tenant_id = v_tenant_id
    for update;

    if v_meta_lock_try is not null and v_meta_lock_try < v_monthly_amount then
      v_lock_try := v_meta_lock_try;
      v_lock_campaign := v_meta_lock_campaign;
    elsif v_old_lock_try is not null and v_sub_plan is not distinct from v_plan then
      v_lock_try := v_old_lock_try;
      v_lock_campaign := v_old_lock_campaign;
    elsif v_old_lock_campaign is not null and v_sub_plan is distinct from v_plan then
      v_lock_try := public.plan_campaign_lock_amount(v_plan);
      v_lock_campaign := case when v_lock_try is not null then v_old_lock_campaign end;
    end if;

    -- subscriptions.amount_try kanonik aylik (MRR) tutardir; kilit varsa kilitli fiyat.
    v_subscription_amount := case
      when v_lock_try is not null then least(v_lock_try, v_monthly_amount)
      else v_monthly_amount
    end;

    v_period_end := case
      when v_cycle = 'yearly' then v_now + interval '1 year'
      else v_now + interval '1 month'
    end;
    insert into public.subscriptions (
      tenant_id,
      plan,
      status,
      billing_cycle,
      amount_try,
      price_lock_try,
      price_lock_campaign,
      current_period_start,
      current_period_end,
      trial_ends_at,
      cancelled_at,
      iyzico_subscription_ref,
      updated_at
    ) values (
      v_tenant_id,
      v_plan,
      'active',
      v_cycle,
      v_subscription_amount,
      v_lock_try,
      v_lock_campaign,
      v_now,
      v_period_end,
      null,
      null,
      coalesce(v_payment_id, v_conversation_id),
      v_now
    )
    on conflict (tenant_id) do update
    set
      plan = excluded.plan,
      status = 'active',
      billing_cycle = excluded.billing_cycle,
      amount_try = excluded.amount_try,
      price_lock_try = excluded.price_lock_try,
      price_lock_campaign = excluded.price_lock_campaign,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      trial_ends_at = null,
      cancelled_at = null,
      iyzico_subscription_ref = excluded.iyzico_subscription_ref,
      updated_at = v_now
    returning id into v_subscription_id;

    if v_subscription_id is null then
      raise exception 'Subscription could not be updated.' using errcode = '55000';
    end if;

    update public.invoices i
    set
      subscription_id = v_subscription_id,
      status = 'paid',
      amount_try = v_amount_try,
      tax_try = v_tax_try,
      total_try = v_total_try,
      period_start = v_now,
      period_end = v_period_end,
      due_at = coalesce(i.due_at, v_now),
      paid_at = coalesce(i.paid_at, v_now),
      iyzico_payment_id = coalesce(i.iyzico_payment_id, v_payment_id),
      meta = i.meta || jsonb_build_object(
        'conversationId', v_conversation_id,
        'plan', v_plan,
        'cycle', v_cycle,
        'source', v_source,
        'provider', v_provider
      )
    where i.id = v_invoice_id and i.tenant_id = v_tenant_id
    returning i.id into v_updated_invoice_id;

    if v_updated_invoice_id is null then
      raise exception 'Invoice could not be updated.' using errcode = '55000';
    end if;

    update public.tenants t
    set plan = v_plan, status = 'active', updated_at = v_now
    where t.id = v_tenant_id
    returning t.id into v_updated_tenant_id;

    if v_updated_tenant_id is null then
      raise exception 'Tenant could not be updated.' using errcode = '55000';
    end if;

    v_result := jsonb_build_object(
      'ok', true,
      'already', false,
      'targetType', 'subscription',
      'tenantId', v_tenant_id::text,
      'invoiceId', v_invoice_id::text,
      'plan', v_plan,
      'cycle', v_cycle,
      'amountTry', v_total_try,
      'currency', v_expected_currency
    );

    update public.billing_fulfillment_events
    set
      status = 'completed',
      tenant_id = v_tenant_id,
      invoice_id = v_invoice_id,
      result = v_result,
      completed_at = v_now
    where id = v_event_id
    returning id into v_completed_event_id;

    if v_completed_event_id is null then
      raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
    end if;

    return v_result;
  end if;

  v_link_token := substring(v_conversation_id from 7);
  if nullif(v_link_token, '') is null then
    raise exception 'Payment link identity is invalid.' using errcode = '22023';
  end if;

  select
    pl.id,
    pl.tenant_id,
    pl.commission_id,
    pl.status,
    pl.amount_try,
    pl.expires_at
  into
    v_payment_link_id,
    v_payment_link_tenant_id,
    v_payment_link_commission_id,
    v_payment_link_status,
    v_payment_link_amount_try,
    v_payment_link_expires_at
  from public.payment_links pl
  where pl.token = v_link_token
  for update;

  if not found then
    raise exception 'Payment link not found.' using errcode = 'P0002';
  end if;

  if v_payment_link_status not in ('open', 'paid') then
    raise exception 'Payment link is not payable.' using errcode = '22023';
  end if;

  if v_payment_link_status = 'open'
    and v_payment_link_expires_at is not null
    and v_payment_link_expires_at <= v_now then
    raise exception 'Payment link has expired.' using errcode = '22023';
  end if;

  if p_expected_tenant_id is not null
    and p_expected_tenant_id is distinct from v_payment_link_tenant_id then
    raise exception 'Payment link tenant does not match.' using errcode = '22023';
  end if;

  if p_expected_plan is not null or p_expected_cycle is not null then
    raise exception 'Payment link does not accept subscription expectations.'
      using errcode = '22023';
  end if;

  if v_payment_link_amount_try is null
    or v_payment_link_amount_try <= 0
    or abs(v_payment_link_amount_try - p_expected_amount_try) > 0.01 then
    raise exception 'Payment link amount does not match.' using errcode = '22023';
  end if;

  if v_payment_link_status = 'paid' then
    v_result := jsonb_build_object(
      'ok', true,
      'already', true,
      'targetType', 'payment_link',
      'tenantId', v_payment_link_tenant_id::text,
      'paymentLinkId', v_payment_link_id::text,
      'amountTry', v_payment_link_amount_try,
      'currency', v_expected_currency
    );

    update public.billing_fulfillment_events
    set
      status = 'completed',
      tenant_id = v_payment_link_tenant_id,
      payment_link_id = v_payment_link_id,
      result = v_result,
      completed_at = v_now
    where id = v_event_id
    returning id into v_completed_event_id;

    if v_completed_event_id is null then
      raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
    end if;

    return v_result;
  end if;

  update public.payment_links pl
  set
    status = 'paid',
    paid_at = coalesce(pl.paid_at, v_now),
    meta = pl.meta || jsonb_build_object(
      'conversationId', v_conversation_id,
      'source', v_source,
      'provider', v_provider
    )
  where pl.id = v_payment_link_id
    and pl.tenant_id = v_payment_link_tenant_id
    and pl.status = 'open'
  returning pl.id into v_updated_payment_link_id;

  if v_updated_payment_link_id is null then
    raise exception 'Payment link could not be updated.' using errcode = '55000';
  end if;

  if v_payment_link_commission_id is not null then
    update public.commissions c
    set status = 'paid'
    where c.id = v_payment_link_commission_id
      and c.tenant_id = v_payment_link_tenant_id
      and c.status not in ('paid', 'collected')
    returning c.id into v_updated_commission_id;

    if v_updated_commission_id is not null then
      v_commission_changed := true;
    else
      perform 1
      from public.commissions c
      where c.id = v_payment_link_commission_id
        and c.tenant_id = v_payment_link_tenant_id
        and c.status in ('paid', 'collected');

      if not found then
        raise exception 'Payment link commission does not belong to tenant.'
          using errcode = '22023';
      end if;
    end if;
  end if;

  insert into public.notifications (
    tenant_id,
    title,
    body,
    href,
    kind,
    meta
  ) values (
    v_payment_link_tenant_id,
    'Ödeme linki tahsil edildi',
    case
      when v_source = 'demo' then 'Demo tahsilat tamamlandı.'
      else 'Kaparo / komisyon ödemesi alındı.'
    end,
    '/app/komisyon',
    'success',
    jsonb_build_object(
      'payment_link_id', v_payment_link_id,
      'fulfillment_event_id', v_event_id
    )
  )
  returning id into v_notification_id;

  if v_notification_id is null then
    raise exception 'Payment notification could not be created.' using errcode = '55000';
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'already', false,
    'targetType', 'payment_link',
    'tenantId', v_payment_link_tenant_id::text,
    'paymentLinkId', v_payment_link_id::text,
    'commissionUpdated', v_commission_changed,
    'amountTry', v_payment_link_amount_try,
    'currency', v_expected_currency
  );

  update public.billing_fulfillment_events
  set
    status = 'completed',
    tenant_id = v_payment_link_tenant_id,
    payment_link_id = v_payment_link_id,
    result = v_result,
    completed_at = v_now
  where id = v_event_id
  returning id into v_completed_event_id;

  if v_completed_event_id is null then
    raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
  end if;

  return v_result;
end;
$$;

revoke all privileges on function public.fulfill_billing_payment(
  text, text, text, text, text, uuid, text, text, numeric, text
) from public, anon, authenticated, service_role;
grant execute on function public.fulfill_billing_payment(
  text, text, text, text, text, uuid, text, text, numeric, text
) to service_role;

comment on function public.fulfill_billing_payment(
  text, text, text, text, text, uuid, text, text, numeric, text
) is
  'Service-role-only atomic fulfillment. Unique provider/conversation and provider/payment claims serialize callback/webhook races. meta.kind=extra_seats: extra_seats atomik artar, donem/plan/tutar degismez.';

-- ---------------------------------------------------------------------------
-- 4. fulfill_billing_payment_v2 (kaynak: 20260810000100; tam govde, extra_seats'ta donem uzatilmaz)
-- ---------------------------------------------------------------------------
create or replace function public.fulfill_billing_payment_v2(
  p_provider text,
  p_conversation_id text,
  p_payment_id text default null,
  p_source text default 'webhook',
  p_target_type text default 'subscription',
  p_expected_tenant_id uuid default null,
  p_expected_plan text default null,
  p_expected_cycle text default null,
  p_expected_amount_try numeric default null,
  p_expected_currency text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_conversation_id text := btrim(coalesce(p_conversation_id, ''));
  v_payment_id text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_target_type text := lower(btrim(coalesce(p_target_type, '')));
  v_now timestamptz := now();
  v_previous_start timestamptz;
  v_previous_end timestamptz;
  v_period_base timestamptz;
  v_period_end timestamptz;
  v_cycle text;
  v_tenant_id uuid;
  v_invoice_id uuid;
  v_updated_subscription_id uuid;
  v_updated_invoice_id uuid;
  v_updated_event_id uuid;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if v_provider = 'iyzico' then
    perform 1
    from public.billing_payment_captures c
    where c.provider = v_provider
      and c.conversation_id = v_conversation_id
      and c.payment_id = v_payment_id
      and c.target_type = v_target_type
      and c.tenant_id = p_expected_tenant_id
      and c.status in ('captured_pending', 'retry_pending', 'manual_review', 'fulfilled');
    if not found then
      raise exception 'Durable captured payment claim required.' using errcode = '55000';
    end if;
  end if;

  if v_target_type = 'subscription' then
    if p_expected_tenant_id is null then
      raise exception 'Subscription tenant is required.' using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('plan-capacity:' || p_expected_tenant_id::text, 0)
    );

    select s.current_period_start, s.current_period_end
    into v_previous_start, v_previous_end
    from public.subscriptions s
    where s.tenant_id = p_expected_tenant_id
    for update;

    update public.invoices i
    set
      status = 'open',
      checkout_status = 'captured_pending'
    where i.tenant_id = p_expected_tenant_id
      and i.meta ->> 'conversationId' = v_conversation_id
      and i.status = 'draft'
      and (
        (v_provider = 'demo' and i.checkout_status = 'pending_checkout')
        or (v_provider = 'iyzico' and i.checkout_status = 'initialized')
      );
  end if;

  v_result := public.fulfill_billing_payment(
    p_provider,
    p_conversation_id,
    p_payment_id,
    p_source,
    p_target_type,
    p_expected_tenant_id,
    p_expected_plan,
    p_expected_cycle,
    p_expected_amount_try,
    p_expected_currency
  );

  if v_target_type = 'subscription' and coalesce((v_result ->> 'already')::boolean, false) = false then
    v_tenant_id := (v_result ->> 'tenantId')::uuid;
    v_invoice_id := (v_result ->> 'invoiceId')::uuid;

    -- seat-fulfillment:v1 (20261005000900): ek kullanici faturasi plan yenilemesi DEGILDIR. Abonelik donemi
    -- (current_period_start/end) ve fatura donemi (ic fonksiyon yazdi) DEGISMEZ; yalniz checkout kapanir.
    if v_result ->> 'kind' = 'extra_seats' then
      update public.invoices i
      set
        due_at = coalesce(i.due_at, v_now),
        checkout_status = 'fulfilled'
      where i.id = v_invoice_id and i.tenant_id = v_tenant_id
      returning i.id into v_updated_invoice_id;

      if v_updated_invoice_id is null then
        raise exception 'Seat invoice checkout could not be closed.' using errcode = '55000';
      end if;

      return v_result;
    end if;

    v_cycle := lower(btrim(v_result ->> 'cycle'));
    v_period_base := greatest(coalesce(v_previous_end, v_now), v_now);
    v_period_end := case
      when v_cycle = 'yearly' then v_period_base + interval '1 year'
      else v_period_base + interval '1 month'
    end;

    update public.subscriptions s
    set
      current_period_start = case
        when v_previous_end is not null and v_previous_end > v_now
          then coalesce(v_previous_start, v_now)
        else v_now
      end,
      current_period_end = v_period_end,
      updated_at = v_now
    where s.tenant_id = v_tenant_id
    returning s.id into v_updated_subscription_id;

    if v_updated_subscription_id is null then
      raise exception 'Renewed subscription could not be extended.' using errcode = '55000';
    end if;

    update public.invoices i
    set
      period_start = v_period_base,
      period_end = v_period_end,
      due_at = coalesce(i.due_at, v_now),
      checkout_status = 'fulfilled'
    where i.id = v_invoice_id and i.tenant_id = v_tenant_id
    returning i.id into v_updated_invoice_id;

    if v_updated_invoice_id is null then
      raise exception 'Renewal invoice period could not be updated.' using errcode = '55000';
    end if;

    v_result := v_result || jsonb_build_object(
      'periodStart', v_period_base,
      'periodEnd', v_period_end
    );

    update public.billing_fulfillment_events e
    set result = v_result
    where e.provider = v_provider and e.conversation_id = v_conversation_id
    returning e.id into v_updated_event_id;

    if v_updated_event_id is null then
      raise exception 'Renewal event result could not be updated.' using errcode = '55000';
    end if;
  end if;

  return v_result;
end;
$$;

revoke all privileges on function public.fulfill_billing_payment_v2(
  text, text, text, text, text, uuid, text, text, numeric, text
) from public, anon, authenticated, service_role;
grant execute on function public.fulfill_billing_payment_v2(
  text, text, text, text, text, uuid, text, text, numeric, text
) to service_role;

comment on function public.fulfill_billing_payment_v2(
  text, text, text, text, text, uuid, text, text, numeric, text
) is
  'Service-role-only fulfillment wrapper: durable capture claim, draft->open, renewal period extension (extra_seats faturasinda donem uzatilmaz).';

-- ---------------------------------------------------------------------------
-- 5. seat_purchase_ready() (kod sozlesmesi: SEAT_READY_RPC, src/lib/billing/seat-purchase.ts)
-- ---------------------------------------------------------------------------
create or replace function public.seat_purchase_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profiles_fn oid;
  v_tenants_fn oid;
begin
  -- Hazirlik sondasi: hicbir kosulda hata FIRLATMAZ, eksikte false doner. Yalniz service_role (grant + kontrol).
  if auth.role() is distinct from 'service_role' then
    return false;
  end if;

  -- (1) subscriptions.extra_seats
  if pg_catalog.to_regclass('public.subscriptions') is null or not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = pg_catalog.to_regclass('public.subscriptions')
      and a.attname = 'extra_seats'
      and a.attnum > 0
      and not a.attisdropped
  ) then
    return false;
  end if;

  -- (2) effective_seat_limit(uuid)
  if pg_catalog.to_regprocedure('public.effective_seat_limit(uuid)') is null then
    return false;
  end if;

  -- (3) Koltuk tetikleyicileri etkin ve effective_seat_limit'e bagli govdeyi calistiriyor
  select t.tgfoid
    into v_profiles_fn
  from pg_catalog.pg_trigger t
  where t.tgrelid = pg_catalog.to_regclass('public.profiles')
    and t.tgname = 'trg_profiles_plan_capacity'
    and t.tgenabled <> 'D'
    and not t.tgisinternal;

  if v_profiles_fn is null or not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = v_profiles_fn
      and position('seat-capacity:v1' in p.prosrc) > 0
      and position('public.effective_seat_limit(target_tenant)' in p.prosrc) > 0
  ) then
    return false;
  end if;

  select t.tgfoid
    into v_tenants_fn
  from pg_catalog.pg_trigger t
  where t.tgrelid = pg_catalog.to_regclass('public.tenants')
    and t.tgname = 'trg_tenants_plan_capacity'
    and t.tgenabled <> 'D'
    and not t.tgisinternal;

  if v_tenants_fn is null or not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = v_tenants_fn
      and position('seat-capacity:v1' in p.prosrc) > 0
  ) then
    return false;
  end if;

  -- (4) fulfill (10 arg) ve v2 extra_seats faturasini isliyor (donem uzatmadan)
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.fulfill_billing_payment(text, text, text, text, text, uuid, text, text, numeric, text)')
      and position('seat-fulfillment:v1' in p.prosrc) > 0
  ) or not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.fulfill_billing_payment_v2(text, text, text, text, text, uuid, text, text, numeric, text)')
      and position('seat-fulfillment:v1' in p.prosrc) > 0
  ) then
    return false;
  end if;

  return true;
exception when others then
  return false;
end;
$$;

revoke all privileges on function public.seat_purchase_ready() from public, anon, authenticated;
grant execute on function public.seat_purchase_ready() to service_role;

comment on function public.seat_purchase_ready() is
  'Ek kullanici satisi hazir mi: extra_seats + effective_seat_limit + koltuk tetikleyicileri + fulfill/v2 extra_seats destegi. Hata firlatmaz. Service-role-only.';

notify pgrst, 'reload schema';
