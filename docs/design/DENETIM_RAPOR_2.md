# Denetim Raporu 2 — Oturum kodu için düşmanca kod incelemesi

Tarih: 2026-10-03 · Kapsam: son ~80 commit (menü/nav, MorphTabs, Talep ve kriterler, Ekip Merkezi, liste kiti,
içe aktarma, kayıp nedeni/aşama etiketleri, layout paralelleştirme, /fiyatlar). Yöntem: yalnız okuma; kod değiştirilmedi.
Her bulgu dosya:satır ile kanıtlanmıştır. DB'nin canlı durumu bu incelemede sorgulanmadı; `0f1c403` commit mesajına göre
Faz 2 migration paketi (özellikle `20260816000500_commission_earnings_privacy`) UYGULANMAMIŞTIR ve aşağıdaki
"kazanç gizliliği" bulguları bu varsayıma dayanır (uygulanmışsa bazıları "yanlış/eksik veri" bulgusuna döner, bkz. B6).

Ciddiyet: P0 = canlıda veri sızıntısı/yetki aşımı hemen sömürülebilir; P1 = yetki/izolasyon açığı veya veri kaybı riski;
P2 = yanlış veri, bütünlük, sessiz hata; P3 = sertleştirme/iyileştirme.

Özet: P0 yok. P1: 5 bulgu. P2: 14. P3: 9.

---

## P1 bulguları

### B1 (P1) Kazanç gizliliği (`earnings_all`) yalnız arayüz katmanında; veri yolları açık
- Kanıt: `src/lib/team/earnings-scope.ts:9` ("veritabanı tarafı (RLS) Faz 2'dedir"); `earnings_all` yalnız
  `ekip/kazanc/page.tsx:27`, `ekip/kiyas/page.tsx:46`, `ekip/[id]/page.tsx:46`, `danisman-kpi/page.tsx:150`, `komisyon/page.tsx:131` içinde okunuyor.
  `commissions_select` RLS'i hâlâ `commissions:view` sahibine tenant genelini açıyor (`20260722000016_rls_role_aware.sql`);
  gizlilik migration'ı (`20260816000500…`) uygulanmadı.
- Atlama yolları:
  1. `src/app/app/anlasmalar/[id]/page.tsx:96,104,142`: `requireModulePage("commissions")` sonrası herhangi bir `id` ile anlaşma açılır;
     aynı sayfa `deal.assigned_to` (danışman adı) ve `commissions.gross_amount/vat_amount` döndürür. Danışman başkasının anlaşma kimliğini
     (listede ofis genelini görmese bile, bkz. B2) URL'e yazarak o danışmanın brüt komisyonunu okur.
  2. `src/app/app/komisyon/page.tsx:160-166`: defter satırları (brüt, KDV, durum, anlaşma, portföy) tüm tenant için gelir; yalnız `splits` ve danışman dağılımı UI'da gizli.
     Anlaşma→danışman eşlemesi (1) ile birleşince kişi bazlı kazanç türetilir.
  3. `src/app/actions/export.ts:76-94` ve `src/lib/export-full.ts:41-50`: `branch_manager` ofis geneli kapsamdadır (`hasOfficeWideDataScope`)
     ama `earnings_all` yoktur (permissions.ts matrisi); komisyon defterini CSV olarak tüm tenant için indirir. `exportAuditCsv` (`export.ts:97-126`) da
     ofis geneli `old_value/new_value` döndürür (komisyon payı değişiklikleri audit'e düşer).
  4. `src/app/actions/ai-tenant-advisor.ts:156-160`: AI bağlamı tüm bekleyen komisyonun toplamını verir (bkz. B3).
  5. `src/app/app/hedefler/page.tsx:100-125,132`: kişi bazlı `actual_revenue` herkesin tahsil komisyonundan hesaplanır ve gösterilir; `targets` iznine sahip herkes görür.
  6. `advisor_kpis` RPC'si canlıda ciroyu maskelemiyor (maske migration'da); `ekip/kiyas` yalnız UI'da gizliyor (`kiyas/page.tsx:151`).
- Öneri: migration 05 kod incelemesi sonrası uygulanmadan önce (a) anlaşma detay sayfasında komisyon sorgusunu `seeAll || deal.assigned_to === userId` ile koşullandır,
  (b) export'ta `komisyonlar` için `canSeeAllEarnings(perms)` yoksa `deal.assigned_to = userId` uygula (hasOfficeWideDataScope yetmez),
  (c) hedefler/danisman-kpi'da gerçekleşme ciro bölümünü `includeRevenue` ile maskele, (d) RLS migration'ını ayrı bir "uygulama öncesi kontrol listesi" ile yayına al.
```ts
// export.ts exportCommissionsCsv
if (!hasOfficeWideDataScope(gate.role) || !canSeeAllEarnings(await getEffectivePermissions(gate.tenantId, gate.role, gate.userId)))
  q = q.eq("deal.assigned_to", gate.userId);
```

### B2 (P1) Satır kapsamı tutarsız: danışman ofis genelini listede görüyor, arama/dışa aktarma/anlaşma listesinde göremiyor
- Kanıt: `permission-data-scope.ts:5-7` kuralı "owner/gm/branch_manager ofis geneli, diğerleri kendi satırı". Uygulanan yerler yalnız `search.ts:90-118`,
  `export.ts`, `export-full.ts`, `anlasmalar/page.tsx` (son commit `15c379c`), `destek`. Oysa RLS politikaları tenant + modül izni ile sınırlı
  (`identity_customers_select`: `tenant_id = current_active_tenant_id() AND has_effective_permission('customers','view')`, 20260813000100:240) ve
  `musteriler/page.tsx:266`, `portfoyler/page.tsx:274`, `talepler/page.tsx:158-168`, `teklifler/page.tsx:96`, `sozlesmeler/page.tsx`
  kapsam uygulamıyor; `?assigned=`/`?danisman=` ile başkasının listesi açılıyor.
- Senaryo: danışman X `/app/musteriler` ve `/app/portfoyler`te tüm ofis kayıtlarını görür (telefon, e-posta, notlar), arama/CSV'de göremez. Kapsam "ürün kuralı" ise
  bu bir veri sızıntısıdır; değilse arama/export gereksiz kısıtlıdır. Ayrıca `anlasmalar/[id]`, `teklifler/[id]` detayları id ile kapsamsız açılır (listede gizlenen anlaşma detayda açık).
- Öneri: karar verilsin ve tek bir `rowScope(role, perms)` yardımcısı hem liste, hem detay, hem arama/export/AI'de kullanılsın; kapsam DB'de RLS ile (assigned_to = auth.uid() OR rol ofis geneli) uygulansın.
  `randevular/page.tsx:160` `YONETICI_ROLES` (team_lead dahil) ile `hasOfficeWideDataScope` farklı: tek kaynak yapılsın (B14).

### B3 (P1) AI asistan bağlamı modül izinlerini ve satır kapsamını atlıyor; `getTenantAdvisorCapabilities` ölü kod
- Kanıt: `permission-data-scope.ts:41` tanımlı, hiçbir yerde çağrılmıyor (grep). `ai-tenant-advisor.ts:95-250` `buildTenantContext` yalnız `dashboard:view` kapısıyla
  (`:473` vb.) müşteri adları ("sıcak müşteri" listesi), portföy, anlaşma değerleri, bekleyen komisyon toplamı ve görev/randevu sayılarını tenant geneli toplar.
- Senaryo: `customers:view`/`commissions:view` olmayan veya satır kapsamı dar bir rol (özel rol, `call_center`, `accounting` vb.) AI'ya "sıcak müşteriler kimler, bekleyen komisyon ne kadar" diye sorup yetkisi olmadığı veriyi alır; ayrıca ad bilgisi LLM'e gider.
- Öneri: `getTenantAdvisorCapabilities(perms)` ile her sorguyu koşullandır; `officeWide` değilse `assigned_to = userId` ekle; komisyon toplamını `canSeeAllEarnings` yoksa dışarıda bırak.

### B4 (P1) İçe aktarma geri alma: yarış, kullanıcı düzenlemesini ezme, audit yazılamazsa geri alınamama
- `import-rollback.ts:167` "zaten geri alınmış" kontrolü ile `:232` `import.rollback` yazımı arasında kilit yok: iki sekme/çift tık aynı anda geçer; yumuşak silme idempotent ama
  `:222-230` "güncelle" geri yükleme ikinci kez, arada yapılan kullanıcı düzenlemelerinin üstüne eski değeri yazar. Geri yükleme hataları (`:226`) yutulup `ok:true, restored` düşük sayıyla başarı döner.
- `import-data.ts:440` `logActivity` sonucu kontrol edilmiyor (`activity.ts:41`: hata "ana akışı bozmaz"). Audit yazılamazsa kayıtlar oluşmuş ama `created_ids` günlüğü yok: sihirbaz geri alma düğmesi gösterir, `rollbackImport` "geri alınabilir kayıt bulunamadı" der; veri temizlenemez.
- Geri alma, içe aktarmadan sonra o müşteriye bağlanan talep/anlaşma/randevuları dikkate almaz: müşteri yumuşak silinir, bağlı kayıtlar yetim kalır (`:206-217`). Talep silinirken (`:194`) gerçek hard delete.
- Senaryo: 5000 müşteri içe aktarıldı, danışmanlar 2 gün çalıştı (notlar, anlaşma), yönetici "geri al"a basar: müşteriler kaybolur, anlaşmalar müşterisiz kalır; "güncelle" ile değişmiş kayıtlar eski haline döner (günlük çalışma kaybı).
- Öneri: (a) `logActivityOrThrow` kullan; audit başarısızsa eklenen id'leri sil/işlemi hata say, (b) geri almayı `import.rollback.started` benzeri bir ön kayıt veya DB RPC (tek transaction, `batch_id` unique) ile idempotent yap,
  (c) geri almayı yalnız ilk 24-48 saatte ve "içe aktarılan kayda başka bağ yoksa" izin ver; bağlıysa liste göster, (d) restore'da `updated_at` ile "kayıt sonradan değişti mi" kontrolü yap.

### B5 (P1) `handoffMemberWorkload` yalnız müşteri+portföyü devreder; yarım devir ve yetki kapsamı
- `team.ts:404-421` iki update `Promise.all` içinde, atomik değil: biri başarısız olursa diğeri uygulanmış kalır, hata mesajı "Devir sırasında hata oluştu" der, audit yazılmaz.
- Açık anlaşma (`deals.assigned_to`), görev, randevu, açık talep sahipliği devredilmez; komisyon eşlemesi (`advisor-share.ts:55`, `deal.assigned_to`) ve satır kapsamı (B2/`anlasmalar` kapsamı) eski danışmanda kalır:
  devralan danışman devralınan müşterinin anlaşmasını anlaşma listesinde göremez; kazanç eski kişiye yazılmaya devam eder.
- Kapı `team:edit` (varsayılan owner/gm); `customers:edit`/`properties:edit` kontrol edilmiyor. `from` doğrulanmıyor (uuid/tenant), `from` bir ofis sahibi de olabilir. `from`'un pasif/aktif durumu önemsiz.
- Öneri: RPC ile tek transaction; `deals/tasks/appointments/demands`'i de dahil et (veya seçenek sun); `requirePermission("customers","edit")` + `("properties","edit")` ekle; audit'e sayılarla birlikte kısmi sonuç yaz.

---

## P2 bulguları

### B6 (P2) Faz 2 RLS uygulanırsa bu sayfalar sessizce yanlış sayı gösterir
- `ekip/kazanc/page.tsx:35-44`, `danisman-kpi/page.tsx:86-95`, `hedefler/page.tsx:106-113`, `_home/data.ts:244`, `komisyon` KPI'ları RLS'le daralacak komisyonlardan hesaplıyor;
  `earnings_all` sahibi dışındaki roller için "Tempo geride", "Kazanç" yanlış/0 görünür (migration başlığındaki "YÜKSEK ETKİ" notu). Önce bu sayfalar `SECURITY DEFINER` toplama RPC'lerine veya `earnings_all` koşullu sorguya taşınmalı.

### B7 (P2) `advisor-share.ts` payı serbest metin ad etiketiyle eşliyor
- `advisor-share.ts:48` `s.label === fullName`: aynı adlı iki danışman birbirinin payını toplar; profil adı self-update ile değişebilir
  (`identity_profiles_self_update`, 20260813000100:559) — danışman adını başkasının split etiketiyle aynı yaptığında "Kendi kazancınız" o payı gösterir (komisyonlar tenant geneli okunabildiği için, B1). Ad değişince geçmiş paylar kaybolur.
- Öneri: `commission_splits.profile_id` (Faz 2/02) bekleniyor; geçici olarak ad eşleşmesini yalnız `deal.assigned_to === userId` ile birlikte uygula.

### B8 (P2) Zaman: sunucu saatiyle ay/gün sınırları (UTC) — TR için 3 saat kayma + saf-olmayan Date
- `danisman-kpi/page.tsx:159-160`, `ekip/[id]/page.tsx:51-52` (`new Date(); setDate(1); setHours(0,0,0,0)`) Vercel UTC'de çalışır → ayın ilk 3 saati önceki aya yazılır,
  aynı ayda `ekip/kiyas` (`trMonthContext`) ve `komisyon` (İstanbul) farklı sonuç verir: ekranlar arası tutarsız sayı.
- `ai-tenant-advisor.ts:99-104,748`: "bugünkü randevu/görev" UTC günü.
- `export.ts:73,94,126` dosya adı UTC tarihi; `team.ts:413` `new Date().toISOString()` (clock kuralı).
- Öneri: `trMonthContext`/`trTodayCalendarDate` kullan; tek `trDayStartIso()` yardımcısı.

### B9 (P2) Tanımlar önbelleği: `revalidateTag(..., "max")` stale-while-revalidate → yazdıktan sonra eski değer
- `definitions.ts(actions):24-25` + `lib/definitions.ts:62-72`. Next 16 belgesi (`revalidateTag.md`): "max" profili bayat içerik sunar. Kayıt sonrası ilk gezintide eski etiket gösterilir
  (kullanıcı kaydın başarısız olduğunu sanır), yeni eklenen kayıp nedeni `validateLossReason` içinde (`loss-reason.ts:49`, `getDefinitionsOrDefault` önbellekten) "Geçersiz kayıp nedeni" verir, gizlenen neden hâlâ kabul edilir.
- Öneri: server action içinde `updateTag(...)` (anında sona erdirir); doğrulama yolunda önbelleği atlayıp doğrudan sorgula.

### B10 (P2) Layout spekülatif promise'ler yakalanmıyor
- `layout.tsx:114-120`: `specPermsPromise` `.catch`siz; claim ≠ profil olursa hiç beklenmez, reddedilirse unhandled rejection (Node ≥15 süreç uyarısı/çökmesi riski). `getOfficeScoreCached(claimedTenantId)` yetkisiz/eski claim için de çalışır (gereksiz cache doldurma, tenant anahtarı claim'den).
- Öneri: tüm spekülatif promise'lere `.catch(() => null)`; `speculationValid` olmayan dalda sonucu `void promise.catch(()=>{})` ile sönümle.

### B11 (P2) Layout her gezintide ağır sayımlar
- `layout.tsx:178` + `nav-badges.ts:101-139`: her navigasyonda `customers` ve `properties` için `count: exact` + profiles + tasks + approval sorgusu; büyük tenantta (100k müşteri) her sayfa yüklemesinde exact count taraması.
  Plan kullanım kartı ve sekme sayaçları aynı sayıları kullanıyor. Öneri: `count: "estimated"`/5 dk cache veya RPC ile birleşik sayım.

### B12 (P2) Fail-open varsayılan rol
- `require-module-page.ts:35`, `layout.tsx:146`: `profile?.role ?? "advisor"`; profil okunamazsa/silinmişse JWT'deki tenant ile advisor yetkisi verilir (`tenantId = profile?.tenant_id ?? claimedTenantId`, `:36`).
  Veri RLS'te kalır ama sayfa kabuğu ve action-dışı çağrılar açılır. Öneri: profil yoksa `/giris`'e yönlendir (fail-closed).

### B13 (P2) `updateDemand` yapılandırılmış kriterleri ezmiyor ama tutarsız bırakıyor
- `demands.ts:110-160`: düzenleme `parseDemandValues` kullanmıyor; `criteria` jsonb (olmazsa olmaz anahtarlar, ek bölgeler) güncellenmez, il/ilçe/bütçe değişince `criteria.required` artık var olmayan alanı "zorunlu" tutabilir; il-ilçe-mahalle hiyerarşisi doğrulanmıyor (`demand-criteria.ts:66-69` `ID_RE` yalnız biçim; `parseDemandValues:238-240` sütun id'leri hiç doğrulanmıyor).
- `createCustomerWithDemand` (`customer-with-demand.ts:47-54`): iki ardışık insert, çift tıkta müşteri iki kez oluşur (idempotency anahtarı yok); `type` yalnız tek alandan okunuyor, `customer_types` çoklu seçimde sahip/satıcı talebi açılabilir. Faz 2 RPC'si (`create_customer_with_demand`) uygulanana dek form tarafı `useTransition` + sunucuda `client_request_id` ile korunmalı.

### B14 (P2) "Ofis geneli" rol kümesi tek kaynaktan değil
- `permission-data-scope.ts:5` (owner, gm, branch_manager) ↔ `randevular/page.tsx:160` (owner, gm, branch_manager, team_lead) ↔ `nav-badges.ts` `isManagerRole`. team_lead randevularda ofis genelini filtreleyebilir, aramada göremez.

### B15 (P2) Eşleştirme sessiz kırpma ve hata yutma
- `match-candidates.ts:84`: `{ data }` — `error` hiç kontrol edilmiyor; sorgu hatasında boş liste "eşleşme yok" olarak döner (önizleme ve `/app/eslestirme`). `MATCH_CANDIDATE_LIMIT = 200` (`:53`) `created_at desc` ile: 200'den eski portföyler hiç eşleşmez; `previewDemandMatches` `scanned` bilgisini veriyor ama UI kırpmayı belirtmiyor (`match-preview.ts:61`).
- `match-notify.ts:23-28`: `limit(500)` sıralamasız → 500'ü aşan ofiste hangi taleplerin bildirim alacağı rastgele; hata `catch`inde `return 0` (sessiz).
- `list-search.ts:23-33`: ilişkili arama `limit(100)`; 100'den fazla "Ahmet" varsa liste sonuçları sessizce eksik.

### B16 (P2) Dashboard ve KPI taramaları sessizce kırpıyor
- `_home/data.ts:219` `deals ... .limit(100)` (sıralamasız) → toplamlar rastgele alt kümeden; `:291` `profiles limit(50)`; `danisman-kpi/page.tsx:80-95` her tablo `limit(5000)` ve tenant süzgeci yok (RLS'e güveniyor), kırpıldığında rakamlar eksik, uyarı yok; oysa `advisor_kpis` RPC'si mevcut (`kiyas` onu kullanıyor): iki sayfa aynı metrik için farklı doğruluk kaynağı.
- `ekip/kazanc/page.tsx:35-44` 2000 satır komisyon + `profiles limit(200)`; `ListLimitNotice` var ama pay hesabı kırpılmış kümeden yapılır.
- `ekip/devir/page.tsx:47-58`: 200 üyeye 200 paralel `head count` sorgusu (N+1) her yüklemede; RPC ile tek sorguya inmeli. `ekip/kiyas:75-100` 80 sorgu.

### B17 (P2) `ekip/kiyas` hedef sorgusu ve hata yönetimi
- `kiyas/page.tsx:53-70,109`: `targetsRes.error` `loadFailed`e dahil değil; ayrıca yalnız `period_start = ayın 1'i` olan aylık hedefler okunuyor (çeyreklik/yıllık veya gün farklı hedefler "Hedef yok" görünür). `deal_count` aslında kabul edilen teklif sayısı (`advisor_kpis`), arayüzde "Anlaşma" etiketli; anlaşma sayfasındaki `won` sayısıyla uyuşmaz (StatCard hedefi tutarsız).

### B18 (P2) CSV içe aktarma ham metni olduğu gibi saklıyor
- `import-data.ts:368-405`: `full_name/notes/title/address_line` formül önekli (`=`, `+`, `-`, `@`, sekme) olabilir. Dışa aktarmada `csv.ts:4-18` korur (iyi), fakat başka tüketiciler (platform-export `platform-export.ts:15` korur; ancak raporlar/yazdırma, kampanya CSV'leri, ileride xlsx) korumasızdır. `csv.ts:1` `PLAIN_NUMERIC_STRING = /^[+-]?[\d.,]+$/` "+1,2" gibi değerleri korumasız bırakır (zararsız ama kural sızdırır).
- Öneri: içe aktarmada hücre başı `=+-@\t\r` için ya reddet ya da `'` önekle (en az `full_name`, `notes`, `title`, `address_line`).
- Ayrıca içe aktarma sunucu tarafında toplam satır sınırı yok: `limitCheck` parça başına 5000 (`import-data.ts:140`, `import-config.ts` `IMPORT_ROW_LIMIT=5000`, parça 250); kötü niyetli istemci tek istekte 5000 satırı döngüyle sınırsız tekrarlar (rate limit yok). Dosya boyutu istemcide denetlenmiyor (`import-wizard.tsx:200-228` büyük dosya `ArrayBuffer`).
- `assignTo` (`import-data.ts:286-304`): `customers:create` yetkisi olan herkes içe aktarılan kayıtları ofisteki herhangi birine atayabilir.

### B19 (P2) İçe aktarma/mükerrer planı yarışı
- `import-data.ts:345-355`: önizleme ve yazma ayrı çağrılar; plan sonrası araya giren eşzamanlı kayıt/ikinci sekme aynı dosyayı yüklerse mükerrer oluşur (telefon/e-posta için DB unique yok). Parçalar sırayla ama paralel iki içe aktarmada "seen" yalnız istemcide.

---

## P3 bulguları

- B20: `vitrin/[slug]/page.tsx:140` kamuya açık arama `q.replace(/[,%()]/g," ")` — `pgrst.safeLike` yerine yarım temizleme (`.`, `:`, `*`, `"`, `\` kalıyor). Tenant süzgeci ve `.or()` AND'li olduğundan sızıntı yok; ancak `*` joker ile yavaş ILIKE ve belgedeki "tek yerde topla" kuralı çiğnenmiş. `safeLike`/`orIlike` kullan, uzunluk sınırla.
- B21: `network.ts:1105-1108` `filters.minBudget` NaN/Infinity ise `.or("budget_max.gte.NaN,...")` PostgREST hatası; `Number.isFinite` ekle.
- B22: `import-rollback.ts:161` günlük okuması `limit(2000)` ascending: çok içe aktarma yapan tenantta yeni toplu iş görünmez ("bulunamadı"). `listRecentImports` (`:72-78`) 500 satır desc, "son 30 gün" iddiası kodda yok.
- B23: `import-rollback.ts:147-174` geri alma yetkisi toplu işi yapanla sınırlı değil: `delete` izni olan herkes başkasının içe aktarmasını geri alabilir (audit'te `actor_id` karşılaştırılmıyor).
- B24: `definitions.ts(actions):140-162` `renameDefinition` aşama kategorisini ve 40 karakter sınırını kontrol etmiyor (`setStageLabel` 40, rename 120); iki aşamaya aynı ad verilebilir (aşama adı benzersizliği yok, `:282-338`).
- B25: `nav-memory.ts:75-88` depolama anahtarı kapsam yoksa `anon` (ortak tarayıcıda önceki kullanıcının sabitleri; yalnız yol, yetkiyle süzülüyor).
- B26: `lib/definitions.ts:70-72` önbellek anahtarı JWT claim'inden (`app_metadata.tenant_id`); eski claim (tenant taşıma) ile admin client okuması eski tenant tanımlarını getirir. `requireActiveTenant` ile doğrula.
- B27: `ekip/[id]/page.tsx:70,81-86` "Bu ay komisyon" brüt tutar toplamı (`gross_amount` anlaşmaya atanmış), danışman PAYI değil; etiket yanıltıcı ve `limit(500)` sessiz kırpma. `advisor-share` ile tutarlı pay göster.
- B28: `ekip/[id]/page.tsx:62-70` üye sayfası `team:view` ile açılıyor; `earnings` maskeli ama müşteri/portföy örnekleri (8'er) satır kapsamı (B2) olmadan listeleniyor.

## Doğrulanmış/Temiz bulunanlar (karşı kanıt)
- `pgrst.ts` `safeLike/orIlike/inFilter`: `%_,.():*\"` temizliyor; `inFilter` uuid desenli. `list-search.ts`'te kullanıcı girdisi buradan geçiyor: `.or()` enjeksiyonu bulunamadı.
- `rollbackImport`, `setStageLabel`, `resetStageLabel`, `definitions.ts` action'ları: tüm yazma sorguları `.eq("tenant_id", gate.tenantId)` ile kapsamlı; id UUID doğrulamalı. IDOR bulunamadı.
- `previewDemandMatches`: `requirePermission("matching","view")`, `sanitizeDemandValues`, `tenantId` açık süzgeç; yazma yok.
- `match-candidates.ts:80` `.or()` içine gömülen id'ler `UUID_LIST_RE` ile sınırlı (virgül/parantez içeremez).
- `matching.ts`/`customer_counts_by_advisor`/`advisor_kpis`: `assert_current_tenant` kullanıyor.
- `csv.ts` `escapeCsvCell`: `= + - @` ve sekme/CR öneklerini `'` ile kaçışlıyor; `export.ts`/`export-entities.ts` bunu kullanıyor.
- `nav-memory.ts`: yalnız `/app/...` yolları saklanıyor (`isNavHref`), kişisel veri yok.
- `roi-calculator.ts`: NaN/Infinity sızmıyor (`parseTrNumber`, `safe`), yüzde >100 reddediliyor.
- `audit_logs` değiştirilemez (INSERT yalnız service_role, `20260802000146`): geri alma günlüğüne istemci sahte kayıt yazamaz.
- `brandColor` `<style>` enjeksiyonu hex deseniyle sınırlı (`layout.tsx:148`).

## İncelenen dosyalar (50)
1. src/lib/list-search.ts
2. src/lib/pgrst.ts
3. src/app/actions/import-data.ts
4. src/app/actions/import-rollback.ts
5. src/lib/import-rows.ts (ilk 140 satır + yapı)
6. src/app/app/ice-aktarma/import-config.ts
7. src/app/app/ice-aktarma/import-wizard.tsx (dosya okuma ve geri alma akışı)
8. src/lib/csv.ts
9. src/app/actions/export.ts
10. src/lib/export-full.ts
11. src/lib/permission-data-scope.ts
12. src/lib/team/earnings-scope.ts
13. src/lib/team/advisor-share.ts
14. src/lib/team/scorecard.ts
15. src/lib/team/target-actuals.ts
16. src/app/app/ekip/kazanc/page.tsx
17. src/app/app/ekip/kiyas/page.tsx
18. src/app/app/ekip/[id]/page.tsx
19. src/app/app/ekip/devir/page.tsx
20. src/app/actions/team.ts (handoffMemberWorkload)
21. src/app/actions/definitions.ts
22. src/lib/definitions.ts
23. src/lib/loss-reason.ts
24. src/lib/deal-stage-labels.ts
25. src/app/actions/customer-with-demand.ts
26. src/app/actions/demands.ts
27. src/lib/demand-criteria.ts
28. src/app/actions/match-preview.ts
29. src/lib/match-candidates.ts
30. src/lib/match-notify.ts
31. src/app/app/layout.tsx
32. src/lib/nav-badges.ts
33. src/lib/nav-memory.ts
34. src/lib/roi-calculator.ts
35. src/lib/require-permission.ts
36. src/lib/require-module-page.ts
37. src/lib/billing/page-gates.ts
38. src/app/actions/search.ts
39. src/lib/activity.ts
40. src/app/app/anlasmalar/page.tsx
41. src/app/app/anlasmalar/[id]/page.tsx
42. src/app/app/komisyon/page.tsx
43. src/app/app/danisman-kpi/page.tsx
44. src/app/app/hedefler/page.tsx
45. src/app/app/_home/data.ts
46. src/app/actions/ai-tenant-advisor.ts
47. src/app/vitrin/[slug]/page.tsx
48. src/app/app/talepler/page.tsx, randevular/page.tsx, sozlesmeler/page.tsx, teklifler/page.tsx, musteriler/page.tsx, portfoyler/page.tsx (arama/kapsam bölümleri)
49. supabase/migrations/20260816000500_commission_earnings_privacy.sql
50. supabase/migrations/20260802000146_security_and_support_lifecycle_hardening.sql ve 20260813000100_rls_initplan_policy_wrapping.sql (politika kesitleri), 20260724000040/20260731000133 (RPC'ler)

Not: `MorphTabs` (`morph-tabs.ts`, `morph-tab-parts.tsx`) ve `/fiyatlar` sayfası bileşenleri (yalnız `roi-calculator.ts` mantığı) bu turda derinlemesine incelenmedi; erişilebilirlik (klavye/ARIA) taraması ayrı tur gerektirir.
