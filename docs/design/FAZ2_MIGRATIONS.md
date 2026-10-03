# Faz 2 Migration Paketi (Danışman Yönetimi ve Talep)

Kaynak: `ADVISOR_AND_MATCHING_SPEC.md` bölüm 3d, 6, 7. Durum: DOSYALAR YAZILDI, CANLIYA UYGULANMADI.
Politika: forward-only; her dosyanın `supabase/rollbacks/<ad>.rollback.sql` karşılığı var (rollback runner'a
bağlı DEĞİL, elle/kontrollü çalıştırılır). Uygulama: yalnız sahibi, `npm run db:migrate` ile.

## Sıra ve bağımlılık

| # | Dosya (supabase/migrations) | Ne | Bağımlı olduğu | Risk |
|---|---|---|---|---|
| 01 | `20260816000100_earnings_all_permission_defaults` | `earnings_all` seed (owner tam, gm/accounting view) | yok | düşük |
| 02 | `20260816000200_commission_splits` | `commission_splits` (profile_id'li pay satırları) + `faz2_touch_updated_at()` | commissions, profiles | düşük |
| 03 | `20260816000300_advisor_commission_plans` | kademe/cap/ofis-referans-franchise payı, geçerlilik | 02 (trigger fonksiyonu) | düşük |
| 04 | `20260816000400_commission_payouts` | hakediş: durum, onay, ödeme, denetim trigger'ı | 02 | orta-düşük |
| 05 | `20260816000500_commission_earnings_privacy` | `commissions` SELECT RLS + `advisor_kpis` ciro maskesi | 01, 02 | YÜKSEK ETKİ (davranış) |
| 06 | `20260816000600_customer_demand_structured_columns` | talep ek sütunları (döviz, kredi, takas, kat, bina yaşı, zorunlu anahtarlar) | yok | düşük |
| 07 | `20260816000700_create_customer_with_demand_rpc` | `create_customer_with_demand` (SECURITY INVOKER) | 06 | düşük |
| 08 | `20260816000800_targets_activity_goals` | `targets` randevu/portföy/talep hedefi | yok | çok düşük |
| 09 | `20260816000900_assignment_rules` | `assignment_rules` + `assignment_rule_members` | 02 (trigger fonksiyonu) | düşük |
| 10 | `20260816001000_profiles_title_visibility_scope` | `profiles.title`, `visibility_scope` + kapsam guard trigger'ı | yok | düşük |

Enum `ADD VALUE` kullanılmadı (hepsi text + CHECK). Dosyalar bağımsız küçük adımlardır; 05 hariç hepsi
additive ve kod bağlanana dek etkisizdir. Uygulama sırası numaradır; aralarında durup doğrulama yapılabilir
(ör. 01-04 bir paket, 05 ayrı pencere, 06-07, 08-10).

## Tasarım kararları (belge önerisine göre)

- `commission_splits`: jsonb'ye `profile_id` eklemek DB'de FK/RLS sağlamaz; yeni tablo seçildi. **Backfill yok.**
  `commissions.splits` jsonb legacy okuma yedeği kalır; kod çift yazıma geçince tablo dolar. Mükerrer tablo değildir
  (bugün yok). `profile_id` FK'sı `ON DELETE RESTRICT`: payı olan profil silinemez (para izi), pasifleştirme kullanılmalı.
- `advisor_targets` AÇILMADI; `targets` genişledi. `demand_features` tablosu AÇILMADI (criteria.features jsonb);
  `demand_locations` ve `demand_match_events` bu pakette YOK (ayrı karar/iş).
- `assignment_rules`: tenant jsonb yerine FK'li iki küçük tablo (ağırlık, yedek zinciri, kapasite için).
- Plan/hakediş yazma yalnız owner/gm (belge 3d). Muhasebenin hakediş ödeme işaretlemesi gerekiyorsa ayrı karar.
- Çakışan plan aralığı için exclusion constraint yok (`btree_gist` gerektirir); uygulama katmanı çözer.
- Yeni `service_role`/`createAdminClient` kullanımı EKLENMEDİ; yeni RLS'li tablolar kullanıcı client'ıyla çalışır.

## Uygulama öncesi kontrol listesi (sahibi)

1. Restore edilebilir backup / PITR doğrula (Supabase paneli, restore noktası zaman damgası not et).
2. `npm run check:migrations` (statik) ve `npm run check:migrations -- --database` (ledger/checksum drift yok).
3. `npm run db:migrate -- --dry-run` (salt-okunur önizleme; yalnız bu 10 dosya bekliyor olmalı).
4. `npm run test` ve `npm run type-check` yeşil (özellikle `faz2-migrations-contract.test.ts`).
5. 05 için ayrıca: aşağıdaki "05 etki taraması" yapıldı mı? Evet değilse 05'i atla, 01-04 ve 06-10'u uygula.
6. Uygula: `npm run db:migrate` (ledger drift varsa DUR). Ardından `npm run db:rls-audit` (yeni tablolar RLS'li, politikalı).
7. Smoke: danışman hesabıyla `/app/cuzdan`, owner ile `/app/komisyon`, `/app/danisman-kpi`.

### 05 etki taraması (uygulamadan önce)
05 sonrası branch_manager/team_lead/advisor user-client ile `commissions` okuyan HER yerde yalnız kendi satırlarını görür.
Tara: `komisyon` sayfası ve toplamları, dashboard/rapor komisyon kartları, `ekip/[id]` bu ay kartı, `cuzdan`,
dışa aktarma, `payment_links` ilişkili sorgular. Bu roller için daralma kabul edilmiyorsa ilgili ekranı admin/RPC
yoluna taşıyan kod önce yayınlanmalı (yeni service_role kullanımı allowlist ve audit gerektirir). `advisor_kpis`
`revenue` sütunu yetkisizlere 0 döner; `Ciro Lideri`/ciro sıralaması bu roller için anlamsız olur (UI zaten gizli).

## Hangi kod değişikliği hangi migration sonrası açılır

| Kod değişikliği | Şu migration uygulanmadan AÇILMAZ |
|---|---|
| Kazanç sütunları/pay editörü için `commission_splits` çift yazım, `profile_id` ile pay eşleme (etiket eşleşmesini bitirme) | 02 |
| Danışman plan ekranı, `advisorShare`'in plandan beslenmesi, kademe/cap hesabı | 03 |
| Hakediş ekranı, "ödemeye hazır" listeleri, ödeme/onay aksiyonları | 02 + 04 |
| Kazanç gizliliğinin DB tarafından zorlandığına güvenen kod (UI'daki ek filtreleri kaldırma) | 01 + 02 + 05 |
| Yapılandırılmış talep alanlarının (döviz, kredi, takas, kat, bina yaşı, zorunlu anahtarlar) yazılması/süzülmesi/eşleştirmesi | 06 |
| Müşteri + talep tek adımlı ekleme formu (`create_customer_with_demand` çağrısı) | 06 + 07 |
| Hedefler ekranında randevu/portföy/talep hedefi | 08 |
| Atama kuralları ekranı, `pickAssignee`'nin kuralları okuması | 09 |
| Profilde unvan, veri kapsamı seçimi ve kapsama göre listeleme | 10 |

Kural: şema uygulanmadan ilgili özellik kodu birleştirilmez (PostgREST var olmayan sütun/tablo için hata verir, liste boş kalır).
`src` içinde üretilmiş bir DB tip dosyası bulunmadığı için tip/şema kaydı güncellemesi gerekmedi.

## Geri alma

Her dosyanın rollback'i yukarıdan aşağıya TERS sırayla (10 -> 01) çalıştırılır; her rollback dosyasının başında
hangi veriyi sildiği ve hangi koddan önce kapatılması gerektiği yazar. 05 geri alınınca eski politika ve eski
`advisor_kpis` gövdesi dönmüş olur. Rollback dosyaları ledger'a yazılmaz; geri alma sonrası ilgili migration
dosyasını silmek YASAK (forward-only): düzeltme yeni migration olarak eklenir.

## Doğrulama kapsamı (bu pakette yapılan)

Statik: `npm run check:migrations`, `src/lib/faz2-migrations-contract.test.ts` (rollback varlığı, RLS/tenant politikası,
anon kapalı, imza korunumu, SECURITY INVOKER, ADD VALUE yok). SQL sözdizimi gerçek bir DB'de ÇALIŞTIRILMADI; ilk
çalıştırma yukarıdaki dry-run/yedekli adımda olur. Önerilen: izole test DB'de önce uygula, `npm run db:rls-audit` çalıştır.
