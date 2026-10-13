-- EP3 Bakanlık (EİDS) e-postalarının alımı, doğrulanması ve ayrıştırılması.
--
-- eids_inbound_addresses: ofise özel alma adresi (yetki-<16 karakter>@eids.emlaksoft.com.tr). Anahtar düz SAKLANMAZ:
--   token_hash = sha256(anahtar) (SMTP alıcısının arama anahtarı), token_sealed = uygulama katmanında AES-256-GCM ile
--   mühürlü anahtar (yalnız kartta adresi yeniden göstermek için; anahtar EIDS_MAIL_KEY ortam değişkeni). Ofis başına
--   TEK aktif adres (revoked_at is null kısmi tekil dizin); "adresi yenile" eskisini revoked_at ile kapatır, eski adres
--   SMTP aşamasında hemen 550 ile reddedilir.
-- eids_inbound_messages: gelen her e-postanın İŞLENMİŞ kaydı. Kaynak: smtp | eml_upload | paste | resend.
--   auth_result: verified | verified_via_arc | unverified | rejected (src/lib/eids/mail-auth.ts).
--   Header From eids.yetki@ticaret.gov.tr olmayan e-postanın GÖVDESİ YAZILMAZ: yalnız 'rejected' satırı (maskeli
--   gönderen, ham yok). İstisna: iletme onay e-postaları (Gmail/Yandex/Outlook) — yalnız onay kodu/bağlantısı
--   confirm_* sütunlarında 24 saat durur (operational-retention cron'u siler).
--   Çift işleme: (tenant_id, message_id) ve (tenant_id, body_sha256) tekil; anlamsal tekrar (no, tür, bitiş, 7 gün)
--   kodda denetlenir ve match_status='duplicate' + duplicate_of yazılır.
--   KVKK: ham .eml raw_eml_encrypted'da (AES-256-GCM, uygulama anahtarı) yalnız raw_purge_after'a kadar (30 gün)
--   tutulur, sonra NULL'lanır; ayrıştırılmış alanlar ve doğrulama sonucu kalır. Malik adı yalnız maskeli
--   (grantor_masked) ve normalleştirilmiş adın özeti (grantor_name_hash) olarak durur.
--   Uygulanan olay EP2 defterine (eids_authority_events, applyAuthorityEvent) yazılır; burada yalnız kimliği
--   authority_event_id'de tutulur (EP2 tablosuna FK bilerek yok: iki migration'ın sırası serbest kalsın).
-- RLS: okuma ofis içi (adres: ayarlar görüntüleme; mesaj: portallar görüntüleme izni); anon/authenticated YAZAMAZ.
--   Yazma yalnız service_role (SMTP köprüsü /api/inbound/eids ve yetki kapısından geçen server action'lar).
-- KOD DAVRANIŞI: tablolar yokken kart ve kuyruk "kurulum bekliyor" der; yapıştırma/yükleme hata mesajı verir.
-- GERİ ALMA: supabase/rollbacks/20261013007200_eids_inbound.rollback.sql (yalnız bu iki tablo).
-- RİSK: düşük (yeni tablolar; mevcut nesnelere dokunmaz).

create table if not exists public.eids_inbound_addresses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_sealed text not null check (char_length(token_sealed) between 20 and 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  last_received_at timestamptz
);

create unique index if not exists eids_inbound_addresses_one_active
  on public.eids_inbound_addresses (tenant_id) where revoked_at is null;
create index if not exists eids_inbound_addresses_tenant_idx
  on public.eids_inbound_addresses (tenant_id, created_at desc);

create table if not exists public.eids_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  address_id uuid references public.eids_inbound_addresses(id) on delete set null,
  received_via text not null check (received_via in ('smtp', 'eml_upload', 'paste', 'resend')),
  message_id text check (message_id is null or char_length(message_id) between 1 and 300),
  body_sha256 text check (body_sha256 is null or body_sha256 ~ '^[0-9a-f]{64}$'),
  from_addr text check (from_addr is null or char_length(from_addr) <= 254),
  auth_result text not null check (auth_result in ('verified', 'verified_via_arc', 'unverified', 'rejected')),
  auth_detail jsonb not null default '{}'::jsonb,
  parse_kind text check (parse_kind is null or parse_kind in ('grant', 'revoke', 'unknown', 'forward_confirmation')),
  eids_property_no text check (eids_property_no is null or eids_property_no ~ '^[0-9]{6,12}$'),
  deal_kind text check (deal_kind is null or deal_kind in ('sale', 'rent')),
  grantor_masked text check (grantor_masked is null or char_length(grantor_masked) <= 160),
  grantor_name_hash text check (grantor_name_hash is null or grantor_name_hash ~ '^[0-9a-f]{64}$'),
  valid_until date,
  match_status text check (match_status is null or match_status in ('applied', 'queued', 'candidate', 'no_match', 'duplicate', 'dismissed', 'rejected')),
  property_id uuid references public.properties(id) on delete set null,
  candidate_property_ids uuid[] not null default '{}'::uuid[],
  authority_event_id uuid,
  duplicate_of uuid references public.eids_inbound_messages(id) on delete set null,
  sample_masked text check (sample_masked is null or char_length(sample_masked) <= 1600),
  confirm_provider text check (confirm_provider is null or confirm_provider in ('gmail', 'yandex', 'outlook')),
  confirm_code text check (confirm_code is null or char_length(confirm_code) <= 24),
  confirm_url text check (confirm_url is null or char_length(confirm_url) <= 600),
  confirm_expires_at timestamptz,
  raw_eml_encrypted bytea,
  raw_purge_after timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 300),
  constraint eids_inbound_messages_raw_has_purge check (raw_eml_encrypted is null or raw_purge_after is not null)
);

create unique index if not exists eids_inbound_messages_message_id_uq
  on public.eids_inbound_messages (tenant_id, message_id) where message_id is not null;
create unique index if not exists eids_inbound_messages_body_sha_uq
  on public.eids_inbound_messages (tenant_id, body_sha256) where body_sha256 is not null;
create index if not exists eids_inbound_messages_tenant_idx
  on public.eids_inbound_messages (tenant_id, received_at desc);
create index if not exists eids_inbound_messages_queue_idx
  on public.eids_inbound_messages (tenant_id, received_at desc) where match_status in ('queued', 'candidate', 'no_match');
create index if not exists eids_inbound_messages_semantic_idx
  on public.eids_inbound_messages (tenant_id, eids_property_no, parse_kind, received_at desc) where eids_property_no is not null;
create index if not exists eids_inbound_messages_raw_purge_idx
  on public.eids_inbound_messages (raw_purge_after) where raw_eml_encrypted is not null;
create index if not exists eids_inbound_messages_confirm_idx
  on public.eids_inbound_messages (confirm_expires_at) where confirm_expires_at is not null;

alter table public.eids_inbound_addresses enable row level security;
alter table public.eids_inbound_messages enable row level security;

drop policy if exists eids_inbound_addresses_select on public.eids_inbound_addresses;
create policy eids_inbound_addresses_select on public.eids_inbound_addresses
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('settings'::text, 'view'::text))
  );

drop policy if exists eids_inbound_messages_select on public.eids_inbound_messages;
create policy eids_inbound_messages_select on public.eids_inbound_messages
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('portals'::text, 'view'::text))
  );

-- Yazma politikası bilerek yok: anon/authenticated ekleyemez, güncelleyemez, silemez; service_role RLS'i atlar.
revoke all on public.eids_inbound_addresses from anon, authenticated;
revoke all on public.eids_inbound_messages from anon, authenticated;
grant select on public.eids_inbound_addresses to authenticated;
grant select on public.eids_inbound_messages to authenticated;
grant all on public.eids_inbound_addresses to service_role;
grant all on public.eids_inbound_messages to service_role;

comment on table public.eids_inbound_addresses is 'EP3: ofise özel EİDS alma adresi (anahtar yalnız özet + mühürlü); ofis başına tek aktif.';
comment on table public.eids_inbound_messages is 'EP3: alınan EİDS e-postalarının işlenmiş kaydı; ham .eml şifreli ve en çok 30 gün (raw_purge_after).';

notify pgrst, 'reload schema';
