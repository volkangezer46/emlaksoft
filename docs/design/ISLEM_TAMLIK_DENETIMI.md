# İşlem Tamlık Denetimi

Tarih: 2026-10-04 · Kapsam: kod DEĞİŞMEDİ, yalnız bu belge · Taban commit: `7c11af1` (main ile güncel).

Soru: "/admin Ofisler'de ofis ekleme yoktu; bunun gibi eksik ne varsa." Bu belge her varlık için
Listele / Detay / Ekle / Düzenle / Sil / Toplu / Filtre / Dışa aktar / İçe aktar / Durum / Atama / Geçmiş
işlemlerinin arayüzde gerçekten var olup olmadığını koddan okuyarak çıkarır.

## 0. Yöntem ve okuma kılavuzu

- Okunan kaynaklar: `src/app/admin/**` (91 dosya), `src/app/app/**` (527 dosya), `src/app/actions/**` (27.592 satır),
  `src/lib/nav-config.ts`, `src/components/admin/admin-sidebar.tsx`, `src/lib/permissions.ts`,
  `supabase/migrations/**` (192 dosya, yalnız şema sorusu için), `docs/design/MODUL_ENVANTERI_360.md`, `docs/design/DIALOG_ENVANTERI.md`.
- Mekanik envanter: `"use server"` içeren 114 dosyadaki 458 `export async function` çıkarıldı; her biri için onu
  import eden/çağıran dosyalar listelendi (kelime sınırı eşleşmesi, test dosyaları hariç). "Arayüzü yok" hükmü bu listeden gelir.
- Hücre değerleri: **VAR** (dosya:satır ya da action adı) · **YOK** · **GEREKSİZ** (neden) · **KISMEN** (ne eksik).
  VAR, arayüzde düğme/form olduğu VE bir action'a bağlandığı görüldüğünde yazıldı.
- Her YOK'un arama kanıtı Bölüm 6'dadır (grep deseni + klasör). Yol kısaltması: `app/…` = `src/app/app/…`,
  `admin/…` = `src/app/admin/…`, `actions/…` = `src/app/actions/…`.
- Doğrulama sınırı: kod statik okundu; uygulama çalıştırılmadı, canlı veritabanı görülmedi (bkz. Bölüm 5).
- Kapsam dışı (başka ajanlarda): `src/app/admin/tenants/**` (ofis ekleme ve ofis yönetimi), `src/app/app/anlasmalar/deal-board*`,
  `motion.css` + animasyon bileşenleri, `themes.css` + tema dosyaları. Bunlar yalnız not olarak geçer.

### Özet

| Ölçü | Değer |
|---|---|
| Denetlenen varlık / ekran satırı | /admin 30, /app 105 |
| P0 (akış tamamlanamıyor ya da veri yanlış yere çıkıyor) | 12 (+ ofis ekleme: başka ajanda) |
| P1 (sık ihtiyaç) | 59 (Bölüm 3.2) |
| P2 (nadir) | yaklaşık 45 madde (Bölüm 3.3, gruplanmış) |
| Hâlâ popup olan ekle / düzenle akışı | 24 dosya (Bölüm 2.2) |
| Çöp kutusunun kapsadığı varlık | 2 (müşteri, portföy); kalıcı silinen 25+ varlık türü |
| Telefon / e-posta bileşeni ihlali | 1 (`src/components/app/portal-link-dialog.tsx:278`) |
| Arayüzü olmayan server action | 22 (Bölüm 2.1.3) |

Sahibin verdiği örnek için not: **şube ekleme, düzenleme ve silme VAR** (`app/ekip/page.tsx:405-427`, `team-panels.tsx:42`,
`branch-card.tsx:55,101`). Eksik olan bulunabilirlik (menüde ya da sekmede "Şubeler" yok, ekip sayfasının en altında),
aktif / pasif anahtarı, şube müdürü ataması ve iletişim alanlarıdır (P1-B5).

P0 listesinin tamamı bu denetimde kodda ikinci kez okunarak doğrulandı:

1. Müşteriye yüklenen dosyalar hiç listelenmiyor (sekme kimliği hatası).
2. Eşleşmemiş çağrı ve mesaj hiçbir müşteriye bağlanamıyor.
3. Portföysüz ya da müşterisiz açılan anlaşmaya sonradan portföy / müşteri bağlanamıyor; kazanmak ikisini de şart koşuyor.
4. Ödeme linki iptal edilemiyor; açık link "kazanmayı geri al"ı kilitliyor.
5. Kira sözleşmesi düzenlenemiyor ve uzatılamıyor; bitiş tarihi geçince tahakkuk duruyor.
6. Proje düzenlenemiyor, durumu değiştirilemiyor.
7. Daire düzenlenemiyor; fiyatsız eklenen daire satılamıyor.
8. Yetki belgesi kaydediliyor ama ekranda hiç gösterilmiyor.
9. Tapu / yetki belgesi görseli portföy galerisine yükleniyor ve public paylaşım sayfasında görünüyor.
10. Randevu başkası adına açılamıyor, danışmanı değiştirilemiyor.
11. Ekip üyesinin adı, telefonu ve e-postası hiçbir yerden düzeltilemiyor (ne kendisi ne yönetici).
12. Askıya alınan ofis ödeme sayfasına ulaşamıyor ("Ödemeyi tamamla" döngüye giriyor).

## 1. Matris

### 1.1 /admin (platform)

| Varlık / ekran | Listele | Detay | Ekle | Düzenle | Sil / arşivle (geri al) | Toplu işlem | Filtre / arama | Dışa aktar | İçe aktar | Durum değiştir | Atama / devir | Geçmiş |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ofisler (`tenants`) | NOT: başka ajanda, denetlenmedi. Gözlem: liste `admin/tenants/page.tsx:69` | NOT: `admin/tenants/[id]/page.tsx` | NOT: sayfada "Yeni/Ekle" bağlantısı yok (sahibin bulduğu eksik) | NOT: plan+durum `TenantPlanForm` (`page.tsx:338`), `subscription-panel.tsx:50` (popup) | NOT | NOT | NOT | NOT: `exportTenantsCsv` (`page.tsx:162`) | NOT | NOT | NOT: kimliğe bürünme `startImpersonation` (`page.tsx:347`) | NOT |
| Üyeler (ofis kullanıcıları, `profiles`) | VAR (`admin/members/page.tsx:80`) | VAR, salt okunur (`admin/members/[id]/page.tsx:53`) | YOK | YOK (ad, telefon, e-posta, rol, şube) | YOK (pasifleştirme yalnız ofis panelinde: `actions/team.ts:156`) | YOK | VAR (ofis, ad/telefon, durum: `page.tsx:85-88`) | VAR (`exportMembersCsv`, `page.tsx:160`) | GEREKSİZ | YOK (aktif/pasif) | YOK (rol, ofis) | VAR (son 20 giriş + son 20 denetim: `[id]/page.tsx:158-222`) |
| Üye parolası / erişim | - | - | - | YOK (parola sıfırlama bağlantısı, e-posta düzeltme, oturum kapatma) | - | - | - | - | - | - | - | - |
| Personel (`platform_staff`) | VAR (`admin/personel/page.tsx:231`, `/api/admin/personel`) | VAR (`admin/personel/[id]/page.tsx`) | VAR (tam sayfa `admin/personel/yeni` → `addPlatformStaff`, `actions/platform-staff.ts:20`) | KISMEN: rol VAR (`updateStaffRole:126`); ad ve e-posta düzenlenemez | VAR: pasif yap / aktif yap (`deactivateStaff:181`, `reactivateStaff:225`, onaylı); kalıcı silme bilinçli yok | GEREKSİZ (küçük kadro) | VAR, istemci tarafı (`page.tsx:258-269`) | YOK | GEREKSİZ | VAR | VAR (rol) | VAR (`[id]/page.tsx:189-218`) |
| Personel parolası / davet | - | - | KISMEN: davet ya da geçici parola (`platform-staff.ts:90-100`) | YOK: daveti yinele, parola sıfırla; `must_change_password` yazılıyor (`:95`) ama hiçbir yerde okunmuyor | - | - | - | - | - | - | - | - |
| Toplu duyuru (`platform_announcements`) | KISMEN: son 20, sayfalama ve arama yok (`admin/duyuru/page.tsx:56-60`) | YOK: gövde metni gösterilmiyor, satır tıklanamıyor (`:183-208`) | VAR (tam sayfa `?yeni=1` → `sendBroadcast`, `actions/platform-notifications.ts:61`) | YOK | YOK ("Gönderim geri alınamaz", `:136`) | GEREKSİZ | YOK | YOK | GEREKSİZ | YOK: zamanlama/taslak yok, anında gider | VAR (hedef kitle: tümü/aktif/deneme/belirli ofis) | KISMEN: `created_by` yazılıyor, gösterilmiyor; okunma sayısı yok |
| Destek talepleri (`support_tickets`) | VAR (`admin/tickets/page.tsx:254`) | VAR (`admin/tickets/[id]/page.tsx`) | VAR ama POPUP (`new-admin-ticket-dialog.tsx:245` → `createSupportTicketAsStaff`) | KISMEN: öncelik, kategori VAR (`ticket-detail-controls.tsx:138`); konu/gövde düzenlenemez (denetim izi için kabul edilebilir) | GEREKSİZ (kapat/çöz var); mükerrer birleştirme YOK | VAR (`ticket-bulk-toolbar.tsx:72` → `bulkUpdateTickets`, en çok 50) | VAR (durum, öncelik, kategori, atanan, ofis, SLA, arama, sıralama: `page.tsx:261-283`) | VAR (`exportTicketsCsv`, `page.tsx:530`) | GEREKSİZ | VAR (çözüm kodu + özeti zorunlu: `ticket-detail-controls.tsx:96`) | VAR (`assignTicketStaff`, `:125`) | VAR (`[id]/page.tsx:388-405`) |
| Destek yanıtı / iç not / ek | VAR (`ticket-thread`) | - | VAR (`staff-reply-form.tsx:62` → `replyTicketAsStaff`, görünürlük seçimi) | YOK (gönderilen mesaj düzeltilemez; kabul edilebilir) | KISMEN: ek silinir (`deleteTicketAttachment`), mesaj silinmez | - | - | - | - | - | - | - |
| Hazır yanıtlar (`ticket_macros`) | KISMEN: yalnız süper admin, yalnız talep detayının yan panelinde (`[id]/page.tsx:407`); ayrı sayfa yok | - | VAR (`ticket-macro-manager.tsx:54` → `createTicketMacro`) | YOK | VAR, kalıcı, onaylı (`:17` → `deleteTicketMacro`) | - | YOK | - | - | - | - | - |
| Abonelikler (`subscriptions`) | VAR (`admin/billing/page.tsx:101`) | KISMEN: satır ofis sayfasına gider (`:496`) | GEREKSİZ (kayıt ve dönüşümde otomatik) | KISMEN: plan+durum ofis sayfasından (`updateTenantPlanStatus`, `actions/platform.ts:26`); tutar, dönem, deneme bitişi düzenlenemez | KISMEN: durum "cancelled" seçilebilir; dönem sonu/iade mantığı yok | YOK | VAR (durum, tarih, ofis: `:108-111`) | VAR (`exportSubscriptionsCsv`, `:218`) | GEREKSİZ | KISMEN (yukarıdaki) | - | YOK (bu ekranda plan değişim geçmişi yok) |
| Faturalar (`invoices`) | VAR (`admin/billing/page.tsx:113`) | YOK: satır ofis sayfasına gider (`:556`); kalem, PDF yok | YOK (elle fatura kesme) | YOK | YOK (iptal/iade) | YOK | KISMEN: tarih + ofis; durum filtresi yok (`:120-122`) | VAR (`exportInvoicesCsv`, `:537`) | GEREKSİZ | YOK: "ödendi" işaretleme (havale/EFT kaydı) yok | - | KISMEN: hatırlatma sayısı (`:567`) |
| Tahsilat mutabakat kuyruğu (`billing_payment_captures`) | VAR, son 20 (`:134-139`) | YOK | - | - | - | - | YOK | YOK | - | **YOK: "Manuel inceleme" ve "İade gerekli" satırlarında hiçbir düğme yok (`:319-353`)** | - | KISMEN (deneme sayısı, hata kodu) |
| Kupon / indirim | YOK | YOK | YOK | YOK | YOK | - | - | - | - | - | - | - |
| Paket / plan tanımları | KISMEN: yalnız kodda (`src/lib/billing/plans.ts:27-92`) | - | YOK | YOK: fiyat, limit, özellik metni kod değişikliği + yayın ister | YOK | - | - | - | - | - | - | - |
| Demo talepleri / adaylar (`demo_requests`) | VAR (`admin/satis/page.tsx:57`) | VAR (`admin/satis/[id]/page.tsx`) | YOK (yalnız public form `requestDemo`; telefonla gelen aday girilemez) | YOK (ad, telefon, e-posta, şirket düzeltilemez) | YOK (spam/mükerrer silinemez; yalnız "Kaybedildi") | YOK | VAR (durum + ad/telefon/şirket: `:62-63`) | VAR (`exportDemoRequestsCsv`, `:111`) | YOK | VAR (`demo-card.tsx:61` → `setDemoStatus`) | VAR (`:68` → `assignDemo`) | KISMEN: notlar düz metin (`:225-231`), durum/atama zaman çizelgesi yok |
| Aday notu | VAR | - | VAR (`demo-card.tsx:104` → `addDemoNote`) | YOK | YOK | - | - | - | - | - | - | - |
| Adayı ofise dönüştür | - | - | VAR (`demo-card.tsx:75` → `convertDemoToTenant`) | - | - | - | - | - | - | - | - | KISMEN: "erişim bağlantısını yeniden gönder" yalnız dönüşümden hemen sonra görünür (`:187-208`, `creds` durumu); sayfa yenilenince kaybolur |
| Coğrafya: il (`geo_provinces`) | VAR (`admin/geo/page.tsx:17`) | VAR (ilçe listesi) | GEREKSİZ (81 il sabit) | VAR, satır içi (`province-row.tsx:55` → `updateProvince`) | GEREKSİZ (pasifleştir var) | - | VAR (`:21`) | GEREKSİZ (kaynak: TurkiyeAPI senkronu) | VAR: "Tara ve tamamla" (`province-row.tsx:64` → `enqueueProvinceGeoSync`) | VAR (aktif/pasif) | - | KISMEN (son tarama özeti) |
| Coğrafya: ilçe (`geo_districts`) | VAR (`admin/geo/[provinceId]/page.tsx:30`) | VAR | VAR (`new-district-form.tsx:15` → `createDistrict`) | VAR (`district-row.tsx:28`) | VAR, kalıcı, satır içi onay; bağlı mahalle varsa engeller (`actions/geo-admin.ts:191-198`) | YOK | VAR | GEREKSİZ | senkron | VAR | - | YOK |
| Coğrafya: mahalle (`geo_neighborhoods`) | VAR (`[districtId]/page.tsx:37`) | - | VAR (`new-neighborhood-form.tsx:15`) | VAR (`neighborhood-row.tsx:26`) | VAR, kalıcı; kullanılıyorsa FK hatası mesajı (`geo-admin.ts:276-280`) | YOK | VAR | GEREKSİZ | senkron | VAR | - | YOK |
| Platform bildirimleri (`platform_notifications`) | VAR (`admin/bildirimler/page.tsx:62`) | - | GEREKSİZ (sistem üretir) | - | YOK (silme/temizleme) | VAR (tümünü okundu: `:99`) | VAR (tür, durum) | GEREKSİZ | - | VAR (okundu: `:212`) | - | - |
| Bildirim tercihleri (personel) | YOK | - | - | YOK (hangi olayda bildirim: kodda) | - | - | - | - | - | - | - | - |
| Raporlar | VAR (`admin/raporlar/page.tsx`) | - | GEREKSİZ | GEREKSİZ | GEREKSİZ | - | VAR (tarih aralığı: `:173`) | VAR (`exportPlatformReportCsv`, `:151`) | - | - | - | - |
| Sistem: zamanlanmış işler (cron) | VAR (`admin/sistem/system-view.tsx:255-287`) | KISMEN (son durum + ayrıntı) | GEREKSİZ | GEREKSİZ (`vercel.json`) | - | - | YOK | YOK | - | **YOK: elle tetikleme yok** | - | KISMEN: yalnız son çalışma; çalışma geçmişi yok |
| Sistem: hata kayıtları (`error_logs`) | VAR (`admin/hatalar/errors-view.tsx:90`) | VAR (yığın izi: `:263`) | GEREKSİZ | - | GEREKSİZ: 90 günlük otomatik temizlik (`operational-retention` cron, migration `…137:64`) | YOK (toplu çözüldü) | KISMEN: açık/çözülmüş + son 1 saat; ofis, kaynak, metin araması yok | YOK | - | KISMEN: çözüldü VAR (`resolve-button.tsx:19`); yeniden aç YOK | YOK (sorumlu) | KISMEN (ilk/son görülme) |
| Sistem: entegrasyon anahtarları (`platform_settings`) | VAR (maskeli) | - | VAR: OpenAI (`openai-key-form.tsx:32`), Endeksa/Tapusor (`integration-keys-form.tsx:63`), portal (`portal-keys-form.tsx:33`); yalnız süper admin | VAR (üzerine yaz) | VAR (temizle) | - | - | - | - | YOK: bağlantıyı sına | - | YOK |
| Platform SMS / WhatsApp sağlayıcısı | KISMEN: kod `netgsm_*`, `whatsapp_api_*` anahtarlarını okuyor (`src/lib/messaging/netgsm.ts:56-58,191-192`) | - | YOK: panelde yazan form yok (yalnız ortam değişkeni ya da elle SQL) | YOK | - | - | - | - | - | - | - | - |
| Marka (logo, favicon) | VAR (`admin/marka/brand-manager.tsx`) | - | VAR (yükle: `:70`) | VAR | VAR (varsayılana dön: `:87`, `:187`) | - | - | - | - | - | - | - |
| Aktivite / denetim izi | VAR (`admin/aktivite/page.tsx:108-120`) | VAR (eski/yeni değer farkı: `:326`) | GEREKSİZ | GEREKSİZ | GEREKSİZ | - | KISMEN: kaynak (platform/ofis) + bugün; kullanıcı, ofis, işlem türü, tarih aralığı, arama yok | YOK | - | - | - | - |
| Platform genel ayarları | YOK | - | - | YOK: bakım modu, kayıt açık/kapalı, varsayılan deneme süresi, e-posta şablonları için ekran yok | - | - | - | - | - | - | - | - |
| Yapay zeka danışmanı oturumları | VAR (`admin/danisman/advisor-chat.tsx:232`) | VAR (`:258`) | VAR | GEREKSİZ | VAR (`:273` → `deleteAdvisorSession`) | - | - | - | - | - | - | - |
| Personelin kendi hesabı | - | YOK | - | YOK: profil, parola değiştirme (`admin-topbar.tsx:148-153` menüde yalnız "Ofis paneline dön" + çıkış) | - | - | - | - | - | - | - | - |

/admin için sorulara kısa cevap:

- **Plan tanımları panelden düzenlenebiliyor mu?** Hayır. Fiyat, limit ve özellik metni `src/lib/billing/plans.ts` içinde sabit;
  kota uygulaması ayrıca veritabanı tarafında (`plan_entitlements`, RPC). İkisi elle eşit tutuluyor.
- **Genel ayarlar nerede?** Ekranı yok. Bakım modu ve "kayıt açık/kapalı" kodda hiç yok (grep 0). Varsayılan deneme süresi
  SQL fonksiyonunda sabit 14 gün (`…140_atomic_registration_provisioning.sql:71`, `…400_atomic_demo_conversion.sql:19`).
- **E-posta şablonları?** Uygulama kodunda e-posta gönderen yok (grep `sendEmail|resend|smtp|nodemailer` 0 sonuç); davet ve parola
  e-postaları Supabase Auth'tan çıkar, şablonu Supabase panosunda düzenlenir.
- **SMS sağlayıcı?** Ofis başına Netgsm/WhatsApp bilgisi `/app/ayarlar` içinde (`saveNetgsmCredentials`, `saveWhatsAppCredentials`).
  Platform yedek hesabı ortam değişkeninden ya da `platform_settings`'ten okunuyor ama panelde yazma formu yok.
- **Cron elle tetikleme?** Yok; route'lar yalnız `CRON_SECRET` Bearer ile çağrılıyor, panel yalnız kalp atışını gösteriyor.

### 1.2 /app (ofis)

Sütunlar 1.1 ile aynıdır. Kısaltma: `pf/` = `app/portfoyler/`, `act/` = `actions/`.

#### 1.2.1 Müşteri ve iletişim

| Varlık / ekran | Listele | Detay | Ekle | Düzenle | Sil / arşivle (geri al) | Toplu işlem | Filtre / arama | Dışa aktar | İçe aktar | Durum değiştir | Atama / devir | Geçmiş |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Müşteri | VAR (`app/musteriler/page.tsx:876`) | VAR (`[id]/page.tsx:94`) | VAR (`yeni/customer-form.tsx:65` → `createCustomerWithDemand`) | KISMEN: `edit-customer-dialog.tsx:43` → `updateCustomer`; şube, kaynak, kara liste, danışman alanı yok; çoklu tip teke düşer (`act/customers.ts:163`) | VAR, yumuşak (`customer-row-delete.tsx:13`, `delete-customer-button.tsx:14`); geri al yalnız çöp kutusu; bağlı kayıt uyarısı yok | KISMEN: ata, etiket, yeniden ısıt, sil (`customer-bulk-actions.tsx:150-187`); mobil kartta seçim yok (`customer-rows.tsx:207-240`) | VAR (`page.tsx:262-283`) | KISMEN: `exportCustomersCsv` ekrandaki filtreyi yok sayar (`act/export.ts:57-76`) | KISMEN: sihirbaz var (`app/ice-aktarma`), listede ve menüde giriş yok | KISMEN: kara liste rozeti okunuyor, yazan action yok | KISMEN: yalnız toplu (`bulkAssignCustomers`); tekil `reassignCustomer` arayüzsüz (`act/customers.ts:860`) | VAR (`[id]/page.tsx:352`) |
| Müşteri etiketi | KISMEN: satır ve filtrede; etiket yönetim ekranı yok | GEREKSİZ | VAR (`customer-tag-chips.tsx:44`; yalnız Enter ile) | YOK (yeniden adlandır, birleştir) | VAR, onaysız (`:58`) | KISMEN: toplu ekle var, toplu kaldır yok | VAR | GEREKSİZ | YOK | GEREKSİZ | GEREKSİZ | VAR (denetim) |
| Müşteri dosyası | **KISMEN: liste hiç dolmuyor** (`[id]/page.tsx:177` koşulu `tab === "dosyalar"`; sekme kimliği `belgeler`, `customer-360-tabs.tsx:79,89`) | KISMEN (indir bağlantısına ulaşılamıyor) | VAR (`customer-files-tab.tsx:51-68`) | YOK (etiket) | KISMEN: kalıcı, yerel `confirm` (`:87`); düğmeye ulaşılamıyor | YOK | YOK | GEREKSİZ | GEREKSİZ | GEREKSİZ | GEREKSİZ | VAR (denetim) |
| İletişim kaydı / not | VAR (`customer-360-tabs.tsx:354`, `gelen-kutusu/inbox-view.tsx:449`) | KISMEN (metin kesik, tam görünüm yok) | VAR (`components/app/communication-timeline.tsx:101`) | YOK | KISMEN: kalıcı, yerel `confirm` (`:240`); sonuç kontrol edilmiyor (`act/communications.ts:119`) | YOK | KISMEN (arama yalnız müşteri adı) | YOK | YOK | GEREKSİZ | GEREKSİZ | VAR |
| Talep | VAR (`app/talepler/demands-view.tsx:584`) | VAR (`talepler/[id]/page.tsx:84`) | VAR (`yeni/demand-form.tsx:68`) | KISMEN: `edit-demand-dialog.tsx:43`; ek kriterler ve ofis tanımları yok | KISMEN: kapat / yeniden aç; silme yok | YOK | VAR (`:389-443`) | VAR (`exportDemandsCsv`; `q` ve `danisman` aktarılmıyor) | KISMEN (sihirbaz var, girişi yok) | VAR (`demand-status-switch.tsx:36`) | GEREKSİZ (müşteriden gelir) | YOK |
| Eşleşme | VAR (`app/eslestirme/matching-view.tsx:405`, son 80 talep) | VAR (satır içi gerekçe) | KISMEN: `saveMatchAndNotify` yalnız talebi "eşleşti" yapar, eşleşme kaydı tutulmaz (`act/matching.ts:76-80`) | GEREKSİZ | YOK | YOK | KISMEN (seçici yok, yalnız URL) | YOK | GEREKSİZ | KISMEN | GEREKSİZ | KISMEN (denetime yazılır, gösterilmez) |
| Akıllı liste | KISMEN: 4 sabit segment, her biri ilk 10 (`app/akilli-listeler/page.tsx:219`) | GEREKSİZ | YOK (özel liste) | YOK | GEREKSİZ | YOK | YOK | YOK | GEREKSİZ | GEREKSİZ | GEREKSİZ | GEREKSİZ |
| Kayıtlı görünüm | VAR (`components/app/saved-views.tsx:133`) | GEREKSİZ | VAR (`:88`; açılır kutu) | YOK (yeniden adlandır) | KISMEN: kalıcı; sil düğmesi yalnız hover'da (`:154`) | GEREKSİZ | GEREKSİZ | GEREKSİZ | GEREKSİZ | GEREKSİZ | YOK (kişisel, paylaşılamaz) | GEREKSİZ |
| Tavsiye bağlantısı | VAR (`app/tavsiyeler/page.tsx:516`, ilk 200) | GEREKSİZ | VAR (`referral-actions.tsx:447`) | YOK | VAR: aç/kapa (`:269`) | YOK | YOK | YOK | GEREKSİZ | VAR | KISMEN (yalnız oluştururken) | KISMEN (tıklanma sayısı) |
| Tavsiye kaydı | VAR (`:337-428`) | KISMEN | YOK (yalnız public form) | KISMEN (yalnız not) | YOK | YOK | VAR | KISMEN (`exportReferralsCsv`, filtresiz) | GEREKSİZ | VAR (`:93`) | YOK | KISMEN |
| Çağrı kaydı | VAR (`app/arama/calls-view.tsx:295`) | KISMEN (not listede görünmez) | VAR (`call-console.tsx:80`) | YOK | YOK | YOK | KISMEN (çoğu filtre yalnız URL ile) | YOK | YOK | GEREKSİZ | **YOK: eşleşmemiş çağrı müşteriye bağlanamaz** | GEREKSİZ |
| Gelen kutusu öğesi | VAR (`inbox-view.tsx:449`) | KISMEN (120 karakter) | KISMEN | YOK | YOK (işlendi / arşiv) | YOK | KISMEN | YOK | GEREKSİZ | YOK (okundu / yanıtlandı) | **YOK: eşleşmemiş öğede hiçbir eylem yok (`:501-515`)** | GEREKSİZ |
| Kampanya | VAR (`app/kampanyalar/page.tsx:327`, son 50) | KISMEN (`[id]/page.tsx` salt okunur) | VAR (`yeni/new-campaign-form.tsx:69`) | YOK (taslak düzenlenemez) | VAR, kalıcı, onaylı (`campaign-actions.tsx:69`) | YOK | VAR | YOK | GEREKSİZ | KISMEN: taslak → gönder; zamanla, iptal, yeniden dene yok | GEREKSİZ | KISMEN |
| Kampanya alıcıları | KISMEN (ilk 500) | GEREKSİZ | YOK (4 sabit hedef kitle, önizleme yok: `new-campaign-form.tsx:18-23`) | YOK | YOK | YOK (başarısızlara yeniden gönder) | VAR | YOK | YOK | GEREKSİZ | GEREKSİZ | VAR |
| İçe aktarma işi | VAR (`ice-aktarma/import-wizard.tsx:941`, son 10) | KISMEN | VAR (`:272`, `:304`) | GEREKSİZ | VAR: geri al (`:326` → `rollbackImport`; talepler kalıcı silinir) | GEREKSİZ | GEREKSİZ | VAR (hatalı satır CSV) | VAR | GEREKSİZ | VAR | VAR |
| Çift kayıt birleştirme | VAR (`musteriler/cift-kayit/page.tsx:187`) | VAR | GEREKSİZ | GEREKSİZ | KISMEN: birleştirme geri alınamaz; "mükerrer değil" yalnız tarayıcıda (`groups-client.tsx:54-75`) | GEREKSİZ | VAR | YOK | GEREKSİZ | KISMEN | GEREKSİZ | KISMEN |
| Kayıp nedenleri / risk | VAR (`app/kayip-satis/page.tsx:266`, ilk 50) | GEREKSİZ | GEREKSİZ | GEREKSİZ | KISMEN: arandı / ertele (`:482,512`); gizleneni geri getirme yok | YOK | YOK | YOK | GEREKSİZ | VAR | GEREKSİZ | KISMEN |

#### 1.2.2 Portföy, proje, portal

| Varlık / ekran | Listele | Detay | Ekle | Düzenle | Sil / arşivle (geri al) | Toplu işlem | Filtre / arama | Dışa aktar | İçe aktar | Durum değiştir | Atama / devir | Geçmiş |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Portföy | VAR (`pf/page.tsx:700`) | VAR (`pf/[id]/page.tsx:133`) | VAR (`pf/yeni/property-form.tsx:94`) | KISMEN: `edit-property-dialog.tsx:69`; açıklama, şube, gizli fiyat, yabancıya uygunluk yok | KISMEN: yumuşak (`property-admin-actions.tsx:14` → `act/properties.ts:543`); bağlı kayıt kontrolü yok; geri al yalnız çöp kutusu | KISMEN: yalnız toplu durum (`property-bulk-actions.tsx:106`); mobilde seçim yok | KISMEN: durum filtresi yalnız Yayında / Teyit / Taslak (`pf/page.tsx:134-139`) | KISMEN: filtre uygulanmaz (`act/export.ts:133-146`) | KISMEN (sihirbaz var, girişi yok) | KISMEN: detayda 4, toplu işlemde 6 durum; nedenli `changePropertyStatus` arayüzsüz | VAR (`property-admin-actions.tsx:49` → `reassignProperty`) | VAR (`pf/[id]/page.tsx:936`) |
| Portföy medyası | VAR (`pf/[id]/property-media-manager.tsx:634`) | KISMEN | VAR (`:496-504`, `:794`) | KISMEN: kapak, sıra; sıra yalnız sürükle-bırak (`:638-655`) | VAR, kalıcı; görselde onaylı, video/tur bağlantısında onaysız (`:775-786`) | VAR (`:584`, `:606`) | GEREKSİZ | KISMEN | GEREKSİZ | GEREKSİZ | GEREKSİZ | KISMEN |
| Portföy belgesi (tapu vb.) | **KISMEN: ayrı varlık yok; tapu görseli galeriye karışır ve public paylaşımda görünür** (`src/app/paylas/[token]/page.tsx:169-174`) | KISMEN (OCR sonucu popup) | KISMEN: yalnız görsel, PDF yüklenemez (`src/lib/direct-file-uploads.ts:63-66`) | KISMEN | VAR, kalıcı | VAR | YOK | KISMEN | GEREKSİZ | YOK ("paylaşımda gizle") | GEREKSİZ | KISMEN |
| Anahtar | VAR (`pf/anahtarlar/page.tsx:317`) | VAR (`pf/[id]/property-keys-section.tsx:229`) | KISMEN: yalnız portföy detayından (`:143-203`); panoda "Yeni" yok | YOK | VAR, kalıcı, onaylı (`:318-335`); dışarıdaki anahtar da silinir | YOK | VAR | YOK | GEREKSİZ | KISMEN: çıkış, iade, kayıp; "kayıp → bulundu" yok | VAR (`:341-448`) | VAR |
| Yetki belgesi | KISMEN (yalnız "15 günde dolacak" şeridi, `app/portallar/page.tsx:236`) | **KISMEN: kaydediliyor, gösterilmiyor** (`pf/[id]/page.tsx:171` select'inde `authorization_*` yok; `:890-905` hep boş) | KISMEN (`property-extras.tsx:130`; dosya eki yok) | KISMEN (form boş açılır) | GEREKSİZ | YOK | YOK | YOK | YOK | GEREKSİZ | GEREKSİZ | YOK |
| Fiyat ve durum geçmişi | VAR (`property-price-history.tsx:235`; zaman çizelgesi) | GEREKSİZ | GEREKSİZ (tetikleyici) | GEREKSİZ | GEREKSİZ | GEREKSİZ | KISMEN ("Gizli fiyat" sekmesi hep boş) | YOK | GEREKSİZ | GEREKSİZ | GEREKSİZ | VAR |
| Proje | VAR (`app/projeler/page.tsx:224`) | VAR (`[id]/page.tsx:27`) | VAR (`yeni/new-project-form.tsx:31`) | **YOK** | **YOK** | YOK | KISMEN (durum çipi; arama yok; 200 sınır) | VAR (`:88`) | YOK | **YOK** (durum yalnız oluştururken) | YOK | YOK |
| Proje birimi (daire) | VAR (`[id]/units-board.tsx:237`) | VAR (popup, `:300`) | VAR ama POPUP (`add-units-dialog.tsx:88`, `:132`) | **YOK** (fiyat, oda, m²) | **YOK** | KISMEN (toplu üretim) | KISMEN (istemci tarafı) | YOK | YOK | KISMEN: rezerve / kapora / satıldı / serbest bırak (`:422-500`); satılmışta serbest bırak tetikleyiciye takılır (`…813…:2460-2490`) | KISMEN (müşteri) | YOK |
| Birim ödeme planı | VAR (`unit-payment-plan.tsx:297`) | GEREKSİZ | KISMEN (plan; tek taksit eklenemez) | YOK | KISMEN (yalnız ödeme alınmamışsa, komple) | YOK | KISMEN | YOK | GEREKSİZ | VAR (`:320-326`) | GEREKSİZ | YOK |
| Açık ev etkinliği | VAR (`app/acik-ev/page.tsx:248`, 50 sınır) | VAR (`[id]/page.tsx:59`) | VAR (`yeni/open-house-form.tsx:32`) | **YOK** (tarih, saat, konum) | YOK (yalnız "İptal" durumu) | YOK | KISMEN | YOK | GEREKSİZ | VAR (`[id]/status-select.tsx:33`) | YOK | KISMEN |
| Açık ev ziyaretçisi | VAR (`[id]/page.tsx:219`) | GEREKSİZ | VAR (`visitor-form.tsx:35`) | YOK | YOK | YOK | YOK | YOK | GEREKSİZ | VAR (müşteriye dönüştür) | YOK | GEREKSİZ |
| Sunum | VAR (`pf/sunumlar/page.tsx:165`, 100 sınır) | KISMEN (public link) | VAR (`yeni/presentation-form.tsx:146`) | YOK | VAR, kalıcı, onaylı (`presentation-actions.tsx:36`) | YOK | YOK | YOK | GEREKSİZ | YOK | GEREKSİZ | KISMEN |
| Müşteri portal bağlantısı | VAR (`pf/sunumlar/shared-portals.tsx:175`) | GEREKSİZ | VAR ama POPUP (`components/app/portal-link-dialog.tsx:129`) | YOK (süre uzatma) | VAR: iptal (`shared-portals.tsx:61`) | YOK | YOK | GEREKSİZ | GEREKSİZ | KISMEN | GEREKSİZ | KISMEN |
| Malik portal bağlantısı | VAR | GEREKSİZ | KISMEN: POPUP; giriş yalnız masaüstü liste satırında (`pf/property-rows.tsx:134`), detayda ve mobilde yok | YOK | VAR: iptal | YOK | YOK | GEREKSİZ | GEREKSİZ | KISMEN | GEREKSİZ | KISMEN |
| Portföy paylaşım linki | YOK | YOK | VAR (`property-workflow.tsx:61`; her tıkta yeni link) | YOK | YOK (iptal) | YOK | YOK | GEREKSİZ | GEREKSİZ | YOK (30 gün sabit) | GEREKSİZ | YOK |
| Portal ilanı | VAR (`app/portallar/page.tsx:413`) | GEREKSİZ | VAR (`portal-dialogs.tsx:85`, satır içi panel) | YOK | YOK (yalnız "Kapat") | KISMEN (toplu teyit) | KISMEN | KISMEN (filtresiz) | YOK | KISMEN (yeniden aç yok) | GEREKSİZ | KISMEN |
| Ağ paylaşımı (ilan, talep, iş birliği) | VAR (`app/ag/page.tsx`) | GEREKSİZ | VAR (paylaşım satır içi; iş birliği ve öneri POPUP) | KISMEN (yeniden paylaşarak) | VAR, kalıcı, onaylı; geri çekme onaysız | YOK | KISMEN | YOK | GEREKSİZ | VAR | YOK | YOK |
| Değerleme raporu | KISMEN (son 40, `app/degerleme/page.tsx:74`) | VAR | VAR (`valuation-form.tsx:36`) | YOK | YOK | YOK | YOK | KISMEN (yazdır + paylaşım linki) | GEREKSİZ | KISMEN (paylaşım geri alınamaz) | GEREKSİZ | YOK |
| Belge merkezi | VAR (`app/belgeler/page.tsx:842`) | VAR | YOK (yükleme yok) | YOK | VAR, kalıcı, onaylı (`document-list.tsx:293`) | VAR | VAR | KISMEN | YOK | GEREKSİZ | GEREKSİZ | KISMEN |
| Kapanan ilan (kayıp-kaçak) | VAR (`app/kayip-kacak/page.tsx:767`) | YOK | VAR ama POPUP (`portal-dialogs.tsx:165`) | YOK | YOK | YOK | VAR | YOK | GEREKSİZ | KISMEN | YOK | YOK |

#### 1.2.3 İş takibi, ekip, otomasyon

| Varlık / ekran | Listele | Detay | Ekle | Düzenle | Sil / arşivle (geri al) | Toplu işlem | Filtre / arama | Dışa aktar | İçe aktar | Durum değiştir | Atama / devir | Geçmiş |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Randevu | VAR (`app/randevular/page.tsx:862`) | YOK (`[id]` sayfası yok) | **KISMEN: danışman seçilemez, hep oluşturan kişi** (`act/appointments.ts:149`) | KISMEN: `appointment-edit-dialog.tsx:47`; müşteri, portföy, danışman değişmez | KISMEN: iptal tek tık, onaysız (`appointment-rows.tsx:92`); iptal edilen listeden düşer (`page.tsx:219`), geri alma düğmesi yok | YOK | VAR | KISMEN (CSV filtreyi yok sayar) | YOK | KISMEN | KISMEN (yalnız toplu devir) | YOK |
| Rezervasyon ayarı, takvim aboneliği | GEREKSİZ | VAR | VAR | VAR (`booking-link-form.tsx:128`) | KISMEN: bağlantı yenileme onaysız | GEREKSİZ | GEREKSİZ | GEREKSİZ | GEREKSİZ | VAR | GEREKSİZ | KISMEN |
| Görev | VAR (`app/gorevler/page.tsx:345`) | KISMEN | VAR (`yeni/task-form.tsx:56`, `quick-task.tsx:30`) | KISMEN: atanan kişi alanı yok (action destekliyor: `act/tasks.ts:204,228`) | VAR, kalıcı, onaylı (`task-card.tsx:229`) | KISMEN (yalnız toplu tamamla) | KISMEN (danışmana göre yok) | YOK | YOK | VAR | KISMEN | YOK |
| Otomasyon kuralı | VAR (`app/otomasyonlar/page.tsx:227`, 50 sınır) | KISMEN | VAR (tam sayfa) | VAR ama POPUP (`automation-wizard.tsx:525`) | VAR, kalıcı, onaylı (`automation-actions.tsx:101`) | YOK | KISMEN | YOK | GEREKSİZ | VAR | GEREKSİZ | KISMEN |
| İş akışı (playbook) ve adımları | VAR (`app/ayarlar/is-akislari/playbooks-manager.tsx:515`) | KISMEN | VAR | VAR (sayfa içi) | VAR, kalıcı, onaylı (`:578`) | GEREKSİZ | YOK | YOK | GEREKSİZ | KISMEN (hata gösterilmez) | VAR | KISMEN ("N çalışma" tıklanamaz) |
| Hedef | VAR (`app/hedefler/page.tsx:226`, 50 sınır) | GEREKSİZ | VAR (`target-create-panel.tsx:57`) | VAR (`target-form-dialog.tsx:48`) | VAR, kalıcı, onaylı | YOK (herkese / geçen ayı kopyala) | YOK | YOK | YOK | GEREKSİZ | VAR | YOK |
| Ekip üyesi | VAR (`app/ekip/page.tsx:301`) | KISMEN: `ekip/[id]` salt okunur | VAR (`ekip/yeni/advisor-form.tsx:110`) | **KISMEN: rol + şube VAR (`page.tsx:373-385`); ad, telefon, e-posta düzenleme hiç yok** | KISMEN: pasifleştir / aktifleştir onaysız (`:386-392`); silme yok | YOK | YOK | YOK | YOK | VAR | VAR (`[id]/member-handoff.tsx:109`) | KISMEN |
| Davet / parola | KISMEN | GEREKSİZ | VAR (davet ya da geçici parola) | YOK | YOK | YOK | YOK | GEREKSİZ | GEREKSİZ | KISMEN: "Daveti yinele" yalnız hiç giriş yapmamış üyede, sonuç mesajsız (`page.tsx:345-356`); giriş yapmış üye için parola sıfırlama yok | GEREKSİZ | YOK |
| Şube | VAR (`ekip/page.tsx:405`; menüde ayrı girişi yok, ekip sayfasının altında) | YOK | VAR (`team-panels.tsx:42`; yalnız ad + il) | VAR (`branch-card.tsx:55`; yalnız ad + il) | VAR, kalıcı; üyesi varsa engeller (`act/team.ts:339-345`) | GEREKSİZ | GEREKSİZ | GEREKSİZ | GEREKSİZ | KISMEN: action `is_active` destekler, arayüz yok | KISMEN: şube müdürü atanamaz (`manager_user_id` kullanılmıyor) | YOK |
| İzin / tatil | VAR (`app/ekip/izinler/page.tsx:320`) | GEREKSİZ | VAR (`leave-form.tsx:81`) | YOK | VAR, kalıcı, onaylı | YOK | KISMEN | YOK | YOK | VAR (onayla / reddet, gerekçesiz) | GEREKSİZ | KISMEN |
| Devir / toplu atama | VAR (`app/ekip/devir/page.tsx:127`) | VAR | VAR | GEREKSİZ | YOK (geri alma) | VAR | GEREKSİZ | YOK | GEREKSİZ | GEREKSİZ | VAR | YOK |
| Rol izin matrisi | VAR (`app/ayarlar/roller/page.tsx:201`) | GEREKSİZ | GEREKSİZ | VAR (`role-permissions-matrix.tsx:77`) | VAR: varsayılana döndür, onaysız (`:130`) | YOK | GEREKSİZ | YOK | GEREKSİZ | GEREKSİZ | GEREKSİZ | YOK (denetime yazılmıyor) |
| Kullanıcı izin istisnası | KISMEN (özet yok) | GEREKSİZ | VAR (`user-exceptions.tsx:102`) | VAR | VAR, onaysız | KISMEN | VAR | YOK | GEREKSİZ | VAR | GEREKSİZ | YOK |
| Özel rol | YOK | YOK | YOK (8 sabit rol, `init.sql:79-80`) | YOK | YOK | - | - | - | - | - | - | - |
| Tanım (seçim listesi), aşama etiketi | VAR (`app/ayarlar/tanimlar/definitions-manager.tsx:204`) | GEREKSİZ | VAR | KISMEN (sistem tanımları değişmez) | VAR, kullanım kontrolü var (`act/definitions.ts:259`) | YOK | KISMEN | YOK | YOK | VAR (gizle / göster) | GEREKSİZ | KISMEN |
| Dijital kartvizit | KISMEN | VAR (`app/ekip/kartvizitim/page.tsx`) | GEREKSİZ | **KISMEN: sayfa `team` modülü ister (`:24`); danışman rolünde bu modül yok (`src/lib/permissions.ts:159-182`), yani danışman kendi kartvizitine giremez** | VAR | GEREKSİZ | GEREKSİZ | VAR (QR) | GEREKSİZ | VAR | GEREKSİZ | KISMEN |

#### 1.2.4 Anlaşma, sözleşme, finans, kiralama

`CWI` = `supabase/migrations/20260813000000_core_workflow_invariants.sql`.

| Varlık / ekran | Listele | Detay | Ekle | Düzenle | Sil / arşivle (geri al) | Toplu işlem | Filtre / arama | Dışa aktar | İçe aktar | Durum değiştir | Atama / devir | Geçmiş |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Anlaşma | VAR (`app/anlasmalar/page.tsx:153`) | VAR (`[id]/page.tsx:117`) | VAR (`yeni/new-deal-form.tsx:43`) | **KISMEN: yalnız pano popup'ında tutar, olasılık, tür, danışman (`deal-board.tsx:457`); portföy ve müşteri hiçbir yerden bağlanamaz (`act/deals.ts:299-303`)** | YOK (silme / arşiv) | YOK | VAR | KISMEN (filtresiz) | YOK | KISMEN: aşama geçişi yalnız panoda; detayda yalnız kazan / kaybet | KISMEN (yalnız pano popup'ı) | VAR (`[id]/page.tsx:606`) |
| Anlaşma maliyeti | VAR (`[id]/deal-costs-section.tsx:104`) | GEREKSİZ | VAR (`:175`) | YOK | VAR, kalıcı, onaylı; denetim kaydı yok | GEREKSİZ | GEREKSİZ | YOK | GEREKSİZ | VAR (ödendi) | GEREKSİZ | KISMEN |
| Anlaşma notu | VAR (`deal-notes-section.tsx:76`) | GEREKSİZ | VAR (`:122`) | YOK (bilinçli) | VAR, kalıcı; sil düğmesi yalnız hover'da (`:108`) | GEREKSİZ | YOK | YOK | GEREKSİZ | GEREKSİZ | GEREKSİZ | VAR |
| Anlaşma kontrol listesi (evrak) | VAR (`deal-checklist-section.tsx:170`) | GEREKSİZ | VAR (şablon `:148`, tek madde `:303`) | KISMEN: yalnız not; dosya eklenemez (`file_url` sütunu var, yazan kod yok) | VAR, kalıcı, onaylı | KISMEN | GEREKSİZ | YOK | GEREKSİZ | VAR | YOK | VAR |
| Teklif | VAR (`app/teklifler/page.tsx:122`) | VAR (`[id]/page.tsx:85`) | KISMEN: seçiciler son 200 portföy / ilk 300 müşteri, arama yok (`yeni/page.tsx:31,37`) | KISMEN: tutar, geçerlilik, not (`offer-edit-dialog.tsx:30`) | YOK (yalnız "Geri çek") | YOK | VAR | KISMEN (filtresiz) | YOK | VAR ama onaysız ve geri alınamaz (`offer-status-actions.tsx:43-67`) | YOK | KISMEN |
| Teklif turu | VAR (`[id]/page.tsx:311`) | GEREKSİZ | VAR ama POPUP (`offer-round-dialog.tsx:40`) | YOK | YOK | GEREKSİZ | GEREKSİZ | YOK | GEREKSİZ | GEREKSİZ | GEREKSİZ | VAR |
| Sözleşme | VAR (`app/sozlesmeler/page.tsx:142`) | VAR (`[id]/page.tsx:73`) | KISMEN: formda müşteri / portföy seçici yok, yalnız URL ön dolgusu (`yeni/new-contract-form.tsx:310-311`) | KISMEN: yalnız taslakta başlık + içerik (`[id]/duzenle/edit-contract-form.tsx:22`) | KISMEN: iptal (geri alınamaz); silme yok | YOK | VAR | KISMEN: CSV filtresiz; ofis tarafında PDF / yazdır yok | YOK | KISMEN ("Reddedildi" hiçbir akışta oluşmuyor) | YOK | KISMEN |
| Sözleşme imzacısı | VAR (`[id]/page.tsx:375`) | GEREKSİZ | KISMEN: yalnız gönderim anında (`contract-sign-panel.tsx:63-111`) | YOK (gönderim sonrası telefon / e-posta düzeltilemez) | YOK | GEREKSİZ | GEREKSİZ | GEREKSİZ | GEREKSİZ | KISMEN: SMS yeniden gönder ve imzacı reddi yok | GEREKSİZ | VAR (IP, zaman) |
| Sözleşme sürümü | VAR (`version-history.tsx:48`) | VAR | GEREKSİZ | GEREKSİZ | VAR: sürüme dön (`:57`) | GEREKSİZ | GEREKSİZ | YOK | GEREKSİZ | GEREKSİZ | GEREKSİZ | VAR |
| Sözleşme şablonu | KISMEN: yalnız yeni sözleşme galerisi (`new-contract-form.tsx:268`); yönetim ekranı yok | KISMEN | KISMEN: yalnız sözleşme oluştururken onay kutusu (`:371`) | YOK | YOK | YOK | YOK | YOK | YOK | YOK (`is_active` sütunu var) | GEREKSİZ | YOK |
| Komisyon kaydı | VAR (`app/komisyon/page.tsx:563`) | KISMEN | GEREKSİZ (anlaşmadan doğar); iki ekrandaki "elle ekleyin" metni karşılıksız | KISMEN (yalnız paylaşım) | KISMEN ("kazanmayı geri al" siler) | VAR (toplu tahsil: `bulk-collect.tsx:71`) | KISMEN | KISMEN (filtresiz) | YOK | VAR (`commission-actions.tsx:79-106`) | GEREKSİZ | YOK |
| Komisyon paylaşımı | VAR | GEREKSİZ | VAR ama POPUP (`commission-split-editor.tsx:53`; satır içi eşi `kapanis-sihirbazi.tsx:440`) | VAR | VAR | YOK | GEREKSİZ | YOK | GEREKSİZ | GEREKSİZ | KISMEN (pay serbest metin, danışman kimliği bağlanmaz) | YOK |
| Danışman hakediş ödemesi | KISMEN (salt okunur: `app/cuzdan/page.tsx:348`) | GEREKSİZ | YOK | YOK | YOK | YOK | YOK | KISMEN (yazdır) | YOK | YOK | GEREKSİZ | YOK |
| Onay talebi | VAR (`app/onaylar/page.tsx:346`) | VAR | VAR (`yeni/new-approval-form.tsx:27`) | YOK | VAR: iptal (`approval-actions.tsx:130`) | YOK | KISMEN | YOK | GEREKSİZ | VAR ama POPUP (`:49`) | YOK | VAR |
| Gider | KISMEN: 200 kayıt tavanı, sayfalama yok (`act/expenses.ts:123`) | GEREKSİZ | VAR (`expense-create-form.tsx:26`) | VAR (`expense-edit-dialog.tsx:42`); düzenleme portföy bağını siler (`act/expenses.ts:69`) | VAR, kalıcı; mobilde sütun gizli (`expenses-table.tsx:152`) | YOK | KISMEN | KISMEN (filtresiz) | YOK | GEREKSİZ | GEREKSİZ | YOK (denetime yazılmıyor) |
| Aidat / vergi vadesi | VAR (`app/aidat/dues-client.tsx:231`) | GEREKSİZ | VAR (`:137`) | YOK | VAR, kalıcı; mobilde gizli (`:299`) | VAR (toplu ödendi: `:208`) | KISMEN | KISMEN (filtresiz) | YOK | VAR; mobilde gizli | GEREKSİZ | YOK |
| Kira sözleşmesi | VAR (`app/kiralama/page.tsx:122`) | VAR (`[id]/page.tsx:47`) | VAR (`yeni/rental-form.tsx:68`) | **YOK** (vade günü, bitiş, depozito, not, kiracı) | KISMEN: sonlandır (`end-rental-button.tsx:18`); geri alma, silme yok | YOK | VAR | VAR (filtreli) | YOK | **KISMEN: uzatma / yenileme yok; bitiş geçince tahakkuk durur (`act/rentals.ts:204-206`, cron `kira-tahakkuk/route.ts:104`)** | YOK | KISMEN |
| Kira tahakkuku / tahsilatı | VAR (`[id]/charges-panel.tsx:123`) | GEREKSİZ | VAR (`:98`; cron) | YOK | YOK | YOK | KISMEN | YOK | YOK | VAR (ödendi / geri al: `:136-149`); kısmi ödeme ve gerçek ödeme tarihi yok | GEREKSİZ | KISMEN |
| Depozito | VAR (`[id]/page.tsx:149`) | GEREKSİZ | VAR | YOK | GEREKSİZ | GEREKSİZ | GEREKSİZ | YOK | GEREKSİZ | VAR (`deposit-return.tsx:41`); kısmi iade yok | GEREKSİZ | KISMEN |
| Arıza / bakım talebi | KISMEN: yalnız kira detayında (`maintenance-panel.tsx:125`); ofis geneli liste yok | GEREKSİZ | VAR (`:102`) | KISMEN (durum, maliyet) | YOK | YOK | KISMEN | YOK | YOK | VAR | YOK (usta / sorumlu) | YOK |
| Kira artışı | KISMEN (yenileme radarı: `kiralama/page.tsx:286`) | GEREKSİZ | KISMEN: POPUP, yalnız 60 günlük radar kartında (`apply-increase-dialog.tsx:54`); hesaplayıcı uygulamıyor | YOK | YOK (geri alınamaz) | YOK | GEREKSİZ | YOK | GEREKSİZ | GEREKSİZ | GEREKSİZ | KISMEN |
| Ödeme linki | **YOK** (ofis listesi yok) | KISMEN (public sayfa) | KISMEN: yalnız komisyon satırından, tek tık, onaysız (`commission-actions.tsx:107`) | YOK | **YOK (iptal yok)** | YOK | YOK | YOK | GEREKSİZ | KISMEN | GEREKSİZ | KISMEN |

#### 1.2.5 Ayarlar, hesap, abonelik, destek, uyum

| Varlık / ekran | Listele | Detay | Ekle | Düzenle | Sil / arşivle (geri al) | Toplu işlem | Filtre / arama | Dışa aktar | İçe aktar | Durum değiştir | Atama / devir | Geçmiş |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ofis profili (ad, adres, telefon, vergi) | GEREKSİZ | VAR (`app/ayarlar/page.tsx:223`) | GEREKSİZ | KISMEN: `company-form.tsx:57` → `updateTenantInfo`; ofis e-postası yok, il / ilçe serbest metin | GEREKSİZ | - | - | - | - | - | - | KISMEN |
| Ofis logosu | GEREKSİZ | VAR | VAR (`logo-upload-form.tsx:77`) | VAR | KISMEN: kalıcı, yerel `confirm` (`:40`) | - | - | - | - | - | - | YOK |
| Entegrasyon: Netgsm, WhatsApp | VAR (`ayarlar/entegrasyonlar/page.tsx:50`, salt okunur durum kartı) | VAR (`integrations-form.tsx:94-331`) | VAR (`:114`, `:221`) | VAR | VAR, kalıcı, onaylı (`:174`, `:315`) | - | - | - | - | KISMEN: Netgsm için bağlantı testi / deneme SMS yok | - | KISMEN |
| Entegrasyon: portal, yapay zeka, Endeksa, Tapusor, iyzico | VAR (durum) | KISMEN | GEREKSİZ (platform geneli, yalnız süper admin) | GEREKSİZ | GEREKSİZ | - | - | - | - | YOK | - | - |
| Filigran, eşleştirme ağırlıkları | GEREKSİZ | VAR | GEREKSİZ | VAR (`filigran/watermark-form.tsx:163`, `matching-weights-form.tsx:68`) | VAR (varsayılana dön) | - | - | - | - | VAR | - | VAR |
| Aday yakalama (form + token) | KISMEN (gelen aday listesi yok) | VAR (`ayarlar/lead/page.tsx:54`) | GEREKSİZ | KISMEN: yalnız aç/kapa + token yenile; kartın vaat ettiği atama kuralı yok | VAR (token yenile, onaylı) | - | - | - | - | VAR | KISMEN | VAR |
| Mesaj şablonu | VAR (`mesaj-sablonlari/page.tsx:15`, 200 sınır) | KISMEN | VAR (satır içi: `templates-manager.tsx:135`) | VAR (`:316`) | VAR, kalıcı, onaylı (`:324`) | YOK | YOK | YOK | KISMEN (hazır set) | VAR (`:302`) | GEREKSİZ | KISMEN |
| Ofis duyurusu | VAR (`duyurular/announcements-view.tsx:13`) | KISMEN: üye 3 satır görür, okununca kaybolur (`app/_home/duyuru-satiri.tsx:38,65`) | VAR (satır içi: `announcements-manager.tsx:111`) | VAR (`:238`) | VAR, kalıcı, onaylı (`:246`) | YOK | YOK | YOK | GEREKSİZ | KISMEN: sabitle, bitiş VAR; başlangıç zamanlama yok (`starts_at` sütunu var) | GEREKSİZ | KISMEN (okuma sayısı; kim okudu yok) |
| Bildirim | VAR (`bildirimler/notifications-view.tsx:66`) | KISMEN (tek satır) | GEREKSİZ | GEREKSİZ | YOK | VAR (tümünü okundu: `:159`) | KISMEN | GEREKSİZ | GEREKSİZ | KISMEN: ofis geneli bildirimde `read_at` tek sütun, biri okuyunca herkese okunmuş olur (`act/notifications.ts:36-53`) | GEREKSİZ | GEREKSİZ |
| Bildirim tercihi, push | GEREKSİZ | KISMEN: yalnız `/app/ayarlar` içinde (`settings` kapılı) | VAR | KISMEN: `settings` modülü olmayan 5 rol sayfaya giremez | KISMEN (yalnız bu cihaz) | - | - | - | - | VAR | - | - |
| Çöp kutusu | KISMEN: yalnız müşteri + portföy, son 90 gün, tür başına 100 (`cop-kutusu/page.tsx:33-48`) | YOK | GEREKSİZ | GEREKSİZ | KISMEN: geri al VAR (`:92`, `:132`); kalıcı sil yok (bilinçli) | YOK | YOK | YOK | - | - | - | KISMEN (kimin sildiği yok) |
| Güvenlik: iki adımlı doğrulama | GEREKSİZ | VAR (`guvenlik/page.tsx:82`) | GEREKSİZ | KISMEN: sayfa `settings` kapılı (`:53`); telefon yoksa kilitli ve telefon ekleme yolu yok | GEREKSİZ | - | - | - | - | VAR | - | YOK |
| Güvenlik: giriş geçmişi, oturumlar | KISMEN (son 20 giriş) | KISMEN | - | - | YOK: aktif oturum listesi ve "tüm cihazlardan çık" yok | - | YOK | YOK | - | - | - | - |
| Kullanıcı profili (ad, telefon, e-posta, avatar) | GEREKSİZ | **YOK** (profil sayfası yok; menüde yalnız Ayarlar / görünüm / çıkış: `components/ui/console/user-menu-panel.tsx:63-99`) | GEREKSİZ | **KISMEN: ad ve e-posta hiçbir yerden; telefon yalnız danışmanın hoş geldin akışında (`act/onboarding-setup.ts:115`); avatar yalnız kartvizitte** | - | - | - | - | - | - | - | YOK |
| Parola | - | - | - | **KISMEN: uygulama içinde parola değiştirme yok** (`updateUser` yalnız `src/app/sifre-yenile/reset-form.tsx:80`); tek yol e-postayla sıfırlama | - | - | - | - | - | - | - | YOK |
| Abonelik / plan | VAR (`app/abonelik/page.tsx:227`) | VAR | VAR (`checkout-button.tsx:39` → `startPlanCheckout`) | KISMEN: yükselt / düşür aynı düğme, oransal hesap yok | **YOK (iptal)** | - | - | - | - | YOK (duraklat / iptal) | - | KISMEN |
| Fatura (ofis tarafı) | KISMEN (son 8: `abonelik/page.tsx:71`) | YOK (satır tıklanamaz) | GEREKSİZ | KISMEN (fatura bilgisi = firma bilgileri) | GEREKSİZ | - | YOK | YOK (indirme / PDF) | - | - | - | - |
| Ödeme yöntemi | YOK | YOK | YOK (kart saklanmıyor; her dönem ödeme formu) | YOK | YOK | - | - | - | - | - | - | - |
| Destek talebi (ofis tarafı) | VAR (`app/destek/page.tsx:125`) | VAR (`[id]/page.tsx:81`) | KISMEN: düğme herkese görünür (`page.tsx:272`), action `support:create` ister (`act/tickets.ts:161`); danışman dahil 4 rolde yalnız görüntüleme var | YOK (konu, öncelik) | GEREKSİZ | GEREKSİZ | VAR | YOK | GEREKSİZ | VAR (kapat / yeniden aç, yanıt, memnuniyet) | GEREKSİZ | VAR |
| KVKK silme talebi | VAR (`uyum/kvkk-panel.tsx:221`, son 50) | KISMEN | VAR ama POPUP (`:108-197`) | GEREKSİZ | GEREKSİZ (geri alınamaz) | KISMEN: toplu temizlik onaysız, süre sabit 1095 gün (`:78`, `:99-106`) | YOK | YOK | - | KISMEN | - | VAR |
| Veri sahibi erişim / taşınabilirlik talebi | YOK | YOK | YOK | - | - | - | - | YOK | - | - | - | - |
| İYS izni | KISMEN (son 100; sayılar bu dilimden: `uyum/page.tsx:58-83`) | KISMEN | VAR (`iys-form.tsx:36`) | KISMEN | GEREKSİZ | YOK | KISMEN | YOK | YOK | VAR | - | KISMEN |
| Denetim kaydı | VAR (`app/denetim/page.tsx:174`) | KISMEN (tam fark yalnız `title` içinde: `:416`) | GEREKSİZ | GEREKSİZ | GEREKSİZ | - | KISMEN (işlem türü, metin araması yok) | KISMEN (`exportAuditCsv`; filtresiz, 2000 satır) | - | - | - | - |
| Vitrin ayarları | YOK (kayıtlı arama / fiyat alarmı listesi yok) | KISMEN (yalnız bağlantı + QR) | GEREKSİZ | KISMEN: ad, renk, logo firma bilgilerinden; adres kısaltması (slug), tanıtım metni, aç/kapa yok | YOK | - | - | YOK | - | YOK | - | YOK |
| Hesap / ofis kapatma, tüm veriyi indirme | - | - | - | - | **YOK** | - | - | KISMEN (14 liste için ayrı CSV; tek paket yok) | - | YOK | YOK (sahiplik devri) | YOK |
| Askıdaki ofis ekranı | - | VAR (`app/askida/page.tsx`) | - | - | - | - | - | - | - | **YOK: "Ödemeyi tamamla" `/app/abonelik`'e gider, ara katman geri yollar (`src/lib/supabase/middleware.ts:148-157`); action da kilitli (`src/lib/tenant-guard.ts:154`)** | - | - |

#### 1.2.6 Salt okunur ekranlar (matris dışı)

Raporlar, Bölge, Talep-arz, Memnuniyet, Şube (franchise), Kaçan komisyonlar, Ofis Panosu, Ekip Ligi, Danışman KPI, Kıyas, Kazanç,
Performansım, Hesaplayıcılar, Kira artışı hesaplayıcısı, AI Asistan, Yardım: bunlar hesaplanmış görünümlerdir; ekle / düzenle / sil
GEREKSİZ. Dışa aktarma durumu: yazdır düğmesi yalnız Bölge, Kazanç, Danışman KPI, Değerleme, Broşür, Denetim dosyası ve yatırım
hesaplayıcısında var (grep `window.print|Yazdır|PDF` `src/app/app`); Raporlar (ofis), Talep-arz, Memnuniyet, Lig, Şube ekranlarında
ne yazdır ne CSV var.

## 2. Çapraz bulgular

### 2.1 Çıkmaz ekranlar

#### 2.1.1 Arayüz var, çalışmıyor (hata)

| # | Ekran | Ne oluyor | Kanıt |
|---|---|---|---|
| 1 | Müşteri kartı → Belgeler ve imza | Yüklenen dosyalar listelenmiyor; sekme rozetindeki sayı doğru, liste hep boş | `app/musteriler/[id]/page.tsx:177` (`tab === "dosyalar"`), `customer-360-tabs.tsx:79,89` |
| 2 | Portföy → Yetki belgesi | Kayıt yazılıyor, sayfa bu sütunları okumuyor; form her açılışta boş, ikinci kayıtta eski değerler silinir | `pf/[id]/page.tsx:171` (select), `:890-905` |
| 3 | Askıda → "Ödemeyi tamamla" | `/app/abonelik` ara katmanda yine `/app/askida`'ya döner; ödeme action'ı da kilitli | `src/lib/supabase/middleware.ts:148-157`, `src/lib/tenant-guard.ts:154`, `app/askida/page.tsx:101` |
| 4 | Proje → satılmış dairede "Serbest bırak" | Onay metni "satış kaydı geri alınır" diyor; güncelleme veritabanı tetikleyicisinde reddedilir | `act/projects.ts:749-754`, `CWI:2460-2490` |
| 5 | Portal Kontrol → "Teyit et" | Yetkisiz kullanıcıda action sessizce döner, düğme yine "Teyit edildi" gösterir | `act/portal-listings.ts:58-59`, `app/portallar/confirm-listing-button.tsx:39-40` |
| 6 | Gider düzenleme | Her düzenleme giderin portföy bağını siler | `act/expenses.ts:69` |
| 7 | Ofis geneli bildirim | Bir kişi okuyunca herkeste okunmuş görünür | `act/notifications.ts:36-53` |
| 8 | Kayıtlı görünüm | Sıcaklık (`segment`) ve yön filtresi beyaz listede yok; görünüm eksik kaydedilir | `act/saved-views.ts:16-28` |
| 9 | Çağrı konsolu | Müşteri seçilmezse listedeki ilk müşteri ön seçili gelir; çağrı düzenlenemediği için hata kalıcı olur | `app/arama/call-console.tsx:53-55` |
| 10 | Personel ekleme (admin) | "İlk girişte parola değiştirsin" bayrağı yazılıyor, hiçbir yerde okunmuyor | `act/platform-staff.ts:95` (grep `must_change_password` tek sonuç) |

#### 2.1.2 Arayüz bir işlemi vaat ediyor, işlem yok

| Metin / düğme | Yer | Eksik olan |
|---|---|---|
| "E-posta (yakında)" kanal seçeneği | `app/kampanyalar/yeni/new-campaign-form.tsx:121` | E-posta kampanyası; liste filtresinde çipi de var (`kampanyalar/page.tsx:47`) |
| "Komisyon sayfasından elle ekleyin" | `app/anlasmalar/[id]/page.tsx:323`, `win-celebration-dialog.tsx:226` | Komisyon sayfasında ekleme yok (`komisyon/page.tsx:549`) |
| "Sonlandırın ya da yenileyin" | `app/kiralama/[id]/page.tsx:179` | Yenileme / uzatma action'ı yok |
| "Not ekle" kısayolu (kira) | `app/kiralama/[id]/page.tsx:245`, `:211` | Sekme "notlar kayıt oluşturulurken girilir" diyor |
| "Önce liste fiyatını girin" | `app/projeler/[id]/unit-payment-plan.tsx:263` | Daire fiyatını girecek ekran yok |
| "Detayda ilan açıklamasını tamamlarsınız" | `pf/yeni/property-form.tsx:204` | Açıklama alanı hiçbir formda yok |
| "Önce profilinize telefon ekleyin" | `app/ayarlar/guvenlik/two-factor-form.tsx:56`, `guvenlik/actions.ts:40` | Profil sayfası yok |
| "Ayarlar bölümünden tamamlayın" (ödeme hatası) | `act/billing.ts:96` | Ödeme sahibi adı profilden gelir, düzenlenemez |
| "Süreyi kendiniz ayarlayın" (KVKK) | `app/uyum/kvkk-panel.tsx:255` | Gün sayısı sabit 1095 (`:78`) |
| "Atama kuralı, hızlı yanıt" (aday yakalama kartı) | `app/ayarlar/page.tsx:60` | Sayfada yalnız aç/kapa ve token var |
| "Müşteri oluştur" (eşleşmemiş çağrı) | `app/arama/calls-view.tsx:316-322` | Müşteri listesine gider; telefon taşınmaz, çağrı bağlanmaz |
| "iyzico bağlanınca tahsilat otomatikleşecek" | `admin/billing/page.tsx:216` | Bilgi metni; elle tahsilat kaydı da yok |

Hiç dolmayan filtre ve sayaçlar: teklif "Taslak" çipi (`teklifler/offer-list-logic.ts:6`; teklif `submitted` doğuyor), sözleşme
"Reddedildi" çipi (`sozlesmeler/contract-list-logic.ts:19`), randevu "İmza eksik" KPI'ı (`randevular/page.tsx:642`; bu duruma
alan düğme yok), fiyat geçmişinde "Gizli fiyat" sekmesi (`pf/[id]/property-price-history.tsx:20`; yazan alan yok).

Genel tarama: grep `[Yy]akında|coming soon|TODO|FIXME|onClick={() => {}}|href="#"` tüm `src/` içinde (test hariç) işlevsiz düğme
olarak yalnız kampanyadaki `E-posta (yakında)` seçeneğini verdi.

#### 2.1.3 Action var, arayüz yok

| Action | Dosya:satır | Durum |
|---|---|---|
| `reassignCustomer` | `act/customers.ts:860` | Tekil danışman devri; çağıran yok (P1-C2) |
| `changePropertyStatus` (nedenli) | `act/property-management.ts:23` | Çağıran yok; arayüz nedensiz `setPropertyStatus` kullanıyor |
| `getLookupValues`, `upsertLookupValue`, `deleteLookupValue` | `act/property-management.ts:137,170,213` | Çağıran yok (tanımlar ekranı yerini almış) |
| `upsertTarget`, `updateCustomerLeadSource`, `getLeadSourceStats` | `act/targets-openhouse-sources.ts:13,368,391` | Çağıran yok |
| `setBranchAction`, `deleteBranchAction` | `act/team.ts:354,358` | Kullanılmayan sarmalayıcı |
| `addInternalTicketNote` | `act/admin-ticket-ops.ts:174` | Çağıran yok; iç not `replyTicketAsStaff` ile gidiyor |
| `signContractByToken` | `act/contracts.ts:280` | Çağıran yok (eski imza yolu) |
| `listCustomerCommunications`, `listPropertyCommunications`, `listContracts`, `listDealCosts`, `listDealNotes`, `listDues`, `listOffers` | `act/communications.ts:67,87`, `contracts.ts:638`, `deals.ts:354,488`, `dues.ts:121`, `offers.ts:318` | Okuma yardımcıları; sayfalar doğrudan sorguluyor |
| `importCustomers`, `importProperties`, `importDemands` | `act/import-data.ts:557-569` | Yalnız test çağırıyor |
| `searchDistricts` | `act/geo.ts:56` | Çağıran yok |
| `checkAuthorityShield` (action sürümü) | `act/compliance.ts:57` | Yetki kapısı yok, arayüz yok |

Action'ın desteklediği ama formun göndermediği alanlar: şube `is_active` (`act/team.ts:320`), görev `assigned_to`
(`act/tasks.ts:204,228`), "yabancı işaretini kaldır" (`act/foreign-sale.ts:109`), denetim dosyası dönemi
(`act/audit-dossier.ts:86-87`), serbest ödeme linki başlık / tutar / müşteri (`act/payment-links.ts:35-39`), gider portföy bağı
(`act/expenses.ts:21`), aidat notu, maliyet notu (`act/deals.ts:378`), başkasının kartviziti (`kartvizitim/page.tsx:29`, `?uye=`
bağlantısı yok), randevu geçişleri iptal → bekliyor ve onaylı → imza (`src/lib/workflow-state.ts:56,59`).

Şemada olup kodda yazılmayan sütunlar: `branches.manager_user_id`, `branches.district_id` (`init.sql:65,67`),
`customers.blacklist` (yalnız okunuyor), `properties.hidden_price`, `properties.foreign_eligible`, `campaigns.scheduled_at`,
`announcements.starts_at`, `deal_checklist_items.file_url`, `listing_closures.evidence_url` / `notes`, `contract_templates.is_active`.

#### 2.1.4 Yetkisi olmayana görünen düğmeler (action reddediyor)

| Ekran | Kanıt |
|---|---|
| Destek "Yeni talep" ve yanıt: görüntüleme yetkisi yeter görünüyor, action `create` / `edit` ister; danışman, takım lideri, çağrı merkezi, muhasebe rollerinde yalnız görüntüleme var | `app/destek/page.tsx:272`, `act/tickets.ts:161,319,352`, `src/lib/permissions.ts:154,171,190,198` |
| Ayarlar formları (firma, entegrasyon, şablon, duyuru, aday, filigran): danışmanda `settings` yalnız görüntüleme | grep `effectiveHasPermission|canEdit` `app/ayarlar` yalnız çöp kutusu, iş akışları, roller |
| Ekip: rol listesi aktörün atayamayacağı rolleri de sunar; düğmeler `team:create` ile görünür, action `team:edit` + yönetici rolü ister | `app/ekip/page.tsx:63,76`, `act/team.ts:76-88` |
| Pano aşama düğmeleri, aidat "Ödendi" / "Sil", depozito | `anlasmalar/deal-board.tsx:370-446`, `aidat/dues-client.tsx:299-319`, `kiralama/[id]/page.tsx:153` |
| Otomasyon listesi, tanımlar | `otomasyonlar/page.tsx:170,283`; grep `canEdit|perms` `app/ayarlar/tanimlar` 0 |
| Portal Kontrol (tüm düğmeler) | grep `can(Create|Edit)|perms\.` `app/portallar/page.tsx` 0 |
| Çift kayıt "Birleştir", müşteri dosyası yükle / sil | `musteriler/cift-kayit/page.tsx:70`, `customer-360-tabs.tsx:391` |

#### 2.1.5 Sessiz hata (action sonucu kullanıcıya gösterilmiyor)

`void` dönen ya da sonucu okunmayan çağrılar: `setMemberRole` / `setMemberActive` (`act/team.ts:277-283`; koltuk dolu hatası
görünmez), `resendInvite` (`ekip/invite-actions.ts:23-55`), `deleteCustomer`, `dismissLostSaleRisk`, `deleteDealCost`,
`deleteDealNote`, `deleteTarget`, `deletePlaybookForm`, `setAppointmentStatus`, izin onay / ret / sil sarmalayıcıları
(`act/staff-leaves.ts:218-228`), `restoreCustomer` / `restoreProperty` (`cop-kutusu/actions.ts:15,25-28`), `setLeadCaptureEnabled`,
`clearSampleDataForm`, `deleteTenantLogo`, kampanya gönder / sil (`campaign-actions.tsx:43-45,68-70`), talep kapat
(`demand-status-buttons.tsx:25`), sözleşme iptal (`cancel-contract-button.tsx:31`), şablon kaydet (`new-contract-form.tsx:226`),
iletişim kaydı ekleme (`communication-timeline.tsx:93,101-106`) ve silme (`act/communications.ts:119` her zaman `ok`).

#### 2.1.6 Sayfalamasız kesilen listeler

| Liste | Sınır | Kanıt |
|---|---|---|
| Gider | 200 | `act/expenses.ts:123` |
| Kampanya / alıcı | 50 / 500 | `act/campaigns.ts:163,194` |
| Açık ev / proje | 50 / 200 | `act/targets-openhouse-sources.ts:357`, `act/projects.ts:58` |
| Sunum | 100 | `pf/sunumlar/page.tsx:66` |
| Değerleme | 40 | `app/degerleme/page.tsx:77` |
| Hedef | 50 | `act/targets-openhouse-sources.ts:181` |
| Otomasyon / günlüğü | 50 / 50 | `otomasyonlar/page.tsx:90`, `[id]/page.tsx:77` |
| İzin | 50 | `ekip/izinler/page.tsx:144` |
| Tavsiye bağlantısı | 200 | `tavsiyeler/page.tsx:161` |
| Eşleştirme (açık talep) | 80 | `eslestirme/matching-view.tsx:116` |
| Akıllı liste segmenti | 10 | `akilli-listeler/page.tsx:219` |
| Mesaj şablonu | 200 | `ayarlar/mesaj-sablonlari/page.tsx:15` |
| İYS izni | 100 (sayılar da bu dilimden) | `uyum/page.tsx:58-83` |
| Fatura (ofis) / giriş geçmişi | 8 / 20 | `abonelik/page.tsx:71`, `guvenlik/page.tsx:58` |
| Çöp kutusu | tür başına 100, son 90 gün | `cop-kutusu/page.tsx:37-47` |
| Platform duyuru geçmişi (admin) | 20 | `admin/duyuru/page.tsx:60` |
| Seçiciler (düz `select`): yeni talepte müşteri 300, teklifte portföy 200 / müşteri 300, tavsiye linkinde müşteri 300, yabancıya satışta müşteri 1000 | - | `talepler/yeni/page.tsx:20`, `teklifler/yeni/page.tsx:31,37`, `tavsiyeler/page.tsx:163`, `yabanci-satis/page.tsx:74` |

### 2.2 Hâlâ popup olan ekle / düzenle akışları

Kural: ekle / düzenle popup olmaz; sekmeli sayfa ya da satır içi panel (`InlinePanel`, `InlineTabbedPanel`) olur. Tarama:
grep `DialogContent|DialogFullscreenContent|createPortal` `src/` (40 dosya). `ConfirmDialog`, galeri / lightbox, menü çekmecesi
ve ürün turu sayılmadı.

| Dosya | Amaç | Alan | DIALOG_ENVANTERI durumu | Şimdi |
|---|---|---|---|---|
| `app/projeler/[id]/add-units-dialog.tsx:70` | Daire ekle (tekil + çoğalt) | 7 + 7 | Sıra | Popup |
| `app/projeler/[id]/units-board.tsx:301` (+ `unit-payment-plan.tsx:151`) | Daire detayı, rezerve / kapora / satış, ödeme planı | 2 + 3..11 | Sıra | Popup |
| `app/otomasyonlar/automation-wizard.tsx:525` | Otomasyonu DÜZENLE (oluşturma tam sayfa) | 7 + 9 | Sıra | Popup |
| `app/portallar/portal-dialogs.tsx:178-264` | İlan kapanış formu (ekleme zaten satır içi) | 7 | Sıra | Popup |
| `admin/tickets/new-admin-ticket-dialog.tsx:245` | Ofis adına destek talebi | 5 | Sıra | Popup |
| `admin/personel` | Personel ekle | - | Sıra | **Taşınmış** (`admin/personel/yeni` tam sayfa); envanter güncel değil |
| `app/onaylar/approval-actions.tsx:49` | Onay / ret notu | 1 | Sıra | Popup (sınır durum) |
| `app/gelen-kutusu/row-actions.tsx:104` | Görev oluştur | 3 | Sıra | Popup |
| `app/gelen-kutusu/sms-dialog.tsx:98` | SMS gönder | 1 | Sıra | Popup |
| `app/musteriler/customer-bulk-actions.tsx:204,257` | Toplu danışman ata, toplu etiket | 1 + 1 | Sıra | Popup |
| `app/musteriler/cift-kayit/merge-wizard.tsx:91` | 3 adımlı birleştirme | 1 | Sıra | Popup |
| `app/ag/demand-response-dialog.tsx:58`, `collab-request-dialog.tsx:47` | Talebe portföy öner, iş birliği iste | 3, 1 | Sıra | Popup |
| `app/teklifler/[id]/offer-round-dialog.tsx:28` | Pazarlık turu | 3 | Sıra | Popup |
| `app/anlasmalar/deal-board.tsx:457` | Anlaşmayı düzenle | 4 | Sıra | Popup (başka ajanın alanı) |
| `app/kiralama/apply-increase-dialog.tsx:66` | Kira artışını uygula | 2 | Sıra | Popup |
| `app/komisyon/commission-split-editor.tsx:70` | Komisyon paylaşımı | 2 × satır | Sıra | Popup (satır içi eşi `kapanis-sihirbazi.tsx:418` var) |
| `app/uyum/kvkk-panel.tsx:108` | KVKK silme talebi | 2 | Sıra | Popup |
| `app/randevular/complete-appointment-dialog.tsx:67` | Randevuyu tamamla | 2 | Sıra | Popup |
| `app/sozlesmeler/[id]/fill-fields-dialog.tsx:148` | Sözleşme alanlarını doldur | dinamik | Sıra | Popup |
| `components/app/portal-link-dialog.tsx:227` | Malik portalı linki (ad + telefon) | 2 | "Kalır (paylaşım menüsü)" | Popup; form içerdiği için kural kapsamında |
| `pf/[id]/property-media-manager.tsx:827` | OCR sonucunu düzenle + portföye uygula | 9 | Envanterde yok | Popup |
| `admin/tenants/[id]/subscription-panel.tsx:63` | Plan + durum değiştir | 2 | "Kalır" | Popup (başka ajanın alanı) |
| `components/app/saved-views.tsx:191` | Görünümü kaydet (açılır kutu) | 1 | Envanterde yok | Popover (kabul edilebilir) |
| `app/anlasmalar/loss-reason-dialog.tsx:39` | Kayıp nedeni | 2 | Kalır | Popup (satır içi eşi `kapanis-sihirbazi.tsx:674` var) |

Kurala uyanlar (adı "dialog" olsa da satır içi): görev, randevu, müşteri, talep, portföy, gider, teklif, hedef düzenleme
panelleri; şube, izin, duyuru, mesaj şablonu, anahtar, ağ paylaşımı, portal ilanı ekleme; tüm "yeni" sayfaları.

Onay tutarsızlığı: `customer-files-tab.tsx:85`, `communication-timeline.tsx:237`, `logo-upload-form.tsx:40` tarayıcının yerel
`confirm()` penceresini kullanıyor; diğer her yerde `ConfirmDialog` var.

### 2.3 Silme akışları

#### 2.3.1 Çöp kutusu kapsamı

`deleted_at` sütunu yalnız üç tabloda var (grep `deleted_at\s+timestamptz|add column( if not exists)? deleted_at`
`supabase/migrations`): `customers` (`init.sql:105`), `properties` (`init.sql:157`), `support_ticket_attachments`.

| Varlık | Silme türü | Çöp kutusunda | Kanıt |
|---|---|---|---|
| Müşteri | Yumuşak | VAR | `act/customers.ts:208,299`; `cop-kutusu/actions.ts:13` |
| Portföy | Yumuşak + durum arşiv | VAR (geri alınınca arşivde kalır) | `act/properties.ts:543`; `cop-kutusu/actions.ts:41-52` |
| Görev | Kalıcı | YOK | `act/tasks.ts:365` |
| Gider, aidat | Kalıcı, denetim kaydı yok | YOK | `act/expenses.ts:93`, `act/dues.ts:107` |
| Anlaşma maliyeti, notu, evrak maddesi | Kalıcı | YOK | `act/deals.ts:467,575`, `act/deal-checklist.ts:249` |
| Kampanya, otomasyon, iş akışı | Kalıcı (alt kayıtlar cascade) | YOK | `act/campaigns.ts:210`, `automations.ts:457`, `playbooks.ts:362` |
| Sunum, anahtar, hedef, izin | Kalıcı | YOK | `act/presentations.ts:129`, `property-keys.ts:426`, `targets-openhouse-sources.ts:167`, `staff-leaves.ts` |
| Müşteri dosyası, portföy medyası | Kalıcı (dosya da silinir) | YOK | `act/customer-files.ts:133`, `property-media.ts:188,319`, `documents.ts:76,115` |
| İletişim kaydı, kayıtlı görünüm | Kalıcı | YOK | `act/communications.ts:114`, `saved-views.ts:149` |
| Mesaj şablonu, ofis duyurusu, tanım, şube | Kalıcı | YOK | `act/message-templates.ts:149`, `announcements.ts:124`, `definitions.ts:267`, `team.ts:347` |
| Ağ paylaşımı (ilan, talep), ödeme planı | Kalıcı | YOK | `act/network.ts:265,1049`, `projects.ts:638` |
| İlçe, mahalle, hazır yanıt (admin) | Kalıcı | YOK | `act/geo-admin.ts:200,276`, `admin-ticket-ops.ts:252` |
| Anlaşma, teklif, sözleşme, randevu, talep, çağrı, kira, proje, daire, açık ev, değerleme, portal ilanı | Silme action'ı hiç yok; durumla kapatılır (iptal, kayıp, geri çek, sonlandır) | konu dışı | Bölüm 6, G-03 |

Çöp kutusunun kendi eksikleri: yalnız son 90 gün ve tür başına 100 kayıt gösterir (`cop-kutusu/page.tsx:37-47`); 90 günden eski
yumuşak silinmiş kayıt ekranda görünmez ama veritabanında kalır (uygulama cron'larında temizlik yok); kalıcı silme bilinçli olarak
yok (`cop-kutusu/actions.ts:9-11`); arama, sayfalama, toplu geri alma, kimin sildiği bilgisi ve sonuç bildirimi yok; sayfa `settings`
modülü ister, yani silen danışman kendi sildiğini geri alamaz; silinen kaydın ekranında "geri al" bildirimi yok.

#### 2.3.2 Bağlı kayıt kontrolü

| Silme | Kontrol | Kanıt |
|---|---|---|
| Şube | Üyesi varsa engeller; müşteri / portföy bağlıysa veritabanı hatası genel mesajla döner | `act/team.ts:339-348` |
| İlçe (admin) | Bağlı mahalle varsa engeller | `act/geo-admin.ts:191-198` |
| Tanım | Sistem anahtarı ve kullanım sayısı engeller | `act/definitions.ts:256-264` |
| Ödeme planı | Ödenmiş taksit varsa silmez (sessiz) | `act/projects.ts:627-634` |
| İçe aktarmayı geri al | Bağlı kayıt kontrolü var | `act/import-rollback.ts:245` |
| Müşteri | **Yok**: açık anlaşması olan müşteri uyarısız silinir; talepleri listede kalır | `act/customers.ts:199-225`, `talepler/demands-view.tsx:167` |
| Portföy | **Yok**: açık anlaşma, canlı portal ilanı, dışarıdaki anahtar, planlı açık ev sorgulanmaz | `act/properties.ts:533-562` |
| Anahtar | **Yok**: dışarıdaki (zimmetli) anahtar da silinir | `act/property-keys.ts:424-428` |
| Ağ paylaşımı | **Yok**: kabul edilmiş iş birliği de silinir | `act/network.ts:263-267` |
| Gider | **Yok**: onay talebine bağlı gider silinince bağ kopar | `act/expenses.ts:91-97` |
| Üye pasifleştirme | **Yok**: müşteri, görev, randevu pasif üyede kalır; devir önerilmez | `act/team.ts:156-274` |

#### 2.3.3 Onaysız yıkıcı ya da geri alınamaz işlemler

Randevu iptali (`appointment-rows.tsx:92`), teklif kabul / ret / geri çek (`offer-status-actions.tsx:43-67`), kazanmayı geri al
(komisyonu ve paylaşım oranlarını siler: `status-transition.tsx:117-126`), üye pasifleştir (oturumları düşürür:
`ekip/page.tsx:386-392`), rol matrisini varsayılana döndür (`role-permissions-matrix.tsx:130`), tüm istisnaları kaldır
(`user-exceptions.tsx:190`), KVKK toplu anonimleştirme (`kvkk-panel.tsx:99-106`), ödeme linki üret (kazanmayı geri almayı kilitler:
`commission-actions.tsx:107`), takvim ve rezervasyon bağlantısını yenile (eski bağlantı ölür: `calendar-subscribe-card.tsx:116`,
`booking-link-form.tsx:302`), video / tur bağlantısı sil (`property-media-manager.tsx:775`), rezerve / kaporalı daireyi serbest bırak
(`units-board.tsx:496`), iş birliği isteğini geri çek (`network-row-actions.tsx:109`), etiket kaldır, iki adımlı doğrulamayı kapat,
izin onayla / reddet.

### 2.4 Telefon ve e-posta alanları

- **Tek ihlal:** `src/components/app/portal-link-dialog.tsx:278-285`: malik telefonu ham `<input inputMode="tel">`. Sunucuda da
  doğrulanmıyor: `act/owner-portal.ts:61` `ownerPhone?.trim()` olduğu gibi yazılıyor.
- Tüm `src/` taraması: `type="tel"|type="email"` yalnız `phone-input.tsx:176` ve `email-input.tsx:54`; `inputMode="tel"` yalnız
  yukarıdaki dosya ve bileşenin kendisi; `name="…phone|email…"` taşıyan 34 kullanımın tamamı `PhoneInput` / `EmailInput` ya da
  gizli alan.
- Sözleşme testinin (`src/lib/contact-input-contract.test.ts`) kör noktaları: (1) `name` / `id` / `autoComplete` taşımayan
  kontrollü input (yukarıdaki ihlal bu yüzden geçiyor); (2) yalnız `inputMode`, `placeholder` ya da `aria-label` ile telefon olduğu
  belli olan alanlar; (3) kelime listesinde `tel`, `whatsapp`, `numara`, `iletisim` yok (`:25`); (4) `<textarea>` ve özel
  sarmalayıcı bileşenler; (5) sunucu kuralı yalnız `src/app/actions/**` altında ve yalnız `formData.get("…")` biçiminde okunan
  anahtarlara bakıyor; nesne ya da konumsal parametre alan action'lar (`createOwnerPortalToken`) ve `src/app/app/**/actions.ts`
  dosyaları kapsam dışı; (6) dosyada tek bir doğrulayıcı çağrısı tüm anahtarları geçirir.
- Gri alan: Netgsm "gelen SMS abone numarası" düz `Input` (`ayarlar/integrations-form.tsx:131`); abone numarası, kişi telefonu
  değil. "Alanları doldur" penceresi sözleşme metnindeki telefon / e-posta boşluklarını düz metinle dolduruyor
  (`fill-fields-dialog.tsx:179`); saklanan iletişim alanı değil.
- Eksik alanlar (ihlal değil, alan yok): şube telefonu, ofis e-postası, üye telefonu / e-postası düzenleme formu.

### 2.5 Mobilde yapılamayan işlemler

Sınıf adlarından çıkarıldı; cihazda denenmedi.

| İşlem | Neden | Kanıt |
|---|---|---|
| Müşteride toplu ata / etiket / sil, tekil sil, portal linki | Tablo `hidden md:block`; mobil kartta seçim kutusu ve eylem yok | `musteriler/customer-rows.tsx:112,207-240` |
| Portföyde toplu durum, malik portalı linki | Aynı | `pf/property-rows.tsx:60,147-170` |
| Talep satır eylemleri | Mobil kartta eylem yok | `talepler/demand-rows.tsx:170-205` |
| Gider silme | İşlem sütunu `hidden sm:table-cell`; düzenleme panelinde sil yok | `giderler/expenses-table.tsx:152` |
| Aidat tekil ödendi / geri al / sil | Aynı | `aidat/dues-client.tsx:299` |
| Anlaşma notu silme | Düğme `opacity-0`, yalnız hover; `.hover-action` sınıfı yok | `anlasmalar/[id]/deal-notes-section.tsx:108` |
| Kayıtlı görünüm silme | `hidden … group-hover/chip:grid` | `components/app/saved-views.tsx:154` |
| Medya sıralama | Yalnız HTML5 sürükle-bırak; düğmeli alternatif yok | `pf/[id]/property-media-manager.tsx:638-655` |
| Anlaşma düzenleme ve aşama geçişi | Yalnız yatay kayan panoda; mobil listede ve detayda eylem yok | `anlasmalar/deal-board.tsx:189`, `deal-rows.tsx:132-157` |
| Etiket ekleme, hızlı görev | Görünür düğme yok, yalnız Enter | `customer-tag-chips.tsx:109`, `gorevler/quick-task.tsx:45-61` |
| Tavsiyede dönüştür / not, içe aktarmada geri al, sunum ve portal linki satır eylemleri, rol matrisi | Yatay taşan tabloda en sağdaki sütun; matrisin modül sütunu sabit değil | `tavsiyeler/page.tsx:337,516`, `import-wizard.tsx:941`, `pf/sunumlar/page.tsx:165`, `shared-portals.tsx:162`, `role-permissions-matrix.tsx:144` |
| Denetim kaydında değişiklik ayrıntısı | Tamamı yalnız `title` içinde | `denetim/page.tsx:416` |

Engel olmayanlar: `opacity-0 group-hover:opacity-100` taşıyan 96 kullanımın 80'i `.hover-action` sınıfıyla dokunmatikte görünür
(`globals.css:1386-1389`), kalan 16'sı zaten tıklanabilir satırların süs oku. Anlaşma panosunda sürükle-bırağın düğme karşılığı
var (`deal-board.tsx:370-446`). /admin tarafında mobilde yapılamayan işlem bulunmadı (tablolar yatay kayıyor, toplu işlem çubuğu
alt gezinmenin üstünde).

## 3. Eksik işlemler

Efor: S ≤ yarım gün, M 1-2 gün, L 3-5 gün. Çözüm kuralı: ekle/düzenle popup olmaz; sekmeli sayfa ya da satır içi panel.
"Şema" sütunu yeni migration gerekir mi. "Mükerrer" sütunu: aynı işi yapan ikinci bir ekran/action doğma ihtimali
(Bölüm 4'teki paket sahipliği bunu önler). "Muhtemelen" yazılan şema kararları canlı şema görülmeden verilemedi (Bölüm 5).

### 3.1 P0 (iş akışını engeller ya da veri yanlış yere çıkar)

| # | Ne eksik | Etki | Çözüm | Dosyalar | Şema | Efor | Mükerrer |
|---|---|---|---|---|---|---|---|
| P0-1 | Müşteri dosyaları listelenmiyor (sekme kimliği `belgeler`, sorgu koşulu `dosyalar`) | Yüklenen dosya görünmez, indirilemez, silinemez | Koşulu sekme kimliğiyle eşle; sabiti tek yere al; test ekle | `app/musteriler/[id]/page.tsx:177`, `customer-360-tabs.tsx:79,89` | Hayır | S | Yok |
| P0-2 | Eşleşmemiş çağrı / gelen kutusu öğesi müşteriye bağlanamaz | Telefon kaydı sahipsiz kalır, kayıp-kaçak sayısı şişer | Satıra "Müşteriye bağla" (aramalı seçici, satır içi panel) ve "Bu telefonla müşteri oluştur" (telefonu taşıyan `yeni?phone=`); action `linkCommunicationToCustomer` | `app/arama/calls-view.tsx:316-322`, `gelen-kutusu/inbox-view.tsx:501-515`, `actions/communications.ts` | Hayır | M | `reassignCustomer` ile karıştırma |
| P0-3 | Anlaşmaya portföy / müşteri sonradan bağlanamaz; kazanma ikisini şart koşar | Portföysüz açılan anlaşma kazanılamaz, komisyon doğmaz | Anlaşma detayına tam sayfa "Düzenle" (`[id]/duzenle`): müşteri, portföy, tutar, olasılık, tür, danışman. Pano popup'ı (başka ajan) sonradan bu sayfaya bağlanır | `app/anlasmalar/[id]/page.tsx`, yeni `[id]/duzenle/*`, `actions/deals.ts:299-303` | Hayır | M | `deal-board.tsx` popup'ıyla çift düzenleme; pano ajanıyla koordinasyon |
| P0-4 | Ödeme linki iptal edilemez, ofis listesi yok; açık link "kazanmayı geri al"ı kilitler | Yanlış tutarlı link kalıcı, geri alma tıkanır | Komisyon satırında "Ödeme linkleri" satır içi panel: liste, iptal, süre uzat; link üretmeye onay | `app/komisyon/commission-actions.tsx:107`, `actions/payment-links.ts`, `anlasmalar/status-transition.tsx:117-126` | Muhtemelen yok (`status` değeri yeter) | M | Yok |
| P0-5 | Kira sözleşmesi düzenlenemez ve uzatılamaz; bitişte tahakkuk durur | Yanlış kira düzeltilemez, uzayan kira muhasebeden düşer | `kiralama/[id]/duzenle` (vade günü, bitiş, depozito, not, kiracı) + "Uzat / yenile" action'ları | `app/kiralama/[id]/page.tsx:179`, `actions/rentals.ts:204-206`, `api/cron/kira-tahakkuk/route.ts:104` | Hayır | M | Kira artışı popup'ıyla birleşir |
| P0-6 | Proje düzenlenemez, durumu değişmez | Yanlış ad / adres / teslim tarihi kalıcı; biten proje "planlanan" kalır | `projeler/[id]` "Bilgiler" sekmesi + durum seçici (`updateProject`) | `app/projeler/[id]/page.tsx:27`, `actions/projects.ts` | Hayır | M | Yok |
| P0-7 | Daire düzenlenemez (fiyat, oda, m²); fiyatsız daire satılamaz, ödeme planı "önce fiyat girin" diyor | Toplu üretilen daireler kilitli kalır | Daire satırında satır içi düzenleme; `updateUnit`; `add-units-dialog` ve `units-board` popup'ları aynı turda satır içine alınır | `projeler/[id]/units-board.tsx:300`, `add-units-dialog.tsx`, `unit-payment-plan.tsx:263` | Hayır | L | Yok |
| P0-8 | Yetki belgesi kaydediliyor ama sayfada okunmuyor | Form hep boş, ikinci kayıtta eski değer silinir; süre uyarısı güvensiz | Detay select'ine `authorization_*` ekle, formu doldur, geçerlilik rozeti | `pf/[id]/page.tsx:171,890-905`, `property-extras.tsx:130` | Hayır | S | Yok |
| P0-9 | Tapu / yetki belgesi görseli galeriye karışıp public paylaşımda görünür | Gizli belge sızar (KVKK) | Medya kaydına tür ayrımı (`belge`); public sorguda belge türlerini dışla; PDF destekli belge sekmesi | `paylas/[token]/page.tsx:169-174`, `pf/[id]/property-media-manager.tsx`, `lib/direct-file-uploads.ts:63-66` | Evet (tür sütunu + geriye dönük işaretleme) | M | P0-8 ile aynı sekme, aynı paket |
| P0-10 | Randevu başkası adına açılamaz, danışman değiştirilemez | Sekreter / yönetici takvim kuramaz | Formlara danışman seçici; düzenlemede danışman, müşteri, portföy | `actions/appointments.ts:149`, `randevular/appointment-edit-dialog.tsx:47`, yeni randevu formu | Hayır | S | Toplu devirle karıştırma |
| P0-11 | Üyenin ad, telefon, e-posta bilgisi düzeltilemez (ne kendisi ne yönetici) | Yanlış isim / e-posta kalıcı; giriş e-postası değişmez | `ekip/[id]` sekmeli düzenleme (ad, `PhoneInput`, `EmailInput`, auth e-postası güncelleme) ve "Profilim" (P1-F1) | `app/ekip/[id]/page.tsx`, `actions/team.ts`, `ekip/page.tsx:373-392` | Hayır | M | Profil sayfasıyla aynı action |
| P0-12 | Askıdaki ofis ödeme sayfasına ulaşamaz | "Ödemeyi tamamla" döngüsü; ofis kendini açamaz | Ara katmanda askıda `/app/abonelik` + ödeme action'ına izin; action kilidini ödeme için gevşet | `lib/supabase/middleware.ts:148-157`, `lib/tenant-guard.ts:154`, `app/askida/page.tsx:101` | Hayır | S | Yok |
| P0-13 | /admin Ofisler: ofis ekleme bağlantısı yok | Sahibin bulduğu eksik | BAŞKA AJAN (`admin/tenants/**`); denetlenmedi | - | - | - | - |

### 3.2 P1 (sık ihtiyaç)

Gruplar: A = /admin, B = ekip ve ayarlar, C = müşteri / iletişim, D = portföy / proje / portal, E = anlaşma / finans / kira / iş takibi, F = hesap / uyum.

| # | Ne eksik | Etki | Çözüm | Dosyalar | Şema | Efor | Mükerrer |
|---|---|---|---|---|---|---|---|
| P1-A1 | Admin üyelerde düzenleme, pasifleştirme, rol, parola sıfırlama, oturum kapatma yok | Destek, ofis adına kullanıcıyı kurtaramaz | `admin/members/[id]` sekmeleri: Bilgiler / Erişim; denetim kaydı | `admin/members/[id]/page.tsx:53`, yeni `actions/platform-members.ts` | Hayır | M | `actions/team.ts` mantığını paylaş |
| P1-A2 | Faturada "ödendi işaretle", elle fatura, iptal, iade yok; mutabakat kuyruğunda "manuel inceleme / iade gerekli" satırları düğmesiz | Havale ile ödeyen ofis kapatılamaz, kuyruk ölü | `admin/billing/faturalar/[id]` detay: durum, ödeme kaydı, iptal; kuyrukta "çözüldü / iade edildi" | `admin/billing/page.tsx:319-353,556`, `actions/platform*.ts` | Muhtemelen (`paid_at`, yöntem) | L | Ofis tarafı fatura listesi |
| P1-A3 | Kupon / indirim yok | Satış kampanyası yapılamaz | Kupon tablosu + admin sayfası + checkout'ta uygulama | `admin/billing/*`, `actions/billing.ts` | Evet | L | - |
| P1-A4 | Plan tanımları kodda sabit | Fiyat / limit değişimi yayın ister | `plan_definitions` + admin düzenleme; `plans.ts` okuyucu; `plan_entitlements` ile tek kaynak | `lib/billing/plans.ts:27-92`, `admin/billing/planlar` | Evet | L | Yüksek: kota RPC ile çifte kaynak |
| P1-A5 | Platform genel ayarları ekranı yok (bakım modu, kayıt açık/kapalı, varsayılan deneme süresi) | Deneme süresi SQL'de sabit 14 gün | `admin/ayarlar`, `platform_settings` anahtarları; kayıt akışı ve SQL okur | `lib/supabase/middleware.ts`, kayıt action'ı, deneme SQL fonksiyonları | Evet | L | `admin/sistem` anahtar formlarıyla |
| P1-A6 | Platform SMS / WhatsApp sağlayıcı formu yok | Yedek hesap yalnız ortam değişkeni / elle SQL | `admin/sistem` altına Netgsm / WhatsApp formu (maskeli) | `lib/messaging/netgsm.ts:56-58`, `admin/sistem/integration-keys-form.tsx` | Hayır | S | Aynı form ailesi |
| P1-A7 | Cron elle tetikleme, çalışma geçmişi yok | Takılan iş beklenir | Süper admin "Şimdi çalıştır" + son 20 çalışma | `admin/sistem/system-view.tsx:255-287` | Opsiyonel | M | - |
| P1-A8 | Hata kayıtları: yeniden aç, toplu çöz, arama / ofis filtresi yok | Gürültüde iş yapılamaz | Filtre çubuğu + toplu çözüldü | `admin/hatalar/errors-view.tsx`, `resolve-button.tsx` | Hayır | M | - |
| P1-A9 | Aktivite / denetim: kullanıcı, ofis, işlem türü, tarih aralığı, arama, CSV yok | Olay incelenemez | Sunucu filtre + `exportActivityCsv` | `admin/aktivite/page.tsx:108-120` | Hayır | M | - |
| P1-A10 | Demo adayı: ekleme, düzenleme, silme (spam) yok; "erişim bağlantısını yeniden gönder" sayfa yenilenince kaybolur | Telefonla gelen aday girilemez | `admin/satis/yeni` tam sayfa; kartta düzenle / sil (onaylı); bağlantı yeniden gönder kalıcı | `admin/satis/*`, `actions/platform-sales.ts` | Hayır | M | `requestDemo` doğrulamasını paylaş |
| P1-A11 | Toplu duyuru: düzenle, sil, zamanla, gövde görüntüle, sayfalama yok | Hatalı gönderi geri alınamaz | Taslak + zamanlama; sayfalı liste, satır detay | `admin/duyuru/page.tsx:56-208`, `actions/platform-notifications.ts:61` | Evet (`scheduled_at`, durum) | M | - |
| P1-A12 | Personel: ad / e-posta düzenle, daveti yinele, parola sıfırla; `must_change_password` hiç okunmaz | İlk girişte parola değiştirmez | Düzenle sekmesi + zorunlu parola değiştirme | `actions/platform-staff.ts:95`, `admin/personel/[id]` | Hayır | M | Parola formu P1-F1 ile paylaşılır |
| P1-A13 | Personelin kendi hesabı (profil, parola) yok | Admin parolasını değiştiremez | `admin/hesabim` | `components/admin/admin-topbar.tsx:148-153` | Hayır | S | P1-F1 bileşeni |
| P1-A14 | Destek: ofis adına talep popup; hazır yanıtlar yalnız yan panelde, düzenle yok | Makro bakımı zor | Yeni talep tam sayfa; `admin/tickets/makrolar` (düzenle) | `admin/tickets/new-admin-ticket-dialog.tsx:245`, `ticket-macro-manager.tsx` | Hayır | M | - |
| P1-B1 | Roller: denetim kaydı yok, sıfırlama onaysız | İzin değişikliği izlenemez | Denetime yaz, `ConfirmDialog` | `app/ayarlar/roller/role-permissions-matrix.tsx:77,130` | Hayır | S | - |
| P1-B2 | Ekip: rol listesi atanamayacak rolleri sunar; pasifleştirme onaysız ve devirsiz; koltuk hatası görünmez | Üye yanlışlıkla kilitlenir, kayıtlar pasif üyede kalır | Rolleri aktöre göre süz; pasifleştirmede devir önerisi; sonucu göster | `app/ekip/page.tsx:63,76,386-392`, `actions/team.ts:156-283` | Hayır | M | `ekip/devir` |
| P1-B3 | Giriş yapmış üye için parola sıfırlama yok; davet yeniden gönder sessiz | Yönetici üyeyi kurtaramaz | `ekip/[id]` Erişim sekmesi: sıfırlama, daveti yinele, sonuç mesajı | `ekip/invite-actions.ts:23-55,176` | Hayır | S | P1-A1 aynı mantık |
| P1-B4 | Danışman kendi kartvizitine giremez (`team` modülü yok) | Rol matrisi hatası | Kendi kaydı için kapıyı gevşet | `app/ekip/kartvizitim/page.tsx:24`, `lib/permissions.ts:159-182` | Hayır | S | - |
| P1-B5 | Şubeler: menüde / sekmede yok (ekip sayfasının altında), aktif/pasif, müdür ataması, telefon / il-ilçe alanları yok | Ekle-düzenle-sil var ama bulunamıyor | `ekip/subeler` sekmesi + `nav-config`; müdür ve telefon (`PhoneInput`); bağlı kayıt sayısı | `app/ekip/page.tsx:405-427`, `team-panels.tsx:42`, `branch-card.tsx:55,101`, `actions/team.ts:320-348` | Muhtemelen (`branches.phone`) | M | Franchise ekranı |
| P1-B6 | Sözleşme şablonu yönetimi ekranı yok | Şablon düzenlenemez, kapatılamaz | `ayarlar/sozlesme-sablonlari` (liste, düzenle, aktif/pasif, sil) | `sozlesmeler/yeni/new-contract-form.tsx:268,371` | Hayır (`is_active` var) | M | - |
| P1-B7 | Aday yakalama: vaat edilen atama kuralı yok; gelen aday listesi yok | Atama elle | Atama kuralı + liste | `app/ayarlar/lead/page.tsx:54`, `ayarlar/page.tsx:60` | Muhtemelen | M | - |
| P1-B8 | Ofis duyurusu: başlangıç zamanlama (`starts_at`) yok | Planlı duyuru yok | Başlangıç alanı | `ayarlar/duyurular/announcements-manager.tsx:111,238` | Hayır | S | - |
| P1-B9 | Netgsm bağlantı testi yok | Hatalı anahtar fark edilmez | "Deneme SMS" | `ayarlar/entegrasyonlar/integrations-form.tsx:94-331` | Hayır | S | - |
| P1-B10 | Ayarlar formları yetkisiz rolde görünür, action reddeder | Sessiz hata | `canEdit` ile salt okunur | `app/ayarlar/**` | Hayır | M | - |
| P1-C1 | Müşteri düzenleme eksik alanlar (şube, kaynak, kara liste, danışman, çoklu tip); silmede bağlı kayıt uyarısı yok | Açık anlaşmalı müşteri uyarısız silinir | Düzenleme panelini genişlet; silmeden önce bağlı kayıt özeti | `edit-customer-dialog.tsx:43`, `actions/customers.ts:163,199-225` | Hayır | M | - |
| P1-C2 | Tekil müşteri devri arayüzsüz (`reassignCustomer`) | Tek müşteri için toplu yol zorunlu | Detayda "Danışmanı değiştir" satır içi | `actions/customers.ts:860`, `musteriler/[id]/page.tsx` | Hayır | S | `bulkAssignCustomers` |
| P1-C3 | Kara liste yazan action yok | Rozet okunuyor, işaretlenemiyor | `setCustomerBlacklist` + detay anahtarı | `actions/customers.ts` | Hayır | S | - |
| P1-C4 | Dışa aktarma ekrandaki filtreyi yok sayar (müşteri, talep, portföy, randevu, teklif, komisyon, gider) | Yanlış / fazla veri | `exportXCsv(searchParams)` ortak filtre yardımcısı | `actions/export.ts:57-146` | Hayır | M | Ortak yardımcı tek yerde |
| P1-C5 | İçe aktarma girişi listede ve menüde yok | Sihirbaz bulunamaz | Listelerde "İçe aktar" | `app/ice-aktarma`, liste sayfaları | Hayır | S | - |
| P1-C6 | Mobilde müşteri / portföy / talep toplu ve satır eylemleri yok | Telefondan işlem yok | Kart seçimi + eylem menüsü | `musteriler/customer-rows.tsx:207-240`, `pf/property-rows.tsx:147-170`, `talepler/demand-rows.tsx:170-205` | Hayır | M | - |
| P1-C7 | Kampanya: taslak düzenleme, zamanlama, iptal, yeniden dene, kitle önizleme yok; "E-posta (yakında)" | Taslak değiştirilemez | `kampanyalar/[id]/duzenle`; `scheduled_at`; "yakında" seçeneğini kaldır | `new-campaign-form.tsx:18-23,121` | Hayır (`scheduled_at` var) | L | - |
| P1-C8 | Etiket yönetim ekranı yok; yalnız Enter ile ekleme | Yeniden adlandır / birleştir yok | `ayarlar/etiketler` | `customer-tag-chips.tsx` | Hayır | M | - |
| P1-C9 | Çöp kutusu yalnız müşteri + portföy; silen kendi kaydını geri alamaz (`settings` kapısı) | Danışman geri alamaz | Kapıyı `customers` / `properties` yetkisine taşı | `cop-kutusu/page.tsx:33-48`, `actions.ts:9-52` | Hayır | S | - |
| P1-D1 | Portföy düzenleme eksik alanlar (açıklama, şube, gizli fiyat, yabancıya uygunluk); "detayda açıklamayı tamamlarsınız" vaadi | İlan açıklaması hiçbir yerde yazılamaz | Düzenleme paneline alanlar | `edit-property-dialog.tsx:69`, `pf/yeni/property-form.tsx:204` | Hayır | M | - |
| P1-D2 | Portföy silmede bağlı kayıt kontrolü yok (anlaşma, portal ilanı, anahtar, açık ev) | Canlı ilan sahipsiz kalır | Silmeden önce özet, engelle / uyar | `actions/properties.ts:533-562` | Hayır | S | - |
| P1-D3 | Malik portalı: detayda ve mobilde giriş yok, süre uzatma yok, telefon `PhoneInput` değil (tek ihlal) | Link yönetimi dağınık | Portföy detayında "Portallar" sekmesi (oluştur, iptal, süre uzat) | `components/app/portal-link-dialog.tsx:129,278`, `actions/owner-portal.ts:61` | Hayır | M | `shared-portals.tsx` ile birleşsin |
| P1-D4 | Anahtar: panodan ekleme, düzenleme, "kayıp → bulundu", zimmetteyken silme engeli yok | Zimmetli anahtar silinir | Pano "Yeni anahtar" satır içi; kontrol | `pf/anahtarlar/page.tsx:317`, `actions/property-keys.ts:424-428` | Hayır | M | - |
| P1-D5 | Açık ev etkinliği düzenlenemez, silinemez | Yanlış tarih kalıcı | `acik-ev/[id]` düzenleme sekmesi | `app/acik-ev/[id]/page.tsx:59` | Hayır | S | - |
| P1-D6 | Portal ilanı: yeniden aç yok; kapanış formu popup | Kapalı ilan geri açılmaz | Satır içi kapanış paneli, "yeniden aç" | `portallar/portal-dialogs.tsx:165-264`, `portallar/page.tsx:413` | Hayır | M | - |
| P1-D7 | Sunum, değerleme: düzenle yok, sayfalama yok; değerleme paylaşımı geri alınamaz | Düzeltme yeni kayıt ister | Düzenle + paylaşımı kapat | `pf/sunumlar/presentation-actions.tsx:36`, `degerleme/page.tsx:74` | Hayır | M | - |
| P1-D8 | Belge merkezine yükleme yok | Belgeler başka yerden gelir | "Belge yükle" satır içi | `app/belgeler/page.tsx:842` | Hayır | S | P0-9 belge depolamasıyla aynı |
| P1-E1 | Teklif: durum geçişi onaysız ve geri alınamaz; seçiciler aramasız (200 / 300 sınır) | Yanlış kabul geri alınmaz | `ConfirmDialog`, aramalı seçici | `teklifler/offer-status-actions.tsx:43-67`, `yeni/page.tsx:31,37` | Hayır | M | Ortak seçici |
| P1-E2 | Sözleşme: yeni formda müşteri / portföy seçici yok; imzacı düzeltme ve SMS yeniden gönder yok | URL'siz açılan sözleşme bağsız | Seçici alanlar; imzacı düzenle | `sozlesmeler/yeni/new-contract-form.tsx:310-311`, `contract-sign-panel.tsx:63-111` | Hayır | M | - |
| P1-E3 | Komisyon: "elle ekleyin" karşılıksız; hakediş ödemesi (`cuzdan`) salt okunur | Danışman hakedişi kapanamaz | Elle ekleme satır içi; hakediş ödeme kaydı | `komisyon/page.tsx:549`, `cuzdan/page.tsx:348`, `anlasmalar/[id]/page.tsx:323` | Muhtemelen (ödeme tablosu) | L | - |
| P1-E4 | Gider: düzenleme portföy bağını siler; 200 tavan; mobilde silme yok | Veri kaybı | Hatayı düzelt, sayfalama | `actions/expenses.ts:69,123`, `expenses-table.tsx:152` | Hayır | S | - |
| P1-E5 | Aidat: düzenleme, not, mobil eylemler yok | - | Düzenleme paneli | `aidat/dues-client.tsx:231-319` | Hayır | S | - |
| P1-E6 | Kira: kısmi ödeme / gerçek tarih, depozito kısmi iade, arıza genel listesi, kira artışı popup | Muhasebe eksik | Ödeme alanları; `kiralama/arizalar` | `charges-panel.tsx:136-149`, `deposit-return.tsx:41`, `apply-increase-dialog.tsx` | Evet | L | - |
| P1-E7 | Anlaşma silme / arşiv yok; detayda aşama geçişi yok | Yanlış kayıt silinemez | Arşivle + detayda aşama seçici | `anlasmalar/[id]/page.tsx` | Evet (`archived_at`) | M | `deal-board` ajanı |
| P1-E8 | Randevu: iptal onaysız, geri alınamaz; "İmza eksik" KPI'ı hiç dolmaz; tamamlama popup | Yanlış iptal | Onay + geri al | `appointment-rows.tsx:92`, `complete-appointment-dialog.tsx:67`, `page.tsx:642` | Hayır | S | - |
| P1-E9 | Görev: atanan kişi alanı, danışman filtresi, mobil hızlı görev düğmesi yok | Görev devredilemez | Forma `assigned_to` | `gorevler/yeni/task-form.tsx:56`, `quick-task.tsx:45-61`, `actions/tasks.ts:204,228` | Hayır | S | - |
| P1-E10 | Otomasyon düzenleme popup | Kural düzenleme kısıtlı | Tam sayfa `[id]/duzenle` | `automation-wizard.tsx:525` | Hayır | M | - |
| P1-F1 | Kullanıcı profili ve uygulama içi parola değiştirme yok | Kullanıcı kendi adını, telefonunu, parolasını değiştiremez | `app/hesabim` (profil, parola, 2FA, oturumlar); menü bağlantısı | `components/ui/console/user-menu-panel.tsx:63-99`, `ayarlar/guvenlik/*` | Hayır | M | P0-11, P1-A13 |
| P1-F2 | Abonelik: iptal, duraklat, oransal yükseltme, fatura detayı / PDF yok | Ofis aboneliğini yönetemez | `abonelik` sekmeleri: Plan / Faturalar / İptal | `app/abonelik/page.tsx:71,227`, `actions/billing.ts` | Muhtemelen | L | Admin faturalama |
| P1-F3 | Aktif oturum listesi ve "tüm cihazlardan çık" yok | Çalınan oturum kapatılamaz | `hesabim` oturum bölümü | `ayarlar/guvenlik/page.tsx:58` | Hayır | M | - |
| P1-F4 | Ofis destek: yetkisiz rolde "Yeni talep" görünür; konu / öncelik düzenleme yok | Sessiz hata | Düğmeyi yetkiyle gizle | `app/destek/page.tsx:272`, `actions/tickets.ts:161` | Hayır | S | - |
| P1-F5 | KVKK: silme talebi popup; veri sahibi erişim / taşınabilirlik talebi yok; süre sabit | Yasal yükümlülük | Tam sayfa talep, tür, süre alanı | `uyum/kvkk-panel.tsx:78,108-255` | Muhtemelen | M | - |
| P1-F6 | Hesap kapatma, tüm veriyi indirme, sahiplik devri yok | Ofis çıkamaz | Ayarlar "Hesap" sekmesi | `app/ayarlar/*` | Evet | L | KVKK ile |
| P1-F7 | Vitrin ayarları ekranı yok (adres kısaltması, tanıtım, aç/kapa) | Vitrin kontrolü yok | `ayarlar/vitrin` | `app/ayarlar/*` | Muhtemelen | M | - |
| P1-F8 | Denetim kaydı: işlem türü / metin araması, tam fark görünümü yok; CSV filtresiz | İz sürülemez | Filtre + fark paneli | `app/denetim/page.tsx:174,416` | Hayır | M | - |

### 3.3 P2 (nadir)

Her biri küçük, ilgili paketin sonuna eklenir; kanıt ilgili matris satırındadır.

- Admin: personel bildirim tercihleri, platform bildirimi silme, plan değişim geçmişi, abonelik tutar / dönem düzenleme, entegrasyon anahtarı bağlantı testi, aday notu düzenleme, destek talebi birleştirme, ilçe / mahalle toplu işlem.
- Müşteri: dosya etiketi, iletişim kaydı düzenleme / tam görünüm, özel akıllı liste, kayıtlı görünüm yeniden adlandır, tavsiye bağlantısı düzenle, çağrı düzenleme, gelen kutusu toplu işlem, çift kayıt "mükerrer değil" kalıcı, eşleşme kaydı (`saveMatchAndNotify` yalnız durum yapar).
- Portföy / proje: ödeme planı tek taksit, açık ev ziyaretçisi düzenle, portföy paylaşım linki yönetimi, medya sıralama düğmeleri (mobil), ağ paylaşımı toplu işlem, proje birimi geçmişi.
- Finans: teklif turu ve komisyon paylaşımı popup'ları, deal checklist dosya eki, anlaşma maliyeti düzenleme, kira arıza ustası, ödeme yöntemi yönetimi.
- Ekip / ayarlar: özel rol, hedef toplu kopya, izin gerekçeli ret, ofis profili e-posta ve il-ilçe seçici, 3 yerel `confirm()` yerine `ConfirmDialog`, ofis geneli bildirimde kişi başı okundu, yumuşak silme (görev, gider, kampanya vb.).
- Mobil: anlaşma notu ve kayıtlı görünüm silme (hover-only), gider / aidat işlem sütunu, rol matrisi sabit sütun, denetim ayrıntısı.

## 4. Uygulama paketleri

Altı paket, dosya sahipliği çakışmaz. Hiçbiri şu alanlara dokunmaz: `src/app/admin/tenants/**`, `src/app/app/anlasmalar/deal-board*`,
`motion.css` ve animasyon bileşenleri (`src/components/ui` içindeki animasyon dosyaları), `themes.css` ve tema dosyaları, `palette-core`.
Ortak dosya kuralı: `src/lib/nav-config.ts`, `src/lib/permissions.ts`, `src/components/admin/admin-sidebar.tsx`, `src/lib/supabase/middleware.ts`,
`src/lib/tenant-guard.ts` yalnız yazılı sahibi tarafından değiştirilir; diğer paketler gereksinimini sahibine not düşer.
Migration: her paket kendi zaman damgası aralığını kullanır (K1 …01xx, K2 …02xx, ... K6 …06xx, aynı gün öneki), enum ADD VALUE ayrı dosyada.
Hepsinde: ekle/düzenle popup olmaz, her sayı tıklanabilir, `PhoneInput` / `EmailInput`, sonuç mesajı gösterilir, yıkıcı işlem `ConfirmDialog` + denetim kaydı,
yeni action `requirePermission`, yeni `createAdminClient` kullanımı kabul listesine eklenir, mobilde yapılabilir.

### K1. Platform yönetimi (admin: kullanıcı, personel, sistem, denetim)
- Sahiplik: `src/app/admin/members/**`, `admin/personel/**`, `admin/sistem/**`, `admin/hatalar/**`, `admin/aktivite/**`, `admin/bildirimler/**`, yeni `admin/ayarlar/**`, yeni `admin/hesabim/**`, `components/admin/admin-sidebar.tsx`, `components/admin/admin-topbar.tsx`, `actions/platform-staff.ts`, yeni `actions/platform-members.ts`, `actions/platform-settings*.ts`.
- Yapılacaklar: P1-A1, A5, A6, A7, A8, A9, A12, A13; personel zorunlu parola değiştirme sayfası; yan menüye "Ayarlar" girişi.
- Kabul: süper admin üyeyi düzenler / pasifleştirir / sıfırlama bağlantısı üretir; bakım modu ve kayıt kapama çalışır; deneme süresi panelden okunur; cron elle tetiklenir ve kayda düşer; aktivite sunucu filtreli ve CSV'lidir; `must_change_password` okunur.

### K2. Faturalama, satış, destek, duyuru (admin)
- Sahiplik: `admin/billing/**`, `admin/satis/**`, `admin/tickets/**`, `admin/duyuru/**`, `admin/raporlar/**`, `actions/platform-sales.ts`, `actions/admin-ticket-ops.ts`, `actions/platform-notifications.ts`, `lib/billing/plans.ts` (yalnız okuyucu katmanı), yeni `actions/platform-billing*.ts`.
- Yapılacaklar: P1-A2, A3, A4, A10, A11, A14.
- Kabul: havale ödemesi faturada "ödendi" işaretlenir; mutabakat kuyruğundaki her satırda eylem vardır; kupon tanımlanır ve checkout'ta uygulanır; plan fiyatı panelden değişir ve kota ile tutarlıdır (tek kaynak); demo adayı elle eklenir, düzenlenir, silinir; duyuru zamanlanır, düzenlenir.
- Not: `lib/billing/plans.ts` okuyucusu K5'in abonelik ekranını etkiler; arayüzü değişmez.

### K3. Müşteri, talep, iletişim
- Sahiplik: `app/musteriler/**`, `talepler/**`, `arama/**`, `gelen-kutusu/**`, `kampanyalar/**`, `tavsiyeler/**`, `akilli-listeler/**`, `cop-kutusu/**`, `ice-aktarma/**`, `eslestirme/**`, `kayip-satis/**`, `components/app/communication-timeline.tsx`, `components/app/saved-views.tsx`, `actions/customers.ts`, `demands.ts`, `communications.ts`, `campaigns.ts`, `export.ts`, `import-*.ts`, `saved-views.ts`, `notifications.ts`.
- Yapılacaklar: P0-1, P0-2; P1-C1 ... C9; P2 müşteri satırları; ortak `export` filtre yardımcısı (tüm modüllerin CSV'si buraya bağlanır, diğer paketler yalnız çağırır).
- Kabul: dosya yükleyince listede görünür; eşleşmemiş çağrı ve mesaj müşteriye bağlanır; müşteri silmeden önce bağlı kayıt özeti çıkar; CSV ekrandaki filtreyi uygular; mobilde toplu işlem yapılır.

### K4. Portföy, proje, portal
- Sahiplik: `app/portfoyler/**`, `projeler/**`, `acik-ev/**`, `portallar/**`, `kayip-kacak/**`, `degerleme/**`, `belgeler/**`, `ag/**`, `src/app/paylas/**` (public), `components/app/portal-link-dialog.tsx`, `actions/properties.ts`, `property-*.ts`, `projects.ts`, `portal-listings.ts`, `owner-portal.ts`, `open-house.ts`, `network.ts`, `documents.ts`, `presentations.ts`, `targets-openhouse-sources.ts`.
- Yapılacaklar: P0-6, P0-7, P0-8, P0-9; P1-D1 ... D8; `portal-link-dialog` telefon alanını `PhoneInput` + sunucu doğrulamasına geçir (tek ihlal).
- Kabul: proje ve daire düzenlenir, durum değişir, fiyatsız daire fiyat alır; yetki belgesi gösterilir; belge görseli public paylaşımda görünmez (test); malik portalı detaydan yönetilir.

### K5. Ofis hesabı, abonelik, ekip
- Sahiplik: `app/ekip/**`, `abonelik/**`, `askida/**`, `uyum/**`, `denetim/**`, `destek/**`, `bildirimler/**` (ofis), yeni `app/hesabim/**`, `ayarlar/guvenlik/**`, `lib/nav-config.ts`, `lib/permissions.ts`, `lib/supabase/middleware.ts`, `lib/tenant-guard.ts`, `components/ui/console/user-menu-panel.tsx`, `actions/team.ts`, `billing.ts`, `tickets.ts`, `staff-leaves.ts`, `compliance*.ts`, `onboarding-setup.ts`, `actions/password-reset.ts`.
- Yapılacaklar: P0-11, P0-12; P1-B2, B3, B4, B5, F1, F2, F3, F4, F5, F6, F8; şubeler sekmesi + menü kaydı.
- Kabul: askıdaki ofis ödeme yapıp açılır; üye bilgisi düzenlenir; kullanıcı profilinden parola değiştirir; Şubeler menüden bulunur (ekle, düzenle, pasif, müdür); abonelik iptali dönem sonunda geçerli olur.

### K6. Ayarlar, iş takibi, finans
- Sahiplik: `app/ayarlar/**` (güvenlik hariç), `randevular/**`, `gorevler/**`, `hedefler/**`, `otomasyonlar/**`, `anlasmalar/**` (deal-board* hariç), `teklifler/**`, `sozlesmeler/**`, `komisyon/**`, `giderler/**`, `aidat/**`, `kiralama/**`, `cuzdan/**`, `onaylar/**`, `actions/deals.ts`, `offers.ts`, `contracts.ts`, `commissions.ts`, `expenses.ts`, `dues.ts`, `rentals.ts`, `payment-links.ts`, `appointments.ts`, `tasks.ts`, `automations.ts`, `settings.ts`, `announcements.ts`, `message-templates.ts`, `definitions.ts`.
- Yapılacaklar: P0-3, P0-4, P0-5, P0-10; P1-B1, B6 ... B10, E1 ... E10, F7.
- Kabul: portföysüz anlaşmaya portföy bağlanır ve kazanılır; ödeme linki iptal edilir; kira düzenlenir ve uzatılır; randevu danışman seçer; sözleşme şablonu yönetilir.
- Koordinasyon: `anlasmalar/[id]/duzenle` yeni dosyadır; `deal-board.tsx` popup'ı başka ajanda bittiğinde tek bağlantıya indirilir.

Sıra önerisi: önce tüm P0 küçükleri (K3 P0-1, K4 P0-8, K5 P0-12, K6 P0-10) tek günde; ardından paketler paralel. K2 ve K5 abonelik / plan okuyucusunda birbirine bağımlıdır (K2 önce).

## 5. Doğrulanamadı

- Uygulama çalıştırılmadı; hiçbir hücre tarayıcıda denenmedi. Mobil bulgular sınıf adlarından çıkarıldı (Bölüm 2.5).
- Canlı şema görülmedi: "Muhtemelen" şema kararları (`invoices` ödeme alanları, ödeme linki iptal durumu, `branches.phone`, hakediş ödeme tablosu, `cancel_at_period_end`, KVKK talep türü) migration dosyalarından okundu, canlı veritabanıyla karşılaştırılmadı.
- `admin/tenants/**` denetlenmedi (başka ajan). Matristeki "NOT" satırı yalnız gözlem; ofis ekleme, ofis düzenleme, kimliğe bürünme ve ofis silme / arşiv durumu bilinmiyor.
- Rol bazlı görünürlük (hangi rol hangi düğmeyi görür) yalnız `permissions.ts` matrisi ile kod koşullarından çıkarıldı; çalışma zamanında doğrulanmadı.
- Supabase Auth e-posta şablonları ve Supabase panosundaki ayarlar (davet / sıfırlama metni) depoda yok; panelde ne olduğu bilinmiyor.
- `src/app/app/**` içinde dinamik menü ögeleri (`nav-config.ts` paket kilidi `page-gates.ts`) yalnız okundu; pakete göre gizlenen ekranlar ayrıca sayılmadı.
- Cron envanterinde (`vercel.json`) elle tetikleme için bir rota-içi yardımcı olup olmadığı (K1/P1-A7 uygulanabilirliği) denenmedi.
- Başka ajanların açık işleri (deal-board, tenants, animasyon, tema) bu belgeyle aynı anda değişiyor olabilir; çakışan satırlar (P0-3, P1-E7) için son durum kontrol edilmeli.

## 6. Kanıt: her YOK için arama

Desenler `src/` içinde (test hariç) arandı; "0" sonuç anlamına gelir. Yol kökü `src/app/actions` (= `act/`) ya da belirtilen klasör.

| Kod | Aranan | Desen / klasör | Sonuç |
|---|---|---|---|
| G-01 | Kupon / indirim | `coupon\|kupon` tüm `src/` | 0 |
| G-02 | Bakım modu, kayıt kapama | `maintenance_mode\|bakim_modu\|registration_open` tüm `src/` | 0 |
| G-03 | Silme / arşiv action'ı (anlaşma, teklif, sözleşme, randevu, talep, çağrı, kira, proje, daire, açık ev, değerleme, portal ilanı) | `export async function (delete\|remove\|archive)(Deal\|Offer\|Contract\|Appointment\|Demand\|Call\|Rental\|Project\|Unit\|OpenHouse\|Valuation\|PortalListing)\b` `act/` | 0 |
| G-04 | Proje, daire, kira, açık ev düzenleme action'ı | `export async function (update\|edit)(Project\|Unit\|Rental\|OpenHouse)` `act/` | yalnız `updateOpenHouseStatus` (durum) |
| G-05 | Uygulama içi parola değiştirme | `updateUser\(\{ *password` `src/` | yalnız `app/sifre-yenile/*` |
| G-06 | Oturum kapatma (tüm cihaz) | `signOut\(\{ *scope` `src/` | 0 |
| G-07 | E-posta gönderimi (şablon) | `sendEmail\|nodemailer\|smtp\|api\.resend\.com` `src/` | 0; davet / sıfırlama `resetPasswordForEmail` (`ekip/invite-actions.ts:48,176`, `act/password-reset.ts`) |
| G-08 | Parola zorunlu değişimi okunuyor mu | `must_change_password` `src/` | tek sonuç `act/platform-staff.ts` (yazma) |
| G-09 | Abonelik iptali | `cancelSubscription\|cancel_at_period_end` `src/` | 0 |
| G-10 | Elle fatura kesme | `createInvoice\|insert\(.*invoices` `src/` | yalnız `lib/efatura.ts` (e-fatura entegrasyonu, panel yok) |
| G-11 | Platform SMS yazma formu | `netgsm_` `src/` | yalnız `lib/messaging/netgsm.ts` (okuma) |
| G-12 | Cron elle tetikleme | `admin/sistem/*` içinde "tetikle\|Çalıştır\|trigger" | düğme yok (`system-view.tsx:255-287` yalnız durum) |
| G-13 | Çöp kutusu kapsamı | `deleted_at` `supabase/migrations` | yalnız customers, properties, support_ticket_attachments |
| G-14 | İşlevsiz düğme / vaat | `[Yy]akında\|coming soon\|TODO\|FIXME\|href="#"` `src/` | yalnız kampanya "E-posta (yakında)" |
| G-15 | Telefon / e-posta ham input | `type="tel"\|type="email"\|inputMode="tel"` `src/` | yalnız bileşenler ve `portal-link-dialog.tsx:278` |
| G-16 | Kullanıcı profil sayfası | klasör `src/app/app/` (`profil`, `hesabim` yok), `user-menu-panel.tsx:63-99` | yok |
| G-17 | Şube müdürü kullanımı | `manager_user_id` `src/` | 0 (şemada var) |
| G-18 | Kupon / plan tablosu panelde | `plan_definitions` `src/`, `supabase/migrations` | 0 (yalnız `plan_entitlements`) |
| G-19 | Açık ev, proje, kira "düzenle" sayfası | klasör `app/acik-ev/[id]`, `projeler/[id]`, `kiralama/[id]` içinde `duzenle` | yok |
| G-20 | Müşteriye bağlama (çağrı) | `act/communications.ts` içinde `link\|attach\|bind` | yok |

Mekanik "arayüzü olmayan action" listesi Bölüm 2.1.3'te: 458 `export async function` içinde çağıranı olmayan 22 adet.
Matristeki diğer YOK hücrelerinin kanıtı ilgili satırın dosya:satır referansıdır (ekranın okunup ilgili düğmenin bulunmadığı yer).
