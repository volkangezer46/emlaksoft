# Tenant İzolasyonu Planı (createAdminClient)

Kaynak: `docs/security/ADMIN_CLIENT_INVENTORY.md` (üretilmiş) — `npx tsx scripts/audit-admin-client.ts`.
Durum notu: tarayıcı heuristiktir. "tenant filtresi var" = kaynakta `tenant_id` geçiyor, DOĞRULUK kanıtı değil.
Hiçbir adım canlı DB'de denenmedi; aşağıdaki plan önerisidir, uygulanmamıştır.

## 1. Mevcut durum (tarama çıktısı)

- 287 birim / 173 dosya. Risk: P0=0, P1=15, P2=272 (P0 sayısı, 10 birimin elle incelenmesinden sonra; bkz. `MANUAL_REVIEW` içindeki kanıtlar).
- Kapı dağılımı: platform 68, oturum-izin 69, public-token 33, dosya-düzeyi 38, cron 21, elle-doğrulandı 10, webhook-imza 3, belirsiz 45 (hepsinde tenant filtresi var/uygulanamaz; kapı çağırana bırakılmış).
- Tenant filtresiz (yok+devir): 37. Çoğu tasarım gereği (platform paneli, cron, token seçicili public sayfalar).
- RLS'li client'a taşıma adayı (oturum-izin + auth.admin/storage yok): 58 birim.

## 2. Gerçek riskler (elle okunarak doğrulananlar)

1. `src/app/actions/appointments.ts:180` `regenerateCalendarToken`: admin ile `profiles` günceller, `.eq("id", userId)` ile kendi satırı; tenant filtresi yok ama kapsam kullanıcıya bağlı. Risk düşük; admin gerekçesi (sütun yetkisi?) doğrulanmadı.
2. `src/app/app/sozlesmeler/[id]/page.tsx:71`: `contract_signers` admin ile `contract_id` üzerinden okunur; hemen öncesinde RLS'li client ile sözleşme okunup `notFound()` ile korunuyor (satır 60-66). Güvenli görünüyor; token sütunu yüzünden admin kullanılıyor.
3. Token seçicili public akışlar (`appointments-confirm.ts:34`, `owner-portal-offers.ts:37`, `contracts.ts:499`, `randevu-teyit/[token]/page.tsx:52`): kapı = token tahmin edilemezliği (uuid) + rate-limit. Token süresi/iptali ve RPC gövdelerindeki tenant kontrolü DOĞRULANMADI.
4. `src/lib/ai-advisor.ts:50`, `billing/reconciliation.ts:172`, `storage-deletion-outbox.ts:160`: kapısız lib işlevleri; çağıranları kapılı ama işlev dışarıdan yanlışlıkla çağrılırsa korumasız. Çağıran kapısı dosya düzeyinde çıkarım (kanıt zayıf).
5. `src/app/api/property-media/[id]/private/route.ts:52`: HMAC imzalı kısa ömürlü talep (`verifyShortLivedPropertyMediaClaim`) kapısı; admin download + tenant durumu kontrolü var. İmza kapsamının tenant'ı bağladığı DOĞRULANMADI.
6. 45 "kapı belirsiz" birimin çoğu lib yardımcısı; tenant filtresi var ama çağıran kapısı elle teyit edilmedi.

Bu analizde acil (ofisler arası veri sızıntısı gösteren) kesinleşmiş bir bulgu YOK; ancak "yok değil, doğrulanmadı" maddeleri 3-6.

## 3. Taşıma planı (sıralı, her adımın geri alması)

Genel ilke: bir birimi taşımadan önce (a) ilgili tablonun RLS politikalarını `npm run db:rls-audit` ile doğrula, (b) iki-tenant testini (bölüm 4) taşıma öncesi admin ile ve sonrası RLS'li client ile çalıştır. Her adım ayrı PR/commit.

| Adım | Kapsam | Yöntem | Geri alma |
|---|---|---|---|
| 0 | Kabul listesi + test (bu çalışma) | `admin-client-tenant-contract.test.ts` CI'da | Test dosyasını çıkar; kod etkisi yok |
| 1 | `belirsiz` + P1 lib işlevleri | İşlev içine açık `tenantId` parametresi + `.eq("tenant_id")` zorunlu; çağıran kapı kanıtı (ör. `requirePermission` sonucu geçirme) | `git revert` (imza değişir, çağıranlar aynı PR'da) |
| 2 | Okuma ağırlıklı oturumlu birimler (58 aday, tek tablo, auth.admin/storage yok) örn. `offers.ts`, `network.ts`, `tickets.ts` | `createAdminClient()` -> `await createClient()` (`@/lib/supabase/server`); sorgu aynı kalır | Tek satır: eski çağrıyı geri koy; kabul listesi korunur |
| 3 | Yazma yapan oturumlu birimler (`rentals`, `portal-publish`, `tenant-integrations`) | Önce RLS INSERT/UPDATE politikası WITH CHECK'i denetle; sonra taşı | Revert; politika değişikliği gerekiyorsa YENİ migration (forward-only, mevcut dosya değiştirilmez) |
| 4 | Admin'in gerçekten gerektiği yerler (auth.admin, storage, cron, platform, webhook) | Taşınmaz; kapı + filtre sözleşmesi test ile korunur | — |
| 5 | Kabul listesini daralt | Taşınan birim listeden silinir; `yok` sayısı yalnız azalabilir | Listeyi `--write` ile yeniden üret |

Taşınamayacaklar: `auth.admin` kullananlar, `storage` imzalı URL üretenler, cron/webhook/public token işlevleri (oturum yok, RLS `current_tenant_id()` boş).

## 4. İki-tenant çapraz test tasarımı

Yalnız izole test DB'de (`E2E_MUTATION_ALLOWED=true`; canlıda ASLA). Bu repoda henüz uygulanmadı.

1. Tohum: iki tenant A ve B; her birinde 1 kullanıcı (owner) ve her modül tablosundan >=1 satır (müşteri, portföy, randevu, sözleşme, bilet).
2. Her taşınan/riskli birim için: A kullanıcısı oturumuyla işlemi B'nin kayıt kimliğiyle çağır (IDOR). Beklenti: not found / yetki hatası, B verisi değişmedi.
3. Okuma sayfaları: A oturumunda liste/sayaç; B'ye ait satır sayıda ve içerikte YOK.
4. Token akışları: A'nın token'ı ile B kaynağı istenemez; süresi dolmuş/iptal token reddedilir.
5. RLS doğrudan: A JWT'siyle supabase-js ile `from(tablo).select()`; yalnız A satırları gelir (taşınan her tablo için).
6. Statik koruma: `admin-client-tenant-contract.test.ts` (yeni kullanım/filtresiz artış kırar) + `npm run db:rls-audit`.

## 5. Sınırlar

- Tarayıcı fonksiyon gövdesini düz metin olarak inceler; yardımcıya devredilen sorgu, dinamik tablo adı, `.match({tenant_id})` biçimleri kaçabilir ("devir" sınıfı).
- Global tablo tespiti migration dosyalarının regex okumasıdır; sonradan eklenen `tenant_id` farklı biçimde ise yanlış olabilir.
- RPC gövdelerinin tenant kontrolü okunmadı (doğrulanmadı).
- `scripts/` altındaki createAdminClient kullanımları kapsam dışı.
