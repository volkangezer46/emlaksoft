# Modül Envanteri 360 (salt okunur mimari denetim)

Tarih: 2026-10-03 · Kapsam: kod DEĞİŞMEDİ, yalnız bu belge.
Yöntem: `git ls-files` + grep + `nav-config.ts`/`page-gates.ts` ayrıştırma + migration SQL tarama + basit import grafı. knip/ts-prune kurulu değil; ölü kod için kendi import grafı betiği kullanıldı (yaklaşık, bkz. sınırlar). `npm run check:links` bu worktree'de `node_modules` olmadığı için ÇALIŞTIRILMADI (öneriler uygulanırken zorunlu kapı).

## 1. Ölçülebilir özet

| Ölçü | Değer |
|---|---|
| Toplam `page.tsx` | **130** (`/app` 109, `/admin` 21) |
| `/app` menü başlığı / menü öğesi | 9 / 46 (+ 12 sekme yolu; 4 sekmeli öğe) |
| `/app` sayfası menüden doğrudan erişilen (öğe + sekme + alias) | 55 (54 + `/app/yatirim` alias) |
| `/app` sayfası menüde OLMAYAN | 54 = 17 detay/dinamik + 16 "yeni" formu + **21 statik** |
| 21 statik menüsüz sayfa | `arama-sonuclari`, `askida`, `bildirimler`, `franchise`, `ice-aktarma`, `paket`, `musteriler/cift-kayit`, `ekip/izinler`, `ekip/kartvizitim`, `raporlar/memnuniyet`, `raporlar/talep-arz`, `uyum/denetim-dosyasi`, `ayarlar/{cop-kutusu,duyurular,entegrasyonlar,filigran,guvenlik,lead,mesaj-sablonlari,roller,tanimlar}` |
| `/admin` menüde olmayan | 8 (`bildirimler`, `hatalar` + 6 detay); sidebar 13 öğe |
| Gerçek yetim (hiçbir link/menü/yönlendirme almayan) | **0** statik sayfa. `askida` (middleware) ve `paket` (require-module-page) yalnız sistem yönlendirmesiyle; `ayarlar/entegrasyonlar` yalnız ayarlar merkeziyle erişilir |
| Salt yönlendirme sayfası | 1 (`/app/yatirim` → `/app/hesaplayici?sekme=yatirim`). `*/yeni` sayfalarından 5'i izin kapısı + form, yönlendirme değil |
| Paket kapılı yol (`PLAN_GATES`) | 27 (12 Ofis, 13 Profesyonel, 2 Kurumsal) |
| Server action dosyası (`src/app/actions`) | 105 (+ sayfa-içi `actions.ts`; `"use server"` içeren toplam 110) |
| Cron route | 27 = `vercel.json` 27 (tutarlı) |
| DB tablosu (migrations `create table`) | 136 (191 migration dosyası, 1 `drop table`) |
| `from("tablo")` kodda hiç geçmeyen tablo | 14 (5'i tasarım-only/ölü aday, 9'u RPC/service-role ile meşru) |
| Hiçbir yerden import edilmeyen `src` dosyası | 13 (+5 yalnız testten import edilen), 1436 dosya içinde |
| "Son değiştirilme" | Hemen hepsi 2026-10-02/03 (yoğun sprint): git tarihi ayırt edici DEĞİL, yalnız bilgi |

Sınırlar: gelen-link sayısı string-literal eşleşmesidir (`"/app/x"`; `${id}` şablonlu ve `router.push` ile dinamik kurulan yollar kaçabilir). RLS "NORLS" sezgisi regex tabanlıdır; kesin kanıt için canlı DB'de `npm run db:rls-audit`.

## 2. Menü yerleşimi (tek kaynak `src/lib/nav-config.ts`)

| Başlık | Öğeler (sekmeler parantezde) |
|---|---|
| Bugün (4) | Ana ekran, Günlük Brifing, Ofis kurulumu, AI Asistan |
| Müşteriler (5) | Müşteriler, Talepler, Eşleştirme, Akıllı Listeler, Tavsiyeler |
| Portföy (8) | Portföyler, Kiralama (+Kira artışı), Projeler, Açık Ev, Portal Kontrol, Anahtar Takibi, Sunumlar, Ofisler Arası Ağ |
| Anlaşmalar (3) | Anlaşmalar, Teklifler, Sözleşmeler |
| İletişim (5) | Gelen Kutusu, Akıllı Arama, Randevular, Görevler, Kampanyalar |
| Finans (3) | Komisyon (+Cüzdanım, +Onaylar), Giderler, Aidat |
| Performans (6) | Raporlar, Kayıp-kaçak, Ekip performansı (Danışman KPI + Ekip Ligi), Bölge Analizi, Kayıp Satış, Ofis Panosu (TV) |
| Araçlar (3) | Değerleme, Hesaplayıcılar, Yabancıya Satış |
| Ofis (9) | Ekip Merkezi (Genel, Kıyas, Kazanç, Hedefler, Devir/Atama), Otomasyonlar, İş Akışları, Uyum, Belge Merkezi, Denetim, Abonelik, Destek, Ayarlar |

Gözlemler: (a) "Ofis" 9 öğeyle en şişkin başlık; yönetim, otomasyon, faturalama, belge karışık. (b) "Performans" içinde "kim ne kadar kazandı" sorusunu cevaplayan 3 ekran (KPI, Lig, Ekip/Kıyas+Kazanç+Hedefler ayrı başlıkta) ve 2 "kayıp" ekranı. (c) Ayarlar merkezi menüde zaten olan sayfalara kart olarak ikinci kez link veriyor (Komisyon defteri, Değerleme, Raporlar, Anlaşma hattı, Portallar, Denetim, Abonelik, İYS/EİDS, İçe Aktarma). (d) İzin modülü sayfa amacına uymuyor: Kira artışı=`valuation`, Kayıp Satış=`customers`, Brifing/Kurulum/AI Asistan/Bildirimler/Arama sonuçları=`dashboard`, Otomasyonlar/Belge/Denetim=`settings`.

## 3. Sayfa envanteri (130 sayfa)

Sütunlar: modül = `requireModulePage` izni (admin: platform izni); paket = `PLAN_GATES` önek eşleşmesi (mevcut tenant'lar ve deneme dışında kilitsiz); gelen link = kendi klasörü ve nav-config dışındaki dosyalardan kaç dosya yolu literal veriyor; son değ. = klasörün son commit ayı-günü.

| Yol | Amaç | Modül | Paket | Menü | Gelen link | Son değ. |
|---|---|---|---|---|---|---|
| `/admin` | Platform kontrol paneli | requirePlatformStaff | - | Admin menü | 17 | 10-03 |
| `/admin/aktivite` | Platform denetim izi | requirePlatformModule | - | Admin menü | 6 | 10-02 |
| `/admin/bildirimler` | Platform bildirimleri | requirePlatformStaff | - | - | 2 | 10-02 |
| `/admin/billing` | Abonelik, MRR, fatura | requirePlatformModule | - | Admin menü | 10 | 10-02 |
| `/admin/danisman` | Platform AI danışmanı | requirePlatformModule | - | Admin menü | 2 | 10-02 |
| `/admin/duyuru` | Ofislere toplu duyuru | requirePlatformModule | - | Admin menü | 2 | 10-02 |
| `/admin/geo` | Coğrafya (il/ilçe/mahalle) yönetimi | requirePlatformModule | - | Admin menü | 6 | 10-02 |
| `/admin/geo/[provinceId]` | Detay sayfası | requirePlatformModule | - | alt sayfa | 10 | 10-02 |
| `/admin/geo/[provinceId]/[districtId]` | Detay sayfası | requirePlatformModule | - | alt sayfa | 0 | 10-02 |
| `/admin/hatalar` | error_logs listesi | requirePlatformModule | - | - | 2 | 10-02 |
| `/admin/members` | Tüm platform kullanıcıları | requirePlatformModule | - | Admin menü | 6 | 10-02 |
| `/admin/members/[id]` | Detay sayfası | requirePlatformModule | - | alt sayfa | 8 | 10-02 |
| `/admin/personel` | EmlakSoft çalışanları | - | - | Admin menü | 2 | 10-03 |
| `/admin/raporlar` | Platform raporları | requirePlatformModule | - | Admin menü | 2 | 10-02 |
| `/admin/satis` | Demo talepleri/aday hunisi | requirePlatformModule | - | Admin menü | 7 | 10-03 |
| `/admin/satis/[id]` | Detay sayfası | requirePlatformModule | - | alt sayfa | 10 | 10-02 |
| `/admin/sistem` | Cron/geo/altyapı sağlığı | requirePlatformModule | - | Admin menü | 7 | 10-02 |
| `/admin/tenants` | Ofis envanteri | requirePlatformModule | - | Admin menü | 10 | 10-02 |
| `/admin/tenants/[id]` | Detay sayfası | requirePlatformModule | - | alt sayfa | 23 | 10-02 |
| `/admin/tickets` | Destek kuyruğu | requirePlatformModule | - | Admin menü | 11 | 10-02 |
| `/admin/tickets/[id]` | Detay sayfası | requirePlatformModule | - | alt sayfa | 21 | 10-02 |
| `/app` | Ana ekran: günün özeti, komisyon akışı, kayıp-kaçak şeridi, hedefler | dashboard | - | Bugün | 44 | 10-03 |
| `/app/abonelik` | Paket, ödeme, fatura (iyzico) | billing | - | Ofis | 12 | 10-03 |
| `/app/acik-ev` | Açık ev etkinlikleri + QR ziyaretçi kaydı | open_house | Ofis | Portföy | 5 | 10-03 |
| `/app/acik-ev/[id]` | Detay sayfası | open_house | Ofis | alt sayfa | 11 | 10-03 |
| `/app/acik-ev/yeni` | Oluşturma formu | open_house | Ofis | - | 3 | 10-03 |
| `/app/ag` | Ofisler arası ilan/talep paylaşımı | network | Prof. | Portföy | 4 | 10-03 |
| `/app/aidat` | Portföy aidat/vergi vade takibi | expenses | Ofis | Finans | 3 | 10-03 |
| `/app/akilli-listeler` | Kayıtlı müşteri segmentleri (appointments/customers) | customers | - | Müşteriler | 2 | 10-02 |
| `/app/anlasmalar` | Anlaşma tahtası (kanban) | commissions | - | Anlaşmalar | 27 | 10-03 |
| `/app/anlasmalar/[id]` | Detay sayfası | commissions | - | alt sayfa | 43 | 10-03 |
| `/app/anlasmalar/yeni` | Oluşturma formu | commissions | - | - | 6 | 10-03 |
| `/app/arama` | Çağrı kayıt merkezi (calls) | calls | - | İletişim | 12 | 10-02 |
| `/app/arama-sonuclari` | Genel arama sonuç sayfası (command palette hedefi) | dashboard | - | - | 2 | 10-03 |
| `/app/asistan` | AI asistan komuta merkezi | dashboard | - | Bugün | 2 | 10-03 |
| `/app/askida` | Askıya alınmış hesap bilgi sayfası (middleware hedefi) | - | - | - | 1 | 10-03 |
| `/app/ayarlar` | Ayarlar merkezi + marka/kimlik formu | settings | - | Ofis | 18 | 10-03 |
| `/app/ayarlar/cop-kutusu` | Silinenleri 90 gün içinde geri alma | settings | - | - | 1 | 10-03 |
| `/app/ayarlar/duyurular` | Ofis içi duyuru panosu | settings | - | - | 3 | 10-03 |
| `/app/ayarlar/entegrasyonlar` | Dış servis bağlantı durumları | settings | - | - | 1 | 10-02 |
| `/app/ayarlar/filigran` | İlan fotoğrafı filigranı | settings | - | - | 4 | 10-02 |
| `/app/ayarlar/guvenlik` | 2 adımlı doğrulama, giriş geçmişi | settings | - | - | 1 | 10-03 |
| `/app/ayarlar/is-akislari` | Playbook (iş akışı) tanımları | settings | Prof. | Ofis | 4 | 10-02 |
| `/app/ayarlar/lead` | Aday yakalama formu, sıralı atama | settings | - | - | 2 | 10-02 |
| `/app/ayarlar/mesaj-sablonlari` | WhatsApp mesaj şablonları | settings | - | - | 4 | 10-02 |
| `/app/ayarlar/roller` | İzin matrisi + kullanıcı istisnaları | settings | - | - | 3 | 10-03 |
| `/app/ayarlar/tanimlar` | Seçim listeleri (definitions) | settings | - | - | 2 | 10-03 |
| `/app/baslangic` | Ofis kurulum sihirbazı/checklist | dashboard | - | Bugün | 2 | 10-03 |
| `/app/belgeler` | Tüm dosyalar (müşteri/portföy/anlaşma/sözleşme) | settings | - | Ofis | 4 | 10-03 |
| `/app/bildirimler` | Bildirim listesi (notifications) | dashboard | - | - | 1 | 10-02 |
| `/app/bolge-analizi` | Bölge fiyat/satış süresi analizi | reports | Prof. | Performans | 5 | 10-03 |
| `/app/brifing` | Günlük brifing (görev, randevu, portföy) | dashboard | - | Bugün | 2 | 10-02 |
| `/app/cuzdan` | Danışmanın kendi kazancı (komisyon payı) | commissions | - | Finans | 4 | 10-03 |
| `/app/danisman-kpi` | Danışman bazlı gelir/arama/randevu KPI | reports | Prof. | Performans | 7 | 10-03 |
| `/app/degerleme` | Değerleme motoru | valuation | - | Araçlar | 10 | 10-03 |
| `/app/degerleme/[id]` | Detay sayfası | valuation | - | alt sayfa | 12 | 10-03 |
| `/app/denetim` | Denetim/KVKK erişim günlüğü | settings | Ofis | Ofis | 4 | 10-02 |
| `/app/destek` | Destek talepleri | support | - | Ofis | 4 | 10-03 |
| `/app/destek/[id]` | Detay sayfası | support | - | alt sayfa | 12 | 10-03 |
| `/app/destek/yeni` | Oluşturma formu | support | - | - | 2 | 10-03 |
| `/app/ekip` | Çalışan, şube, davet, rol yönetimi | team | - | Ofis | 14 | 10-03 |
| `/app/ekip/[id]` | Detay sayfası | team | Ofis | alt sayfa | 32 | 10-03 |
| `/app/ekip/devir` | Devir ve toplu atama | team | Ofis | Ofis | 2 | 10-03 |
| `/app/ekip/izinler` | İzin takvimi (staff_leaves) | team | Ofis | - | 6 | 10-03 |
| `/app/ekip/kartvizitim` | Danışmanın dijital kartviziti | team | - | - | 5 | 10-02 |
| `/app/ekip/kazanc` | Ekip kazanç tablosu (komisyon payı) | commissions | Ofis | Ofis | 1 | 10-03 |
| `/app/ekip/kiyas` | Danışman karnesi/kıyası | reports | Prof. | Ofis | 2 | 10-03 |
| `/app/eslestirme` | Talep-portföy eşleşme motoru | matching | - | Müşteriler | 24 | 10-03 |
| `/app/franchise` | Şube × kazanılan hacim BI | reports | Kurumsal | - | 3 | 10-02 |
| `/app/gelen-kutusu` | Tüm iletişim kronolojisi (calls+communications) | calls | - | İletişim | 7 | 10-03 |
| `/app/giderler` | Ofis giderleri + kâr/zarar | expenses | Ofis | Finans | 5 | 10-03 |
| `/app/gorevler` | Görev listesi (tasks) | tasks | - | İletişim | 19 | 10-03 |
| `/app/gorevler/yeni` | Oluşturma formu | tasks | - | - | 4 | 10-03 |
| `/app/hedefler` | Ofis/danışman hedefleri ve gerçekleşme | targets | Prof. | Ofis | 6 | 10-03 |
| `/app/hesaplayici` | Alım maliyeti + yatırım getirisi (sekmeli) | valuation | - | Araçlar | 4 | 10-03 |
| `/app/ice-aktarma` | CSV içe aktarma sihirbazı | customers | - | - | 4 | 10-03 |
| `/app/kampanyalar` | SMS/WhatsApp kampanyaları | campaigns | Ofis | İletişim | 3 | 10-03 |
| `/app/kampanyalar/[id]` | Detay sayfası | campaigns | Ofis | alt sayfa | 8 | 10-02 |
| `/app/kampanyalar/yeni` | Oluşturma formu | campaigns | Ofis | - | 2 | 10-03 |
| `/app/kayip-kacak` | Portaldan rakibe kapanan ilan/kaçan komisyon | leak | Prof. | Performans | 12 | 10-03 |
| `/app/kayip-satis` | Risk altındaki müşteri/anlaşma (lost-sale-detector) | customers | Prof. | Performans | 2 | 10-03 |
| `/app/kira-artis` | Kira artışı (TÜFE) hesaplayıcı | valuation | - | Portföy | 4 | 10-02 |
| `/app/kiralama` | Kira sözleşmeleri, tahakkuk, depozito | rentals | Ofis | Portföy | 6 | 10-03 |
| `/app/kiralama/[id]` | Detay sayfası | rentals | Ofis | alt sayfa | 13 | 10-03 |
| `/app/kiralama/yeni` | Oluşturma formu | rentals | Ofis | - | 3 | 10-03 |
| `/app/komisyon` | Komisyon defteri & hakediş | commissions | - | Finans | 22 | 10-03 |
| `/app/lig` | Danışman ligi/rozet/sıralama | reports | Prof. | Performans | 7 | 10-02 |
| `/app/musteriler` | Müşteri listesi | customers | - | Müşteriler | 57 | 10-03 |
| `/app/musteriler/[id]` | Detay sayfası | customers | - | alt sayfa | 110 | 10-03 |
| `/app/musteriler/[id]/talep/yeni` | Oluşturma formu | customers | - | alt sayfa | 0 | 10-03 |
| `/app/musteriler/cift-kayit` | Mükerrer müşteri tespit/birleştirme | customers | - | - | 2 | 10-03 |
| `/app/musteriler/yeni` | Oluşturma formu | customers | - | - | 9 | 10-03 |
| `/app/onaylar` | Çok adımlı onay akışları | commissions | Prof. | Finans | 5 | 10-03 |
| `/app/onaylar/yeni` | Oluşturma formu | commissions | Prof. | - | 3 | 10-03 |
| `/app/otomasyonlar` | Tetikleyici-aksiyon otomasyonları | settings | Prof. | Ofis | 5 | 10-03 |
| `/app/otomasyonlar/[id]` | Detay sayfası | settings | Prof. | alt sayfa | 10 | 10-03 |
| `/app/otomasyonlar/yeni` | Oluşturma formu | settings | Prof. | - | 2 | 10-03 |
| `/app/paket` | Paket kilidi yükseltme sayfası (guard hedefi) | dashboard | - | - | 1 | 10-03 |
| `/app/pano-tv` | Ofis TV panosu | reports | Prof. | Performans | 2 | 10-02 |
| `/app/portallar` | Portal ilan teyit/yenileme | portals | Ofis | Portföy | 14 | 10-03 |
| `/app/portfoyler` | Portföy listesi | properties | - | Portföy | 52 | 10-03 |
| `/app/portfoyler/[id]` | Detay sayfası | properties | - | alt sayfa | 117 | 10-03 |
| `/app/portfoyler/[id]/brosur` | Portföy broşürü (yazdırma) | properties | - | alt sayfa | 0 | 10-02 |
| `/app/portfoyler/anahtarlar` | Anahtar zimmet panosu | properties | - | Portföy | 4 | 10-03 |
| `/app/portfoyler/sunumlar` | Portföy sunumları + müşteri/malik portal bağlantıları | properties | - | Portföy | 8 | 10-03 |
| `/app/portfoyler/sunumlar/yeni` | Oluşturma formu | properties | - | - | 3 | 10-03 |
| `/app/portfoyler/yeni` | Oluşturma formu | properties | - | - | 9 | 10-03 |
| `/app/projeler` | Proje ve daire stoğu | projects | Kurumsal | Portföy | 6 | 10-03 |
| `/app/projeler/[id]` | Detay sayfası | projects | Kurumsal | alt sayfa | 12 | 10-03 |
| `/app/projeler/yeni` | Oluşturma formu | projects | Kurumsal | - | 3 | 10-03 |
| `/app/randevular` | Randevu & yer gösterme | appointments | - | İletişim | 31 | 10-03 |
| `/app/randevular/yeni` | Oluşturma formu | appointments | - | - | 4 | 10-03 |
| `/app/raporlar` | Ofis sağlık & performans raporu | reports | Ofis | Performans | 14 | 10-03 |
| `/app/raporlar/memnuniyet` | NPS / anket sonuçları | reports | Ofis | - | 7 | 10-03 |
| `/app/raporlar/talep-arz` | Talep-arz haritası | reports | Ofis | - | 2 | 10-03 |
| `/app/sozlesmeler` | Sözleşme & e-imza | contracts | Ofis | Anlaşmalar | 10 | 10-03 |
| `/app/sozlesmeler/[id]` | Detay sayfası | contracts | Ofis | alt sayfa | 21 | 10-03 |
| `/app/sozlesmeler/[id]/duzenle` | Sözleşme düzenleme | contracts | Ofis | alt sayfa | 0 | 10-02 |
| `/app/sozlesmeler/yeni` | Oluşturma formu | contracts | Ofis | - | 3 | 10-03 |
| `/app/talepler` | Talep listesi (customer_demands) | demands | - | Müşteriler | 22 | 10-03 |
| `/app/talepler/[id]` | Detay sayfası | demands | - | alt sayfa | 28 | 10-03 |
| `/app/talepler/yeni` | Oluşturma formu | demands | - | - | 3 | 10-03 |
| `/app/tavsiyeler` | Tavsiye/referans programı | customers | - | Müşteriler | 3 | 10-02 |
| `/app/teklifler` | Teklif turları | offers | Ofis | Anlaşmalar | 10 | 10-03 |
| `/app/teklifler/[id]` | Detay sayfası | offers | Ofis | alt sayfa | 18 | 10-03 |
| `/app/teklifler/yeni` | Oluşturma formu | offers | Ofis | - | 3 | 10-03 |
| `/app/uyum` | KVKK / İYS / EİDS uyum merkezi | compliance | Prof. | Ofis | 7 | 10-03 |
| `/app/uyum/denetim-dosyasi` | Denetim dosyası çıktısı | compliance | Prof. | - | 1 | 10-02 |
| `/app/yabanci-satis` | Yabancıya satış kontrol listesi | properties | Ofis | Araçlar | 5 | 10-03 |
| `/app/yatirim` | Eski yol, /app/hesaplayici?sekme=yatirim yönlendirmesi | valuation | - | (alias) | 2 | 10-03 |

## 4. Mükerrer / çakışan adaylar

Karar etiketleri: BİRLEŞTİR (tek sayfa/sekme), YÖNLENDİR (yol kalır, hedefe yönlendirir), KALDIR (veri/akış yok), BIRAK (farklı iş, yalnız ad/çapraz link düzelt). Efor S/M/L; risk D/O/Y. Her birleştirmede mevcut yol KORUNUR: eski sayfa dosyası `redirect()` ile (yatirim deseni) ya da sekme olarak `NAV_ALIASES`/`NavTab` ile bağlanır; `scripts/check-link-contracts.ts` (check:links) searchParams okunmasını doğrular, `src/lib/nav-config.test.ts` menü kontratını korur.

### 4.1 En kritik 10 çakışma (öncelik sırasıyla)

| # | Aday | Kanıt | Öneri | Efor/Risk |
|---|---|---|---|---|
| 1 | **Danışman performansı: `/app/danisman-kpi` + `/app/lig` + `/app/ekip/kiyas` + `/app/ekip/kazanc` + `/app/hedefler` + `/app/pano-tv`** | Hepsi "danışman başına ne üretti" hesaplıyor, her biri kendi toplamıyla: danisman-kpi `commissions.gross_amount` ⨝ `deals.assigned_to` (satır 87-115), kiyas `lib/team/scorecard`, kazanc `lib/team/advisor-share`, hedefler `lib/team/target-actuals` (commissions+offers), lig `lib/gamification-query` (agent_score_snapshots), pano-tv `deals.deal_value` stage=won `assigned_to` (satır 22-38). Ortak yardımcı: `lib/team/earnings-scope.ts`. Gelir TANIMI üç farklı (komisyon brüt, danışman payı, anlaşma değeri): aynı danışman için ekranlar farklı rakam gösterir | BİRLEŞTİR: tek "Ekip performansı" kabuğu (Ekip Merkezi sekmeleri): Genel, Performans (KPI+Kıyas), Lig, Kazanç, Hedefler. Tek `loadAdvisorMetrics(period)` kaynağı; pano-tv ve lig aynı kaynaktan beslenir. `/app/danisman-kpi`, `/app/lig` yolları YÖNLENDİR (sekme `?sekme=`), paket kapıları (Prof.) sekme bazlı kalır | L / O (rakam tutarlılığı kullanıcı görünür) |
| 2 | **`/app/cuzdan` ↔ `/app/ekip/kazanc` ↔ `/app/komisyon`** | cuzdan ve kazanc aynı `advisorShare()` (lib/team/advisor-share.ts: "tek kaynak Cüzdanım ve Kazanç"); ikisi de `commissions`+`profiles`; cuzdan menüde Komisyon sekmesi, kazanc Ekip Merkezi sekmesi; Ayarlar hub'ında ayrıca "Komisyon defteri" kartı | BİRLEŞTİR cuzdan+kazanc: tek "Kazanç" sayfası, kapsam `canSeeAllEarnings` ile (yönetici: ekip, danışman: yalnız kendisi). `/app/cuzdan` YÖNLENDİR → `/app/ekip/kazanc?kapsam=ben`. Komisyon defteri (komisyon) ayrı kalır (muhasebe görünümü) | M / D |
| 3 | **`/app/brifing` ↔ `/app` (ana ekran) ↔ `/app/gorevler`** | brifing: `appointments`,`properties`,`tasks`; `_home/data.ts` aynı üçlüyü yükler; `tasks` tablosu 17 dosyada sorgulanıyor; Bugün başlığında iki "bugün özeti" var | BİRLEŞTİR brifing → Ana ekran "Günlük brifing" bölümü/sekmesi; `/app/brifing` YÖNLENDİR → `/app?gorunum=brifing`. Görevler ayrı kalır (CRUD listesi) | M / D |
| 4 | **`/app/arama` ↔ `/app/gelen-kutusu`** | İkisi de `calls` üzerinde (arama:86,97; gelen-kutusu:175-213 sayaçlar); gelen-kutusu zaten "çağrı ve notlar tek akış"; adlar da `arama-sonuclari` (genel arama) ile karışıyor | BİRLEŞTİR: Gelen Kutusu'na "Çağrı kaydı" sekmesi (modül `calls` ortak); `/app/arama` YÖNLENDİR. Menü ad çakışması biter ("Akıllı Arama" yerine yalnız palet araması) | M / D |
| 5 | **`/app/eslestirme` ↔ `/app/talepler`** | İkisi `customer_demands` + `portal_match_feedback` okur; talepler 8 tablo, eşleştirme matching action; `lib/matching.ts` + `match-candidates.ts` ortak | BİRLEŞTİR: Talepler'e "Eşleşme" sekmesi (NavTab kendi `matching` izniyle gizlenir). `/app/eslestirme` YÖNLENDİR; müşteri/portföy detaydaki eşleşme linkleri değişmez (yol kalır) | M / O (izin ayrımı) |
| 6 | **`/app/otomasyonlar` ↔ `/app/ayarlar/is-akislari` (playbook) ↔ `/app/kampanyalar`** | İki ayrı tetikleyici motor: `lib/automation-engine.ts` (trigger_type+actions: create_task, send_notification) ve `lib/playbook-engine.ts`+`playbook-trigger.ts` (event → görev adımları); ikisi de `tasks` insert eder (automation-engine.ts:253, playbook-engine.ts:338). Tablolar: automations/automation_logs vs playbooks/playbook_runs/playbook_steps. Hepsi menüde Ofis başlığında, ikisi "settings" modülü | BİRLEŞTİR sayfa düzeyinde: tek "Otomasyon" menü öğesi, sekmeler Kurallar / İş akışları; eski yollar YÖNLENDİR/sekme. Motor birleşimi (tek `task` üretici) ayrı, yüksek efor: önce ortak `insertTaskRows()` yardımcısı. Kampanyalar (toplu mesaj) BIRAK | M (sayfa) / L (motor) / O |
| 7 | **Duyuru ailesi: `/app/ayarlar/duyurular` ↔ `/app/bildirimler` ↔ `/admin/duyuru` ↔ `/admin/bildirimler`** | `announcements`+`announcement_reads` (ofis içi) vs `notifications` vs `platform_announcements` vs `platform_notifications`; 3 ayrı action dosyası (announcements.ts, notifications.ts, platform-notifications.ts). Ofis içi duyuru Ayarlar'ın altına gömülü, okuyan kitle çalışanlar | BIRAK tablolar (farklı kitle). Ofis duyurusunu Bildirimler sayfasına "Duyurular" sekmesi yap, `/app/ayarlar/duyurular` YÖNLENDİR; admin tarafında duyuru+bildirim tek "İletişim" sayfası | S / D |
| 8 | **Ayarlar merkezi kopya kartları** | `ayarlar/page.tsx` 55-71. satırlar: Komisyon defteri, Değerleme, Raporlar, Anlaşma hattı, Portallar, Denetim, Abonelik, İYS/EİDS, İçe Aktarma kartları menüde zaten var | KALDIR kopya kartlar (yalnız `/app/ayarlar/*` alt sayfaları + gerçekten ayar olanlar kalsın); "Sıfır çıkmaz" kuralı korunur (sayfalar menüde erişilebilir) | S / D |
| 9 | **`/app/kayip-kacak` ↔ `/app/kayip-satis` ↔ raporlar "Tahmini kayıp"** | Veri farklı: kayip-kacak `listing_closures`+`portal_listings` (portal teyit), kayip-satis `calls`+`deals`+`lost_sale_dismissals` (lost-sale-detector); `portallar` aynı `portal_listings` tablosunu okur. Çakışma veri değil ADLANDIRMA ("kayıp" ×3) | BIRAK sayfalar; ad: "Rakibe giden ilanlar" / "Risk altındaki müşteriler"; kayip-satis'i Performans yerine Müşteriler başlığına taşı (izin zaten `customers`); kayip-kacak ↔ portallar sekme çapraz linki | S / D |
| 10 | **İki yetki/kullanıcı yönetimi yeri: `/app/ekip` (rol seç, aktif/pasif) ↔ `/app/ayarlar/roller` (matris+istisna)** | Tek yetki ekranı var (`roller`: tenant_role_permissions + user_permission_overrides, actions/permissions.ts); ekip `setMemberRole` ile rolü değiştirir. `ekip/izinler` ise izin (tatil) takvimi, yetkiyle ilgisiz AMA ad aynı | BIRAK; yalnız `ekip/izinler` adını "İzin (tatil) takvimi" yap ve roller ekranına Ekip Merkezi'nden sekme/link ver | S / D |

### 4.2 Diğer adaylar (sıra dışı notlar)

| Aday | Kanıt | Karar |
|---|---|---|
| `/app/teklifler` ↔ `/app/anlasmalar` | `offers.deal_id`; kabul → `acceptOffer` anlaşma açar (actions/offers.ts 269-274). Farklı nesne, sıralı akış | BIRAK; Anlaşmalar başlığında zaten yan yana |
| `/app/musteriler/yeni` ↔ `/app/talepler/yeni` ↔ `/app/musteriler/[id]/talep/yeni` | Üçü de `DemandForm` (talepler/yeni/demand-form) paylaşır; `createCustomerWithDemand` + `createCustomer` iki action; uygulama içi müşteri insert noktaları: `actions/customers.ts:62`, `lead-intake.ts:145`, `referrals.ts:332`, `sample-data.ts:110` (+ içe aktarma, RPC) | BIRAK; `createCustomer` tek kaynak kalsın, `createCustomerWithDemand` onu çağırsın (kontrol: bkz. 5.1) |
| `/app/ice-aktarma` ↔ yeni müşteri | CSV sihirbazı farklı akış; yalnız menüde yok (Ayarlar kartı + müşteri sayfası linkleri) | BIRAK; Müşteriler listesinde "İçe aktar" düğmesi mevcut, menü eklemeye gerek yok |
| `/app/portfoyler/sunumlar` ↔ vitrin ↔ musteri/malik portalı | `presentations`, `customer_portal_tokens`, `owner_portal_tokens`: üç token'lı public yüzey, tek yönetim sayfası zaten `sunumlar` | BIRAK |
| `/app/paket` ↔ `/app/abonelik` | paket = kilit yükseltme açıklaması (`PLAN_GATES`), abonelik = ödeme. İkisi "paket" kelimesi | YÖNLENDİR değil; paket sayfasında "Paketi yönet" CTA'sı abonelik'e gitsin (ayrı amaç) |
| `/app/hesaplayici` + `/app/kira-artis` + `/app/degerleme` | hesaplayici = purchase-costs + roi-calculator (zaten sekmeli); kira-artis ayrı menü sekmesi Kiralama'da | BIRAK; kira-artis'i `valuation` yerine `rentals` iznine al |
| `/app/raporlar` + `/app/bolge-analizi` + `/app/raporlar/talep-arz` + `/app/franchise` + `/app/raporlar/memnuniyet` | Hepsi analiz; bolge-analizi ve talep-arz ayrı sorgu (geo_*), franchise yalnız Kurumsal | BİRLEŞTİR menüde: Raporlar kabuğunda sekmeler (Ofis, Bölge, Talep-arz, Memnuniyet, Şube); yollar değişmez |
| `/app/tavsiyeler` ↔ `raporlar/memnuniyet` | `referrals`/`referral_links` vs `surveys`; tavsiyeler sayfası `surveys` de okur | BIRAK |
| `/app/aidat` ↔ `/app/giderler` | İkisi `expenses` modülü; aidat portföye bağlı vade takibi (`dues` action) | BIRAK; Finans'ta ikili sekme olabilir (S) |
| `/app/onaylar` ↔ `/app/komisyon` | komisyon sayfası `approval_requests` de okur; onaylar zaten Komisyon sekmesi | BIRAK |
| `/app/baslangic` (Ofis kurulumu) ↔ Ayarlar eksik-alan listesi | ikisi de tenant alan doluluğu (`tenants`, `tenant_integrations`) ve `lib/onboarding-checklist.ts` | YÖNLENDİR: kurulum tamamlanınca menüden gizle, ayarlar kurulum kartını `onboarding-checklist` tek kaynağından beslesin |
| `/admin/hatalar` ↔ `/admin/sistem` | İkisi `error_logs` okur; hatalar menüde yok | BİRLEŞTİR: sistem sayfasına "Hatalar" sekmesi; `/admin/hatalar` YÖNLENDİR |

### 4.3 Birleştirme sırası (öneri)

1. Ayarlar kopya kartlarını sil (S, sıfır risk) + ad düzeltmeleri (kayıp, izin takvimi) (S).
2. `/app/yatirim` zaten alias: aynı kalıp `brifing`, `arama`, `cuzdan`, `eslestirme`, `lig`, `danisman-kpi`, `ayarlar/duyurular`, `admin/hatalar` için YÖNLENDİR dosyalarıyla uygulanır (her biri ayrı küçük PR).
3. Gelen Kutusu + Arama; Brifing → Ana ekran (M).
4. Cüzdan + Kazanç (`advisorShare` zaten tek kaynak).
5. Eşleştirme → Talepler sekmesi.
6. Ekip performansı büyük birleşim (#1): ÖNCE `loadAdvisorMetrics` tek veri kaynağı + gelir tanımı kararı (komisyon brüt mü, danışman payı mı, deal_value mu), SONRA sayfalar.
7. Otomasyon sayfa birleşimi, sonra motor ortak görev üreticisi.
8. Raporlar sekme kabuğu.

Yönlendirme testi (her adımda): `nav-config.test.ts` (ALL_NAV_HREFS/NAV_ALIASES), `npm run check:links` (eski yola `?param` veren linkler hedefte okunuyor mu), `page-gates.test.ts` (paket kapısı sekme taşınınca kaybolmasın: kapı sayfa yolu bazlı, ör. `/app/lig` Prof.; yönlendirme hedefi de aynı kapıdan geçmeli), `requireModulePage(mod, href)` her sekme sayfasında korunmalı.

## 5. Tekrarlı server action / lib mantığı: tek kaynağa taşıma listesi

| # | Konu | Kopyalar (kanıt) | Tek kaynak önerisi |
|---|---|---|---|
| 1 | Para biçimi | `formatTry` 4 yerde: `lib/utils.ts:8` (kuruşsuz para birimi), `lib/purchase-costs.ts:547` ("1.234 ₺"), `lib/roi-calculator.ts:115`, `kiralama/yeni/rental-form.tsx:32` (yerel); ayrıca `formatTl` (teklifler/yeni), `formatTL` (components/pricing.tsx), `formatPrice` ×3 (portfoyler/page, [id]/page, related-properties-widget; + `lib/price-history.ts:50`). `style:"currency"` geçen 47 dosya | `lib/format/money.ts` (tek `formatTry(n,{kurus?})`, `formatPrice(value,tx)`); `money-value.tsx` bileşeni onu kullansın |
| 2 | TR tarih biçimi | Yerel `fmtDate`/`formatDate`/`fmtDateTime` ≥20 dosyada (örn. ayarlar/cop-kutusu, guvenlik, duyurular, roller/user-exceptions, brifing, giderler ×2, komisyon, musteriler, portfoyler, projeler/unit-payment-plan, memnuniyet, sozlesmeler/version-history, imza, malik-portali, musteri-portali, odeme-link, admin/members/[id]); `toLocaleString/DateString("tr-TR")` 79 dosya; `lib/clock.ts`+`clock-tr.test.ts` var ama biçim yardımcısı yok | `lib/clock.ts` yanına `formatDateTr`, `formatDateTimeTr`, `formatRelativeTr`; saflık kuralı zaten orada |
| 3 | Komisyon/danışman payı | `lib/commission.ts calculateCommission` (oran/KDV), `commission-cap.ts` (tavan %4; `contract-risk.ts:72 COMMISSION_CAP_PCT=4` ikinci sabit!), `leak-shield.ts estimateLostCommission`, `team/advisor-share.ts`, `_home/helpers.ts commissionTotals`, danisman-kpi satır içi toplam, `form-tabs.ts commissionSummary`, `demo-seed-invariants.ts buildDemoCommissionRow`, `export-entities mapCommission` | Sabitler (`DEFAULT_COMMISSION_RATE`, tavan) tek dosyada; "danışman payı" yalnız `advisorShare`; toplamlar `lib/reporting`e; `COMMISSION_CAP_PCT` `commission-cap.ts`ten import edilsin |
| 4 | Danışman başına aggregate | Bkz. 4.1 #1: danisman-kpi, kiyas, kazanc, hedefler(target-actuals), lig(gamification-query), pano-tv, raporlar'da 6+ ayrı sorgu | `lib/team/advisor-metrics.ts` |
| 5 | Durum/etiket sözlükleri | `STATUS_LABELS` yerel kopyalar: acik-ev/page + acik-ev/[id], projeler/page + yeni + [id] (3), kampanyalar/[id], tavsiyeler, teklifler/[id] (+ `offer-list-logic OFFER_STATUS_LABELS`!), ag; toplam 99 `*LABEL(S)` sabiti. `deal-stage-labels.ts` ve `definitions` (stage-labels-panel) iki ayrı aşama etiketi yolu; "Müzakere" 4 dosyada (`actions/deals.ts`, `anlasmalar/yeni/deal-tabs.ts`, `stage-labels-panel.tsx`, `definition-defaults.ts`) | Her varlık için tek `*-labels.ts` (offer, project, open-house, campaign, referral); aşama etiketi yalnız `definitions` (tenant'a özel) + `deal-stage-labels` varsayılanı |
| 6 | Telefon normalizasyonu | `lib/phone.ts` (`normalizePhone`, `normalizeTurkishPhone`, `toWhatsAppLink`, `toWhatsAppShareLink`), `lib/whatsapp-link.ts` (ince sarmalayıcı, aynı iş), `lib/messaging/netgsm.ts:382` yerel `normalizePhone`, `lib/ai/redact.ts:67 digitsOnly`, `imza/_lib/sms.ts` | `whatsapp-link.ts` kaldırılıp çağıranlar (`components/app/whatsapp-link.tsx`, `degerleme/[id]/share-button`) `phone.ts`e; netgsm yerel kopya `phone.ts normalizePhone`a |
| 7 | Netgsm yapılandırma okuma | `getTenantNetgsmConfig` 3 yerde (`ayarlar/guvenlik/actions.ts`, `imza/_lib/sms.ts`, `lib/messaging/tenant-providers.ts`) | `tenant-providers.ts` tek kaynak |
| 8 | Kira artışı hesabı | `lib/rent-increase.ts computeRentIncrease` (yalnız testten import edilir) ve `lib/tufe.ts computeRentIncrease` (sayfa `kira-artis/rent-calculator.tsx` bunu kullanır). Aynı ad, iki gerçekleme | `rent-increase.ts` yeni sürüme taşınmadıysa SİL (testleriyle) veya `tufe.ts`i ona yönlendir; birinde yasal tavan hatası kalmasın |
| 9 | Tapu harcı | `lib/tapu-cost.ts computeTapuCost` yalnız testten import; canlı kod `purchase-costs.ts` | `purchase-costs.ts` tek kaynak, `tapu-cost.ts` sil |
| 10 | Görev insert | `tasks` insert 6 yerde: `actions/tasks.ts` (2), `actions/customers.ts:367`, `automation-engine.ts:253`, `playbook-engine.ts:338`, `sample-data.ts:186` — her biri kendi alan haritasıyla | `lib/tasks/insert-task.ts` tek `buildTaskRow()` (due, assigned_to, tenant_id, source) |
| 11 | Müşteri oluşturma | `customers` insert: `actions/customers.ts:62`, `lead-intake.ts:145`, `referrals.ts:332`, `sample-data.ts:110`, ice-aktarma, `createCustomerWithDemand` RPC | `lib/customers/create-customer.ts` (telefon/e-posta doğrulaması + dedupe tek yerde). Dikkat: bkz. 5.2 |
| 12 | Ortak UI kopyaları | `components/app/empty-state` (36 kullanım) vs `ui/empty-state-v3` (8); `components/app/stat-card` (13) vs `ui/stat-row` (4); `ui/table` (27) vs `ui/data-table` (3); `interactive-chart` (6) vs `ui/chart` (1) | Tasarım sistemi kılavuzuna göre `ui/*` hedef; eski bileşenler tek tek taşınana dek ince sarmalayıcı |
| 13 | Paylaşım/token linki action'ları | `shares.ts createPropertyShareLink`, `valuations.ts generateValuationShareLink`, `presentations.ts`, `payment-links.ts`, `portal-keys.ts` | `lib/share-token.ts` (token üretimi, süre, iptal) ortaklaşa; bu ayrı bir güvenlik incelemesi gerektirir |
| 14 | Randevu public/özel | `booking.ts` + `booking-public.ts` + `appointments.ts` + `appointments-confirm.ts` (4 dosya) | tek `appointments/` klasörü; `booking-slots.ts` zaten ortak lib |
| 15 | Portal etkileşim | `customer-portal.ts`/`customer-portal-feedback.ts` ve `owner-portal.ts`/`owner-portal-offers.ts` (iki aynalı çift) | Ortak `portal-token` doğrulama/limit katmanı |

### 5.1 / 5.2 Güven notları

- 5.1 `createCustomerWithDemand` ve `createCustomer` aynı doğrulamayı tekrarlıyorsa (telefon/e-posta) birleştirilmeli; bu belge fonksiyon gövdelerini satır satır karşılaştırmadı.
- 5.2 **CLAUDE.md kontrat boşluğu:** CLAUDE.md "sunucuda `src/lib/validation/contact.ts` (`phoneSchema`/`emailSchema`) veya `parsePhone`/`normalizeEmail` ile doğrulanır" diyor; ancak `lib/validation/contact.ts` hiçbir üretim dosyasından import edilmiyor (yalnız `contact.test.ts` ve `contact-input-contract.test.ts`). Fiili doğrulama `parsePhone`/`normalizeEmail` yolunda; `validation/contact.ts` ölü/yalnız test (bkz. 7).

## 6. DB envanteri (136 tablo)

Ham tablo listesi `supabase/migrations` içindeki `create table` ifadelerinden; modül gruplaması aşağıda. Kod referansı = `from("tablo")` sayısı.

| Alan | Tablolar (örnek, ilk 4-6) |
|---|---|
| Çekirdek CRM | customers, customer_demands, properties, property_media, appointments, calls, communications, tasks |
| Anlaşma/finans | deals, offers, commissions, deal_costs, deal_notes, deal_checklist_items, expenses, contracts, rentals, rent_charges, invoices, subscriptions, approval_requests |
| Otomasyon | automations, automation_logs, playbooks, playbook_steps, playbook_runs, campaigns |
| Ekip | profiles, branches, staff_leaves, targets, agent_badges, agent_score_snapshots, user_permission_overrides, tenant_role_permissions, permission_defaults |
| Public/portal | presentations, customer_portal_tokens, owner_portal_tokens, referral_links, referrals, surveys, open_houses |
| Platform | tenants, platform_staff, platform_audit_logs, platform_announcements, platform_notifications, support_tickets, cron_heartbeats, error_logs, demo_requests |
| Coğrafya | geo_provinces, geo_districts, geo_neighborhoods, geo_province_stats, geo_sync_jobs |

### 6.1 Kodda hiç `from()` ile geçmeyen 14 tablo

| Tablo | Durum | Kanıt |
|---|---|---|
| `commission_splits`, `advisor_commission_plans`, `commission_payouts`, `assignment_rules`, `assignment_rule_members` | **ÖLÜ ADAY (tasarım-only)**. Yalnız `faz2-migrations-contract.test.ts` ve design belgelerinde geçer; `advisor-share.ts` açıkça "kalıcı çözüm: splits'e profile_id — Faz 2" diyor ve komisyon `commissions.splits jsonb` kullanıyor | Karar: ya Faz 2 kodunu aç (hakediş/atama kuralı) ya da migration'ları yeni "drop" migration'ıyla kaldır; her iki durumda `docs/design/FAZ2_MIGRATIONS.md` güncellenmeli. Mevcut uygulanmış migration dosyaları DEĞİŞTİRİLMEZ (forward-only) |
| `rate_limits`, `billing_fulfillment_events`, `registration_consents`, `support_ticket_sla_alerts`, `lead_capture_token_revocations`, `iys_consent_events`, `plan_entitlements`, `geo_sync_jobs` | Meşru: SQL fonksiyon/RPC, service-role veya cron yoluyla erişilir (migration'larda `service_role_tables_explicit_deny`) | Dokunma; yalnız `registration_consents`, `support_ticket_sla_alerts` ve `lead_capture_token_revocations` için kodda doğrudan referans yok: RPC içinde kullanıldığını `check:migrations`/RPC taramasıyla doğrula |

Sütun adayları: `customer_demands.criteria` BUGÜN KULLANILIYOR (actions/demands.ts:37-59, matching.ts:27,52, match-preview.ts:45, properties.ts:98, import-data.ts:402, `lib/demand-criteria.ts`): ölü değil. Sütun düzeyinde ölü taraması için hat boyunca sütun-başına grep yapılmadı (136 tablo × sütun); öneri: `scripts/` altına `check-unused-columns.ts` (information_schema + `select(` metinleri) salt-okunur araç.

### 6.2 RLS audit uyumu

- Tarama sezgisi 14 tabloda `enable row level security` ifadesini aynı dosyada bulamadı (permission_defaults, campaigns, contracts, open_houses, automations, automation_logs, rentals, rent_charges, projects, network_demands, property_keys, playbooks, playbook_runs, agent_badges). Örnek doğrulama: `campaigns` (`20260723000028_campaigns.sql:45`) ve `permission_defaults` (`..460_permission_defaults_read_policy.sql`) AÇIK → bunlar regex yanlış negatifi (RLS `alter table ... enable` farklı biçimde/dosyada). Beklenen: hepsi RLS'li; **kanıt** için canlı DB'de `npm run db:rls-audit` koşulmalı (bu denetimde koşulmadı).
- Yeni modül kuralı (CLAUDE.md "4 kayıt yeri"): Faz 2 tabloları (`commission_splits` vb.) kod ve izin kaydı olmadan RLS'li duruyor: çıkmaz.

## 7. Ölü kod (import grafı, 1436 dosya)

Hiçbir dosyadan import edilmeyen (giriş noktaları hariç):

| Dosya | Not |
|---|---|
| `src/app/app/sample-data-cta.tsx` | bileşen kullanılmıyor |
| `src/components/admin/sparkline.tsx`, `src/components/count-up.tsx`, `src/components/app/live-office-strip.tsx`, `src/components/app/use-query-dialog.ts` | kullanılmayan UI |
| `src/components/ui/date-range-field.tsx`, `filter-bar.tsx`, `status-badge.tsx`, `switch.tsx` | tasarım sistemi bileşenleri hiç benimsenmemiş (CLAUDE.md `FilterBar`ı öneriyor, kullanım 0; `docs/DESIGN_SYSTEM.md` ile çelişir) |
| `src/hooks/use-api.ts` | kullanılmıyor |
| `src/lib/efatura.ts`, `src/lib/expense-categories.ts`, `src/lib/lead-sources.ts` | kullanılmıyor (lead-sources için `lead-score.ts` string geçişi var, doğrula) |

Yalnız testten import edilenler (üretimde ölü): `lib/rent-increase.ts`, `lib/tapu-cost.ts`, `lib/validation/contact.ts`, `lib/migration-integrity.ts` (scripts kullanıyor: ölü değil), `lib/admin-client-allowlist.ts` (sözleşme testi: kasıtlı).

Not: `src/components/admin/` altında da `count-up.tsx` var (ayrı dosya, import grafında kullanımda görünüyor); kök `components/count-up.tsx` ise yetim. Yöntem sınırları: dinamik `import()` şablonları, `next/dynamic` string yolları ve css `@import`ler dışlandı; silmeden önce her dosyada `grep -r <ad>` ile ikinci doğrulama yapın.

## 8. Önerilen modül haritası (9 başlık, yollar korunur)

Hedef: menü öğesi 46 → **~31** (yukarıdaki tablodaki öğe sayısı), kullanıcıya görünen bağımsız sayfa ~109 → ~97 (12 sayfa yönlendirme/sekmeye dönüşür). Sayfa DOSYASI silinmez, yönlendirme dosyası olarak kalır; hiçbir yol kırılmaz.

| Başlık | Öğeler (sekmeler) | Değişiklik |
|---|---|---|
| Bugün (2) | Ana ekran (Genel, Günlük brifing), AI Asistan | `brifing` ve `baslangic` ana ekrana; baslangic kurulum bitince gizlenir |
| Müşteriler (4) | Müşteriler (+Akıllı listeler, Çift kayıt, İçe aktar), Talepler (Liste, Eşleşme), Tavsiyeler, Kayıp müşteri riski | `eslestirme`→Talepler sekmesi; `kayip-satis` buraya |
| Portföy (6) | Portföyler (+Anahtar, Sunumlar), Kiralama (+Kira artışı), Projeler, Açık Ev, Portal Kontrol (+Kayıp-kaçak bağlantısı), Ofisler Arası Ağ | anahtar/sunum portföy sekmesi |
| Anlaşmalar (3) | Anlaşmalar, Teklifler, Sözleşmeler | değişmez |
| İletişim (3) | Gelen Kutusu (+Çağrı kaydı), Randevular, Görevler, Kampanyalar | `arama` Gelen Kutusu sekmesi |
| Finans (3) | Komisyon (+Onaylar), Giderler (+Aidat), Kazanç | `cuzdan`+`ekip/kazanc` tek |
| Performans (4) | Raporlar (Ofis, Bölge, Talep-arz, Memnuniyet, Şube), Ekip performansı (KPI, Kıyas, Lig, Hedefler), Kayıp-kaçak, Ofis Panosu (TV) | `danisman-kpi`+`lig`+`kiyas`+`hedefler` tek kabuk |
| Araçlar (3) | Değerleme, Hesaplayıcılar, Yabancıya Satış | değişmez |
| Ofis (6) | Ekip Merkezi (Genel, Devir/Atama, İzin takvimi, Roller), Otomasyon (Kurallar, İş akışları), Uyum & Denetim, Belge Merkezi, Abonelik & Destek, Ayarlar | `ayarlar/roller`, `ayarlar/is-akislari` menüye sekme; Ayarlar yalnız gerçek ayar |

Paket kapıları: sekme taşınsa bile `PLAN_GATES` sayfa yolu bazlı, doğru kalır; `planGatingApplies` yalnız yeni tenant (2026-10-03 sonrası) için geçerli: **yönlendirme hedefi eski yoldan farklı pakette olabilir** (örn. cuzdan kilitsiz, kazanc `/app/ekip` Ofis kapısı): birleştirme öncesi kapı hizalanmalı, yoksa "Cüzdanım" Advisor paketinde kilitlenir.

## 9. Bulgu özeti (ciddiyet · efor · risk)

| Bulgu | Ciddiyet | Efor | Risk |
|---|---|---|---|
| Danışman performansı 6 ekran, 3 farklı gelir tanımı (4.1 #1) | Yüksek (rakam güveni) | L | O |
| Paket kapısı + yönlendirme hizası (cuzdan/kazanc) | Yüksek | S | D |
| Faz 2 tabloları 5 adet kodsuz (6.1) | Orta | S (karar) / M (drop) | D |
| `validation/contact.ts` ölü; CLAUDE.md kontratı yanıltıcı (5.2) | Orta | S | D |
| `rent-increase.ts` ↔ `tufe.ts` çift `computeRentIncrease` | Orta (yasal tavan yanlışı riski) | S | D |
| Ayarlar kopya kartlar (4.1 #8) | Düşük | S | D |
| Brifing/arama/eşleştirme birleşimi (#3-#5) | Orta | M×3 | D-O |
| Otomasyon/playbook çift motor (#6) | Orta | L | O |
| Para/tarih/etiket yerel kopyaları (bölüm 5, #1-#2, #5) | Orta (bakım) | M | D |
| Ölü dosyalar (13) + yalnız-test (3) | Düşük | S | D |
| Menüsüz statik sayfa 21 | Bilgi: 0 gerçek yetim | - | - |

## Birleştirme A notu (menü sadeleştirme)

- Birleştirildi (eski yol redirect dosyası olarak durur): /app/arama -> /app/gelen-kutusu?sekme=cagri, /app/eslestirme -> /app/talepler?sekme=eslesme (matching izniyle gizli sekme), /app/ayarlar/duyurular -> /app/bildirimler?sekme=duyurular (settings izniyle gizli), /admin/hatalar -> /admin/sistem?sekme=hatalar. Sayfa içeriği `*-view.tsx` bileşenlerindedir.
- Menüde tek öğe, yollar sabit (NavTab): Raporlar (raporlar, bolge-analizi, talep-arz, memnuniyet, franchise) ve Otomasyon (otomasyonlar, ayarlar/is-akislari).
- BEKLEYEN: /app/brifing ana ekranla aynı üçlüyü (appointments, properties, tasks) yükler. Ana ekran ajanı bitince brifing içeriği ana ekranın üst bloğuna taşınıp /app/brifing -> /app?gorunum=brifing yönlendirilecek; o zamana dek Bugün başlığında tek öğe olarak durur.
