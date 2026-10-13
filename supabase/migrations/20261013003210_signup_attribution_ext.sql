-- SP3: kayıt atfı genişletmesi. signup_attributions'a kanal, yönlendiren ana makine, utm_term/utm_content ve
-- ilk/son dokunuş özetleri eklenir; landing_path (20260825000800'den beri var, hiç yazılmıyordu) kısıtlanır.
--
-- KVKK/gizlilik: tıklama kimliği (gclid/gbraid/wbraid) sütunu BİLEREK YOK; IP/çerez/cihaz izi yok. Yalnız kanal etiketi,
--   ana makine adı (≤100), kısa etiket metinleri (≤64) ve iniş yolu (≤120, sorgusuz) saklanır.
-- Ödül mantığı DEĞİŞMEZ: yalnız ref_kind'e bağlıdır (growth_* fonksiyonları bu sütunları okumaz).
-- Geçmiş satırlar geriye dönük DOLDURULMAZ (yeni sütunlar null kalır; kısıtlar null'u kabul eder).
-- Yetki: service_role'ün tablo düzeyi INSERT yetkisi (20261012002100) yeni sütunları da kapsar; politika değişmez.
-- KOD DAVRANIŞI: sütunlar yoksa (migration uygulanmamış) kayıt atfı eski sütunlarla yazılır (42703 geri düşüşü).
-- GERİ ALMA: supabase/rollbacks/20261013003210_signup_attribution_ext.rollback.sql (eklenen sütunlar ve kısıtlar düşer).
-- RİSK: düşük (yalnız nullable sütun + CHECK; tablo bugün 0 satır).

alter table public.signup_attributions
  add column if not exists channel text,
  add column if not exists src_host text,
  add column if not exists utm_term text,
  add column if not exists utm_content text,
  add column if not exists first_touch jsonb,
  add column if not exists last_touch jsonb;

alter table public.signup_attributions drop constraint if exists signup_attributions_channel_check;
alter table public.signup_attributions add constraint signup_attributions_channel_check check (
  channel is null or channel in (
    'paid_search','organic_search','social','referral_site','direct','email','office_invite','partner','vitrin_signature','unknown'
  )
);

alter table public.signup_attributions drop constraint if exists signup_attributions_src_host_check;
alter table public.signup_attributions add constraint signup_attributions_src_host_check check (
  src_host is null or (char_length(src_host) between 1 and 100 and src_host ~ '^[a-z0-9.-]+$')
);

alter table public.signup_attributions drop constraint if exists signup_attributions_utm_term_check;
alter table public.signup_attributions add constraint signup_attributions_utm_term_check check (
  utm_term is null or (char_length(utm_term) between 1 and 64 and utm_term !~ '[[:cntrl:]<>"\\]')
);

alter table public.signup_attributions drop constraint if exists signup_attributions_utm_content_check;
alter table public.signup_attributions add constraint signup_attributions_utm_content_check check (
  utm_content is null or (char_length(utm_content) between 1 and 64 and utm_content !~ '[[:cntrl:]<>"\\]')
);

alter table public.signup_attributions drop constraint if exists signup_attributions_landing_path_check;
alter table public.signup_attributions add constraint signup_attributions_landing_path_check check (
  landing_path is null or (
    char_length(landing_path) between 1 and 120 and left(landing_path, 1) = '/'
    and position('?' in landing_path) = 0 and position('#' in landing_path) = 0
  )
);

alter table public.signup_attributions drop constraint if exists signup_attributions_touch_check;
alter table public.signup_attributions add constraint signup_attributions_touch_check check (
  (first_touch is null or (jsonb_typeof(first_touch) = 'object' and octet_length(first_touch::text) <= 1024))
  and (last_touch is null or (jsonb_typeof(last_touch) = 'object' and octet_length(last_touch::text) <= 1024))
);

create index if not exists idx_signup_attr_channel on public.signup_attributions(channel) where channel is not null;

comment on column public.signup_attributions.channel is 'Kayıt kanalı (classifyChannel; ödül mantığı ref_kind''e bağlıdır).';
comment on column public.signup_attributions.first_touch is 'İlk dokunuş özeti {channel, src_host, utm_*, lp} (kişisel veri yok).';
comment on column public.signup_attributions.last_touch is 'Son dokunuş özeti {channel, src_host, utm_*, lp} (kişisel veri yok).';

notify pgrst, 'reload schema';
