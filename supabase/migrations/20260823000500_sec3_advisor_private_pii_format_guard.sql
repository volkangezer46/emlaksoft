-- Güvenlik denetimi 3 / #13 (P2): advisor_private — *_enc / *_last4 alanlarına doğrudan (uygulama dışı) yazım.
--
-- NEDEN: 20260816001300'de advisor_private INSERT/UPDATE politikası danışmana KENDİ satırını yazdırır; bu
--   doğru (form kendi oturumuyla yazar) ama national_id_enc / iban_enc için yalnız "text" tipi vardı.
--   Danışman PostgREST ile açık TC/IBAN'ı (şifresiz) *_enc sütununa yazabilir veya last4'ü şifreli
--   değerden bağımsız uydurabilirdi; uygulama doğrulaması (TC sağlama, IBAN mod-97, AES-GCM) atlanırdı.
--
-- SEÇİLEN ÇÖZÜM VE GEREKÇE: sütun düzeyinde REVOKE UPDATE/INSERT (authenticated) KULLANILMADI, çünkü
--   src/app/actions/advisor-profile.ts writePrivate() bu sütunları KULLANICI OTURUMUYLA upsert eder
--   (admin client yok; kabul listesine yeni service_role kullanımı eklemek de ayrı onay ister). Revoke, kendi
--   profilini düzenleyen danışman ve owner/gm formunu kırardı. En az etkili çözüm: CHECK kısıtları ile yalnız
--   uygulamanın ürettiği biçim kabul edilir:
--     * *_enc: NULL veya `v<sürüm>.<iv 16 kar>.<tag 22 kar>.<şifreli 1-256 kar>` (base64url, dolgusuz;
--       src/lib/advisor/pii-crypto.ts encryptPii: 12 bayt IV → 16, 16 bayt GCM tag → 22 karakter).
--       Açık TC (11 hane) ya da açık IBAN bu biçime UYMAZ → doğrudan açık değer yazımı engellenir.
--     * çift kuralı: *_enc ile *_last4 ya birlikte dolu ya birlikte NULL (koddaki yazma/temizleme ile aynı).
--     * *_last4 biçimleri zaten mevcut CHECK'lerde (TC: 4 rakam, IBAN: 4 alfanümerik).
--   SINIR (dürüst not): DB anahtarı bilmez; biçime uyan ama çözülemeyen sahte bir şifreli metin + uydurma last4
--   yazılabilir. Etkisi yalnız kişinin KENDİ satırıdır, açık veri sızmaz; kod çözemediği değeri göstermez.
--   Tam kapatma için öneri (TS, sahibi onayı): writePrivate'i SECURITY DEFINER RPC'ye veya sunucu tarafı
--   imzalı (HMAC) last4 doğrulamasına taşıyıp ardından bu sütunlarda authenticated için REVOKE.
--
-- NOT VALID: mevcut satırlar taranmaz (kilitsiz/hızlı); kural tüm YENİ insert/update'lerde geçerlidir.
--   Mevcut satırlarda ihlal varsa o satır bir sonraki güncellemede hata verir. Uygulamadan ÖNCE şu salt-okunur
--   sorgu 0 dönmeli (dönerse satırlar elle düzeltilmeli), ardından istenirse VALIDATE CONSTRAINT çalıştırılabilir:
--     select count(*) from public.advisor_private
--     where (national_id_enc is not null and national_id_enc !~ '^v[0-9]{1,3}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{1,256}$')
--        or (iban_enc is not null and iban_enc !~ '^v[0-9]{1,3}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{1,256}$')
--        or ((national_id_enc is null) <> (national_id_last4 is null))
--        or ((iban_enc is null) <> (iban_last4 is null));
-- ETKİ: yalnız katalog değişikliği (NOT VALID CHECK); kısa ACCESS EXCLUSIVE kilidi, tablo taranmaz.
-- GERİ ALMA: supabase/rollbacks/20260823000500_sec3_advisor_private_pii_format_guard.rollback.sql
-- RİSK: düşük. Anahtar sürümü ileride değişse de biçim (`v<n>.`) kuralı geçerli kalır.

alter table public.advisor_private
  drop constraint if exists advisor_private_national_id_enc_format_chk;
alter table public.advisor_private
  add constraint advisor_private_national_id_enc_format_chk check (
    national_id_enc is null
    or national_id_enc ~ '^v[0-9]{1,3}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{1,256}$'
  ) not valid;

alter table public.advisor_private
  drop constraint if exists advisor_private_iban_enc_format_chk;
alter table public.advisor_private
  add constraint advisor_private_iban_enc_format_chk check (
    iban_enc is null
    or iban_enc ~ '^v[0-9]{1,3}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{1,256}$'
  ) not valid;

alter table public.advisor_private
  drop constraint if exists advisor_private_national_id_pair_chk;
alter table public.advisor_private
  add constraint advisor_private_national_id_pair_chk check (
    (national_id_enc is null) = (national_id_last4 is null)
  ) not valid;

alter table public.advisor_private
  drop constraint if exists advisor_private_iban_pair_chk;
alter table public.advisor_private
  add constraint advisor_private_iban_pair_chk check (
    (iban_enc is null) = (iban_last4 is null)
  ) not valid;

comment on constraint advisor_private_national_id_enc_format_chk on public.advisor_private is
  'Yalnız uygulama şifreli biçimi (v<n>.<iv>.<tag>.<ct>, base64url). Açık TC yazılamaz.';
comment on constraint advisor_private_iban_enc_format_chk on public.advisor_private is
  'Yalnız uygulama şifreli biçimi (v<n>.<iv>.<tag>.<ct>, base64url). Açık IBAN yazılamaz.';
comment on constraint advisor_private_national_id_pair_chk on public.advisor_private is
  'national_id_enc ve national_id_last4 birlikte dolu ya da birlikte NULL.';
comment on constraint advisor_private_iban_pair_chk on public.advisor_private is
  'iban_enc ve iban_last4 birlikte dolu ya da birlikte NULL.';
