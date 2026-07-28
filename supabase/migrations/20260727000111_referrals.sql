-- ============================================================
-- Referans (tavsiye) programı — /tavsiye/[token] + /app/tavsiyeler
-- ============================================================
-- NPS anketinin (20260727000104_surveys) doğal devamı: 9-10 puan veren
-- "destekleyen" müşteriye kişiye özel bir tavsiye linki üretilir; müşteri
-- linki çevresiyle paylaşır, gelen kişi kısa formu doldurur ve ofise
-- "tavsiye" olarak düşer. Panelden durum takibi yapılır, kazanılan tavsiye
-- tek tıkla müşteriye dönüştürülür (customers.source = 'referral').
--
-- SMS YOK — İYS kapsam dışı; link panelden kopyalanır, danışman iletir
-- (surveys/presentations deseni). Public sayfa token'ı service role ile
-- çözer, RLS anon'a açılmaz.

-- ============================================================
-- referral_links — tavsiye eden müşteriye özel paylaşım linki
-- ============================================================
create table if not exists public.referral_links (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  -- Tavsiye eden müşteri. Müşteri silinirse linkin anlamı kalmaz → cascade.
  customer_id  uuid        not null references public.customers(id) on delete cascade,
  public_token uuid        not null unique default gen_random_uuid(),
  -- Gelen tavsiyelerin varsayılan sahibi olacak danışman (boşsa işlemi yapan alır).
  staff_id     uuid        references public.profiles(id) on delete set null,
  is_active    boolean     not null default true,
  -- Ofisin vaadi, örn. "Anlaşma olursa 1.000 TL hediye çeki". Public sayfada gösterilir.
  reward_note  text,
  created_by   uuid        references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  click_count  int         not null default 0
);

comment on table public.referral_links is
  'Müşteriye özel tavsiye linki (/tavsiye/[token]) — memnun müşteri yeni müşteri getirir';
comment on column public.referral_links.public_token is
  'Public tavsiye sayfası için tahmin edilemez token (surveys/presentations deseni)';
comment on column public.referral_links.reward_note is
  'Ofisin tavsiye edene vaadi — public sayfada aynen gösterilir, boş bırakılabilir';
comment on column public.referral_links.click_count is
  'Sayfa açılış sayacı — increment_referral_click() ile after() içinde atomik artar';

create index if not exists idx_referral_links_tenant
  on public.referral_links(tenant_id, created_at desc);

create index if not exists idx_referral_links_customer
  on public.referral_links(tenant_id, customer_id);

-- Bir müşteriye AKTİF tek link — "bunlar sizi tavsiye etmeye hazır" önerisi
-- mükerrer link üretmesin; pasifleştirilen eski linkler saklı kalır.
create unique index if not exists idx_referral_links_active_customer
  on public.referral_links(tenant_id, customer_id) where is_active;

-- ============================================================
-- referrals — linkten gelen tavsiye kayıtları
-- ============================================================
create table if not exists public.referrals (
  id                  uuid        primary key default gen_random_uuid(),
  tenant_id           uuid        not null references public.tenants(id) on delete cascade,
  -- Link silinse bile gelen tavsiye kaybolmasın → set null.
  link_id             uuid        references public.referral_links(id) on delete set null,
  referrer_customer_id uuid       references public.customers(id) on delete set null,
  referred_name       text        not null,
  referred_phone      text        not null,
  -- Tavsiye edilen kişinin "ne arıyorum" notu (public formdan gelir).
  referred_note       text,
  -- Ofisin kendi notu (panelden eklenir) — public not ile karışmasın diye ayrı.
  staff_note          text,
  -- Tavsiye edilen kişinin KVKK açık rızası — form onay kutusu zorunlu.
  kvkk_at             timestamptz,
  status              text        not null default 'yeni'
                        check (status in ('yeni','iletisim','musteri','kazanildi','kayip')),
  -- Müşteriye dönüştürülünce oluşan/eşleşen customers kaydı.
  created_customer_id uuid        references public.customers(id) on delete set null,
  handled_by          uuid        references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.referrals is
  'Tavsiye linkinden gelen aday kayıtları — yeni → iletisim → musteri → kazanildi/kayip';
comment on column public.referrals.kvkk_at is
  'Tavsiye EDİLEN kişinin verisinin işlenmesine verdiği açık rıza anı (public form onayı)';
comment on column public.referrals.referred_phone is
  'TR mobil, 05XXXXXXXXX normalize (customers_phone_tr_format ile aynı çizgi)';

create index if not exists idx_referrals_tenant
  on public.referrals(tenant_id, created_at desc);

create index if not exists idx_referrals_status
  on public.referrals(tenant_id, status, created_at desc);

create index if not exists idx_referrals_link
  on public.referrals(link_id);

create index if not exists idx_referrals_referrer
  on public.referrals(tenant_id, referrer_customer_id);

-- Aynı linkten aynı telefon iki kez gelmesin (mükerrer freni) —
-- action 23505'i yakalayıp "Bu kişiyi zaten iletmişsiniz" der.
create unique index if not exists idx_referrals_link_phone_unique
  on public.referrals(link_id, referred_phone) where link_id is not null;

-- ============================================================
-- RLS — kiracı izolasyonu (bkz. 20260725000054: helper kullan)
-- ============================================================
alter table public.referral_links enable row level security;
alter table public.referrals enable row level security;

drop policy if exists referral_links_tenant on public.referral_links;
create policy referral_links_tenant on public.referral_links
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on policy referral_links_tenant on public.referral_links is
  'Kiracı izolasyonu — current_tenant_id(). Public tavsiye sayfası service role ile okur.';

drop policy if exists referrals_tenant on public.referrals;
create policy referrals_tenant on public.referrals
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on policy referrals_tenant on public.referrals is
  'Kiracı izolasyonu — current_tenant_id(). Public form service role ile yazar.';

grant all on public.referral_links to authenticated, service_role;
grant all on public.referrals to authenticated, service_role;

-- ============================================================
-- Tıklanma sayacı — atomik +1 (increment_listing_view deseni)
-- ============================================================
create or replace function public.increment_referral_click(p_link_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.referral_links
  set click_count = coalesce(click_count, 0) + 1
  where id = p_link_id;
$$;

-- Yalnızca service_role çağırır (public sayfa admin client kullanır);
-- authenticated'a açılmaz — istemciden keyfî sayaç şişirme kapısı olmasın.
revoke execute on function public.increment_referral_click(uuid) from public;
grant execute on function public.increment_referral_click(uuid) to service_role;

comment on function public.increment_referral_click(uuid) is
  'Tavsiye linki açılış sayacı — public sayfadan after() ile fire-and-forget çağrılır';
