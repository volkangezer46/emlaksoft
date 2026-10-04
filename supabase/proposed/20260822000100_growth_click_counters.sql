-- TASLAK (UYGULANMADI) — organik büyüme: bağlantı tıklama sayacı (kişisel veri YOK).
-- Bağımlılık: 20260819000100_growth_referral_partner_attribution.sql ÖNCE uygulanır (growth_* ve signup_attributions tabloları).
-- Numara notu: taslak dosyalar supabase/migrations'a taşınırken ledger'daki en son numaranın ÜSTÜNE yeniden numaralanır
-- (20260819000100 zaten uygulanmış 20260819010xxx dosyalarının altında kalır). Bu dosya sıralamada taslağın ardından gelmelidir.
-- Uygulama kodu (src/lib/growth/store.ts) tablo/fonksiyon yoksa sessizce "etkin değil" davranır; bu migration uygulanmadan sistem bozulmaz.
--
-- KVKK: yalnız (tür, kod, gün) başına sayaç. IP, cihaz izi, çerez kimliği saklanmaz. Kod opak/rastgeledir.

create table if not exists public.growth_click_counters (
  kind  text not null check (kind in ('referral','partner','powered_by')),
  code  text not null check (code ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  day   date not null default (now() at time zone 'Europe/Istanbul')::date,
  n     integer not null default 0 check (n >= 0),
  primary key (kind, code, day)
);

alter table public.growth_click_counters enable row level security;
-- Politikasız: okuma/yazma yalnız service_role (ofis sayıları sunucuda, tenant süzgeciyle hesaplanır).

create or replace function public.growth_count_click(p_kind text, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('referral','partner','powered_by') or p_code !~ '^[a-z0-9][a-z0-9-]{0,59}$' then
    return;
  end if;
  insert into public.growth_click_counters (kind, code, day, n)
  values (p_kind, p_code, (now() at time zone 'Europe/Istanbul')::date, 1)
  on conflict (kind, code, day) do update set n = public.growth_click_counters.n + 1;
end $$;

revoke all on function public.growth_count_click(text, text) from public, anon, authenticated;
grant execute on function public.growth_count_click(text, text) to service_role;

-- Not (kayıt akışı): ilk-dokunuş atfı uygulamada signup_attributions'a yazılır (service_role, kayıt sonrası, en iyi çaba).
-- provision_registration RPC'sine p_ref EKLENMEDİ; atomiklik gerekirse ayrı migration ile yapılır.
