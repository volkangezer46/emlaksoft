# Referans / ortaklık programı (müşteri-getir-müşteri + profesyonel ortak)

Durum: HAZIRLANDI, UYGULANMADI (migration `20260826000600_growth_referral_engine`). Bayraklar KAPALI. Kod migration yokken "etkin değil" kipinde çalışır.
Üst plan: `ORGANIK_BUYUME_PLANI.md`. Sıra: `20260825000800` → `20260825000900` → `20260826000400/000500` (TL cüzdan) → `20260826000600`.

## Faz 1: müşteri-getir-müşteri (çift taraflı, kredi nakde çevrilmez)

- **Tetikleyici:** davet edilen ofisin İLK GERÇEK ödemesi. Gerçek ödeme = `invoices.status='paid'`, plan faturası (`meta.kind` yok), `provider/source` demo veya `account_credit` DEĞİL,
  `walletCashTry` > 0 (tam kredi ile ödenen fatura sayılmaz), `meta.refund` yok. Deneme (`trialing`) ve kayıt ödül vermez.
- **Bekleme:** `growth_reward_rules.hold_days` (iade/iptal penceresi). Dolunca: davetçinin aboneliği `active` ve davet edilenin aboneliği `active` ise tahakkuk.
- **Davetçi ödülü:** kural tipi `monthly_multiple` (1 aylık paket bedelinin katı; yıllık fatura = tutar / 12, KDV hariç). `try_credit_grant(kind 'referral', idem 'ref-claim-<claim id>', vade = kural `credit_expires_days`)`.
  Defter `source_id` RPC'den yazılamadığı için bağ `meta.claim_id`'dedir (kullanıcı onaylı şartın uyarlaması).
- **Davet edilen (hoş geldin):** `growth_referral_settings.welcome_credit_try` kadar TL kredi (kayıtta, bayraksız çiftte; fatura payı üst sınırı %50 olduğundan "ilk ay %50'ye kadar indirim" gibi davranır). 0 = kapalı.
  Fatura indirimi/kupon altyapısına dokunulmadı (kupon `redeem_coupon` akışı değişmedi).
- **Kademe:** N. başarılı (ödenmiş) referansta bir kez bonus (`tier1_at/tier1_bonus_months`, `tier2_at/...`); rozet adı ayarda, rozet sayımdan türetilir. Yıllık tavan: son 365 günde `annual_cap_months` aylık bedel (bonus dahil; aşan kısım kırpılır/reddedilir).
  Kural `monthly_cap_try` varsa takvim ayı TL tavanı (dolunca ertesi aya bekler).
- **Kötüye kullanım:** aynı tenant (red) · aynı vergi no · aynı telefon (ofis + profil) · aynı kurumsal e-posta alan adı (gmail/hotmail/outlook/yahoo/icloud/yandex... hariç) → talep `pending` (ödül yok, admin inceleme) ·
  hız sınırı (`velocity_max_per_day`/24 saat → `velocity` bayrağı). IP/cihaz hash'i SAKLANMAZ (KVKK).
- **Geri alma:** fatura paid değil / `meta.refund` / yakalama `refunded|refund_required` / davet edilen abonelik `cancelled` → `reversed`; kredi verilmişse `try_credit_reverse(p_original_idem = grant idem)` (eksi bakiye mümkün, harcanamaz).
  İade kaydı kısmi bile olsa talep tamamen geri alınır (muhafazakâr; bkz. riskler).
- **İnceleme:** /admin/growth "Talep kuyruğu": durum/bayrak/vade süzgeçleri; süper admin onay (yalnız `pending`), ret, geri alma; neden zorunlu; olay izi (`growth_claim_events`, append-only) + `platform_audit_logs`.
  Onaylanan kredi bir sonraki işleyici çalışmasında yüklenir (personel oturumu cüzdana yazamaz; bilinçli).

## Faz 2: profesyonel ortak (altyapı hazır, KAPALI)

`growth_partner_enabled` kapalıyken komisyon üretilmez. Kademe: aktif ücretli müşteri 0-4 / 5-14 / 15+ → %20 / %25 / %30 (ayarlanabilir), ilk 12 ay yinelenen (ilk gerçek ödemeden itibaren), kural `hold_days`.
Komisyon = fatura net tutarı x yüzde; vade gelince `approved` (ödenebilir bakiye). Ödeme: minimum eşik (`partner_min_payout_try`), YALNIZ vergi mükellefine fatura karşılığı dış ödeme
(`bank_transfer_external`, belge no + tarih zorunlu) ya da hesap kredisi (`account_credit`, ortağa bağlı ofis). Nakit için AYRI `growth_cash_payout_enabled` (ortak programı kapalıyken açılamaz).
Ödenmiş komisyonun faturası sonradan iade olursa `clawback_due` işaretlenir ve sonraki ödemeden mahsup edilir. Ortak panosu: /app/buyume altında, ofis bir ortağın `owner_tenant_id`'si ise.

## Aktivasyon

/admin/growth → "Aktivasyon": hazırlık kontrolü (migration, cüzdan, aktif kural; uyarı: cron, hoş geldin kredisi; ortak: kural; nakit: vergi mükellefi ortak). Engelleyici madde varsa
`saveGrowthFlags` açmayı REDDEDER. Sıra: migration'ları uygula → kural ekle (`monthly_multiple`, hold, `credit_expires_days`) → ayarları gözden geçir → bayrağı aç.

## Açık riskler / teyit gerekenler

- Mali müşavir: davetçiye verilen hesap kredisinin ve hoş geldin kredisinin KDV/gelir muamelesi (indirim mi, bedelsiz hizmet mi); ortak komisyonunun stopaj/KDV/e-fatura (serbest meslek makbuzu/fatura) çerçevesi; nakit ödeme yalnız vergi mükellefine.
- Hukuk: ortak sözleşmesi, ticari ileti kuralı (EmlakSoft davetçi adına ileti ATMAZ; WhatsApp paylaşımını kullanıcı kendi yapar), davet sayfasında davetçi ofis adının gösterilmesi, kampanya/çekiliş mevzuatı.
- Hoş geldin kredisi kayıtta verilir; davet edilen aynı kişi başka e-posta/ofisle tekrar kayıt olabilir (kredi yalnız faturanın %50'sine kadar kullanılır, ilk ödeme zorunlu).
- Süpürme (`growth_claims_process` A bölümü) son 60 gün/`limit` ile sınırlıdır; çok sayıda ödeme kaçarsa eskiler atlanabilir (kanca birincil yoldur).
- Kısmi iade tüm ödülü geri alır; ince ayar gerekirse `growth_reverse_claims` eşiği eklenir.
- Ofis-içi takma ad sıralaması YAPILMADI: davet bağlantısı ofis düzeyindedir (kullanıcı başına kod yok); açık genel lider tablosu bilerek yok.
