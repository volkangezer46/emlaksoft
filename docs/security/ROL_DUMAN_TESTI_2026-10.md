# Rol bazlı güvenlik duman testi — 2026-10-10

Hedef: canlı https://emlaksoft.vercel.app + canlı Supabase. Yöntem tamamen SALT-OKUNUR: oturumlu/oturumsuz GET sayfa
istekleri (`redirect: manual`), PostgREST GET (SELECT, `Prefer: count=exact`) ve zemin gerçeği için `BEGIN READ ONLY`
pg oturumu. INSERT/UPDATE/DELETE/RPC yazma YOK. Giriş deseni `scripts/perf/measure-live.mts` (deriveDemoPassword). Geçici
`tmp-*.mts` betikleri iş sonunda silindi. Yan etki: personalar için yeni oturum (auth `last_sign_in_at`) + rate-limit sayaçları.
Kapsam dışı bırakılan sayfa: `/app/anketler/ayarlar` (render sırasında `ensureSurveyDefaults` yazabilir).

Beklenen değerler: `src/lib/permissions.ts` DEFAULT_MATRIX = DB `permission_defaults` (fark 0), demo ofiste
`tenant_role_permissions` ve `user_permission_overrides` boş; platform tarafı `src/lib/platform-access.ts`.
sec3 runbook’u `docs/security/` altında bulunamadı (yalnız ADMIN_CLIENT_INVENTORY.md, TENANT_ISOLATION_PLAN.md).

## Persona erişilebilirliği

| Persona | Durum |
|---|---|
| sahip, mudur, danisman, cagri (ofis) · admin (super_admin) | giriş OK (aal1) |
| sube | profil var, giriş "Invalid login credentials" (parola türetimi canlıyla uyuşmuyor) |
| takim, ofis-muhasebe, izleyici · ops, muhasebe | canlıda hesap YOK |
| destek | platform_staff var, giriş başarısız |

=> branch_manager, team_lead, accounting, readonly ve platform ops/support/billing için canlı test DOĞRULANAMADI.

## Matris (persona × kontrol)

| Kontrol | sahip | mudur | danisman | cagri | admin | oturumsuz |
|---|---|---|---|---|---|---|
| 1. /app sayfa kapıları (141 sayfa) | GEÇTİ (141 izin) | GEÇTİ | GEÇTİ (16 red + 3 ek rol kapısı, 0 sızıntı) | GEÇTİ (97 red, 0 sızıntı) | GEÇTİ (/app → 307 /admin) | GEÇTİ (307 /giris?next=) |
| 2a. Tenant izolasyonu (12 tablo; tenant_id=neq + 4 yabancı tenant eq) | GEÇTİ (0) | GEÇTİ (0) | GEÇTİ (0) | GEÇTİ (0) | GEÇTİ (tenant tablolarında 0) | GEÇTİ (anon 0 / 401) |
| 2b. Modül = RLS (modülsüz tabloda 0 satır) | GEÇTİ | GEÇTİ | GEÇTİ (expenses 0) | GEÇTİ (properties/deals/commissions/rentals/rent_payments/expenses 0) | – | – |
| 2c. Danışman kayıt kapsamı (DB) | – | – | KALDI* (B1) | KALDI* (B1) | – | – |
| 2d. P12 komisyon RLS | 18/18 (beklenen) | 18/18 (earnings_all) | GEÇTİ 13/13 = kendi payı | GEÇTİ 0 | – | – |
| 2e. P12 sayfa (gizli 5 komisyon tutarı + ofis toplamı HTML içinde) | görünür (pozitif kontrol) | – | GEÇTİ (12 sayfada 0 eşleşme) | – | – | – |
| 2f. TRY kredi defteri yalnız owner/gm | GEÇTİ | GEÇTİ | GEÇTİ | GEÇTİ | – | – |
| 2g. calendar_token gizliliği | KALDI (B2) | KALDI | KALDI | KALDI | KALDI (10 profil, tüm tenantlar) | – |
| 2h. audit_logs rol sınırı | – | – | KALDI (B3) | KALDI (B3) | GEÇTİ (0) | – |
| 3. /admin reddi | GEÇTİ (307 /app, API 403) | GEÇTİ | GEÇTİ | GEÇTİ | 44 sayfa izinli (GEÇTİ) | GEÇTİ (307 /giris) |
| 4. Token portalları (14 yol × 3 geçersiz token) | – | – | – | – | – | GEÇTİ (veri yok, noindex; B7) |

*Demo ofiste `office.access.scope_enforcement` kapalı (hiçbir tenant’ta açık değil) → bugünkü görünürlük ürün kararıyla uyumlu; bulgu, bayrak açıldığında DB’nin kapsamı uygulamamasıdır.

## Bulgular

| # | Önem | Bulgu | Kanıt (istek → beklenen → gelen) | Kök neden (dosya:satır) | Öneri |
|---|---|---|---|---|---|
| B2 | Yüksek | Her ofis üyesi meslektaşlarının `profiles.calendar_token` değerini okuyup kimlik doğrulamasız ICS akışına abone olabiliyor; token ayrılan çalışanda da çalışır | danisman JWT: GET /rest/v1/profiles?select=id,calendar_token&id=neq.SELF → beklenen sütun yok/403 → 206, 4 dolu token (owner, gm, branch_manager, call_center). Ardından GET /api/takvim/OWNER_TOKEN → 200 text/calendar. super_admin aynı sorguda 10 profil (tüm tenantlar) görüyor | `supabase/migrations/20260802000300_identity_session_authorization_hardening.sql:740-742` (profiles tenant geneli SELECT, sütun kısıtı yok) + `:744` (platform SELECT); `src/app/api/takvim/[token]/route.ts:59-67` profil is_active / tenant durumu kontrolü yok | calendar_token sütununda authenticated için column-level SELECT kaldır (kendi token’ı sunucu/RPC ile) ya da token’ı yalnız id = auth.uid() okunur ayrı tabloya taşı; ICS rotasında is_active ve tenant active/trial şartı; pasifleştirmede token döndür |
| B1 | Orta | Kayıt kapsamı (danışman = kendi kayıtları) yalnız uygulama katmanında; DB RLS tenant + modül izniyle sınırlı. Kapsam bayrağı açılsa bile danışman/çağrı merkezi PostgREST ile tüm ofis müşteri/talep/portföy/anlaşma satırlarını okur | danisman: GET /rest/v1/customers?select=id&assigned_to=neq.SELF → beklenen 0 (CONTRACT) → 12 (toplam 45; kendi 33). cagri: customers 45, customer_demands 37 | `supabase/migrations/20260802000300_identity_session_authorization_hardening.sql:825-828` (identity_*_select = tenant eşitliği + has_effective_permission(modül, view)); `src/lib/access-control/list-scope.ts:6-9` (kapsam yalnız sorgu filtresi); `src/lib/access-control/CONTRACT.md:27,118` DB’de uygulandığını iddia ediyor | Bayrak açık tenantlar için RLS’e kapsam yüklemi ekle (SECURITY DEFINER scope_allows(tenant_id, assigned_to), bayrak kapalıyken true); en azından CONTRACT.md’yi gerçek davranışla düzelt ve bayrak ekranında "yalnız arayüz" uyarısı ver |
| B3 | Orta | `audit_logs` tenant içindeki her role açık (settings modülü olmayan call_center dahil); old/new_value içerikleri okunuyor | cagri: GET /rest/v1/audit_logs → beklenen 0 (/app/denetim settings ister, cagri rolünde yok) → 32 satır; örnekte old_value/new_value JSON | `supabase/migrations/20260721000000_init.sql:335` + `20260813000100_rls_initplan_policy_wrapping.sql:62` (audit_tenant: yalnız tenant eşitliği) | Politikaya settings:view (veya owner/gm) şartı + actor_id = auth.uid() istisnası |
| B4 | Düşük | `error_logs` tenant geneli okunuyor: diğer kullanıcıların stack, path, user_agent bilgisi | danisman/cagri: GET /rest/v1/error_logs → 5 satır (owner kullanıcısının hataları, stack 178-1264 karakter) | `supabase/migrations/20260726000057_error_logs.sql:75` (+ `20260813000100...:315`) | SELECT’i owner/gm veya user_id = auth.uid() ile sınırla |
| B5 | Düşük | anon rolünde ~110 tabloda SELECT, 130 tabloda TRUNCATE/TRIGGER/REFERENCES; koruma yalnız RLS (TRUNCATE RLS’e tabi değil, PostgREST’ten erişilemiyor) | information_schema.role_table_grants (grantee=anon). anon PostgREST denemeleri 0 satır/401 (bugün sızıntı yok) | Supabase varsayılan grantları geri alınmamış | Forward migration: anon/authenticated için TRUNCATE, TRIGGER, REFERENCES revoke; anon için public-vitrin dışı SELECT revoke + alter default privileges |
| B6 | Düşük | Rol-bilinçsiz tenant içi sırlar: presentations.public_token, tenants.lead_capture_token, subscriptions.iyzico_subscription_ref danışman ve çağrı merkezi tarafından okunuyor (cagri rolünde properties modülü yok) | cagri: presentations 2 satır (public_token), tenants 1 (lead_capture_token), subscriptions 1 | presentations_tenant / subscriptions_tenant_select politikaları yalnız tenant eşitliği | Modül izni ekle (properties / billing) |
| B7 | Düşük | Geçersiz tokenlı public sayfalar HTTP 200 dönüyor (soft-404) | /sunum/RASTGELE_UUID vb. → beklenen 404 → 200 + NEXT_HTTP_ERROR_FALLBACK;404; noindex var, veri yok | Next akış davranışı (notFound akış başladıktan sonra) | İzleme açısından not; istenirse kontrolü layout öncesine al |
| B8 | Bilgi | `/admin/geo/kullanim` super_admin için 404 | GET → 200 + notFound | doğrulanamadı (sayfa içi kontrol) | İşlev kontrolü |

## Doğrulanamayanlar

- branch_manager/team_lead/accounting/readonly ve platform ops/support/billing canlı testleri (hesap yok/giriş başarısız). Platform departman kapısı kod incelemesiyle: `requirePlatformModule` (`src/lib/platform.ts:184-190`) + `PLATFORM_ROLE_MODULES`; `/api/admin/personel` ofis personalarına 403 döndü.
- İki danışman arası P12: demo ofiste tek danışman var; danışmanın göremediği 5 komisyon atanmamış anlaşmalara ait. RLS fonksiyonu (`20260816000500_commission_earnings_privacy.sql`) kurala uygun görünüyor.
- Ekip/şube kapsamı (team_id/branch_id demo profillerinde boş).
- ICS akışının içerik sızıntısı: owner için pencerede randevu yok (0 VEVENT); erişim zinciri kanıtlandı, içerik adet olarak doğrulanamadı.
