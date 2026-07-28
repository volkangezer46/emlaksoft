-- ============================================================
-- Danışman dijital kartviziti — /danisman/[slug] public mini profil
-- ============================================================
-- Danışman kendi profil linkini WhatsApp'ta/QR ile paylaşır; müşteri açar ve
-- tek sayfada fotoğraf + unvan + uzmanlık + aktif portföyler + memnuniyet
-- puanını görür, tek tıkla arar / WhatsApp yazar / randevu alır / rehbere ekler.
--
-- Vitrin (tenants.slug) deseninin KİŞİ ölçeğindeki karşılığı: slug tahmin
-- edilebilir ve SEO'ya AÇIK olmalı (token'lı portallardan farkı bu — burada
-- amaç gizlilik değil, bulunabilirlik). Bu yüzden `public_token` yerine
-- okunabilir `public_slug` kullanılır ve sayfa noindex DEĞİLDİR.
--
-- Yayın kapalıyken (is_public=false veya slug null) sayfa 404 verir; yani
-- profil verisi girilse bile danışman "yayına al" demeden hiçbir şey sızmaz.

alter table public.profiles
  add column if not exists public_slug      text,
  add column if not exists is_public        boolean not null default false,
  add column if not exists title            text,
  add column if not exists bio              text,
  add column if not exists photo_url        text,
  add column if not exists specialties      text[],
  add column if not exists languages        text[],
  add column if not exists public_view_count int not null default 0;

comment on column public.profiles.public_slug is
  'Public kartvizit adresi (/danisman/<slug>) — null ise profil paylaşımda değil (tenants.slug deseni)';
comment on column public.profiles.is_public is
  'Kartvizit yayında mı? Varsayılan KAPALI — danışman bilgilerini girmeden link canlıya çıkmasın (booking_settings.is_active deseni)';
comment on column public.profiles.title is
  'Unvan — "Kıdemli Danışman", "Portföy Uzmanı" gibi serbest metin';
comment on column public.profiles.bio is
  'Kısa tanıtım metni (en fazla 600 karakter)';
comment on column public.profiles.photo_url is
  'Vesikalık/portre görsel URL (agent-photos bucket public URL veya harici adres); yoksa baş harf monogramı gösterilir';
comment on column public.profiles.specialties is
  'Uzmanlık etiketleri — bölge veya portföy tipi ("Kadıköy", "Lüks konut")';
comment on column public.profiles.languages is
  'Konuşulan diller ("Türkçe", "İngilizce") — yabancı müşteri için ayırt edici';
comment on column public.profiles.public_view_count is
  'Kartvizit sayfası açılış sayacı — increment_profile_view() ile after() içinde atomik artar';

-- Slug URL'e giriyor: yalnız küçük harf/rakam/tire, 3-60 karakter, tire ile
-- başlayıp bitmesin. `not valid` DEĞİL — kolon yeni, mevcut satırlarda null.
alter table public.profiles
  drop constraint if exists profiles_public_slug_format,
  add constraint profiles_public_slug_format
    check (public_slug is null or public_slug ~ '^[a-z0-9]([a-z0-9-]{1,58})[a-z0-9]$');

alter table public.profiles
  drop constraint if exists profiles_bio_len,
  add constraint profiles_bio_len check (bio is null or char_length(bio) <= 600);

-- Slug GLOBAL benzersiz (kiracı üstü) — /danisman/<slug> tek segmentli adres.
-- Kısmi index: null slug'lar (paylaşımda olmayan profiller) çakışmaz.
create unique index if not exists idx_profiles_public_slug
  on public.profiles(public_slug)
  where public_slug is not null;

-- Public sayfanın tek sorgusu "yayındaki slug" üzerinden.
create index if not exists idx_profiles_public_live
  on public.profiles(public_slug)
  where is_public and public_slug is not null;

-- ============================================================
-- Görüntüleme sayacı — atomik artırım (increment_presentation_view deseni)
-- ============================================================
create or replace function public.increment_profile_view(p_profile_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set public_view_count = public_view_count + 1
   where id = p_profile_id
     and is_public;
$$;

comment on function public.increment_profile_view(uuid) is
  '/danisman/[slug] görüntüleme sayacı — atomik artırım, service role çağırır (after() içinde)';

revoke all on function public.increment_profile_view(uuid) from public, anon, authenticated;
grant execute on function public.increment_profile_view(uuid) to service_role;

-- ============================================================
-- Danışman fotoğrafı için depolama alanı
-- ============================================================
-- Public bucket: fotoğraf zaten herkese açık kartvizitte gösteriliyor, imzalı
-- URL üretmek gereksiz gecikme olurdu (tenant-logos deseni). Yükleme server
-- action'da service role ile yapılır → storage.objects politikası gerekmez.
insert into storage.buckets (id, name, public)
values ('agent-photos', 'agent-photos', true)
on conflict (id) do nothing;
