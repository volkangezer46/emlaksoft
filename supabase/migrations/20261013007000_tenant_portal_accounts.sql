-- MIGRATION 20261013007000_tenant_portal_accounts.sql (EP1 — portal üyeliğinin tek kaynağı)
-- UYGULANMADI: yalnız restore edilebilir backup/PITR doğrulandıktan sonra SAHİBİ
-- `npm run db:migrate -- --only 20261013007000_tenant_portal_accounts.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261013007000_tenant_portal_accounts.rollback.sql
--
-- NEDEN: sistem ofisin hangi portallara üye olduğunu bilmiyordu; eklenti üye olunmayan portalı da günde ~12 kez tarıyor ve
--   "giriş istedi" uyarısı üretiyordu, gece işleri eklentisi olmayan ofise her gün "teyit gecikti" bildirimi yazıyordu.
--
-- NE YAPAR (hepsi ek; mevcut tablo/RPC gövdesi değişmez):
--   1. public.tenant_portal_accounts (PK tenant_id + portal): üyelik (active/none/unknown), otomatik kontrol açık/kapalı,
--      kaynak, mağaza adı/bağlantısı, abonelik bitişi, eklentinin son giriş başarılı/başarısız zamanı ve üst üste başarısızlık.
--      `portal` CHECK'i kod kataloğuyla (src/lib/portals/catalog.ts CURRENT_PORTALS) aynıdır; sözleşme testi karşılaştırır.
--      RLS: ofis içi herkes okur; yalnız owner ve gm yazar (insert/update/delete).
--   2. portal_account_report_login(p_portal, p_ok) (authenticated, SECURITY DEFINER, search_path=''): eklentinin mağaza
--      taraması sonucu. Yalnız çağıranın kendi ofisi; başarıda last_login_ok_at + seri sıfır, "giriş istedi"de
--      last_login_fail_at + seri+1. Seri 3'e ulaşınca ofis sahiplerine TEK SEFERLİK "üyelik bitti mi?" bildirimi
--      (dedupe_key: portal-login-fail:<portal>:<son başarı>); satır yoksa 'unknown' + source 'extension_login' açılır
--      (beyan sayılmaz). Üyeliği 'none' olan portal için hiçbir şey yazılmaz.
--   3. portal_membership_evidence(p_tenant_id) (authenticated, SECURITY DEFINER, search_path=''): üyelik önerisinin kanıtı
--      (portal başına canlı ilan, son 365 gün gider ve portal kaynaklı talep SAYISI; satır içeriği dönmez). Çağıranın
--      expenses/customers görme yetkisinden BAĞIMSIZ: aynı ofiste sahip de danışman da aynı etkin listeyi görür.
--      Yalnız çağıranın kendi ofisi (service_role her ofis).
--   4. Veri düzeltmesi: portal_listings.portal_name = lower(btrim(portal_name)) (yalnız farklı olan satırlar).
--      Tekil indeksler zaten lower(btrim(portal_name)) üzerindedir, çakışma üretmez.
-- ETKİ: ek + tek seferlik veri biçimi düzeltmesi (yalnız büyük/küçük harf ve boşluk). Kod tablo yokken öneriye düşer.
-- RİSK: düşük. portal_listings güncellemesi postgres rolüyle çalışır (guard tetikleyicisi yalnız authenticated'ı engeller).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.tenants') is null
     or pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.portal_listings') is null
     or pg_catalog.to_regclass('public.notifications') is null
     or pg_catalog.to_regprocedure('public.current_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.current_profile_role()') is null then
    raise exception '20261013007000: temel tablolar veya current_tenant_id()/current_profile_role() yok.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Tablo
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_portal_accounts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  portal text not null check (portal in ('sahibinden', 'hepsiemlak', 'emlakjet')),
  status text not null default 'unknown' check (status in ('active', 'none', 'unknown')),
  check_enabled boolean not null default true,
  source text not null default 'owner_declared' check (source in ('owner_declared', 'inferred_listing', 'inferred_expense', 'extension_login')),
  account_label text check (account_label is null or char_length(account_label) <= 120),
  store_url text check (store_url is null or (char_length(store_url) <= 500 and store_url ~* '^https://')),
  plan_ends_at date,
  last_login_ok_at timestamptz,
  last_login_fail_at timestamptz,
  login_fail_streak integer not null default 0 check (login_fail_streak >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, portal)
);

comment on table public.tenant_portal_accounts is
  'EP1: ofisin portal üyelikleri (tek kaynak). Eklenti, gece işleri ve portal ekranları yalnız buradan okur; yazma owner/gm.';

alter table public.tenant_portal_accounts enable row level security;

drop policy if exists tenant_portal_accounts_select on public.tenant_portal_accounts;
create policy tenant_portal_accounts_select on public.tenant_portal_accounts for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

drop policy if exists tenant_portal_accounts_insert on public.tenant_portal_accounts;
create policy tenant_portal_accounts_insert on public.tenant_portal_accounts for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_profile_role()) = any (array['owner'::text, 'gm'::text])
  );

drop policy if exists tenant_portal_accounts_update on public.tenant_portal_accounts;
create policy tenant_portal_accounts_update on public.tenant_portal_accounts for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_profile_role()) = any (array['owner'::text, 'gm'::text])
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_profile_role()) = any (array['owner'::text, 'gm'::text])
  );

drop policy if exists tenant_portal_accounts_delete on public.tenant_portal_accounts;
create policy tenant_portal_accounts_delete on public.tenant_portal_accounts for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_profile_role()) = any (array['owner'::text, 'gm'::text])
  );

revoke all on public.tenant_portal_accounts from anon;
grant select, insert, update, delete on public.tenant_portal_accounts to authenticated;
grant all on public.tenant_portal_accounts to service_role;

-- ---------------------------------------------------------------------------
-- 2) Eklenti giriş sonucu RPC'si
-- ---------------------------------------------------------------------------
create or replace function public.portal_account_report_login(p_portal text, p_ok boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_role text := public.current_profile_role();
  v_row public.tenant_portal_accounts%rowtype;
  v_notified integer := 0;
  v_label text;
begin
  if v_tenant is null or auth.uid() is null or coalesce(v_role, '') in ('', 'readonly') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_portal is null or p_portal not in ('sahibinden', 'hepsiemlak', 'emlakjet') or p_ok is null then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  insert into public.tenant_portal_accounts as t (tenant_id, portal, status, source, updated_at)
  values (v_tenant, p_portal, 'unknown', 'extension_login', now())
  on conflict (tenant_id, portal) do nothing;

  select * into v_row from public.tenant_portal_accounts
  where tenant_id = v_tenant and portal = p_portal
  for update;

  if v_row.status = 'none' then
    return jsonb_build_object('outcome', 'not_member');
  end if;

  if p_ok then
    update public.tenant_portal_accounts
       set last_login_ok_at = now(), login_fail_streak = 0
     where tenant_id = v_tenant and portal = p_portal;
    return jsonb_build_object('outcome', 'ok', 'streak', 0, 'notified', 0);
  end if;

  update public.tenant_portal_accounts
     set last_login_fail_at = now(), login_fail_streak = login_fail_streak + 1
   where tenant_id = v_tenant and portal = p_portal
  returning * into v_row;

  if v_row.login_fail_streak = 3 then
    v_label := case p_portal when 'sahibinden' then 'Sahibinden' when 'hepsiemlak' then 'Hepsiemlak' else 'Emlakjet' end;
    insert into public.notifications (tenant_id, user_id, title, body, href, kind, dedupe_key)
    select v_tenant, p.id,
           v_label || ' üyeliğiniz bitti mi?',
           'Eklenti ' || v_label || ' mağaza sayfanızı üst üste 3 kez açamadı (portal giriş istedi). Üyelik bittiyse Portal üyelikleri kartında "Üye değiliz" seçin; eklenti bu portala istek atmayı bırakır. Devam ediyorsa tarayıcıda portala yeniden giriş yapın.',
           '/app/ayarlar?sekme=entegrasyon#portal-uyelikleri',
           'warning',
           'portal-login-fail:' || p_portal || ':' || coalesce(to_char(v_row.last_login_ok_at at time zone 'UTC', 'YYYYMMDDHH24MISS'), 'never')
             || ':' || p.id::text
      from public.profiles p
     where p.tenant_id = v_tenant and p.is_active = true and p.role = 'owner'
    on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing;
    get diagnostics v_notified = row_count;
  end if;

  return jsonb_build_object('outcome', 'ok', 'streak', v_row.login_fail_streak, 'notified', v_notified);
end;
$$;

revoke all on function public.portal_account_report_login(text, boolean) from public, anon;
grant execute on function public.portal_account_report_login(text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Üyelik önerisi kanıtı (yalnız sayı; çağıranın modül yetkisinden bağımsız)
-- ---------------------------------------------------------------------------
-- Takma adlar src/lib/portals/catalog.ts `aliases` ile aynıdır (portalIdFromName içerme eşlemesi).
create or replace function public.portal_membership_evidence(p_tenant_id uuid)
returns table (portal text, live_listings integer, expenses integer, leads integer)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select case
             when auth.role() = 'service_role' then p_tenant_id
             when auth.uid() is not null and p_tenant_id = public.current_tenant_id() then p_tenant_id
           end as id
  ),
  p (portal, aliases, ord) as (
    values ('sahibinden', array['sahibinden'], 1),
           ('hepsiemlak', array['hepsiemlak', 'hepsi emlak'], 2),
           ('emlakjet', array['emlakjet', 'emlak jet'], 3)
  ),
  l as (
    select lower(translate(btrim(pl.portal_name), 'İIı', 'iii')) as n
      from public.portal_listings pl, t
     where t.id is not null and pl.tenant_id = t.id and pl.status = 'live'
  )
  select p.portal,
         (select count(*) from l where exists (select 1 from unnest(p.aliases) a where position(a in l.n) > 0))::integer,
         (select count(*) from public.expenses e, t
           where t.id is not null and e.tenant_id = t.id and lower(btrim(e.portal_key)) = p.portal
             and e.created_at >= now() - interval '365 days')::integer,
         (select count(*) from public.customers c, t
           where t.id is not null and c.tenant_id = t.id and c.deleted_at is null
             and lower(btrim(c.lead_source)) = 'portal_' || p.portal
             and c.created_at >= now() - interval '365 days')::integer
    from p
   order by p.ord;
$$;

revoke all on function public.portal_membership_evidence(uuid) from public, anon;
grant execute on function public.portal_membership_evidence(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Veri düzeltmesi: portal adı tek biçim (küçük harf, kırpılmış)
-- ---------------------------------------------------------------------------
update public.portal_listings
   set portal_name = lower(btrim(portal_name))
 where portal_name is not null
   and portal_name <> lower(btrim(portal_name));
