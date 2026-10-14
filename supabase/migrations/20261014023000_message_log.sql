-- SN3 SMS ve WhatsApp teslim günlüğü: giden SMS (Netgsm) ve WhatsApp (Meta Cloud API / platform ağ geçidi) gönderimleri
-- tek tabloda (message_sends) + budama RPC'si (message_log_prune). E-posta günlüğünün (AD7, 20261013004600) eşi.
--
-- Platform verisidir: RLS açık, politika yok -> yalnız service_role erişir (email_sends deseni). Admin Entegrasyon merkezi
--   ve Ofis 360 sunucuda service_role ile okur; ofis kullanıcıları bu tabloyu göremez.
-- KİŞİSEL VERİ: alıcı numarası DÜZ SAKLANMAZ; yalnız maskeli gösterim (to_masked, "05** *** ** 42") ve E.164 rakamlarının
--   SHA-256 özeti (to_hash; teslim raporundaki numarayı doğrulamak ve aynı alıcıyı süzmek için). Mesaj gövdesi saklanmaz
--   (giriş kodu vb. içerebilir).
-- channel: sms | whatsapp. account: gönderimin yapıldığı sağlayıcı hesabı (platform = EmlakSoft hesabı, tenant = ofisin
--   kendi entegrasyonu). audience: office (ofisin kendisine/personeline: giriş kodu, tahsilat hatırlatması, kanal testi) |
--   contact (ofisin müşterisine/malikine/imzacısına). tenant_id: mesajın ilgili olduğu ofis (yoksa null).
-- status: queued (sağlayıcı kabul etti, teslim bekleniyor) -> sent (WhatsApp: Meta iletti) -> delivered -> read (WhatsApp)
--   | failed (sağlayıcı reddetti ya da teslim raporu başarısız) | unknown (sonuç belirsiz; otomatik tekrar yapılmaz).
--   Teslim raporu (Netgsm) ve durum webhook'u (Meta, imzalı) durumu öncelik kuralıyla İLERLETİR, geri çekmez.
-- segments: SMS kredi boyu (gönderimde metinden tahmin; Netgsm raporu boy bildirirse o yazılır). WhatsApp için null
--   (Meta konuşma bazlı ücretlendirir; pricing_category webhook'tan gelirse yazılır).
-- message_log_prune(): gönderimler 400 gün sonra silinir (operational-retention cron adımı).
-- KOD DAVRANIŞI: tablo yokken gönderim sürer (günlük sessizce atlanır), ekran "kurulum bekliyor" der.
-- GERİ ALMA: supabase/rollbacks/20261014023000_message_log.rollback.sql (yalnız bu tablo + RPC).
-- RİSK: düşük (yeni tablo + bir fonksiyon; mevcut nesnelere dokunmaz).

create table if not exists public.message_sends (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid references public.tenants(id) on delete set null,
  channel text not null check (channel in ('sms', 'whatsapp')),
  account text not null default 'platform' check (account in ('platform', 'tenant')),
  audience text not null default 'contact' check (audience in ('office', 'contact')),
  source text not null default 'system' check (char_length(source) between 1 and 64),
  to_hash text check (to_hash is null or to_hash ~ '^[0-9a-f]{64}$'),
  to_masked text not null check (char_length(to_masked) between 1 and 40),
  status text not null check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'unknown')),
  provider_id text check (provider_id is null or char_length(provider_id) between 1 and 512),
  error_code text check (error_code is null or char_length(error_code) <= 64),
  error text check (error is null or char_length(error) <= 300),
  segments smallint check (segments is null or segments between 0 and 100),
  pricing_category text check (pricing_category is null or char_length(pricing_category) <= 32),
  delivered_at timestamptz,
  read_at timestamptz,
  last_event_at timestamptz,
  unique (channel, provider_id)
);

create index if not exists message_sends_created_idx on public.message_sends (created_at desc);
create index if not exists message_sends_tenant_idx on public.message_sends (tenant_id, created_at desc) where tenant_id is not null;
create index if not exists message_sends_status_idx on public.message_sends (status, created_at desc);

alter table public.message_sends enable row level security;
-- Politika bilerek yok: anon/authenticated hiçbir şey göremez; service_role RLS'i atlar.
revoke all on public.message_sends from anon, authenticated;
grant all on public.message_sends to service_role;

create or replace function public.message_log_prune()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer := 0;
begin
  delete from public.message_sends where created_at < now() - interval '400 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.message_log_prune() from public, anon, authenticated;
grant execute on function public.message_log_prune() to service_role;

notify pgrst, 'reload schema';
