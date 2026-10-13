# Portal form kuralları (öğrenen eklenti 0.6.0): anahtar, yayın, geri alma, acil durum

Eklentinin "EmlakSoft'tan doldur" eşleştirmesi iki parçadır: **motor pakette** (eşleme `fill-plan.ts`/`rules-engine.ts`, güvenlik tabanı, kapalı alan
kümesi `FILL_FIELD_KEYS`, doğrulayıcı `rule-format.ts`, imza doğrulayıcı ve açık anahtarlar `rule-keys.ts`, pakete gömülü TOHUM `seed-rules.ts`),
**kurallar veride** (`portal_rule_sets`; etiket eş anlamlıları, seçenek takma adları, alan durumu/güveni, form parametreleri, form parmak izleri — regex,
seçici, URL, betik YOK). Kural değişikliği mağaza incelemesi gerektirmez; motor ya da format değişirse yeni paket gerekir
(`ILAN_KONTROL_EKLENTI_YAYIN.md` §8).

Akış: EmlakSoft sayfasındaki içerik betiği `GET /api/app/portal-aktar/kurallar?engine=f1` (aynı köken + köprü başlığı + oturum + `portals/view` +
`x-emlaksoft-ext ≥ 0.6.0`) → arka plan her zarfı sırayla doğrular (boyut → şema → format → portal → `minExtension` → süre → sürüm ileri mi → sha → imza)
→ kabul edilen set "son iyi sürüm" olur; herhangi bir adım başarısızsa eski set kalır, o da yoksa tohum kullanılır. İmza **yayın anında** üretilir ve
satıra yazılır; GET ucu özel anahtarı yüklemez. Yönetim: `/admin/sistem?sekme=portal-kurallari` (super_admin/ops; yayın ve geri alma super_admin).

## 1. Anahtar üretimi ve yerleştirme (paket derlenmeden ÖNCE)

1. `npx tsx scripts/gen-portal-rules-keypair.ts k1` — çıktı YALNIZ ekrana basılır (dosyaya/ortama yazılmaz). Çıktıyı sohbet, kayıt ya da depoya koyma.
2. **Özel anahtar → sunucu ortamı** (sahip): `.env.production` içine `PORTAL_RULES_SIGNING_KID=k1` ve `PORTAL_RULES_SIGNING_KEY="-----BEGIN PRIVATE KEY-----\n…"`
   (PKCS8 PEM, satır sonları `\n` kaçışlı). Veritabanına hiç girmez. Uygulama yeniden başlatılınca yayın/imzalama açılır.
3. **Açık JWK → `src/lib/portal-transfer/rule-keys.ts`**: `RULE_PUBLIC_KEYS = { "k1": { kty, crv, x, y } }` olarak yapıştır, commit et. Bu dosya eklenti
   paketine gömülür; boşken eklenti her uzak seti reddeder (tohumda kalır) ve `build-extension.ts --release` HATA verir.
4. Sıra zorunludur: anahtar üret → env → `rule-keys.ts` → deploy → tohum yayını → `--release` paket → mağaza. Paket anahtarsız çıkarsa sonradan anahtar eklemek
   YENİ mağaza incelemesi ister.

**Anahtar değişimi (rotasyon):** yeni kid üret (`k2`), açık anahtarını `RULE_PUBLIC_KEYS`'e EKLE (eskisini silme), yeni paketi mağazaya gönder; paket
kullanıcılara yayıldıktan sonra sunucu env'ini `k2`'ye çevir (yeni yayınlar `k2` ile imzalanır, eski satırlar `k1` imzasıyla geçerli kalır). Eski kid en az
bir paket sürümü boyunca listede tutulur, sonraki pakette çıkarılır. Özel anahtar sızdıysa sıra şudur (§7.3): önce sızmamış/yeni anahtarla tohum
içerikli geri alma (max+1) yayınla, SONRA sızan özel anahtarı env'den kaldır ve sızan kid'i `rule-keys.ts`'ten çıkarıp sunucuyu yeniden dağıt; yeni kid
ile hızlandırılmış paket gönder. Env'den kaldırmak yalnız YENİ yayını durdurur; uç saklı imzalı setleri sunmaya devam eder.

## 2. Tohum yayını (ilk kurulum)

- Önkoşul: P1 migration'ları canlıda (`20261013002000_portal_rules_core` → `002010_portal_rules_rpcs` → `002020_portal_rules_learn`), uygulama deploy, env dolu.
- `/admin/sistem?sekme=portal-kurallari` → portal seç → **"Tohumu yayınla (sürüm 1)"** (yalnız hiç set yoksa görünür; `seed-rules.ts` içeriği, sürüm 1, imzalı).
  Üç portal için ayrı ayrı yapılır.
- Doğrulama: paketlenmemiş eklentiyle EmlakSoft sayfasını aç → açılır pencerede kural sürümü 1; geliştirici araçlarında `es_form_rules_meta.lastRejectReason` boş.

## 3. Öneri onayı ve sürüm akışı

- Ofislerin (yalnız açık rızayla) "Yayından önce kontrol et" / "EmlakSoft'a bağla" düzeltmeleri gece `operational-retention` cron'unda `pt_rules_learn` ile
  sayılır (ofis başına tek oy, Wilson alt sınırı). Eşiği dolan öneri **"ready"** olur.
- **İlk yayında onay yolu personeldir** (`portal_rules.auto_publish=false`): Bekleyen öneriler panelinde kanıtı (ofis/oturum/hafta sayısı; kiracı adı yok) incele,
  **Onayla** → yayındaki içerik + öneri `applyProposals` + `validateRuleSet`'ten geçer, yeni sürüm (max+1) imzalanıp yayınlanır. Bozuk sonuç yayına GİRMEZ.
  **Reddet** gerekçe ister.
- Tek ofisten gelen etiket/seçenek metni tüm ofislere gider: `support_tenants < 2` iken etiket/seçenek önerisini onaylama (kişisel veri riski; eleştirmen Y2).
- Riskli alanlar (fiyat, para birimi, tapu durumu, krediye uygunluk, takas, EİDS, kimden) yalnız personel kaynağıyla değişir; doğrulanmış eşlemeden silme yapılmaz.
- AI önerisi ("AI önerisi üret", portal başına 10 dk'da 1): girdi yalnız en az `ai_min_tenants` ofiste görülen eşleşmemiş alanların etiket/tür/seçenekleri;
  OpenAI'ye `openai-client.ts` üzerinden maskelenerek gider. Öneri "doğrulanmamış" girer, ofis oyları olmadan "verified" olmaz.

## 4. Eşik ayarları (platform ayarları; `src/lib/settings/registry/platform.ts`)

| Anahtar | Varsayılan | Not |
| --- | --- | --- |
| `portal_rules.min_tenants` | 3 | Otomatik doğrulama için destekleyen uygun ofis sayısı. Bugün uygun gerçek ofis sayısı az; düşürme, personel onayıyla ilerle. |
| `portal_rules.min_sessions` | 6 | Yayınlanmış oturum sayısı (ayrıca ≥2 takvim haftası, son 14 günde 0 karşı oy). |
| `portal_rules.auto_publish` | kapalı | Açılmadan önce en az 3 uygun gerçek ofis ve birkaç haftalık temiz geçmiş beklenir. |
| `portal_rules.auto_degrade` | ilk aşamada KAPALI tutulur | Açıksa yalnız uygun ofislerin hata oranıyla alan "kontrol edin" durumuna iner; her otomatik yayın personele görünür. |
| `portal_rules.ai_min_tenants` | 2 | **2'nin altına İNDİRİLMEZ**: gizlilik metni "en az iki ofiste görülen" der (`/gizlilik` bölüm 6). |

## 5. Test/demo kiracı dışlama

Ofis uygunluğu panelinde (kiracı adı yalnız burada) **E2E Test Ofis**, **Demo Emlak Ofisi** ve **admin** kiracılarını "dışla" yap, gerekçe yaz. Örnek veri
paketi (`sample_pack`) dolu, 14 günden yeni, aktif olmayan ya da son 60 günde <3 yayınlanmış oturumu olan ofis zaten uygun sayılmaz. Mağaza inceleme demo
hesabının kiracısı da dışlanır (oyları öğrenmeye girmez).

## 6. Form değişti uyarısı ve geri alma

- **Uyarı şeridi** (`portal_form_versions`): yeni parmak izi 72 saatte ≥2 ofiste VE Jaccard < 0,8 VE başarı ≥15 puan düşüş → *warning*; tek ofis → *info*.
  Müdahale: uyarıya tıkla → etkilenen alanlar ve parmak izi kanıtı → başarısı düşen alanı "kontrol edin"e indiren ya da yeni etiketi ekleyen öneriyi onayla;
  form tamamen değiştiyse tohum içerikli geri alma yayınla (aşağıda). Eklenti tarafında parmak izi bilinen listede yoksa popup "Form değişmiş olabilir,
  alanları kontrol edin" uyarısını zaten gösterir.
- **Geri alma:** Sürüm geçmişi → "Bu sürüme geri dön" → eski içerik **yeni ve daha büyük sürüm** (max+1, `kind='rollback'`) olarak imzalanıp yayınlanır.
  Eklenti yalnız ileri sürümü kabul ettiğinden eski numaranın yeniden yayını mümkün değildir; geri alma her zaman yeni numaradır.

## 7. Acil durum (bozuk/zehirli kural yayına çıktı)

1. **Doğru adım: tohum içerikli geri alma yayınla (max+1).** Sürüm geçmişinde sürüm 1'e (tohum) geri dön; eklentiler bir sonraki tazelemede
   (EmlakSoft sayfası açılışı ≤6 saat, aktarım başında ≤1 saat) tohum davranışına iner.
2. **Kural ucunu kapatmak:** GET ucu imzalamaz, satırda saklı imzayı pakete gömülü açık anahtarla (`RULE_PUBLIC_KEYS`) doğrulayıp sunar. Bu yüzden
   özel anahtarı (`PORTAL_RULES_SIGNING_KEY`) env'den kaldırmak ucu KAPATMAZ: uç `200` ile mevcut imzalı setleri sunmaya devam eder, yalnız yeni yayın
   (geri alma dahil) durur. Ucu `503 signing_unavailable`'a almak için `rule-keys.ts`'ten kid çıkarılıp sunucu yeniden dağıtılmalı (liste boşalırsa
   503; yalnız bir kid çıkarılırsa o kid'le imzalı satırlar sunulmaz) ya da route kapatılmalı. Her iki durumda da eklenti **son iyi sürümde kalır** —
   sorunlu set son iyi sürümse o set, süresi (`expiresAt`, yayından 14 gün) dolana kadar kullanılmaya devam eder, süre dolunca tohuma döner.
   Bu yüzden 503 tek başına kurtarma DEĞİLDİR; 1. adımın yerine geçmez, ondan SONRA kullanılır.
3. **Anahtar sızıntısı:** sıra önemlidir, çünkü 1. adım özel anahtarla imzalama ister.
   a. Sızmamış/yeni anahtar env'de etkinken tohum içerikli geri alma (max+1) yayınla (1. adım). Yeni kid ise önce açık anahtarı `rule-keys.ts`'e
      eklenip sunucu dağıtılmış olmalı; eklenti yalnız paketine gömülü kid'leri kabul ettiğinden yeni kid'li set ancak yeni paketle etkili olur.
   b. Sonra sızan özel anahtarı env'den kaldır, sızan kid'i `rule-keys.ts`'ten çıkarıp sunucuyu yeniden dağıt; §1 rotasyonunu hızlandırılmış yap ve
      sızan kid'i sonraki pakette `RULE_PUBLIC_KEYS`'ten çıkar.
   c. Sızan anahtar TEK anahtarsa (paketlerde başka kid yoksa) eklentinin kabul edeceği bir geri alma imzalanamaz: eklentiler son iyi sürümde kalır ve
      `expiresAt` (yayından 14 gün) dolunca tohuma döner; bu süre, yeni kid'li paketin mağazadan yayılmasıyla kısaltılır.
4. Olay sonrası: `platform_audit_logs` (`entity_type` `portal_rule_set` / `portal_rule_proposal` / `portal_rule_trust` / `portal_rule_ai`) ile kimin hangi
   sürümü yayınladığını incele; `docs/HAFIZA.md`'ye kısa not düş.

## 8. Saklama ve kişisel veri

Eklenti geri bildirimi yalnız açık rızayla gider (varsayılan kapalı; rıza geri alınınca bekleyen kuyruk ve anlık görüntü silinir) ve değer taşımaz
(`value`/`current`/`checked` anahtarları şemada yok, zod `.strict()` reddeder). Kişisel veri süzgeci eklentide ve sunucuda iki kez çalışır. Saklama:
alan olayları 180 gün, form raporları 90 gün, oylar 180 gün, reddedilen/süresi dolan öneriler, katalog ve form sürümleri 1 yıl; kural setleri kalıcı
(kişisel veri içermez). Mağaza ve gizlilik metni: `ILAN_KONTROL_EKLENTI_YAYIN.md` §4b ve §5 eki.
