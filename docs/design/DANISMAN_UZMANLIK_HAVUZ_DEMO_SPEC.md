# Danışman Uzmanlık, İlan Havuzu, Demo Ofis ve Kurulum Turları — Tasarım ve Uygulama Spesifikasyonu

Durum: TASARIM + migration DOSYALARI (yazıldı, CANLIYA UYGULANMADI, SQL gerçek DB'de çalıştırılmadı). Kod değişikliği yok.
Kapsam dışı (tekrar üretilmedi): piyasa taraması (`PIYASA_VE_FARK_YARATAN_OZELLIKLER.md` bu dalda MEVCUT DEĞİL, bölüm 8'deki
fark yaratan maddeler PERSONA_* ve ADVISOR_AND_MATCHING_SPEC belgelerinden çıkarıldı; piyasa belgesi gelince çapraz kontrol edilmeli).
Hukuki iddia yoktur; KVKK metinleri yalnız yer tutucudur.

## 1. Mevcut envanter (koddan/migration'dan doğrulanan)

| Konu | Durum | Kanıt |
|---|---|---|
| Danışman ekleme | VAR: sekmeli form (Kimlik: ad, telefon, e-posta, unvan; Rol; Atama/şube; Hedef; Davet) | `src/app/app/ekip/yeni/advisor-tabs.ts`, `advisor-form.tsx`, `ekip/invite-actions.ts::createAdvisor` (hesap açmayı `createTeamMember`'a devreder) |
| profiles şeması | ad, telefon, rol, şube, is_active (init); `title, bio, photo_url, specialties text[], languages text[], public_slug, is_public` (public kartvizit, `20260728000118`); `title` (tekrar) + `visibility_scope` (`20260816001000`, UYGULANMAMIŞ) | migrationlar |
| Kimlik/kişisel alan | YOK: TC, doğum tarihi, adres, acil durum, IBAN, işe giriş, yetki belgesi sütunu yok | `grep` profiles ALTER'ları |
| Mevcut `profiles.specialties text[]` | Serbest etiket, YALNIZ public kartvizit için; atamada kullanılamaz (tür/bölge/fiyat yok) | `20260728000118` |
| Faz 2 atama kuralları | `assignment_rules`, `assignment_rule_members` DOSYASI var, UYGULANMAMIŞ (strateji least_loaded/round_robin/weighted, SLA, yedek zinciri, kapasite `max_open`) | `20260816000900`, `docs/design/FAZ2_MIGRATIONS.md` |
| Lead atama | `pickAssignee`: aktif danışman/team_lead arasında en az müşterisi olan; kural, uygunluk, SLA yok. Yalnız `customers` | `src/lib/lead-intake.ts:45-86` |
| İlan atama | `properties.assigned_to` + `source_agent`; havuz kavramı YOK; `createProperty` doğrudan kaydeder | `20260721000000_init.sql:144`, `src/app/actions/properties.ts:168` |
| Tanımlar | `definitions` (tenant_id null = global, ofis override); kategoriler `DEFINITION_CATEGORIES` (11 adet); `property_type`: Daire, Villa, Müstakil ev, Arsa, İşyeri, Dükkan, Ofis, Depo, Bina; `transaction_type`: Satılık/Kiralık (sistem anahtarı). "Uzmanlık/segment" kategorisi YOK; "Lüks konut" bir property_type DEĞİL | `src/lib/definition-defaults.ts`; `category` serbest metin (`20260813000300`) |
| Coğrafya | `geo_provinces/districts/neighborhoods` (init); ilan/talep/müşteri il-ilçe-mahalle FK taşır | `20260721000000_init.sql:8-40` |
| Demo/örnek veri | `is_sample` YALNIZ customers, properties, customer_demands, tasks, appointments, deals; `tenants.sample_seeded_at`. `seedSampleData`/`clearSampleData`: 6 müşteri, 4 portföy, 3 talep, 4 görev, 2 randevu, 1 anlaşma; yalnız boş ofise; temizleme doğrudan `is_sample` filtresiyle; denetim kaydı var. Komisyon, teklif, sözleşme, kira, gider, çağrı, bildirim, danışman YOK | `20260726000086/096`, `src/app/actions/sample-data.ts`, `_home/sample-seed-button.tsx` |
| `scripts/seed-demo.ts` | Yalnız `demo-ofis` tenant'ı, tüm modüller, idempotent, `is_sample` İŞARETLEMEZ (bu yüzden "tek tuşla sil" için kullanılamaz; geliştirme/demo ortamı aracıdır) | `scripts/seed-demo.ts` |
| Kurulum sihirbazı | 6 adım: office, team, data, property, defs, portals + Bitiş; tamamlanma gerçek sayımdan, "sonra yaparım" çerezde; `is_sample=false` sayımları | `src/lib/onboarding-checklist.ts`, `onboarding-state.ts`, `baslangic/setup-wizard.tsx` (`SampleSeedButton` burada) |
| Ürün turu | TEK tur, 5 adım, ana sayfaya sabit seçiciler (`data-tour`), localStorage `emlaksoft:tour-done`, yeniden başlatma `/app?tur=1` | `src/app/app/product-tour.tsx`, `src/lib/product-tour-storage.ts`, `yardim/restart-tour-button.tsx` |
| Kayıt/provizyon | `provision_registration` RPC (atomik tenant+owner) | `20260731000140_atomic_registration_provisioning.sql` |
| Denetim/KVKK | `logActivity` (service_role ile `audit_logs`, `old_value/new_value jsonb`); `src/lib/ai/redact.ts` TC/IBAN/telefon/e-posta/kart maskeler (TC algoritma doğrulamalı); `kvkk_erasure_log`, `iys_consents` tabloları var | `src/lib/activity.ts`, `ai/redact.ts` |
| Danışman 360 | `/app/ekip/[id]`: sekmeler Genel, Aktivite, Talep(Lead), Hat(Pipeline), Hedef, Kazanç, Koç; kapı: kendi profili herkese, başkası için team modülü + ofis geneli kapsam + Ofis paketi | `ekip/[id]/page.tsx`, `tab-panels.tsx`, `advisor-view.tsx` |

### Kritik bulgular (kanıtlı)

1. **Demo ilanlar PUBLIC vitrine sızıyor.** `seedSampleData` ilanları `status:"live"` + `published_at` ile yazar; vitrin sorgusu yalnız `status='live'` süzer, `is_sample` süzmez (`src/app/vitrin/[slug]/page.tsx:72-75`; `grep is_sample` yalnız 4 dosyada geçer). Bu mevcut bir hatadır, demo genişlemeden ÖNCE kapatılmalı (P-DEMO ilk iş: vitrin/portal/sitemap/paylaşım sorgularına `is_sample=false` veya demo ilanı `draft` üret).
2. **Raporlar/KPI/dashboard `is_sample` süzmez** (yalnız onboarding sayaçları süzer). Demo modunda karışması kabul edilebilir (amaç dolu panel), ama banner ve temizleme sonrası sıfırlanma bunu açıkça belirtmeli (bölüm 5.4).
3. **Demo komisyon yok:** mevcut örnek anlaşma `negotiation`; komisyon/hakediş/kazanç ekranları boş kalır. Tam demo için kazanılmış anlaşma + komisyon gerekir (`demo-seed-invariants.ts` kuralları yeniden kullanılır).
4. **`profiles.specialties text[]` ile yeni `advisor_specialties` çakışır:** public kartvizit etiketi olarak KALIR (pazarlama metni); atama yalnız yeni tabloyu okur. Formda tek giriş: uzmanlık seçimi yeni tabloya yazar, kartvizit etiketi isteğe bağlı olarak buradan türetilir (P-UZMAN kararı).

## 2. Veri modeli kararı

**Karar: `profiles` genişletilmez; iki 1:1 tablo + iki ilişki tablosu.** Gerekçe: profiles sıcak ve geniş okunur, kullanıcıya self_update verir, public kartvizit sütunlarını taşır (sızdırma yüzeyi). Hassasiyet katmanları ayrılır:

| Tablo | İçerik | Okuma | Yazma | Migration |
|---|---|---|---|---|
| `advisor_profiles` | işe giriş/ayrılış, istihdam türü, Taşınmaz Ticareti Yetki Belgesi no + bitiş, SPK no + bitiş, kapasite (aktif ilan/talep üst sınırı), çalışma günleri/saatleri, havuza katılım, havuz duraklatma | kendisi + team:view | owner/gm | `20260816001300` |
| `advisor_private` | TC kimlik (şifreli + son 4), doğum tarihi, adres, il/ilçe, acil durum kişisi/telefon/yakınlık, banka adı, IBAN sahibi, IBAN (şifreli + son 4) | YALNIZ owner/gm + kendisi | owner/gm + kendisi | `20260816001300` |
| `advisor_specialties` | danışman × tür (kind=property_type, değer `definitions.property_type`) veya segment (kind=segment, değer `definitions.advisor_segment`) × işlem türü (Satılık/Kiralık/null=ikisi) × fiyat bandı × deneyim yılı × seviye 1-3 | tenant içi herkes | owner/gm | `20260816001400` |
| `advisor_regions` | danışman × il [× ilçe [× mahalle]] × ağırlık 1-5 (mahalle için ilçe zorunlu) | tenant içi herkes | owner/gm | `20260816001400` |

- **İzinde mi:** yeni sütun YOK; mevcut `staff_leaves` (ekip/izinler) okunur. Mesai dışı = `work_days/work_start/work_end`.
- **Uzmanlık listesi koda sabit değil:** tür için mevcut `property_type` tanımları (Arsa, Daire, Villa, İşyeri, Dükkan ...) yeniden kullanılır; "lüks konut, yatırımlık, yeni proje, kentsel dönüşüm, tarım arazisi, sanayi/lojistik, yabancıya satış" yeni `advisor_segment` tanım kategorisidir (migration global seed eder, ofis `ayarlar/tanimlar` ekranından ekler/düzenler). Kod değişikliği: `definition-defaults.ts` (`DEFINITION_CATEGORIES`, `DEFAULT_DEFINITIONS`, `SYSTEM_DEFINITION_VALUES`) — `definition-single-source-contract.test.ts` ve `definition-quality-contract.test.ts` birlikte güncellenir. "Kiralık" uzmanlığı ayrı tür değil, işlem türü boyutudur (Satılık/Kiralık sistem anahtarı).
- **Faz 2 tabloları GENİŞLETİLDİ, mükerrer yok:** `20260816001200` `assignment_rules`'a `target_kind ('lead'|'listing')`, `assign_mode (manual|semi_auto|auto|claim)`, `min_score` ekler; SLA = mevcut `sla_minutes`, yedek zincir/kapasite/ağırlık = mevcut `assignment_rule_members`. Havuz ana anahtarı `tenants.listing_pool_enabled` (varsayılan kapalı).
- **TC kimlik ve IBAN stratejisi:** DB'de yalnız uygulama katmanı AES-256-GCM şifreli metin + son 4 hane. Açık değer: DB'ye, loga, `audit_logs`'a, AI bağlamına (`redact.ts` zaten maskeler; ayrıca bu alanlar AI sorgularına HİÇ seçilmez), CSV/dışa aktarmaya varsayılan girmez. Liste: `•••••••1234`. Açma ("göster") ayrı sunucu eylemi, owner/gm veya kendisi, her açılış `logActivity` ile `advisor_pii.reveal` (alan adı, açan kişi; DEĞER YOK). Değişiklik trigger ile `advisor_private.change` (yalnız alan adları). Anahtar ortam değişkeni (ör. `ADVISOR_PII_KEY` + sürüm) gerektirir: SAHİBİN KARARI; anahtar yoksa kod TC/IBAN girişini kapatır (alan "anahtar tanımlı değil" gösterir), şema yine uygulanabilir. pgcrypto (`pgp_sym_encrypt`) bilerek seçilmedi: anahtar SQL metniyle taşınır (sorgu logu yüzeyi). TC doğrulaması `isValidTcKimlik` (ai/redact.ts) yeniden kullanılır, kopyalanmaz.
- **Telefon/e-posta kuralı:** `advisor_private.emergency_phone` ve danışman telefonu `PhoneInput` + `phoneSchema` (CLAUDE.md kontratı; `contact-input-contract.test.ts`).

## 3. İlan havuzu ve atama motoru

### 3.1 Akış
Kaynaklar: elle ekleme, içe aktarma, portal/talep formu, ağ/MLS paylaşımı, devir (`source`: manual/import/portal_form/network/api/transfer). `tenants.listing_pool_enabled=true` iken:
- Danışman kendi adına ilan ekliyorsa (assigned_to kendisi, `source=manual`) HAVUZA DÜŞMEZ (sürtünme yaratmaz; karar: "sahibin kararı" listesinde değiştirilebilir).
- Atanmamış (`assigned_to` null) veya `import/portal_form/network/api` kaynaklı ilan `listing_pool_entries(status=pending)` olur; `properties.status` enum/metnine DOKUNULMAZ (enum ADD VALUE yok). İlan havuzdayken yayın kapısı: atanana dek portal/vitrin yayını yapılamaz (P-HAVUZ, `properties` yayın eylemlerine küçük kapı).
- Atama `assign_pool_entry` RPC ile (atomik: atama + `properties.assigned_to` + olay satırı, FOR UPDATE ile yarış güvenli). Geçmiş `listing_pool_events` (created/suggested/assigned/reassigned/skipped/sla_breached/escalated; kimden-kime-puan-neden).

### 3.2 Açıklanabilir puan (0-100, saf fonksiyon, birim testli: `src/lib/pool/score.ts`)
Önce ELEME (puan değil): pasif, `accepts_pool=false`, `pool_paused_until` gelecekte, aktif izinde (`staff_leaves`), kapasite dolu (`max_active_listings`/`assignment_rule_members.max_open`), yetki belgesi süresi dolmuş (ofis ayarıyla opsiyonel: SAHİBİN KARARI). Elenen danışman "neden elendi" ile listelenir.

| Bileşen | Maks | Kural |
|---|---|---|
| Bölge | 35 | mahalle eşleşmesi 35, ilçe 24, il 10; `advisor_regions.weight` (1-5) ile ölçeklenir (35·w/5 ... en yüksek ağırlıkla tam puan); birden çok bölge varsa en yüksek |
| Tür | 20 | `property_type` eşleşmesi seviye ile (1:12, 2:16, 3:20); eşleşme yoksa 0 |
| İşlem türü | 10 | uzmanlık satırının işlem türü eşleşir veya null (ikisi) |
| Fiyat bandı | 15 | liste fiyatı bandın içinde 15; dışına her %10 sapma -3 (alt sınır 0); band boşsa nötr 8 |
| İş yükü | 10 | kapasiteye göre boşluk oranı (aktif ilan / üst sınır); sınır tanımsızsa ofis ortalamasına göre |
| Performans | 5 | yalnız son 90 gün dönüşüm (kayıtlı ilan → anlaşma), örnek az ise (n<5) nötr 2; `advisor_kpis`/mevcut KPI hesabı yeniden kullanılır, yeni formül yazılmaz |
| Müsaitlik | 5 | şimdi mesai içi 5, bugün çalışma günü ama mesai dışı 3 |

Segment (lüks konut vb.): ilanda segment alanı OLMADIĞI için v1'de segment eşleşmesi PUANLANMAZ; segmenti fiyat bandı dolaylı yakalar. İlana segment etiketi `features jsonb` ile eklenirse `kind=segment` satırlarına +bonus (v2, SAHİBİN KARARI). Kanıtsız "performans skoru" uydurulmaz; yeterli veri yoksa nötr ve "veri yetersiz" etiketi.

Çıktı: `suggestions jsonb = [{profile_id, score, reasons:[{key,label,points,max}], excluded?:{reason}}]` (kişisel veri yok), UI "Neden bu danışman: Onikişubat/X mahallesi +35, Arsa uzmanı +20 ..." dökümü gösterir. Adil dağıtım: eşit puanda (±3) son atamadan en eski olan öne geçer (`assignment_rule_members.weight` ile round-robin ağırlığı).

### 3.3 Modlar (`assignment_rules.assign_mode`, ofis sahibi ayarı)
- manual: öneriler sıralı görünür, sahip seçer.
- semi_auto: en iyi 3 öneri + tek tıkla onay (varsayılan önerilen).
- auto: en iyi puan >= `min_score` ise sistem atar (`method=auto`); altında havuzda kalır, sahibe "eşik altı" bildirimi.
- claim: `claim_open_until = now + sla_minutes`; uygun (elenmeyen) danışmanlara bildirim; ilk sahiplenen `assign_pool_entry(method='claim')` ile alır; süre dolunca yedek zincir (`fallback_order`) sırayla, sonra manual/öneri (`escalated` olayı).
- Auto/fallback/SLA taraması yeni cron `/api/cron/havuz-atama` (CRON_SECRET Bearer + `recordHeartbeat`; `vercel.json` ve cron sayısı sözleşmesi `npm run check:cron`, CLAUDE.md "27 route" ifadesi 28'e güncellenir) çalıştırır; cron service_role kullanır → `admin-client-allowlist.ts` + `scripts/audit-admin-client.ts --write` ile envanter yenilenir (kod bağlanırken denetlenir; yeni RLS'li RPC tercih edilmiş, yalnız cron için service_role gerekir).
- Havuz ayarlarının ve yeniden atamanın denetimi: `assignment_rules` değişimi `logActivity`; her atama `listing_pool_events`.
- Devir/yeniden atama: `method='reassign'` (owner/gm/branch_manager), mevcut `handoffMemberWorkload` toplu devri ile çakışmaz (o toplu, bu tek ilan; geçmiş ikisinde de tutulur).

### 3.4 Lead atamaya dönüş
`pickAssignee` bu işin kapsamı DEĞİL; ancak `target_kind='lead'` kuralları aynı tablodadır ve aynı skor çekirdeği (bölge/tür uzmanlığı) talep atamasında v2'de kullanılabilir. Faz 2 `assignment_rules` ekranı (`ayarlar/` altında, başka ajan alanı) ile havuz ayarı ekranı aynı kural satırını farklı `target_kind` ile düzenler: çakışma önlemek için havuz ayarı YENİ sayfada (`/app/havuz/ayarlar`) yapılır.

## 4. Danışman 360 ve kimlik formu
- `ekip/yeni` formuna YENİ sekmeler (advisor-tabs.ts veri odaklıdır): "Uzmanlık" (tür/segment çoklu, işlem türü, fiyat bandı, seviye), "Bölgeler" (il > ilçe > mahalle seçici, ağırlık), "Kişisel ve kimlik" (yalnız owner/gm görür), "Yetki belgeleri ve çalışma" (işe giriş, belge no/bitiş, kapasite, mesai). `ADVISOR_DRAFT_FIELDS` taslağına HASSAS alan EKLENMEZ (mevcut kural: telefon/e-posta/ad yok; TC, IBAN, adres, doğum tarihi taslağa/localStorage'a girmez). `form-tabs-contract.test.ts` yeni sekmelerle güncellenir.
- Danışman 360'a yeni sekmeler: "Profil" (iş + uzmanlık + bölge + kapasite; owner/gm düzenler), "Kimlik" (yalnız owner/gm ve kendisi; maskeli, "göster" eylemi denetimli), "Belgeler" (yetki belgesi bitiş uyarısı: 60/30/7 gün; mevcut bildirim yardımcıları). Mevcut sekmelerin (Aktivite, Hat, Hedef, Kazanç, Koç) davranışı değişmez. "Havuz" bölümü: bu danışmana atanan havuz ilanları, sahiplenme/kabul oranı, ortalama atama süresi (yalnız gerçek olay verisinden; sıfır çıkmaz kuralı: her sayı `/app/havuz?danisman=...` süzgecine bağlanır).
- Erişim: kimlik sekmesi `profile_id = auth.uid()` veya owner/gm; branch_manager/accounting kimliği GÖRMEZ (RLS zorlar; UI da gizler). Yeni modül olmadığı için 4 kayıt yeri gerekmez (team + properties modülleri yeter; permission_defaults seed gerekmez).
- Onboarding/oluşturma: `createAdvisor` mevcut akışını bozmadan sonunda `advisor_profiles`/`advisor_private`/uzmanlık/bölge yazan yeni sunucu eylemleri (yeni dosya `ekip/yeni/...-actions.ts`) çağrılır; hesap açılırken alanlar boş geçilebilir (kimlik sonradan da doldurulabilir).
- KVKK: danışman kişisel verisi için aydınlatma/rıza metni ALAN VE YER TUTUCU olarak bırakılır (metin: SAHİBİN KARARI).
- Silme/çıkış: danışman `is_active=false` olunca `advisor_profiles.left_at` doldurulur; kişisel veri saklama/silme süresi SAHİBİN KARARI (`kvkk_erasure_log` mevcut mekanizması ile bağlanabilir).

## 5. Demo ofis ("demo veriyle başla") ve tek tuşla silme

### 5.1 Paketler
`tenants.sample_pack`: `konut` (konut ağırlıklı), `ticari`, `arsa`. Her paket: 8 müşteri, 10 portföy (paket tipine göre), 6 talep, 6 görev, 5 randevu, 3 anlaşma (1 kazanılmış + komisyon + 1 teklif), 1 sözleşme, 1 kira kaydı, birkaç çağrı/gider, 3 demo danışman (uzmanlık+bölge dolu), 3-4 havuz kaydı (atama demosu için), bildirimler. Üretici mevcut `seedSampleData`'nın GENİŞLETİLMİŞ sürümüdür (mükerrer yazılmaz; `sample-data.ts` taşınır/genişler); `scripts/seed-demo.ts` ayrı kalır (dev aracı, `is_sample` yazmaz).
Gerçek geo kullanımı: ofisin il/ilçesinin gerçek `geo_*` kayıtları (örn. Kahramanmaraş/Onikişubat) seçilir; bulunamazsa konumsuz (mevcut "best-effort" deseni).

### 5.2 İşaretleme
`is_sample` mevcut 6 tabloda var; `20260816001600` ekler: commissions, offers, contracts, rentals, calls, expenses, notifications, profiles (+ `tenants.sample_pack`, `sample_cleared_at`). Demo havuz kayıtları ve alt tablolar (commission_splits, offer_rounds, listing_pool_*) FK CASCADE ile ana kayıtla gider; cascade olmayanlar temizleme sırasında açıkça silinir (uygulama aşamasında `pg_constraint` taramasıyla FK sırası doğrulanır ve test edilir; burada varsayılmaz).
**Demo danışmanlar** (`profiles.is_sample`): `auth.users` zorunlu (profiles.id FK). Geçersiz alan adlı e-posta (RFC 2606 ayrılmış `*.invalid`), rastgele parola (kimseye gösterilmez), giriş engelli (banned/oturum açılamaz). Oluşturma/silme `createAdminClient` gerektirir (yeni kullanım: allowlist + audit envanteri; SAHİBİN KARARI alt maddesi).

### 5.3 Düzenleme kararı
Kullanıcı demo kaydı düzenlerse `is_sample` TRUE KALIR (sessiz değişim kullanıcı emeğini yanlışlıkla silmez korkusuna karşı DEĞİL, tahmin edilebilirlik için); kayıt sayfasında "Demo kayıt" rozeti + "Gerçek kayıt olarak sakla" düğmesi (is_sample=false, denetim kaydı). Temizleme ön izlemesi "düzenlenmiş demo kayıtlar: N (saklamak için işaretleyin)" listeler. Alternatif (düzenleyince otomatik false) reddedildi: demo kaydı gerçek kayıtla kısmen karışır, FK/silme kuralı belirsizleşir.

### 5.4 Banner ve KPI
Her /app sayfasında küçük, kapatılabilir (oturum boyunca) "Demo veri yüklü: Gerçek kullanıma başla" şeridi (`sample_seeded_at` dolu ve `sample_cleared_at` null iken). Demo veri raporlara/KPI'a karışır (dolu panel amacı); banner bunu söyler ve temizlemede sayıların sıfırlanacağı yazar. "Demo hariç göster" seçeneği v2 (rapor sorguları ayrı iş, çakışma riski). 

### 5.5 Tek tuş: "Gerçek kullanıma başla"
Yalnız owner (gm değil: karar listesinde). Onay: ofis adını yazma, "geri alınamaz" uyarısı, ön izleme (tablo başına sayı). Sunucu eylemi (`clearSampleData` genişletilmiş): FK sırası (komisyon/teklif/sözleşme/kira/anlaşma > görev/randevu/çağrı/talep > havuz > portföy > müşteri > bildirim/gider > demo danışman auth+profiles); bağlı GERÇEK kayıt varsa (ör. gerçek görev demo müşteriye bağlı) o demo satır ATLANIR ve rapora yazılır (silinmez, `is_sample` true kalır, sonuç ekranında listelenir). `sample_seeded_at=null, sample_cleared_at=now()`. Denetim: `sample_data.clear` + silinen/atlanan sayılar. Tekrar yüklemeyi `sample_cleared_at` dolu iken engelle (gerçek kullanıma geçmiş ofis yanlışlıkla demo yüklemesin; sahibin kararı).
Atomiklik: şu an yöntem satır silmelerini ardışık çağırır (kısmi hata mümkün). Öneri: yeniden denenebilir (idempotent) tasarım; hata olursa banner kalır, tekrar basılınca kalan demo satırlar silinir. DB RPC (tek transaction) sonraki adım olarak değerlendirilir, bu pakette YAZILMADI (FK haritası doğrulanmadan blind SQL yazmamak için).

### 5.6 Demo kayıtların dış dünyaya sızmaması (kritik güvenlik)
- Demo müşteri telefonu/e-postası: e-posta `*.invalid` alan adı (RFC 2606 ayrılmış); telefon için DOĞRULANMIŞ ayrılmış bir TR aralığı BİLİNMİYOR (mevcut örnek `0532 000 01xx` ayrılmış olduğu doğrulanmadı). Bu yüzden telefon güvencesi veriye değil KOD KAPISINA bağlanır.
- Tek kapı: dış gönderim noktaları (`automation-engine.ts` send_sms/send_whatsapp/e-posta dalları, kampanya teslimi `campaign-delivery`, hatırlatma cronları `randevu-hatirlat`/`gorev-hatirlat`/`dogum-gunu`/`portal-teyit`/`vitrin-*`, `match-notify.ts`, portal token üretimi `customer_portal_tokens`, vitrin/portal yayını `portal-publish`, public vitrin sorguları) alıcı/ilan `is_sample` ise ATLAR. Mevcut pazarlama sınırı (tenant sağlayıcı + kanal bazlı geçerli rıza: `automation-messaging-boundary-contract.test.ts`) demo müşterinin rıza kaydı olmadığından zaten bloklar; ek `is_sample` kapısı ikinci katmandır. Yeni sözleşme testi: dış gönderim dosyaları `is_sample` kapısı içerir.
- Demo müşteri için `customer_portal_tokens` ve `share_links` ÜRETİLMEZ; demo ilanı `draft` üretilir veya vitrin sorgularına `is_sample=false` eklenir (bulgu 1).
- İç bildirimler (kendi ekibine zil) serbesttir; demo danışmanlara push/e-posta GİTMEZ (`*.invalid` + `is_sample` kapısı).

## 6. Kurulum sihirbazı ve tanıtım turları

### 6.1 Sihirbaz (mevcut `/app/baslangic`; `onboarding-checklist.ts` tek kaynak)
Yeni adımlar (tamamlanma gerçek veriden): `advisors` ("Danışman uzmanlık ve bölgeleri": en az bir danışmanın uzmanlık+bölgesi var mı: `advisor_specialties`/`advisor_regions` sayımı) ve başa `mode` ("Demo veriyle başla / Boş başla": paket seçimi konut/ticari/arsa). Mevcut `SampleSeedButton` ve `baslayalim.tsx` bu adımı kullanır (mükerrer buton yazılmaz). Şema yokken (migration uygulanmamış) yeni adımlar gizlenir: sayım sorgusu hata verirse adım listeden düşer (mevcut "hata verirse null" deseni; sahte ilerleme yok).

### 6.2 Modül turları (mevcut `ProductTour` motoru genişler, ikinci motor yok)
`product-tour.tsx` bugün tek sabit `STEPS`. Genişletme: `TOUR_PARAM` değerinden tur kimliği (`/app?tur=1` = genel, `?tur=musteriler`, `...=portfoy-havuz`, `eslestirme`, `randevu`, `anlasma-komisyon`, `ekip`, `raporlar`, `tv`); her tur 3-4 adım, seçiciler ilgili sayfadaki `data-tour="..."` (sayfa dosyaları başka ajanlarda: entegrasyon yalnız `data-tour` öznitelik eklemesidir, ayrı küçük PR'lar). Her tur: atlanabilir (mevcut X/Atla), yeniden başlatılabilir (`yardim` sayfasında modül listesi + `restart-tour-button.tsx` genişletilir), "görüldü" işareti tur başına (`emlaksoft:tour-done:<id>`; `product-tour-storage.ts` genişler). Bulunamayan hedef sessizce atlanır (mevcut davranış) → şema/özellik yokken tur kendiliğinden kısalır. Kurulum bitince ("Bitiş" adımı) "Sistem turuna başla" bağlantısı turları sırayla önerir. Yardım merkezi bağlantısı: her tur sonunda ilgili `yardim?sekme=` bağlantısı.

## 7. Uygulama paketleri (dosya sahipliği çakışmasız)

Dokunulmayacak (başka ajan): `src/app/admin/**`, `src/app/app/{musteriler,talepler,arama,gelen-kutusu,kampanyalar,portfoyler,projeler,acik-ev,portallar,degerleme,belgeler,ayarlar,randevular,gorevler,anlasmalar,teklifler,sozlesmeler,komisyon,giderler,aidat,kiralama,onaylar}/**`, abonelik, tema/animasyon, telefon girişi. Bu paketlerin bu alanlara tek teması `data-tour` öznitelikleri ve havuz kapısıdır (aşağıda açık).

Migration sırası (hepsi UYGULANMAMIŞ; ön koşul: Faz 2 dosyaları 02, 09 uygulanmış): 
`20260816000900` (Faz 2) > `001200` (assignment_rules ilan hedefi) > `001300` (danışman profil/kimlik) > `001400` (uzmanlık/bölge) > `001500` (havuz) > `001600` (demo bayrakları). 001300/001400/001600 birbirinden bağımsız, 001500 yalnız 000900+001200'ye bağlı.

| Paket | Kapsam | Sahip olduğu yeni yol/dosyalar | Mevcut dosyaya entegrasyon (küçük) | Migration | Şema yokken |
|---|---|---|---|---|---|
| P-MIGRATION | 5 migration + rollback dosyaları (HAZIR), `faz3-migrations-contract.test.ts` (rollback varlığı, RLS, anon kapalı, ADD VALUE yok, DEFINER `search_path` boş), `docs/design/FAZ3_MIGRATIONS.md` uygulama listesi, `db:rls-audit` | `supabase/**`, ilgili test, doküman | yok | tümü | n/a |
| P-UZMAN | Danışman iş profili, kimlik, uzmanlık, bölge, belge; form sekmeleri; 360 sekmeleri; PII şifreleme yardımcıları | `src/lib/advisor/{pii-crypto,advisor-profile,score-inputs}.ts`, `src/app/app/ekip/yeni/{uzmanlik-tab,bolge-tab,kimlik-tab,advisor-extra-actions}.ts(x)`, `src/app/app/ekip/[id]/{profil-tab,kimlik-tab,belge-tab}.tsx` | `advisor-tabs.ts` (sekme ekle), `advisor-form.tsx`, `tab-panels.tsx`/`advisor-view.tsx` (sekme kaydı), `definition-defaults.ts` (+testler) | 001300, 001400 | Sunucu eylemleri/sayfalar `to_regclass`/boş sonuç yerine ilk sorgu hatasında "bu özellik henüz etkin değil" boş durumu; sekmeler gizli; mevcut form aynen çalışır |
| P-HAVUZ | Havuz sayfası, öneri paneli, atama eylemleri, ayar, cron, bildirim | `src/app/app/havuz/{page,pool-board,suggestion-panel,assign-actions,ayarlar/*}`, `src/lib/pool/{score,suggest,enqueue,types}.ts`, `src/app/api/cron/havuz-atama/route.ts` | `src/lib/nav-config.ts` (Portföy grubuna "İlan havuzu"), `src/lib/billing/page-gates.ts`, `vercel.json`, `admin-client-allowlist.ts`; `properties.ts::createProperty` sonuna `enqueueToPool()` çağrısı (portfoyler alanı: TEK SATIR entegrasyon, ilgili ajan sonrası) | 001200, 001500 (+001400 öneri için, yoksa puan yalnız iş yükü) | `listing_pool_enabled` okunamazsa havuz kapalı sayılır; nav öğesi gizlenir; `createProperty` aynen çalışır |
| P-DEMO | Demo üretici, banner, ön izleme + tek tuş silme, sızıntı kapıları, vitrin düzeltmesi | `src/lib/sample/{packs/konut,ticari,arsa,builders,clear-order,guards}.ts`, `src/app/actions/sample-data.ts` (genişler/sahiplik bu pakette), `src/app/app/_demo/{demo-banner,start-real-dialog}.tsx` | `src/app/app/layout.tsx` (banner yerleşimi), `_home/sample-seed-button.tsx`, dış gönderim dosyalarına `is_sample` kapısı (automation-engine, match-notify, cron/*: her biri tek koşul), vitrin sorguları (`src/app/vitrin/**`: `is_sample=false`) | 001600 (+001400/001500 demo danışman/havuz için) | Yeni sütun yoksa üretici yalnız mevcut 6 tabloyu yazar (bugünkü davranış), banner yalnız `sample_seeded_at` ile çalışır |
| P-TUR | Sihirbaz adımları (advisors, mode), modül turları, yardım bağlantıları | `src/lib/tours/{registry,steps/*}.ts`, `src/app/app/baslangic/{advisors-step,mode-step}.tsx` | `product-tour.tsx`, `product-tour-storage.ts`, `onboarding-checklist.ts`, `onboarding-state.ts`, `setup-wizard.tsx`, `yardim/*` ; ilgili sayfalarda yalnız `data-tour` | 001400/001600 (adım sayımları) | Sayım hatasında adım düşer; bulunamayan hedefli tur adımı atlanır |

Bağımlılık sırası önerisi: P-MIGRATION > (P-UZMAN, P-DEMO paralel) > P-HAVUZ (uzmanlık verisine) > P-TUR (son, hedefler oluştuktan sonra). `onboarding-checklist.ts`, `product-tour.tsx`, `layout.tsx`, `nav-config.ts` ortak dosyalardır: her biri TEK pakete aittir (checklist/tour: P-TUR; layout banner: P-DEMO; nav-config: P-HAVUZ; sıralı birleştirme).

Kabul kriterleri (özet): 
- P-UZMAN: owner kimlik formunu doldurur; advisor başka danışmanın `advisor_private` satırını okuyamaz (RLS testi); liste son 4 hane; `audit_logs` değer içermez; TC geçersizse reddedilir; anahtar yoksa alan kapalı.
- P-HAVUZ: havuz açıkken import edilen ilan pending olur; öneri puan dökümü toplamı=skor; iki kullanıcı aynı anda sahiplenirse biri hata alır; auto eşik altı bekler; SLA dolunca yedek zincir; tenant çapraz erişim RPC'de reddedilir; cron heartbeat yazar.
- P-DEMO: paket yüklenince tüm modüllerde veri; vitrin/portal/dış gönderimde demo görünmez/gitmez (sözleşme testi); "Gerçek kullanıma başla" ofis adı olmadan çalışmaz, gerçek bağlı kayıt atlanır ve raporlanır, denetim kaydı yazılır, tekrar basılabilir (idempotent).
- P-TUR: her tur atlanır/yeniden başlar, mobilde çalışır, hedef yoksa kırılmaz.

## 8. Ofis sahibi / danışman / müşteri açısından fark yaratanlar (bu kapsamla ilgili olanlar)
Yalnız bu belgenin altyapısına doğrudan bağlı olanlar (diğerleri PERSONA_* belgelerinde): (1) "Neden bu danışman" açıklamalı atama dökümü: sahip için şeffaf adalet, danışman için itiraz edilebilir kural (2) yetki belgesi bitiş uyarıları (ruhsat/belge takibi PERSONA_OFIS_SAHIBI İ8 ile uyumlu) (3) havuz SLA'sı: gelen ilan/talep sahipsiz kalmaz (kayıp-kaçak kalkanı İ4 ile aynı dil) (4) demo veriyle ilk dakikada dolu panel + tek tuş temizlik (5) modül turları (6) müşteri tarafı: doğru bölge uzmanına yönlenme, daha kısa ilk yanıt süresi (ölçülebilir: havuza düşüş-atama süresi, `listing_pool_events` verisi). Rakip karşılaştırma iddiası YAPILMADI (piyasa belgesi bu dalda yok).

## 9. SAHİBİN KARARI GEREKENLER
1. **PII şifreleme anahtarı** (`ADVISOR_PII_KEY` + sürüm; Vercel ortam değişkeni; kaybı = TC/IBAN geri alınamaz; döndürme/`enc_key_version` politikası). Alternatif: TC/IBAN hiç saklanmasın (yalnız son 4) veya şifresiz-RLS. Anahtar kararı verilene dek TC/IBAN girişi kapalı kalır.
2. **KVKK:** danışman kişisel verisi için aydınlatma/açık rıza metni, saklama/silme süreleri, çıkan danışmanın verisi (metin ve süre sahibin/hukukçunun; kodda yalnız alan ve yer tutucu).
3. **Migration uygulama sırası ve zamanı:** önce Faz 2 (000200, 000900) + yedek/PITR doğrulaması; sonra 001200 > 001300 > 001400 > 001500 > 001600; her adımdan sonra `db:rls-audit`. Faz 2'nin 05 (kazanç gizliliği) kararı bu işten bağımsızdır.
4. Havuz varsayılan modu (öneri: semi_auto), `min_score` eşiği (öneri 70), claim süresi, danışmanın kendi eklediği ilanın havuza düşmemesi kuralı, belgesi süresi dolmuş danışmanın elenmesi.
5. "Gerçek kullanıma başla" yetkisi (yalnız owner mu, gm de mi), tekrar demo yüklemeye izin.
6. Demo danışmanlar için `auth.users` oluşturma (yeni `createAdminClient` kullanımı + allowlist) kabulü; aksi halde demo danışmansız (yalnız sahip adına) paket.
7. Yeni cron (`havuz-atama`) ve paket kilidi: havuz hangi pakette (öneri: Ofis).
8. Segment alanının ilana eklenmesi (v2) ve "demo hariç göster" raporları (v2).

## 10. Doğrulama durumu
Yapılan: mevcut dosya/migration okuması, tablo/tenant_id varlık kontrolü, `on delete set null (col)` sözdiziminin repoda kullanıldığının doğrulanması, uyumlu mevcut unique indeksler (`idx_profiles_id_tenant_unique`, `idx_properties_id_tenant_unique`). YAPILMADI: SQL'i DB'de çalıştırma, `npm run check:migrations`/test (node_modules yok, `npm ci` istenmedi). İlk çalıştırma: izole test DB, sonra `check:migrations -- --database`, `db:migrate -- --dry-run`, `db:rls-audit`.
