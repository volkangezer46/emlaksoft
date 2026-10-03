# Yapılandırılmış Talep, Eşleştirme ve Danışman Yönetimi (Ekip Merkezi) — İç Denetim ve Tasarım

Durum: ÖNERİ belgesi. Kod ve migration DEĞİŞTİRİLMEDİ; aşağıdaki şema taslakları yalnız öneridir.
Kaynak: yalnız depo okuması (dış araştırma `RESEARCH_TR_CRM.md` / `RESEARCH_GLOBAL_CRM.md` ayrı). Sahte metrik ve hukuki iddia yoktur.

Sahibin isteği: müşteri formunda talep/bütçe/tercih, eşleştirilebilir yapılandırılmış alanlar olsun (yalnız Not değil); ofis sahibinin altında danışmanlar, kazançları, kıyasları ve ofis sahibince ayarlanmaları olsun.

## 1. ENVANTER (koddan doğrulanan gerçek)

### A. Talep ve eşleştirme

| Konu | Durum | Gerçek / dosya |
|---|---|---|
| Talep tablosu | VAR | `customer_demands`: transaction_type, property_type, il/ilçe/mahalle (tekil), budget_min/max, rooms (text), min_sqm, urgency, status, `criteria jsonb default '{}'` — `supabase/migrations/20260721000000_init.sql:110`. Para birimi, kat, ısınma, cephe, özellik, kredi/takas, çoklu bölge sütunu YOK. |
| `criteria jsonb` kullanımı | KISMEN | Sütun var ama `createDemand` yazmıyor (`src/app/actions/demands.ts:70-84`), skorlayıcı okumuyor; `talepler/[id]/page.tsx:92` select ediyor ama chip'lerde göstermiyor. Fiilen ölü sütun. |
| Talep formu | VAR | `talepler/yeni/demand-form.tsx` + `demand-tabs.ts`: müşteri, işlem, tür, aciliyet, bütçe min/max, oda, min m², il/ilçe/mahalle. Taslak kaydı var (`DEMAND_DRAFT_FIELDS`). |
| Müşteri formu | KISMEN | `musteriler/yeni/customer-tabs.ts`: Kişi, İletişim ve bölge, Özel günler, Not. "Talep, bütçe, tercih" yalnız `notes` placeholder'ı ve sekme açıklamasıdır (`customer-form.tsx:119`): yapı yok, eşleşmez. Müşteri ve talep iki ayrı action: `createCustomer` (`actions/customers.ts:29`), `createDemand` (`actions/demands.ts:23`). Müşteri-360'tan sabit müşteriyle talep eklenebilir (`fixedCustomer`). |
| Eşleştirme motoru | VAR | `src/lib/matching.ts::scoreDemandProperty`: işlem 25 sabit (uyumsuzsa skor en çok 20), tür, bütçe (±%10 yumuşak), il/ilçe, oda (metin içerme), m². Kademeler: güçlü ≥75, iyi ≥55, zayıf ≥35. |
| Skor açıklaması | VAR | `MatchResult.reasons` (etiket, ok, ağırlık) üretiliyor. Mahalle, kat, ısınma, cephe, özellik, kredi/takas puanlanmıyor. |
| Ağırlık ayarı | VAR | `tenants.matching_weights` (budget/location/rooms/type/sqm, 75 puanlık havuza normalize): `ayarlar/matching-weights-form.tsx`, `actions/settings.ts:17`, `fetchTenantMatchingWeights`. İşlem türü ayarlanamaz. |
| "Olmazsa olmaz" kriter | YOK | Tüm kriterler yumuşak puan; tek sert süzgeç yok (işlem uyumsuzluğu hariç, o da skor tavanı). |
| Eşleştirme sayfası | VAR | `/app/eslestirme` (`?customer, demand, property, kademe, minSkor, sayfa`), müşteri portal geri bildirimi bonusu (`portal_match_feedback`), `save-match-button.tsx` → `saveMatchAndNotify` (talebi `matched` yapar, bildirim, denetim). |
| Ters eşleştirme (portföy → müşteri) | VAR | `lib/match-notify.ts::notifyMatchingDemandsForProperty` (yeni portföyde, eşik 60, ilk 500 aktif talep, ilk 3 isim), fiyat düşüşü varyantı `actions/properties.ts:75-107`; bildirim `/app/eslestirme?property=` ve yalnız portföyü ekleyen danışmana gider. Talep sahibi danışmana gitmez. |
| Eşleşme → WhatsApp → randevu akışı | KISMEN | Eşleşme satırında portföy bağlantısı var; kayıtlı bir "önerildi/gönderildi/randevu" durumu yok. Talep durumu `new/active/matched/closed`. |
| Otomasyon tetiği | VAR | `automation-engine.ts` `property_matched` olayı ve talep durum geçişleri. |
| Form içinde canlı eşleşen sayısı | YOK | Hiçbir formda sorgu yok. |
| Müşteri + talep tek işlem | YOK | İki ayrı insert, RPC yok (tek transaction örneği: `merge_customers` RPC, migration `…093`). |

### B. Danışman yönetimi

| Konu | Durum | Gerçek / dosya |
|---|---|---|
| Roller | VAR | `profiles.role`: owner, gm, branch_manager, team_lead, advisor, call_center, accounting, readonly (init:80). Davet/rol/şube: `ekip/page.tsx`, `actions/team.ts` (`createTeamMember`, `setMemberRole`, şube CRUD). |
| Profil alanları | KISMEN | profiles: ad, telefon, rol, şube, is_active. Unvan, hedef, komisyon planı, kapsam, kapasite sütunu YOK. Kartvizit/ajan profili ayrı (`ekip/kartvizitim`, `actions/agent-profile.ts`). |
| assigned_to | KISMEN | `customers.assigned_to`, `properties.assigned_to` (+`source_agent`), `deals.assigned_to`. `customer_demands`'ta YOK (sahibi müşterinin danışmanı). Görev/randevu atama alanı bu denetimde doğrulanmadı. |
| Devir / yeniden atama | VAR | `bulkAssignCustomers` (`customers.ts:248`, audit log'lu), `reassignCustomer`, `handoffMemberWorkload` (`team.ts:383`; müşteri + portföy toplu devri, `ekip/[id]/member-handoff.tsx`). Talep, görev, randevu, açık anlaşma devri YOK/doğrulanmadı. Portföy toplu atama kapsamı ayrıntılanmadı. |
| Lead otomatik atama | KISMEN | `lead-intake.ts::pickAssignee`: aktif danışmanlar arasında en az yüklü; kural ayarı, ağırlık, uygunluk (izin/mesai), SLA yok. `ayarlar/lead` yalnız yakalama paneli. |
| Komisyon hesabı | VAR | `lib/commission.ts` (saf aritmetik: oran, KDV, danışman payı varsayılan 50, stopaj girdi), `buildSplits`, `commission-cap.ts`. |
| Komisyon payları | KISMEN | `commissions.splits jsonb` (etiket + oran + tutar); `commission_splits` tablosu YOK. Satır etiketleri metindir ("Danışman" ya da ad); `cuzdan/page.tsx` payı etiket/ad eşleştirmesiyle bulur: profile_id ile bağlı değil, kırılgan. Editör: `komisyon/commission-split-editor.tsx`, `updateCommissionSplits` (`commissions.ts:16`, izin `commissions:edit`). |
| Danışman bazlı varsayılan pay/plan | YOK | `advisor_share` yalnız bir RPC parametresi/form alanı (varsayılan 50); profil veya tenant sütunu yok. Kademeli plan, danışman bazlı cap YOK. |
| Hakediş / ödeme | KISMEN | Statüler `calculated` → `paid/collected`; `markCommissionsPaidBulk`, `revertCommissionPayment` (`commissions.ts:69,125`). Bu müşteriden TAHSİLAT durumudur; danışmana ödeme (hakediş) ayrı bir durum değil. `onaylar` genel onay akışıdır. |
| Danışman cüzdanı | VAR | `/app/cuzdan`: oturum açan kullanıcının payı (tahmini/ödenen, bordro çıktısı); pay etiketle süzülüyor, `limit(1000)`. Ofis sahibinin başkasının cüzdanına bakışı yok. |
| Hedefler | KISMEN | `targets` (profile_id, dönem, hedef anlaşma/ciro, gerçekleşen sütunları; `20260723000031`), `/app/hedefler`, `actions/targets-openhouse-sources.ts`. Yalnız anlaşma ve ciro; randevu/portföy/talep hedefi yok. Gerçekleşenin doldurulma yolu doğrulanmadı. |
| Performans / kıyas | VAR | `/app/danisman-kpi` (müşteri, çağrı, randevu, teklif, anlaşma, ciro, dönüşümler, danışman bazlı gelir grafiği, koç; `advisor-coach.ts`), `/app/lig` (puan/rozet, `gamification-query.ts`, TV modu). Ayrı formüller, bilinçli (lig başlık yorumu). `danisman-kpi` profilleri `limit(50)` ile çekiyor. |
| Ekip sayfaları | VAR | `ekip` (davet, rol, şube), `ekip/[id]` (üye 360, devir), `ekip/izinler` (`staff_leaves`, onay), `ekip/kartvizitim`. |
| Yetki | VAR | `permissions.ts` DEFAULT_MATRIX, `permission_defaults`, `user_permission_overrides`, `ayarlar/roller` (matris + kullanıcı istisnası), `permission-data-scope.ts::hasOfficeWideDataScope` (owner/gm/branch_manager tüm ofis, diğerleri kendi satırı). |
| Ofis sahibi ayarları | KISMEN | `ayarlar`: firma, logo, entegrasyonlar, eşleştirme ağırlıkları, roller, tanımlar, lead, iş akışları, filigran, güvenlik. Ekip/komisyon planı/hedef/atama kuralı ayarı yok. |

## 2. BOŞLUKLAR (sahibin isteğine göre, öncelik sırasıyla)

1. Müşteri formunda yapılandırılmış talep yok; tek alan Not. Ayrı sekme ve kayıtla birlikte talep yok.
2. Talep şeması dar: çoklu bölge, para birimi, kat, ısınma, cephe, özellik, kredi/takas, "olmazsa olmaz" yok; `criteria` jsonb kullanılmıyor.
3. Motor bu alanları puanlayamaz; sert süzgeç ve alan bazlı "neden eşleşmedi" yok.
4. Form içinde canlı eşleşen portföy sayısı/önizleme yok.
5. Ters eşleştirme bildirimi yalnız portföyü ekleyen danışmana gider; talep sahibi danışmana gitmez, ilk 3 isimle sınırlı; eşleşme akışı (öner, WhatsApp, randevu) kayıtlı durum değil.
6. Danışman bazlı komisyon planı (pay, kademe, cap) yok; pay metin etiketine bağlı, `profile_id` yok. Hakediş (danışmana ödeme) durumu yok.
7. Ofis sahibine ait "Ekip Merkezi" yok: profil/hedef/plan/atama kuralı tek yerde değil; kıyas `danisman-kpi` ve `lig` içinde dağınık; ofis sahibi başkasının cüzdanını göremiyor.
8. Atama kuralları (ağırlıklı, uygunluk, SLA) ve talep/görev/randevu/anlaşma devri yok.

## 3. HEDEF TASARIM

### 3a. Yapılandırılmış Talep (müşteri ve talep girişi)

Alan grupları (tek bileşen: `StructuredDemandFields`, hem müşteri formunda hem `talepler/yeni` içinde; mükerrer form yazılmaz):

- Ne aranıyor: işlem türü (satılık/kiralık), mülk tipi (çoklu), aciliyet.
- Bütçe: min/max, para birimi (varsayılan TRY), kredi kullanır mı, takas olur mu.
- Fiziksel: oda (çoklu seçim), min/max m², kat aralığı, bina yaşı üst sınırı.
- Bölge: çoklu il/ilçe/mahalle (GeoSelect çoklu; en az ilçe).
- Özellik: ısınma, cephe, asansör/otopark/balkon vb. etiketler. Portföy `features` anahtarlarıyla AYNI sözlük (`features.heating/facade/floor/building_age` `actions/properties.ts:220-223`'te zaten kullanılıyor).
- Her kriter için "olmazsa olmaz / tercih" anahtarı (varsayılan tercih; bütçe ve işlem türü kendiliğinden olmazsa olmaz).

Müşteri formu: yeni sekme "Talep ve kriterler" (`customer-tabs.ts`'e eklenir; `form-tabs-contract.test.ts` aynı kaynağı doğrular). Müşteri türü alıcı/kiracı seçilince açılır. Mülk sahibi/satıcı seçilince sekme yerine "Portföyü ekle" yönlendirmesi (`/app/portfoyler/yeni?customer=`). "Not" sekmesi açıklaması "Serbest not" olarak düzeltilir (şu anki placeholder yanıltıcı).

Canlı önizleme: form değerleri debounce ile salt-okunur bir server action'a gider (`previewMatches`, izin `matching:view`); gerçek `properties` sorgusu + `scoreDemandProperty` ile "N portföy eşleşiyor, ilk 3" döner. Sayı tıklanınca `/app/eslestirme` filtreli hedefe gider (sıfır çıkmaz metrik kuralı). Sahte sayı yok.

Atomiklik: müşteri + talep tek istek. Seçenekler: (1) iki ardışık insert + hata durumunda telafi (basit, yarım kayıt riski); (2) tercih edilen: `create_customer_with_demand` RPC (SECURITY INVOKER, RLS korunur, tek transaction). Faz 1'de (1), Faz 2'de RPC. `createCustomer` ve `createDemand` doğrulamaları ortak fonksiyona çıkarılır. Mevcut Not metinlerinin göçü YOK.

### 3b. Eşleştirme motoru iyileştirmeleri

- Skor: mevcut ağırlık modeli korunur; `matching_weights` yeni anahtarlarla (özellik, kat) genişler, `sanitizeMatchingWeights` geriye uyumlu kalır, varsayılan ağırlıkta skor birebir aynıdır.
- Olmazsa olmaz süzgeci: işaretli kriter tutmuyorsa eşleşme "elendi"; `reasons` içine `required` alanı eklenir.
- Açıklama: `reasons` zaten var; arayüzde "neden eşleşti / neden değil" tek satırlık dökümle gösterilir.
- Ters eşleştirme: mevcut `notifyMatchingDemandsForProperty` genişler; bildirim talep sahibi danışmana (müşterinin `assigned_to`) da gider; 500 talep ve ilk 3 isim sınırı için sayfalı sorgu. İkinci bir bildirim sistemi kurulmaz.
- Akış: Öner → WhatsApp → Randevu. Faz 1'de WhatsApp bağlantısı (`whatsapp-link.ts`) ve randevu kısayolu; Faz 2'de `demand_match_events` (demand_id, property_id, skor, durum, kullanıcı, zaman).

### 3c. Ekip Merkezi (ofis sahibi)

Tek giriş: `/app/ekip` genişler (yeni sayfa açılmaz; `nav-config.ts` tek kaynak). Sekmeler: Üyeler | Danışman ayarları | Atama kuralları | Kıyas | Hakediş.

- Danışman profili (ofis sahibi düzenler): unvan, şube, hedefler, komisyon planı, görünürlük kapsamı, kapasite/uygunluk, izin/mesai (mevcut `staff_leaves`).
- Komisyon planı: ofis/danışman payı, kademeli (ciro eşiğine göre), cap (`commission-cap.ts` mevcut). Plan anlaşma anında `buildSplits`'e varsayılan olarak beslenir; elle düzenleme sürer.
- Atama kuralları: round-robin, ağırlıklı, uygunluk (aktif, izinde değil), kapasite, SLA (ilk temas süresi aşılırsa yeniden atama önerisi). Mevcut `pickAssignee` ("en az yüklü") varsayılan olarak kalır.
- Karne ve kıyas: yalnız koddaki gerçek ölçümler: dönüşüm (çağrı→randevu→teklif→anlaşma, `danisman-kpi`), aktif talep/portföy sayısı, randevu, komisyon, hedef gerçekleşme (`targets`). Ort. kapanış süresi ve gösterim sayısı: veri kaynağı Faz 1'de doğrulanmadan sütun eklenmez. Kıyas `danisman-kpi` ve `lig` verisinin birleşimidir; yeni formül uydurulmaz.
- Kazanç/hakediş: tahmini (calculated), kesinleşmiş (tahsil edildi), danışmana ödenen. Üçüncüsü bugün YOK (Faz 2 `commission_payouts`). Danışman yalnız kendi kazancını (`cuzdan`), ofis sahibi hepsini görür.
- Devir/yeniden atama: `handoffMemberWorkload` genişler (talep, görev, randevu, açık anlaşma), seçmeli toplu, zorunlu gerekçe, `logActivity` denetim kaydı.

### 3d. Veri modeli önerileri (taslak, migration YAZILMADI)

| Öneri | Tür | Not / çakışma riski |
|---|---|---|
| `customer_demands` + `currency`, `budget_includes_loan`, `swap_ok`, `max_sqm`, `floor_min/max`, `max_building_age`, `required_keys text[]` | mevcut genişletme | Faz 1'de `criteria jsonb` kullanılır (migration yok); sorgulanacak alanlar Faz 2'de sütuna çıkar. |
| `demand_locations (demand_id, province_id, district_id, neighborhood_id)` | yeni | Tekil geo sütunlarıyla mükerrerlik: tekil sütun "birincil" kalır, ek satırlar çoklu bölgedir; motor ikisini birlikte okur. |
| `demand_features` ya da `criteria.features` | jsonb (tercih) | Portföy `features` sözlüğüyle aynı anahtarlar; ayrı sözlük açılmaz. |
| `advisor_commission_plans (tenant_id, profile_id, base_share, tiers jsonb, cap_amount, valid_from)` | yeni | `commission.ts` `advisorShare` parametresine kaynak olur. `commissions.splits` satırlarına `profile_id` eklenmesi mevcut yapının genişletilmesidir (etiket eşleştirmesi biter). |
| `commission_payouts (commission_id, profile_id, amount, status, paid_at, paid_by)` | yeni | Hakediş; `commissions.status` tahsilattır, karıştırılmamalı. |
| `advisor_targets` | yeni DEĞİL | Mevcut `targets` genişler (randevu, portföy, talep hedefi). Ayrı tablo mükerrer olur. |
| `assignment_rules` | yeni / tenant jsonb | `lead-intake.ts::pickAssignee` okur; tenant jsonb sütunu daha basit olabilir. |
| `profiles` + `title`, `visibility_scope` | mevcut genişletme | `visibility_scope` yetki matrisiyle çakışmamalı: gerçek kapı `permissions.ts` ve RLS; bu yalnız veri kapsamı (kendi/şube/ofis). |
| `demand_match_events` | yeni | 3b akışı için. |

RLS ilkeleri: hepsi `tenant_id` + `public.current_tenant_id()`. `advisor_commission_plans` ve `commission_payouts` SELECT: sahibi (profile_id = auth.uid()) VEYA owner/gm/accounting. Yazma yalnız owner/gm. Yeni `service_role` kullanımı eklenmez (`admin-client-allowlist` testi); gerekirse RLS'li RPC.

### 3e. Yetki ve gizlilik (danışman kazancı hassas)

| Veri | Danışman | Takım lideri / Şube müdürü | Genel müdür / Sahip | Muhasebe |
|---|---|---|---|---|
| Kendi kazancı / cüzdan | görür | kendisi | kendisi | — |
| Başkasının kazancı | GÖRMEZ | önerilen: varsayılan görmez (sahip açabilir) | görür | görür |
| Komisyon planları | yalnız kendi planı | görmez | sahip düzenler, gm görür | görür |
| Kıyas tablosu | yalnız sayısal sıra (kazanç hariç) | ekip/şube kapsamı | tümü | gelir sütunu |
| Atama/devir | kendi kayıtları | ekip | tümü | — |

Not: `permissions.ts` matrisinde branch_manager ve team_lead için `commissions` VIEW var, yani şu an komisyonun tamamını görebilirler. Kazanç gizliliği için ayrı bir izin ya da kapsam gerekir; bu karar sahibe sorulmalı, varsayılan uygulanmamalı. Kıyas ekranları (`lig`, `danisman-kpi`) bugün `reports` modülüne bağlı; kazanç sütunları ayrı kapıya alınmalı.

## 4. AŞAMALI UYGULAMA PLANI

**Faz 1 — salt UI + mevcut şema (migration yok)**
- Müşteri formuna "Talep ve kriterler" sekmesi: mevcut `customer_demands` alanları + ek tercihler `criteria` jsonb'ye. İki action ardışık. "Not" açıklaması düzeltilir.
- Canlı eşleşen sayı/önizleme (salt-okunur action).
- Motor: `criteria.required` süzgeci, `reasons` arayüzü; ters eşleştirmede talep sahibi danışmana bildirim.
- Ekip Merkezi kabuğu: `ekip` sekmeleri; Kıyas sekmesi mevcut `danisman-kpi`/`lig` verisini yeniden kullanır (kopya hesap yok); kazanç gizlilik kapısı.
- Kabul: formdan kayıt sonrası talep `/app/talepler/[id]` ve `/app/eslestirme`'de görünür; önizleme sayısı eşleştirme sayfasıyla aynı; sözleşme testleri (form-tabs, contact-input, postgrest-embed) yeşil; yeni birim testleri: süzgeç, ağırlık geriye uyumu (varsayılan ağırlıkta skor değişmez).
- Mükerrer riski: orta (iki talep formu) — ortak `StructuredDemandFields`. Efor: 5-8 gün.

**Faz 2 — migration gerektirenler** (yalnız yedek/PITR doğrulandıktan sonra; enum ekleme ve kullanım ayrı dosya; dry-run ve ledger denetimi)
- Talep sütunları/çoklu bölge; `create_customer_with_demand` RPC; `advisor_commission_plans`; `splits` içine `profile_id`; `commission_payouts`; `targets` genişletme; atama kuralları; `demand_match_events`.
- Kabul: `npm run db:rls-audit` temiz; danışman başkasının planı/ödemesini okuyamaz testi; ledger/checksum temiz; eski splits satırları etiketle çalışmaya devam eder.
- Mükerrer riski: yüksek (geo ve splits çift kaynak) — tek okuma yardımcıları. Efor: 10-15 gün.

**Faz 3 — akış ve otomasyon**: SLA yeniden atama önerisi, eşleşme olay kaydı arayüzü, toplu devir genişlemesi (talep, görev, randevu). Efor: 5-8 gün.

## 5. BİRLEŞTİRME / TEMİZLEME ÖNERİLERİ

- `danisman-kpi` (karne), `lig` (oyun), `hedefler`, `cuzdan` (kendi kazancı), `komisyon` (ofis geneli): beş ayrı ekran; ofis sahibi bir danışmanı tek bakışta göremiyor. `ekip/[id]` üye sayfası bunların danışman bazlı toplayıcısı olmalı (hedef, KPI, kazanç, devir); sayfa yolları değişmez.
- `talepler/yeni` ve müşteri formundaki talep sekmesi tek bileşeni paylaşmalı.
- `customer_demands.criteria` ya kullanılmalı ya kaldırılmalı (ölü sütun).
- `ayarlar` içindeki eşleştirme ağırlıkları, atama kuralları ve komisyon planı "Ekip ve kurallar" altında gruplanabilir.
- Ölçek: `danisman-kpi` `profiles.limit(50)` ve cüzdan `limit(1000)` büyük ofiste sessiz keser (`ListLimitNotice` bu amaçla var).
- Doğrulanmayanlar (Faz 1 başında kontrol edilecek): görev/randevu `assigned_to`, `targets.actual_*` doldurma yolu, portföy toplu atama kapsamı, ortalama kapanış süresi kaynağı. (Faz 1B'de doğrulandı: bkz. bölüm 6.)

## 6. Doğrulama notları (Faz 1B, kod okuması)

Belgenin "doğrulanmayanlar" listesindeki dört nokta kodda kontrol edildi:

| Konu | Sonuç | Kanıt |
|---|---|---|
| Görev / randevu `assigned_to` | VAR. `tasks.assigned_to` (`20260722000022_tasks.sql:13`) ve `appointments.assigned_to` (`20260721000004_appointments.sql:19`) profiles'a bağlı; sayfalar kullanıyor (`randevular?danisman=`, `danisman-kpi` görev sayımı). Devir kapsamında YOK. | migration + `randevular/page.tsx` |
| `targets.actual_deals / actual_revenue` doldurma yolu | **YOK.** Sütunlar yalnız `20260723000031` ile tanımlı ve `scripts/seed-demo.ts` yazıyor; uygulama kodunda, RPC'de, trigger'da veya cron'da güncelleyen yer yok. Gerçek ofiste `/app/hedefler` gerçekleşmeyi hep 0 gösteriyordu. Düzeltme: gerçekleşme canlı veriden hesaplanır (`src/lib/team/target-actuals.ts`: anlaşma = kabul edilen teklif, ciro = tahsil edilmiş brüt komisyon; `advisor_kpis` ile aynı tanım). Sütunlar yerinde duruyor ama okunmuyor. | grep + hedefler sayfası |
| Portföy toplu atama kapsamı | Toplu danışman ataması YOK. `bulkUpdatePropertyStatus` yalnız durum değiştirir; `reassignProperty` tekil; portföy devri yalnız `handoffMemberWorkload` ile (üyenin TÜM aktif müşteri + portföyü, tek hedefe, seçmeli değil, gerekçesiz). Talep, görev, randevu, açık anlaşma devri yok. | `actions/bulk-property.ts`, `actions/team.ts:383` |
| Ort. kapanış süresi kaynağı | Danışman bazında YOK. Yalnız bölge/ilçe düzeyinde `avg_days_listed` (`bolge-analizi`, piyasa özeti). Karneye kapanış süresi eklenmedi; eklenecekse `deals` kapanış zamanı ve portföy yayın tarihi ile tanım ayrıca kararlaştırılmalı. | `bolge-analizi/page.tsx` |

Ek bulgular:
- `commissions.splits` payı hâlâ ad etiketine bağlı; Ekip Merkezi / Kazanç ve Cüzdanım aynı hesabı kullanır (`src/lib/team/advisor-share.ts`, eskiden cüzdana gömülüydü). Ad değişince pay eşleşmesi kırılır (kalıcı çözüm Faz 2 `profile_id`).
- Etkin izin hesabı `DEFAULT_MATRIX` (kod) + `tenant_role_permissions` + `user_permission_overrides` birleşimidir; `permission_defaults` tablosu çalışma zamanında okunmaz. Bu yüzden yeni izin anahtarı için migration olmadan kod tarafı çalışır.

## 7. Faz 1B uygulaması (Ekip Merkezi) ve Faz 2 gereksinimleri

**Yapılan (migration yok):**
- Menü: `Ekip` öğesi `Ekip Merkezi` oldu; sekmeler Genel (`/app/ekip`), Kıyas (`/app/ekip/kiyas`), Kazanç (`/app/ekip/kazanc`), Hedefler (`/app/hedefler`, eski Performans başlığından taşındı, yolu aynı), Devir / Atama (`/app/ekip/devir`). Tek kaynak `nav-config.ts`; `Danışman KPI` ve `Ekip Ligi` Performans'ta kaldı, Kıyas'tan bağlantılıdır. Sekmeli breadcrumb düzeltildi (sekme sayfası "Ayrıntı" yerine sekme adıyla görünür).
- Paket kilidi: `/app/ekip/kiyas` Profesyonel (KPI ile aynı), diğer ekip sekmeleri Ofis.
- Kıyas: danışman karnesi (müşteri, yayında portföy, randevu, teklif, anlaşma, dönüşüm, kazanç, hedef gerçekleşmesi). Sıralama ve "dikkat gerektiren" filtreleri URL'de (`?sirala=`, `?filtre=`). Sayılar filtreli hedefe gider (`musteriler?assigned=`, `portfoyler?status=live&danisman=` [yeni filtre], `randevular?danisman=`, üye sayfası). Teklif/anlaşma sayıları üye sayfasına gider: `teklifler` ve `anlasmalar` listelerinde danışman filtresi yok. Bu ay kapsamlıdır; geçmiş aylar `danisman-kpi`'de.
- Devir / Atama: üye başına iş yükü, mevcut `MemberHandoff` / `handoffMemberWorkload` yeniden kullanıldı; Kıyas satırındaki "Devret" bağlantısı ilgili üyeyi açar. Toplu müşteri atama `/app/musteriler`'e bağlıdır.
- Kazanç gizliliği: yeni izin anahtarı `earnings_all` (yalnız "view" anlamlı). Varsayılan: owner, gm, accounting. branch_manager, team_lead, advisor GÖRMEZ. Uygulandığı yerler: `danisman-kpi` (gelir sütunu, gelir grafiği, Ciro Lideri rozeti, toplam gelir), `komisyon` (danışman pay dağılımı, split etiketleri, split editörü), `ekip/[id]` (bu ay komisyon kartı), `ekip/kiyas`, `ekip/kazanc`. Kendi kazancı her zaman görünür (`/app/cuzdan` yalnız oturum sahibinin payını gösterir). Sahibi `Ayarlar > Roller` ekranında rol bazında açabilir; kullanıcı istisnası ekranıyla TEK danışman için de açılıp kapatılabilir (danışman bazlı görünürlük ayarı mevcut şemayla bu yolla yapılır).
- Danışman bazlı hedef: `Hedefler` sekmesi mevcut `targets` (profile_id) şemasıyla çalışır (anlaşma + ciro).

**Faz 2 migration / sonraki iş gereksinimleri:**
1. `permission_defaults` seed: `earnings_all` için owner (view/create/edit/delete), gm (view), accounting (view). Çalışma zamanı kodda; DB kopyası denetim uyumu içindir.
2. RLS: `commissions` SELECT bugün tenant genelinde açık; kazanç gizliliği şu an yalnız sayfa/sunucu katmanındadır. Veritabanında kapatmak için `commissions` okuma politikası (veya danışman payı için ayrı görünüm/RPC: `deal.assigned_to = auth.uid()` ya da `earnings_all`) gerekir; `advisor_kpis` RPC'si tüm danışmanların ciro sütununu döndürmeye devam eder (arayüzde gizlenir).
3. `commissions.splits` satırlarına `profile_id`, `advisor_commission_plans`, `commission_payouts` (hakediş).
4. `targets` genişletme: randevu / portföy / talep hedefi (Kıyas şu an yalnız anlaşma ve ciro hedefini gösterir). `actual_*` sütunlarının kaldırılması veya trigger ile doldurulması kararı.
5. `profiles.title`, `visibility_scope`. Takım/şube kapsamlı kıyas (team_lead, branch_manager yalnız kendi ekip/şubesi) ekip ilişkisi şeması olmadan yapılamaz.
6. Liste filtreleri: `teklifler?danisman=`, `anlasmalar?danisman=`, `talepler?danisman=` (talepler eklendiğinde Kıyas'a "aktif talep" sütunu eklenir).
7. Devir genişlemesi: talep, görev, randevu, açık anlaşma; seçmeli devir, zorunlu gerekçe (şu an tüm müşteri+portföy, gerekçesiz). Portföy toplu danışman atama aksiyonu.
8. Ortalama kapanış süresi (danışman bazlı): tanım ve veri kaynağı kararı.
9. Atama kuralları ayarı (`assignment_rules`), danışman kapasite/uygunluk.
