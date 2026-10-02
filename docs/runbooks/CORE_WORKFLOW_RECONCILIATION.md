# Core Workflow Reconciliation

Son güncelleme: 13 Ağustos 2026

## Amaç

`20260813000000_core_workflow_invariants.sql`; kazanılmış anlaşma, komisyon,
portföy kapanışı, aktif kiralama, proje dairesi satışı ve teklif geçmişini tek
atomik modele geçirir. Geçmiş kayıtlarda eksik ilişki varsa migration bunu
tahmin ederek onarmaz; aggregate sayaçlarla durur.

Bu işlem iki fazlıdır:

1. `20260812000000_core_workflow_scaffold.sql` yalnız bağlantı kolonlarını ve
   tenant-bileşik foreign key'leri ekler. İş davranışını değiştirmez.
2. Yetkili operatör geçmiş kayıtları tenant bazında inceler ve uzlaştırır.
   Bütün blocker sayaçları sıfırlandıktan sonra invariant migration uygulanır.

## Değişmez güvenlik kuralları

- Önce geri yükleme noktası/PITR ve güncel migration ledger checksum'u doğrulanır.
- İnceleme sorguları tenant kimliği, kayıt kimliği, telefon, e-posta veya token
  loglamaz. `check:workflow-data` yalnız aggregate sayaç basar ve salt okunurdur.
- Müşteri, tutar, komisyon oranı, önceki portföy durumu veya işlem türü tahmin
  edilmez. Belge/CRM kanıtı yoksa kayıt karantinada kalır ve dağıtım yapılmaz.
- Canlı veriyi doğrudan bu runbook'taki metinden toplu güncelleyen genel SQL yoktur.
  Her düzeltme dört-göz onayıyla, tenant/kayıt kapsamı açık bir değişiklik setinde
  hazırlanır; before/after aggregate kanıtı kaydedilir.
- `non_won_commission` otomatik silinmez veya anlaşma otomatik kazanılmış yapılmaz.
  Her iki karar da finansal anlam taşır ve yetkili insan kanıtı gerektirir.
- Invariant migration sonrasında authenticated istemci komisyon ekleyemez/silemez;
  `deal_id`, tenant, brüt/KDV toplamı ve oluşturma zamanı yalnız atomik kapanış
  akışında değişebilir. Durum ve doğrulanmış split düzenlemeleri yetki kapısından geçer.
- Faz 2 bakım penceresinde uygulama/worker yazıları önce durdurulur ve açık yazma
  transaction'larının boşaldığı doğrulanır. Migration; sekiz reconciliation ledger
  tablosunu sabit sırayla `SHARE ROW EXCLUSIVE` kilitleyip kilitleri commit'e kadar
  tutar. Kilit alınamaz, deadlock/timeout oluşur veya yeni yazı gözlenirse dağıtım
  başarısız sayılır; kilit atlanmaz ve migration elle parçalara bölünmez.

## Faz 1 — scaffold

Normal migration runner, bekleyen eski migration'ları sırayla uygular ve
scaffold noktasında bilinçli olarak durur:

```powershell
npm run db:migrate
npm run check:workflow-data
```

Runner aynı çalıştırmada invariant migration'a geçmez. `--only` ile invariant
migration'ı öne almak da reddedilir.

## Sayaçların anlamı ve karar kuralı

| Sayaç | Zorunlu operatör kararı |
|---|---|
| `won_property_status_mismatch` | Anlaşmanın gerçekten kapanıp kapanmadığını ve satış/kira türünü kanıtla; portföy durumunu veya anlaşma aşamasını birlikte uzlaştır. |
| `won_missing_commission` | İmzalı sözleşme/tahsilat kaynağından net matrah, oran, KDV ve split'i doğrula; eksik komisyonu kanıtla oluştur ya da yanlış `won` aşamasını düzelt. |
| `duplicate_projected_closure_groups` | Aynı portföyü kapatan tek canonical anlaşmayı belirle; diğerlerini uygun tarihsel aşamaya al. |
| `won_invalid_financials` | Tutar ve 0'dan büyük, en çok %100, iki haneli komisyon oranını yetkili kaynaktan tamamla. |
| `won_missing_asset` | İşlemi portföy veya proje dairesine kanıtla bağla; kanıt yoksa kazanılmış bırakılamaz. |
| `active_rental_property_mismatch` | Aktif sözleşme kanıtıyla portföyü `rented` yap veya geçersiz kiralamayı sonlandır. |
| `active_rental_prev_status_missing` | Kira öncesi gerçek non-terminal portföy durumunu seç; bilinmiyorsa ürün sahibi açıkça `live` fallback kararını onaylamalıdır. |
| `duplicate_active_rental_groups` | Portföy başına tek aktif kiralamayı kanıtla; diğer sözleşmeleri doğru bitiş tarihiyle sonlandır. |
| `active_rental_deal_mismatch` | Aynı portföy, kiracı ve kiralama türündeki tek won deal'i bağla; yoksa kanıtlı rent deal oluştur. |
| `active_rental_missing_commission` | Bağlı deal için kanıtlı komisyon kaydı oluştur veya kira kapanışını düzelt. |
| `sold_unit_deal_mismatch` | Satılan proje dairesini müşteri, tutar ve tarihle tek won project-unit deal'e bağla. |
| `sold_unit_missing_commission` | Proje satışının açıkça onaylanan oranıyla komisyon kaydı oluştur. |
| `project_unit_deal_mismatch` | Ters yönü doğrula: her won project-unit deal aynı tenant'ta `sold` daireye, aynı müşteriye ve dairenin iki haneli pozitif liste tutarına birebir bağlı olmalı. |
| `countered_offer_missing_history` | Karşı teklif geçmişi tahmin edilemez; seller turu ve karşı tutarı yetkili kayıtla oluştur veya teklif durumunu kanıtla düzelt. Otomatik tur üretilmez. |
| `offer_round_projection_mismatch` | Son tur tarafına göre canonical durumu düzelt: buyer→`submitted`, seller→`countered`; accepted tutarı son turla aynı olmalı. Geçmiş tur silinmez. |
| `open_offer_invalid_financials` | `submitted`/`accepted` canonical amount ile `countered` counter_amount ve son tur tutarını 0,01–100 milyar aralığında, en çok iki ondalık haneli olacak şekilde kanıttan düzelt. |
| `non_won_commission` | Komisyon yanlışsa iptal/silme muhasebe kararı; anlaşma gerçekten kapandıysa canonical won kapanış kararı. Otomatik işlem yoktur. |

`offer_missing_initial_history` ve `active_renter_missing_tag` bilgilendirici,
deterministik onarım sayaçlarıdır. Invariant migration; submitted/accepted ve hiç
turu olmayan teklifte canonical `amount`, `created_by`, `submitted_at` ile buyer
tur 1'i oluşturur; aktif kiracının mevcut tip dizisine `Kiracı` ekler. Başka
alanı değiştirmez.

## Canlı salt-okunur ilk denetim (13 Ağustos 2026)

- Duplicate kapanış grubu: `0`; duplicate aktif kiralama grubu: `0`.
- `won` portföy durum uyumsuzluğu: `4`; eksik won komisyonu: `5`.
- Aktif kiralama: portföy uyumsuzluğu `1`, önceki durum eksik `2`, deal bağı
  uyumsuz `2`, komisyon bağı eksik `2`, kiracı tipi eksik `2`.
- Satılmış proje dairesi: deal bağı uyumsuz `4`, komisyon eksik `4`.
- Teklif: initial turu eksik `3` (ikisi gerçek submitted, biri demo accepted),
  son tur/canonical durum uyumsuz `1` (demo).
- Yeni ters project-unit deal uyumsuzluğu `0`; geçmişsiz countered teklif `0`.
- Won dışı anlaşmaya bağlı komisyon: `1` (demo; silme/promote kararı belirsiz).
- Finansal format/komisyon oranı ihlali: `0`.
- Deterministik onarımlar hariç blocker toplamı: `26`.

Deal/property/rental/project/commission sapmaları salt-okunur denetimde demo
tenant ile sınırlıydı; bu bilgi otomatik düzeltme yetkisi vermez. Demo seed yeni
kurulumda canonical ledger üretir. Mevcut canlı kayıtlar yine bu runbook'taki
kanıt ve onay sürecinden geçer.

## Faz 2 — doğrulama ve uygulama

1. `npm run check:workflow-data` çalıştır; çıkışı değişiklik kaydına ekle.
2. `CORE_WORKFLOW_BLOCKER_KEYS` içindeki bütün sayaçların `0` olduğunu doğrula.
3. Deterministik onarım sayaçları dışında beklenmeyen yeni kayıt olmadığını
   ikinci bir operatörle doğrula.
4. `npm run db:migrate -- --dry-run` ile invariant migration'ın sıradaki dosya
   olduğunu kontrol et.
5. Bakım penceresinde `npm run db:migrate` çalıştır.
6. Ardından `npm run check:workflow-data`, auth/RLS smoke, sözleşme imza, teklif
   kabul/dönüşüm, satış kapanışı, kira açma/bitirme ve proje dairesi satış smoke
   senaryolarını çalıştır.
7. Before/after sayaçları, release SHA, migration checksum ve operatör onaylarını
   incident/deploy kaydına ekle; ham PII veya bearer token ekleme.

Herhangi bir sayaç tekrar yükselirse deploy durur. Migration hatasında transaction
geri alınır; dosya değiştirilmez, yeni forward migration veya kanıtlı veri
uzlaştırması hazırlanır.
