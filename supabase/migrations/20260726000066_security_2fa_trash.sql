-- SMS tabanlı iki adımlı doğrulama (2FA) + giriş günlüğü
--
-- profiles.two_factor_sms : kullanıcı başına opsiyonel 2FA anahtarı.
--   Açıksa şifre doğrulandıktan sonra kayıtlı telefona 6 haneli kod gider,
--   kod doğrulanana dek /app - /admin erişimi middleware'de kesilir.
--
-- login_challenges : bekleyen 2FA kodları. Kod düz metin SAKLANMAZ,
--   yalnızca sha256 hex hash'i tutulur (imza OTP'si ile aynı desen,
--   bkz. 20260726000062_contract_signer_otp.sql). 5 dk geçerli, 5 deneme.
--   Yalnız service_role erişir (tüm okuma/yazma admin client üzerinden).
--
-- login_events : her giriş denemesinin kaydı (başarılı/başarısız/2FA).
--   Kullanıcı yalnız KENDİ kayıtlarını okur (güvenlik sayfasındaki
--   "son girişler" listesi); yazma yalnız service_role.

alter table public.profiles
  add column if not exists two_factor_sms boolean not null default false;

-- ---------------------------------------------------------------------------
-- Bekleyen 2FA kodları
-- ---------------------------------------------------------------------------
create table if not exists public.login_challenges (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  code_hash  text        not null,
  expires_at timestamptz not null,
  attempts   integer     not null default 0,
  created_at timestamptz not null default now()
);

-- Girişte "bu kullanıcının bekleyen kodu var mı" sorgusu
create index if not exists idx_login_challenges_user
  on public.login_challenges(user_id);

-- Süresi dolanları temizlik sorgusuyla hızlı silmek için
create index if not exists idx_login_challenges_expires
  on public.login_challenges(expires_at);

alter table public.login_challenges enable row level security;
-- Policy yok: anon/authenticated hiçbir satır göremez; yalnız service_role.
grant all on public.login_challenges to service_role;

-- ---------------------------------------------------------------------------
-- Giriş günlüğü
-- ---------------------------------------------------------------------------
create table if not exists public.login_events (
  id         uuid        primary key default gen_random_uuid(),
  -- Şifre yanlışsa kullanıcı bilinmez → NULL kalır (yalnız IP izi)
  user_id    uuid        references auth.users(id) on delete cascade,
  tenant_id  uuid        references public.tenants(id) on delete cascade,
  ip         text,
  user_agent text,
  result     text        not null
    check (result in ('success', 'failed', '2fa_pending', '2fa_failed')),
  created_at timestamptz not null default now()
);

-- Güvenlik sayfası: kullanıcının son 20 girişi (created_at desc)
create index if not exists idx_login_events_user_created
  on public.login_events(user_id, created_at desc);

-- Olası ofis bazlı denetim raporları için
create index if not exists idx_login_events_tenant_created
  on public.login_events(tenant_id, created_at desc)
  where tenant_id is not null;

alter table public.login_events enable row level security;

-- Kullanıcı yalnız kendi giriş kayıtlarını okur
create policy login_events_own_read on public.login_events
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Yazma yalnız service_role (insert policy tanımlı değil)
grant select on public.login_events to authenticated;
grant all on public.login_events to service_role;
