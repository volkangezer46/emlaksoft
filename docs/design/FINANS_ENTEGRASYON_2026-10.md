# Finans entegrasyonu: tek defter, tek kayıt servisi, tek Finans modülü (2026-10-16)

Sahip talimatı: "tüm finans işlemleri mantıklı olarak entegre genel bir modül olarak çalışsın; en profesyonel sistem".
Bu belge iş paketlerinin (WP1–WP6) ortak sözleşmesidir.

## Tespitler

- `finance_entries` tablosu YOK. Defter: `public.cash_entries` + `finance_accounts` + `finance_parties` +
  `finance_open_items` + `finance_ledger_v` + `finance_open_items_v`.
- Ledger v2 migration'ları (`20261014001000/1100/1200`) ve `20261016060100_finance_pnl_vat_fix.sql` henüz canlıda değil;
  sıradaki yayınla uygulanır. Tüm paketler bunların üzerine kurulur.

### Bugünkü yüzeyler

| Yüzey | Rota / modül | Tablolar | Deftere işler mi |
|---|---|---|---|
| Muhasebe (10 sekme) | `/app/giderler`, `expenses` | `cash_entries`, `finance_*`, eski `expenses` | Evet (`finance_record_entry` + `create_expense` hem `expenses` hem `cash_entries`) |
| Komisyon | `/app/komisyon`, `commissions` | `commissions`, `commission_splits`, `commission_payouts` | Tahsilat: hesap seçilirse (`source_type='commission'`). Hakediş ödemesi: HAYIR |
| Kazanç (Cüzdan) | `/app/cuzdan`, `commissions` | splits + payouts (`advisor-metrics.ts`) | Defterle bağsız |
| Kasam | `/app/hesabim` kasam-tab | `finance_accounts owner_scope='user'` | Kişisel; ofis K/Z dışında (doğru) |
| Aidat (bina) | `/app/aidat`, `expenses` | `building_charges`, `building_payments` | Tahsilat opsiyonel (`building`) |
| Aidat (basit) | `/app/aidat` | `property_dues` (unpaid/paid) | HAYIR; `deleteDue` sert siler, denetim yok |
| Kiralama | `/app/kiralama/[id]`, `rentals` | `rent_charges` (kira-tahakkuk cron), `rent_payments`, `owner_payouts`, `owner_charge_links` | Tahsilat (`rent`) ve malik ödemesi (`owner_payout`) evet; yönetim ücreti `finance_pnl` içinde doğrudan |
| Faturalar | `giderler/faturalar` | `einvoices` (Nilvera/Paraşüt) | HAYIR; `party_id` / açık kalem bağı yok; KDV fatura tarihinden değil |
| Abonelik | `/app/abonelik`, `billing` | platform `invoices`, `subscriptions` | Ofis gideri olmaz |
| Kira artışı | `/app/kira-artis` | hesaplayıcı | Finans değil, yerinde kalır |

### Doğrulanmış açıklar

1. `finance_open_items_v` komisyon alacağı = `gross_amount − Σtahsilat`; `gross_amount` KDV hariç, tahsilat KDV dahil →
   kısmi tahsilat erken kapanmış görünür.
2. K/Z tahakkuk ve nakit esasını karıştırıyor; eski `expenses` ikinci doğruluk kaynağı.
3. Ödenen hakediş banka bakiyesini düşürmüyor → mutabakatta eşleşmeyen satır.
4. `property_dues`, `building_charges`, `einvoices` açık kalemlerde yok → yaşlandırma/cari eksik.
5. Kira, komisyon, aidat açık kalemlerinde `party_id` null → müşteri cari ekstresinde görünmez.
6. Ters kayıt yerine silme (`deleteDue`); kilitli ayda düzeltme yapılamıyor.
7. Birden çok, her biri opsiyonel kayıt yolu; ortak olay anahtarı yok.

## Hedef mimari

**Esas: değiştirilmiş tahakkuk.** `cash_entries` = nakit gerçeği (ofis hesabından gerçekten geçen her lira).
`finance_open_items` = tahakkuk alt defteri (cari bazında alacak/borç, vade, KDV, stopaj). `finance_pnl(p_basis)`:
`'tahakkuk'` (varsayılan; gelir/gider açık kalemin düzenleme/fatura tarihinde + açık kalemsiz nakit) ve `'nakit'`.
İşletme defteri pratiğine (KDVK md.10, fatura tarihinde KDV) uygun; tam çift taraflı/e-defter yok
(`FINANS_KASA_EFATURA_TASARIM_2026-10.md` §6). TDHP eşlemesi yalnız dışa aktarım için.

**Değişmez:** her operasyonel olayın, `posting_key` ile tanımlı tam olarak bir açık kalemi ve/veya nakit kaydı vardır.

**Tek kayıt servisi (SQL):**
- `finance_post(p_event jsonb)` SECURITY DEFINER, tek transaction, `{outcome, entry_ids, open_item_id}` döner;
  `posting_key` (kiracı başına tekil, kısmi unique index), `event_type`, `reversal_of` yazar; tekrar çağrı `duplicate`.
- `finance_reverse(p_target uuid, p_reason text, p_date date)`: açık dönemde void; kilitli dönemde ilk açık aya
  `reversal_of` bağlı ayna kayıt. Hiçbir şey silinmez.
- Tahakkuklar kaynak tablolardaki tetikleyicilerle (`commissions`, `commission_splits`, `commission_payouts`,
  `building_charges`, `einvoices`, `property_dues` yerine geçen yapı) iç `finance_post_internal()` ile.
- Nakit olayları açık RPC'lerle (hesabı kullanıcı seçer). **Kural: tetikleyici yalnız tahakkuk, RPC yalnız nakit.**
- `cash_entries` ve `finance_open_items` üzerinde `audit_logs` tetikleyicisi.
- Dönem kilidi: mevcut `finance_period_lock_guard`; kilitli aya düşen tetikleyici tahakkuku ilk açık aya tarihlenir, `note` ile işaretlenir.

### Kayıt kuralları (`src/lib/finance/posting/rules.ts` SQL'in aynası; testle eşlenir)

| Olay (anahtar) | Açık kalem | Nakit | K/Z / KDV | TDHP |
|---|---|---|---|---|
| `commission.accrued` (`commission:{id}`) | Müşteri carisinden alacak = brüt+KDV | – | Gelir = `gross_amount` tahakkuk ayında; KDV fatura ayında (yoksa tahakkuk) | 120 / 600 + 391 |
| `commission.split_accrued` (`split:{id}`) ofis dışı pay | Danışman/dış tarafa borç | – | "Danışman hakedişi" gider satırı (net değişmez) | 740/770 / 335/320 |
| `commission.collected` (`commission:{id}:col:{n}`) | Alacağı kapatır (kısmi olabilir) | giriş `komisyon` | – | 102 / 120 |
| `payout.paid` (`payout:{id}`) | Borcu kapatır; stopaj vergi dairesine yeni borç (`stopaj`) | çıkış `danisman_hakedis` | – | 335 / 102, 360 |
| `rent.accrued` (`rent_charge:{id}`) | Yalnız görünümde (kiracı), kopya yok | – | Gelir değil (emanet) | memo |
| `rent.collected` | Malike borç | giriş `kira_tahsilat` | Yalnız `management_fee` gelir (`kira_yonetimi`) | 102/336, 336/600 |
| `owner.paid` | Kapatır | çıkış `mulk_sahibi_odeme` | hariç | 336 / 102 |
| `deposit.received/returned` | Kiracıya borç | giriş/çıkış `depozito` | hariç | 102 / 336 |
| `building.charged/collected` | Daire sahibinden alacak (bina emaneti) | giriş `aidat_tahsilat` | hariç | 102 / 336 |
| `dues.accrued` (`due:{id}`) | Borç/alacak | kapatma | Ofis üstleniyorsa gider | 770 |
| `invoice.issued` (`einvoice:{id}`) | Kaynağın alacağına `einvoices.open_item_id` ile bağlanır; `free` ise yeni alacak | – | KDV tarihi `issue_date` | 120/600/391 |
| `invoice.received` | Tedarikçiye borç, indirilecek KDV | – veya anında kapatma | Fatura tarihinde gider | 770 / 320 + 191 |
| `expense.paid` | – | çıkış | Gider | 770 / 100-102 |
| `transfer` | – | iki bacak, `transfer_group_id` | hariç | 102 / 100 |
| `subscription.invoiced` | Borç + fiş kutusuna öneri | – | `yazilim` gideri | 770 / 320 |
| Kişisel Kasam | Ofis değil | Ödenen hakedişte opsiyonel "Kasama işle" (`payout:{id}:personal`) | Ofis K/Z dışında | – |

Eski `expenses` WP5'ten sonra dondurulur (yeni yazma yok); `finance_adopt_legacy_expenses` geri doldurur;
`finance_pnl`, `tenant_expense_aggregates`, portal ROI ve bütçeler `cash_entries`'e geçer.

## Bilgi mimarisi (WP6)

Tek menü öğesi "Finans", `?sekme=` yerine gerçek yol bölümleri. Eski rotalar silinir, bağlantılar güncellenir
(yönlendirme/takma ad YOK). Tüm finans URL'lerinin tek üreticisi `src/lib/finance/routes.ts`.

| Alt alan | Rota | İçerdiği |
|---|---|---|
| Genel bakış | `/app/finans` | genel + akıllı kartlar |
| Kayıt | `/app/finans/kayit` | `/app/giderler/kayit` |
| Hareketler | `/app/finans/hareketler` | |
| Kasa & Banka | `/app/finans/kasa-banka` | mutabakat + "hesaba işlenmemiş hakediş/tahsilat" kuyruğu |
| Cari | `/app/finans/cari`, `/app/finans/cari/[id]` | müşteri, malik, kiracı, danışman ekstreleri |
| Komisyon & Hakediş | `/app/finans/komisyon`, `/app/finans/hakedis` | `/app/komisyon`, ödeme kuyruğu |
| Tahsilatlar | `/app/finans/tahsilat` | kira + aidat + dues nakit tarafı (operasyon ekranları `/app/kiralama/[id]`, `/app/aidat` yerinde kalır, buraya bağlanır) |
| Faturalar & Belgeler | `/app/finans/faturalar`, `/app/finans/belgeler` | |
| Tekrarlayan / Bütçe / Vergi / Raporlar / Ayarlar | `/app/finans/{tekrarlayan,butce,vergi,raporlar,ayarlar}` | Ayarlar: dönem kilidi + TDHP eşlemesi |
| Kazancım (kişisel) | `/app/kazancim` | `/app/cuzdan` + `/app/hesabim` Kasam sekmesi |

İzin modülleri yeniden adlandırılmaz: `expenses` Finans'ın, `commissions` Komisyon/Hakediş'in kapısı.
Sahip/GM her şey; Muhasebe silme ve kilit açma hariç her şey, hakediş hazırlar (`approved`), ödeme sahip/GM;
Müdür komisyon (ekip kapsamı) + tahsilat görüntüleme; Danışman yalnız Kazancım ve kendi komisyonları
(`earnings_all` yoksa danışman cari kalemleri gizli; `20261014011000_finance_party_advisor_scope` deseni).

## İş paketleri

Migration ön eki `20261017…`; her migration'ın `supabase/rollbacks/` dosyası, ön koşul `do $$` koruması ve
`scripts/migration-pairs-data.ts` girdisi olur.

- **WP1 Kayıt çekirdeği:** `20261017010000_finance_posting_core.sql` (`posting_key`/`event_type`/`reversal_of`,
  kısmi unique index'ler, `source_type` genişletme: `commission_payout`, `invoice`, `deposit`, `subscription`, `due`;
  `finance_open_items.invoice_id`; `finance_post`, `finance_reverse`, denetim tetikleyicileri) +
  `20261017010100_finance_open_items_v3.sql` (alacak = brüt+KDV−tahsilat; bina, dues, hakediş borçları, cari çözümü).
  `src/lib/finance/posting/{rules,keys,client}.ts`. pglite: tekrar post tek satır; kilitli döneme ters kayıt açık ayda
  ayna; bakiye = açılış + Σgiriş − Σçıkış; KDV alacak regresyonu.
- **WP2 Tahakkuk tetikleyicileri + cari + geri doldurma** (WP1'den sonra): `…010200_finance_accrual_triggers`,
  `…010300_finance_parties_backfill` (ON CONFLICT DO NOTHING; nakit UYDURULMAZ, nakitsiz ödenmiş hakediş
  `note='kasa dışı'`, mutabakat kuyruğunda), `…010400_finance_pnl_v3` (`p_basis`, danışman pay gider satırı, fatura
  tarihinde KDV). Test: 2026 tohum verisinde K/Z net önce=sonra; geri doldurma iki kez çalışınca değişiklik yok.
- **WP3 Komisyon + hakediş:** hakediş ödemesi hesap ister, stopajlı `payout.paid`; kısmi tahsilat;
  `revertCommissionPayment` → `finance_reverse`; `collection-link.ts` `finance_post` sarmalayıcısı.
- **WP4 Kira, aidat, dues:** `…010500_property_dues_open_items` (dues → açık kalem `due:{id}`, tablo salt okunur,
  `deleteDue` → iptal); depozito emanet; kiracı/malik carileri.
- **WP5 Fatura + belge + `expenses` dondurma:** `…010600_einvoice_ledger_link` (`einvoices.party_id`, `open_item_id`;
  issued → `invoice.issued`, cancelled → ters); `.from("expenses").insert` yasak sözleşme testi; platform faturası öneri.
- **WP6 Finans BM + rota taşıma** (en son): `giderler/**` → `finans/**` (sekme başına `page.tsx`, kabuk `layout.tsx`),
  `komisyon` → `finans/komisyon`, `cuzdan` + Kasam → `kazancim`; nav/yardım/palet/örnek veri; `…010700_finance_hrefs`;
  sözleşme: `/app/giderler`, `/app/komisyon`, `/app/cuzdan` hiçbir yerde geçmez.

## Riskler

K/Z sunumu değişir (brüt gelir + danışman gider satırı, KDV fatura ayına) → iki esas gösterilir, sürüm notu.
Geri doldurma kilitli aya nakit yazmaz. Danışman cari gizliliği pglite testiyle korunur. Çift kayıt riski:
tetikleyici yalnız tahakkuk, RPC yalnız nakit. Bekleyen v2 migration'ları önce canlıya çıkmalı.
