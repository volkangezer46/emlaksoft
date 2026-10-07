# Google ile giriş / kayıt — sahibin kurulum adımları

Kod hazır; düğmeler **`NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`** verilene kadar hiçbir yerde görünmez.
Sıra önemlidir: önce Google Cloud, sonra Supabase, en son Vercel bayrağı. Migration YOK.

## 0. Proje ref'ini bul

Supabase proje ref'i, `.env.local` içindeki `NEXT_PUBLIC_SUPABASE_URL` değerinde `https://` ile
`.supabase.co` arasındaki kısımdır (ör. `https://<proje-ref>.supabase.co`). Aynı değer Supabase Dashboard →
Project Settings → General → **Project ID** alanında da yazar. Aşağıda `<proje-ref>` geçen her yere bunu yazın.

## 1. Google Cloud Console — OAuth onay ekranı

1. <https://console.cloud.google.com/> → üstten proje seçin (yoksa "EmlakSoft" adında yeni proje).
2. **APIs & Services → OAuth consent screen** (yeni arayüzde "Google Auth Platform → Branding").
3. User type: **External** → Create.
4. Alanlar:
   - Uygulama adı: **EmlakSoft**
   - Kullanıcı destek e-postası: destek adresiniz
   - Uygulama logosu (isteğe bağlı; yüklerseniz Google doğrulaması gerekebilir)
   - Uygulama ana sayfası: `https://emlaksoft.vercel.app`
   - Gizlilik politikası: `https://emlaksoft.vercel.app/kvkk-aydinlatma`
   - Hizmet şartları: `https://emlaksoft.vercel.app/kullanim-sartlari`
   - **Yetkili alan adları (Authorized domains):** `emlaksoft.vercel.app` (ve `supabase.co` istenirse onu da)
   - Geliştirici iletişim e-postası: sizin adresiniz
5. **Kapsamlar (Scopes / Data access):** yalnız `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
   Başka kapsam eklemeyin (bu üçü "hassas olmayan" kapsamdır; Google doğrulama incelemesi gerektirmez).
6. **Yayın durumu:** "Testing" modunda yalnız eklediğiniz test kullanıcıları girebilir. Herkese açmak için
   **Publish app → In production**.

## 2. Google Cloud Console — OAuth istemci kimliği

1. **APIs & Services → Credentials → Create credentials → OAuth client ID** ("Clients → Create client").
2. Application type: **Web application**; ad: `EmlakSoft Supabase`.
3. **Yetkili JavaScript kaynakları (Authorized JavaScript origins):** `https://emlaksoft.vercel.app`
   (yerel deneme için ayrıca `http://localhost:3000`).
4. **Yetkili yönlendirme URI'leri (Authorized redirect URIs):**
   `https://<proje-ref>.supabase.co/auth/v1/callback`
   (Google kullanıcıyı uygulamaya değil Supabase'e döndürür; Supabase sonra uygulamanın `/auth/callback`
   adresine yollar.)
5. Create → **Client ID** ve **Client secret** değerlerini kopyalayın (secret'ı kimseyle paylaşmayın,
   depoya yazmayın).

## 3. Supabase Dashboard — Google sağlayıcısı

1. **Authentication → Sign In / Providers → Google** → Enable.
2. Client ID ve Client Secret'ı yapıştırın → Save.
3. "Skip nonce checks" KAPALI kalsın. "Allow users without an email" KAPALI kalsın.
4. **Authentication → Sign In / Providers → (User Signups)**: "Allow new users to sign up" AÇIK olmalı
   (Google ile ilk girişte auth kullanıcısı oluşur; ofis ancak `/kayit/tamamla` bitince açılır. Platformdaki
   "kayıt açık/kapalı" ayarı kapalıysa uygulama yeni ofisi yine reddeder).
5. **Manual linking** (Hesabım → "Google hesabını bağla" için): Authentication → Sign In / Providers →
   **Allow manual linking** AÇIK. Kapalıysa bağla düğmesi anlaşılır hata verir; giriş/kayıt etkilenmez.

### Aynı e-postayla şifreli hesap

Supabase, aynı ve **doğrulanmış** e-postaya sahip kimlikleri otomatik bağlar. EmlakSoft'ta e-posta/şifre
kayıtları doğrulanmış oluşturulduğu için, şifreli hesabı olan biri Google ile girerse aynı hesaba bağlanır
ve `/app`'e girer (2FA açıksa SMS kodu otomatik gönderilir). Google, aynı e-postayı başka bir hesaba bağlı
bulursa kullanıcı "Bu e-posta ile hesabınız var; şifrenizle giriş yapıp Hesabım sayfasından Google'ı
bağlayın." mesajını görür.

## 4. Supabase Dashboard — URL ayarları

**Authentication → URL Configuration**

- **Site URL:** `https://emlaksoft.vercel.app`
- **Redirect URLs** (Add URL):
  - `https://emlaksoft.vercel.app/auth/callback`
  - (yerel deneme) `http://localhost:3000/auth/callback`
  - (Vercel önizlemeleri isteniyorsa) `https://*-<vercel-ekip-adi>.vercel.app/auth/callback`

Listede olmayan bir adrese dönüş Supabase tarafından reddedilir (açık yönlendirme koruması).

## 5. Vercel — bayrak

1. Vercel → Project → Settings → Environment Variables →
   `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` = `true` (Production; isterseniz Preview).
2. **Redeploy** (NEXT_PUBLIC_ değişkenleri build sırasında gömülür; yeniden dağıtım şarttır).

## 6. Doğrulama (5 dakika)

1. Gizli pencerede `https://emlaksoft.vercel.app/kayit` → "Google ile devam et" → hesap seçin →
   `/kayit/tamamla` açılmalı (ad dolu, e-posta salt-okunur, telefon zorunlu) → adımları bitirin → `/app`.
2. Çıkış yapın → `/giris` → "Google ile devam et" → doğrudan `/app`.
3. Şifreli bir test hesabıyla girip Hesabım → Parola sekmesi → "Giriş yöntemleri" → "Google hesabını bağla".
4. Kurulumu yarıda bırakın (sihirbazı kapatın) → tekrar Google ile girin → yine `/kayit/tamamla`.

## Geri alma

Vercel'de `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`'ı silin/`false` yapın + redeploy: düğmeler kaybolur, `/auth/callback`
"Google ile giriş şu an kullanılamıyor" der. Google ile açılmış ofislerin sahipleri "Şifremi unuttum" ile
e-postalarına şifre belirleyip giriş yapabilir. Supabase'de sağlayıcıyı kapatmak ek güvenliktir.

## Kurallar (koddan)

- Platform personeli (platform_staff / `PLATFORM_ADMIN_EMAILS`) Google ile giremez ve ofis açamaz
  (şifre + MFA yolu); demo hesapları (`*.emlaksoft.test`) reddedilir.
- `/auth/callback` yalnız uygulama içi göreli `next` kabul eder; CSRF/state Supabase PKCE ile.
- Yeni service_role kullanımı yok: provizyon `signUp` içindeki mevcut istemciyle, ortak çekirdek
  `src/lib/registration/provision-office.ts` üzerinden yapılır.
