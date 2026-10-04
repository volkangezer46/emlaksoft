# ChatGPT öneri listesi: sistemle karşılaştırma, ayıklama ve Modüller (aç/kapa) tasarımı

Tarih: 2026-10-04 · Kapsam: yalnız belge; kod, canlı DB ve migration DEĞİŞMEDİ (aşağıdaki SQL taslağı belge içindedir, dosya olarak eklenmedi, uygulanmadı).
Kaynak liste: `docs/design/CHATGPT_ONERI_LISTESI.md` (114 numara; listede "2" numarası yoktur, "1" içine dahildir; yani 113 madde). İçindeki sayılar, atıflar ve mevzuat iddiaları ChatGPT'nindir ve DOĞRULANMAMIŞTIR; bu belge hiçbirini hukuki gerçek olarak kullanmaz.
Sahibin yönergesi: hepsini yapmak zorunda değiliz; bize uygun olanlar entegre edilir; amaç modül çoğaltmak değil, daha fazla KULLANILABİLİR özellik; müşteri isterse Modüller bölümünden modül açıp kapatabilsin.

Tekrar üretilmeyen, okunup atıf yapılan belgeler: `ORGANIK_BUYUME_PLANI.md` (ofisten ofise büyüme, referral/ortak, ücretsiz araçlar, Powered by, benchmark: ChatGPT'nin ikinci cevabı), `DANISMAN_UZMANLIK_HAVUZ_DEMO_SPEC.md` (uzmanlık, bölge, ilan havuzu, claim/SLA, demo paketleri, kurulum turu), `PIYASA_VE_FARK_YARATAN_OZELLIKLER.md` (F1-F7, Paket A-E, K1-K11), `FEATURE_BACKLOG.md`, `PERSONA_*`, `MODUL_ENVANTERI_360.md`, `ISLEM_TAMLIK_DENETIMI.md`, `ADVISOR_AND_MATCHING_SPEC.md`. Başka ajanların alanı (önerilmedi): K1-K6 eksik işlem paketleri, admin ofis ekleme, animasyon, telefon girişi, TV modu.

Okuma kılavuzu: yol kısaltması `app/…` = `src/app/app/…`, `actions/…` = `src/app/actions/…`, `lib/…` = `src/lib/…`. Kanıt yöntemi: dosya/tablo adı ve içerik okunarak; "doğrulanmadı" yazılan yerde kod okunmadı. Uygulama çalıştırılmadı.

---

## 0. Özet

| Ölçü | Sonuç |
|---|---|
| Madde sayısı | 113 (numara 1-114, "2" yok) |
| Menü | bugün 41 öğe (9 başlık; `nav-config.ts`, 61 `href` satırı - 20 sekme satırı). Hedef ≤ 40, bu belgenin önerisi 36 (bölüm 2.3) |
| ChatGPT'nin 10 başlıklı menüsü | Mevcut 9 başlık korunur (bölüm 2.2) |
| Seçilen uygulama paketi | 8 (V2: Ö-1..Ö-6, V3: Ö-7, Ö-8) |
| Yeni ana menü öğesi | 0 |
| Yeni modül (kapatılabilir ürün alanı) | 0; mevcut 25 alan Modüller ekranına kaydedilir |
| Sayımlar (durum) | bölüm 1.8'de tablonun altında |

Üç ana bulgu:
1. Listenin büyük kısmı zaten var (CRM omurgası, eşleştirme, anlaşma panosu, teklif turları, komisyon, otomasyon/playbook, AI içerik, AI asistan, malik/müşteri portalı, açık ev, kira, değerleme, hesaplayıcılar, KVKK/İYS, denetim). Yeni iş azdır; çoğu "mevcut özelliğe küçük ek" veya "iki mevcut şeyi tek göstergede birleştir".
2. Gerçek boşluk dar: ilk yanıt süresi ölçümü, malik-müşteri bağı (`properties` üzerinde malik FK'sı bulunamadı), WhatsApp gelen mesaja cevap taslağı, Emlakfiyati arayüz sınırı, gösterim sonrası geri bildirim, satış sonrası playbook şablonları.
3. Risklilerin hepsi ELE veya "sahibin kararı" listesinde (bölüm 5, 6).

---

## 1. Madde madde karşılaştırma

Durum: **VAR** (kanıtlı) · **KISMEN** (eksik yazılı) · **YOK** (aranıp bulunamadı) · **BAŞKA AJANDA** (başka belge/ajan kapsamında) · **UYGUN DEĞİL** (neden yazılı). Karar: **ENTEGRE ET** (yeni, küçük) · **GELİŞTİR** (mevcut genişler) · **BİRLEŞTİR** (mevcut iki şey/mevcut sekme) · **ELE** · **ERTELE V3/V4**. `(Ö-n)` = bölüm 4 paketi. RİSK işareti bölüm 5'tedir.

### 1.1 A. Gösterge paneli ve CRM çekirdeği

| # | Durum | Kanıt / eksik | Karar | Gerekçe |
|---|---|---|---|---|
| 1 | KISMEN | `app/_home/{siradaki-eylem,aranacaklar,bugun-ozet,karar-bekleyenler}.tsx`, `app/brifing`, `lib/ai/briefing-summary.ts`. Eksik: kişi bazlı davranış cümlesi ("5 ilan inceledi"); `listing_views` yalnız ilan/gün sayacı | GELİŞTİR | Kural tabanlı gerçek-veri cümleleri ("X gündür aranmadı"); "AI diyor ki" uydurması yok |
| 3 | KISMEN | `customers`: `customer_types[]` (çoklu rol), `tags[]`, `source`, `birth_date` (cron `dogum-gunu` kullanıyor), `app/musteriler/[id]/customer-360-tabs.tsx`. Eksik: meslek, şirket, medeni durum, eş/çocuk, referans veren | GELİŞTİR (Ö-2) | Yalnız meslek ve "kim getirdi" (mevcut `referrals` bağı); aile/medeni durum ELE: kullanılmayan kişisel alan formu şişirir |
| 4 | KISMEN | `lib/activity-timeline.ts`, `communications` (call/whatsapp/sms/email/meeting/note), `calls` + `lib/ai/call-summary.ts`, 360 "Zaman çizelgesi". Eksik: arama süresinin otomatik kaydı (santral yok), bütçe değişikliği olayı | BİRLEŞTİR | Mevcut zaman çizgisine bütçe değişikliği ve çağrı özeti olayı eklenir |
| 5 | KISMEN | `customers.tags[]` (elle), `app/akilli-listeler`, `lib/customer-heat.ts`. Otomatik etiket üretimi yok | BİRLEŞTİR (Ö-2) | Dinamik etiket = Akıllı Liste kuralı. "30 gün içinde alır" tipi tahmin etiketi ELE (girdi verisi yok) |
| 6 | KISMEN | `lib/lead-score.ts` (0-100 + `factors[]` neden listesi), `customer-heat.ts`, `churn-risk.ts`; kural tabanlı | BİRLEŞTİR (Ö-2) | "AI lead skoru" adı kullanılmaz: tek "Müşteri ısısı", formül gösterilir. 48 saatte ilan inceleme sinyali kişi bazında yok, uydurulmaz |
| 7 | BAŞKA AJANDA | `assignment_rules` (least_loaded/round_robin/weighted), `lib/lead-intake.ts`; bölge/uzmanlık/fiyat/müsaitlik: `DANISMAN_UZMANLIK_HAVUZ_DEMO_SPEC.md` (`advisor_specialties`, `advisor_regions`, `target_kind`) | ELE (burada) | Mükerrer tasarlanmaz |
| 8 | BAŞKA AJANDA | Aynı spec: `assign_mode='claim'`, `claim_open_until`, ilk sahiplenen alır | ELE (burada) | Aynı |
| 9 | KISMEN | İlk yanıt süresi ölçülmüyor: `lib/gamification-query.ts:296` `avgFirstResponseMin: null`. Spec'te `sla_minutes` + yedek zincir (taslak), `PERSONA_OFIS_SAHIBI` #8 | GELİŞTİR (Ö-3) | Ölçüm + rapor sekmesi + sahibe istisna bildirimi. Otomatik devir spec'in yedek zinciridir, burada yeniden yazılmaz |
| 10 | VAR | `lib/demand-criteria.ts` (oda, m², kat, ısınma, cephe, özellik, il/ilçe/mahalle + `extra_locations`, bütçe, aciliyet), `app/talepler` | ELE | Zaten var |
| 11 | KISMEN | `lib/matching.ts`, `lib/match-notify.ts` (yeni ilan, uygun talepler için danışmana bildirim), `actions/match-preview.ts`, Talepler > Eşleşme. Müşterilere toplu gönderim doğrulanmadı | GELİŞTİR (Ö-4) | Toplu gönderim mevcut sunum + WhatsApp şablonu + İYS kontrolüyle; yeni yüzey yok |
| 12 | VAR | `app/musteriler/[id]/matched-properties-widget.tsx` | ELE | "AI en iyi 3" ağırlıklı skor sıralaması zaten var |

### 1.2 B. Portföy ve ilan

| # | Durum | Kanıt / eksik | Karar | Gerekçe |
|---|---|---|---|---|
| 13 | KISMEN | `properties`: `parcel_block`, `parcel_lot`, `list_price`, `min_price`, `hidden_price`, `commission_rate`, `features jsonb`, `authorization_start/end/type/notes` (migration `20260723000034`), `property_media`. Eksik: bağımsız bölüm, arsa payı, hisse | GELİŞTİR | Eksikler `features jsonb` içine (migration gerekmez) |
| 14 | VAR | `lib/property-health.ts` (sağlık + ilan kalite puanı 0-100, eksik/öneri), `components/app/property-health-card.tsx`, `lib/sale-diagnostics.ts` | ELE | Zaten kural tabanlı ve eksik listeli; görsel kalite için `PIYASA` F3 |
| 15 | VAR | `lib/ai/content.ts` (`listing/whatsapp/social/email`), `app/portfoyler/[id]/ai-content-panel.tsx`, `lib/listing-text.ts` | ELE | Zaten var |
| 16 | KISMEN | Filigran: `lib/watermark*.ts`, `app/ayarlar/filigran`; `integrations/registry.ts` `ai_media` durumu "planned"; fotoğraf iyileştirme/staging yok | ERTELE V3 | Dış sağlayıcı ve "sanal döşeme" etiketi kararı (`PIYASA` K4); deterministik kalite denetçisi `PIYASA` F3'te |
| 17 | KISMEN | `portal_listings`, `app/portallar` (teyit, yenileme, kapanış), `lib/integrations/portals/index.ts` iskelet (kapalı API, sözleşme gerekir), vitrin var | ERTELE V3 | Portal API anlaşması sahibin kararı (`PIYASA` K1/K2). Sosyal medyaya yayın ELE (#70) |
| 18 | KISMEN | `properties.authorization_*`, `lib/authority-shield.ts`, otomasyon tetikleyicisi `auth_expiring`, portföy detay + `app/portallar`, `app/ayarlar` "EİDS kalkanı: Manuel". Eksik: taşınmaz no / yetkilendiren malik alanı, 30/7/1 gün kademesi | GELİŞTİR (Ö-5) | Yalnız TAKİP alanı; resmi EİDS doğrulama iddiası YOK. RİSK işaretli (bölüm 5) |
| 19 | KISMEN | `contract_templates`, `contract_versions`, `app/sozlesmeler`, `lib/contract-risk.ts`. Tür bazlı hazır metin yok (yazılmaz) | GELİŞTİR | Yalnız değişken/yer tutucu sözlüğü + ofisin kendi metni; yer gösterme belgesi `PIYASA` §3.0'da. Hukuki metin YAZILMAZ |
| 20 | KISMEN | `/imza/[token]`, `contract_signers`, `lib/otp-hmac.ts` (SMS OTP). Nitelikli e-imza sağlayıcısı yok | ELE (sağlayıcı entegrasyonu) | Hukuki geçerlilik türü sahibin/hukukçunun kararı (`PIYASA` K8). "Hukuken geçerli" iddiası yok. RİSK işaretli |
| 21 | KISMEN | `appointments.appointment_type='showing'`, `complete-appointment-dialog.tsx`, `lib/appointment-outcome.ts`, `contracts` yer_gosterme türü (`PIYASA`). Müşteri imzası/konum yok | BİRLEŞTİR | `PIYASA` §3.0 "dijital yer gösterme tutanağı" ile aynı iş; yeni modül yok |
| 22 | KISMEN | `surveys`, `/anket/[token]`, `app/raporlar/memnuniyet`; gösterim sonrası otomatik anket ve satın alma "ihtimali" yok; `PERSONA_MUSTERI` #3 | GELİŞTİR (Ö-7) | 1-5 ilgi puanı talep kaydına yazılır. "AI satın alma ihtimali" ELE (sahte skor) |
| 23 | VAR | `appointments.appointment_type`; migration adı `20260813000300_expense_text_appointment_loose_definitions_system.sql` türü tanım listesine bağlar (dosya adından çıkarım, içerik okunmadı) | ELE | Tür eklemek Ayarlar > Tanımlar'dan |
| 24 | VAR | `app/randevular/{rota-view,rota-map,route-suggestion}.tsx`, `lib/route-plan.ts` (haversine, sıkışık geçiş uyarısı; gezgin satıcı optimizasyonu bilinçli yok) | ELE | Zaten var |

### 1.3 D. İletişim ve AI

| # | Durum | Kanıt / eksik | Karar | Gerekçe |
|---|---|---|---|---|
| 25-26 | KISMEN | `lib/messaging/whatsapp-cloud.ts`, `app/api/webhooks/meta` + `lib/webhooks/meta-inbound.ts` (gelen mesaj + teslim durumu), `communications`, Gelen Kutusu, `app/ayarlar/mesaj-sablonlari`, `lib/ai-advisor.ts` `draft_sms`. Gelen mesaja cevap taslağı yok | GELİŞTİR (Ö-4) | Taslak öner, İNSAN gönderir. "Onaysız otomatik gönderim" ayarı ELE: açık uçlu bot WhatsApp politikası (`PIYASA` §1 [A]) ve İYS riski |
| 27 | KISMEN | `calls` (notes, direction, disposition, duration), `lib/ai/call-summary.ts` (nottan özet; ses değil). Santral, ses kaydı, transkript yok | ERTELE V4 | RİSK: ses kaydı kişisel veri + çalışan izleme; dış bağımlılık (`PIYASA` K5) |
| 28 | YOK | `lib/email.ts` yalnız adres doğrulama; e-posta `communications`'a elle kayıt; OAuth yok. Kısmi karşılık: otomasyon `no_contact_days` | ERTELE V4 | Gmail/Outlook OAuth uygulama doğrulaması + güvenlik değerlendirmesi; sahibin hesabı |
| 29 | KISMEN | Gelen Kutusu (WhatsApp + SMS + çağrı akışı), `meta_lead_ads` (registry), `app/ayarlar/lead`. Instagram/Facebook DM yok | BİRLEŞTİR | Zaten tek akış; DM entegrasyonu ERTELE V4 |
| 30 | VAR | `app/asistan`, `app/api/ai/tenant-chat`, `actions/ai-tenant-advisor.ts` (araçlar `suggest_task`, `list_hot_customers`, `draft_sms`; görev önerisi insan onaylı `confirmSuggestedTask`), `lib/ai/advisor-scope.ts` | GELİŞTİR (Ö-4) | Talep/portföy sorgu aracı eklenir ("6-8M villa arayanlar"); sağ panel yeni yüzey ELE |
| 31 | KISMEN | Cron `gunluk-ozet` + `app/brifing` var; müşteriyle insansız konuşan ajan yok | ELE | Otonom müşteri etkileşimi: İYS/WhatsApp politikası + ürün riski; sabah özeti zaten var |
| 32 | VAR | `lib/seller-prediction.ts`, `lib/churn-risk.ts`, `app/akilli-listeler`, `app/kayip-satis`, `auth_expiring` | GELİŞTİR (Ö-2) | Hazır akıllı listeler: tekrar aktifleşenler, yetkisi bitenler, eski alıcı. Kural tabanlı |

### 1.4 E. Değerleme ve fiyat (Emlakfiyati: bölüm 3)

| # | Durum | Kanıt / eksik | Karar | Gerekçe |
|---|---|---|---|---|
| 33 | KISMEN | `valuations`, `app/degerleme`, `lib/valuation.ts` `estimateMultiSourceValue` (ofis emsal motoru en yüksek ağırlık + Endeksa + Tapusor), `properties.price_health`. Portföy detayında "değer - ilan farkı" kısayolu doğrulanmadı | GELİŞTİR (Ö-6) | Emlakfiyati aynı kaynak arayüzüne takılır; uydurma uç nokta yok |
| 34 | KISMEN | `lib/sale-diagnostics.ts` (neden satmıyor: süre, emsal üstü fiyat, portal görünürlüğü, foto, görüntülenme; aksiyonlu) | BİRLEŞTİR | "Satılabilirlik skoru" adı ELE; teşhis zaten açıklanabilir |
| 35 | KISMEN | `region_stats_history`, `app/bolge-analizi`, kapanan `deals`. Fiyata göre süre tahmini yok | ERTELE V3 (Ö-8) | Yalnız "benzer n kapanışta ortalama X gün" istatistiği; n eşiği altında gösterilmez |
| 36 | VAR | `/degerleme-raporu/[token]`, `presentations` + `/sunum`, `app/portfoyler/[id]/brosur`, `actions/public-valuation.ts` | ELE | Pazarlama planı bölümü küçük ek, Ö-8'de |

### 1.5 F-G. Portallar ve satış süreci

| # | Durum | Kanıt / eksik | Karar | Gerekçe |
|---|---|---|---|---|
| 37 | KISMEN | `/malik-portali/[token]`: gelen teklif, randevular. `listing_views` (ilan/gün) tablosu var ama portalda görüntülenme/favori sayısı gösterilmiyor | GELİŞTİR (Ö-7) | Gerçek sayaç kartı; `PERSONA_MUSTERI` #2 haftalık özetle birlikte |
| 38 | KISMEN | `/musteri-portali/[token]`: talepler, randevular, `match-feedback.tsx` (`portal_match_feedback`). Favori/belge/danışmanım doğrulanmadı | ERTELE V3 | `PERSONA_MUSTERI` #4-5 zaten önerilmiş |
| 39 | VAR | `app/anlasmalar/deal-board.tsx` (dnd-kit), aşama etiketleri `app/ayarlar/tanimlar/stage-labels-panel.tsx` | ELE | Aşama sayısı ofis tanımına bırakılır (aşama tasarımı `DURUM.md`'de açık) |
| 40 | VAR | `lib/deal-score.ts` (aşamaya ek olarak yaş, dokunulmamışlık, teklif sinyalleri) | GELİŞTİR | Formül UI'da gösterilir. "Tahmini kapanış tarihi" ELE (veri yok) |
| 41 | VAR | `offers`, `offer_rounds`, `app/teklifler`; `min_price`/`hidden_price` | ELE | Zaten var |
| 42 | KISMEN | `malik-portali/[token]/offer-actions.tsx`, `actions/owner-portal-offers.ts`. Alıcı portalından teklif verme yok | ERTELE V3 | `PERSONA_MUSTERI` #4 |
| 43 | KISMEN | `app/anlasmalar/[id]/kapanis-sihirbazi.tsx`, `deal_costs`, `payment_links`; makbuz belgesi yok | BİRLEŞTİR | Kapora = ofis aşaması + checklist maddesi |
| 44 | VAR | `app/anlasmalar/[id]`: checklist, costs, notes, timeline, kapanış paneli; `customer_files` | ELE | Ayrı "Transaction room" yok; anlaşma detayı zaten oda |
| 45 | KISMEN | `deal_checklist_items`, `lib/deal-checklist-templates.ts` (SALE/RENT kodda), `actions/deal-checklist.ts`. Ofis özel şablon ekranı doğrulanmadı | GELİŞTİR | Şablonu Ayarlar > Tanımlar'a taşı (küçük) |
| 46 | VAR | `lib/ai/document-ocr.ts` (tapu/yetki, alanlar kullanıcı onaylı), `actions/property-media.ts` | GELİŞTİR (Ö-5) | Portföy ekleme akışına "tapu fotoğrafından doldur" düğmesi |

### 1.6 H. Danışman ve ofis yönetimi

| # | Durum | Kanıt / eksik | Karar | Gerekçe |
|---|---|---|---|---|
| 47 | VAR | `app/performansim`, `app/_home/hedef-karti.tsx` | ELE | Zaten var |
| 48 | VAR | `targets`, `app/hedefler`, `lib/team/target-actuals.ts` | ELE | Zaten var |
| 49 | VAR | `lib/team/scorecard.ts`, `app/ekip/kiyas`, `app/danisman-kpi`, `agent_score_snapshots` | ELE | Tek /100 danışman skoru ELE; sütunlu karne gerçek veri |
| 50 | VAR | `app/_home` (`kpi-satiri`, `bugun-ozet`, `kapsam-anahtari`), `app/pano-tv`, `app/raporlar` | ELE | "Control Tower" ayrı sayfa değil; `PERSONA_OFIS_SAHIBI` #1 ile aynı iş |
| 51 | UYGUN DEĞİL | Canlı durum takibi yok; `staff_leaves` izin takvimi var | ELE | RİSK: çalışan gözetimi (bölüm 5) |
| 52-54 | VAR | `commissions`, `commission_splits`, `commission_payouts`, `advisor_commission_plans` (`tiers jsonb` kademeli), `lib/commission.ts`, `lib/commission-cap.ts`, `app/onaylar`. Takım lideri override ve referral primi doğrulanmadı | ELE | Zaten var |
| 55-56 | KISMEN | `expenses`, `app/giderler`, `property_dues`, kâr-zarar karşılaştırma. Kasa/banka hesabı yok | ELE | Kasa/banka muhasebe programı işi, kafa karıştırır. Şube/danışman karlılığı `PERSONA_OFIS_SAHIBI` #4 finans özeti sekmesine |
| 57 | KISMEN | `lib/lead-sources.ts`, Raporlar kaynak ROI. Reklam harcaması girişi yok | GELİŞTİR | Gider kategorisi "reklam" + kaynak etiketi (küçük). Ofisler arası UTM ölçümü organik plan Paket H'dir, ayrı |
| 58 | VAR | `lib/sale-diagnostics.ts` + portal teyit + `listing_views` | ELE | "Trafik var teklif yok" teşhisi zaten kural tabanlı |

### 1.7 I-M. Pazar, kira, pazarlama, otomasyon, ağ, güvenlik, mobil

| # | Durum | Kanıt / eksik | Karar | Gerekçe |
|---|---|---|---|---|
| 59-61 | UYGUN DEĞİL | Rakip ilan takibi, fiyat alarmı, satıldı tahmini: veri kazıma (scraping) yolu | ELE | RİSK (bölüm 5). Kendi ilanlarınızın portal kapanışı zaten `listing_closures` + Kaçan komisyonlar; lisanslı bölge endeksi Endeksa/Tapusor |
| 62 | VAR | `app/bolge-analizi`, `region_stats_history`, `lib/talep-arz.ts`, `app/raporlar/talep-arz`, hesaplayıcı getiri | ELE | Zaten var |
| 63 | KISMEN | `app/portfoyler/map-view.tsx` (lat/lng), `app/randevular/rota-map.tsx`. Talep/satıldı katmanı yok | ERTELE V3 | Yeni modül değil; mevcut harita görünümüne katman |
| 64 | UYGUN DEĞİL | "Satılmayan sahibinden ilanları": kazıma | ELE | RİSK. Alternatif: yetkisi biten kendi portföyler + `seller-prediction` |
| 65 | YOK | `properties` tablosunda malik-müşteri FK'sı bulunamadı (migration taraması; `owner_portal_tokens` yalnız `owner_name/owner_phone` taşır; kiralamada `rentals.renter_customer_id` var) | ENTEGRE ET (Ö-5) | #32, #37, #66, #80'in temeli: bir kişi birden çok taşınmaz |
| 66 | YOK | Malik bağı yok; `lib/investment.ts` yalnız hesap | ERTELE V3 | #65'e bağlı |
| 67-68 | VAR | `rentals`, `rent_charges`, `property_dues`, `maintenance_requests`, `actions/property-management.ts`, cron `kira-tahakkuk`, `app/kira-artis` | ELE | Zaten var |
| 69 | KISMEN | `lib/ai/content.ts` + `campaigns` + `brosur`; tek tuş kampanya yok | BİRLEŞTİR | AI içerik panelinden "kampanyaya aktar" |
| 70 | YOK | Sosyal medya planlayıcı yok | ELE | Yayın entegrasyonu ve Meta hesabı gerekir; kafa karıştırır |
| 71 | KISMEN | `/acik-ev-kayit` QR, `share_links` `/paylas`. İlan başına QR + kaynak izleme yok | GELİŞTİR | Küçük: ilan bağlantısına kaynak=qr |
| 72 | VAR | `app/acik-ev`, `/acik-ev-kayit`, `open_house_visitors` | ELE | Zaten var |
| 73 | VAR | `/danisman/[slug]`, `lib/agent-profile.ts`, `app/ekip/kartvizitim` (alt alan adı değil yol) | ELE | Opt-in sayfa var; geliştirmeler organik plan Paket D |
| 74 | KISMEN | `/vitrin/[slug]`, marka (logo, renk). Domain bağlama / no-code builder yok | ELE | Builder kafa karıştırır; domain V4 |
| 75 | KISMEN | `app/sitemap.ts`, vitrin. Şehir/tür SEO sayfaları doğrulanmadı | BİRLEŞTİR | Organik plan #17 kapsamı |
| 76 | KISMEN | `actions/public-valuation.ts`, `/degerleme-raporu`, vitrin değerleme talebi. Emlakfiyati bağlantısı yok | BİRLEŞTİR (Ö-6) | Lead = vitrin talebi; üçüncü kişiye aktarım rızalı (organik plan #18) |
| 77 | VAR | `referrals`, `referral_links`, `app/tavsiyeler`, `/tavsiye/[token]`. Prim hesabı doğrulanmadı | ELE | Müşteri tavsiye programı var; ofisten ofise referral organik planda |
| 78 | KISMEN | `surveys`, `app/raporlar/memnuniyet`. Google yorumu isteme yok | ENTEGRE ET (Ö-7) | `PIYASA` F6 ile aynı; yeniden tasarlanmaz |
| 79 | KISMEN | `playbooks`/`playbook_steps` + `deal_won` tetikleyici. Satış sonrası (6 ay, 1 yıl) şablon yok | GELİŞTİR (Ö-7) | `lib/playbook-templates.ts`'e şablon (kod değişikliği küçük) |
| 80 | KISMEN | `lib/seller-prediction.ts` yalnız malik tipi için | GELİŞTİR (Ö-2) | Kapanmış alıcı + süre, akıllı liste kuralı |
| 81 | YOK | Ekip içi chat yok | ELE | Atama bildirimi var (`notify.ts`); chat kafa karıştırır |
| 82 | VAR | `lib/automation-engine.ts` (olay: new_customer, new_demand, new_property, property_matched, offer_received, deal_won, deal_lost; zamanlı: no_contact_days, auth_expiring, appointment_missed, demand_stale), `playbooks` | ELE | Zaten var |
| 83 | VAR | `app/otomasyonlar/automation-wizard.tsx`, `conditions jsonb`, `app/ayarlar/is-akislari` | ELE | IF/THEN zaten var |
| 84 | VAR | `playbook_steps` (gün bazlı adımlar), cron `otomasyon` | ELE | Drip = playbook |
| 85 | VAR | Cron `gunluk-ozet`, `lib/ai/briefing-summary.ts`, `app/brifing` | ELE | Zaten var |
| 86 | VAR | Cron `haftalik-ozet`, `app/_home/kapsam-anahtari.tsx` | ELE | Zaten var |
| 87 | UYGUN DEĞİL | Çağrı kaydı analizi ile çalışan koçluğu | ELE | RİSK (bölüm 5). Mevcut `lib/advisor-coach.ts` kural tabanlı KPI koçu, ses analizi değil |
| 88 | VAR | `lib/gamification.ts`, `app/lig`, `agent_badges`, cron `lig-snapshot` | ELE | Zaten var |
| 89 | KISMEN | `branches`, `app/ekip/branch-card.tsx`, `app/franchise`, plan sınırı `branches`. Holding/marka/bölge katmanı yok | ERTELE V4 | Önce talep |
| 90 | KISMEN | `app/franchise` (Franchise BI). Royalty yok | ERTELE V4 | ChatGPT de "ileri faz" diyor |
| 91 | VAR | `app/ag`, `network_listings`, `network_demands`, `network_requests`, `network_demand_responses`. Komisyon yüzdesi alanı doğrulanmadı | ELE | Ofisler arası ağ zaten var |
| 92 | YOK | Marketplace yok | ELE | Organik plan #13 V-later; ödeme/komisyon tutmak risk |
| 93 | UYGUN DEĞİL | Banka lead / kredi motoru: finansal ürün aracılığı | ELE | RİSK. Kredi taksit hesabı `lib/purchase-costs.ts` `computeLoanPlan` zaten var |
| 94 | VAR | `lib/purchase-costs.ts`, `app/hesaplayici` | ELE | Zaten var |
| 95 | VAR | `lib/investment.ts`, `lib/roi-calculator.ts`, `app/hesaplayici?sekme=yatirim` | ELE | Zaten var |
| 96 | KISMEN | `app/portfoyler/compare-shell.tsx`, `property-row-compare.tsx`. Getiri satırı yok | BİRLEŞTİR | Karşılaştırmaya getiri satırı; "AI yatırım karşılaştırma" ELE |
| 97 | KISMEN | `customer_files`, `app/belgeler`, `contract_versions`. Genel versiyonlu kasa yok | ELE | Evrak toplama `PIYASA` F4/Paket D |
| 98 | VAR | `lib/permissions.ts`, `user_permission_overrides`, `app/ayarlar/roller`, `lib/permission-data-scope.ts`, `lib/export-data-scope-contract.test.ts` | ELE | Zaten var |
| 99 | KISMEN | `audit_logs` (dışa aktarma dahil), `lib/two-factor.ts` (SMS), `login_events`, `lib/rate-limit.ts`. Toplu görüntüleme alarmı, cihaz yönetimi yok | ERTELE V3 (Ö-8) | Sahibin kararı (bölüm 6 #9): sert güvenlik önlemi onaysız eklenmez |
| 100 | KISMEN | `app/denetim`, `audit_logs`, `lib/activity.ts`. "Kim gördü" okuma günlüğü yok | ERTELE V3 (Ö-8) | Okuma günlüğü yazma yükü ve gizlilik etkisi; sahibin kararı |
| 101 | KISMEN | `app/uyum` (`iys_consents`, `iys_consent_events`, `public_lead_consent_events`, `registration_consents`, `kvkk-panel`). Kanal bazlı ayrım doğrulanmadı | GELİŞTİR (Ö-8) | Yalnız alan/izin kaydı; METİN YAZILMAZ |
| 102 | KISMEN | `/kvkk-aydinlatma` statik sayfa | ELE (metin) | Hukukçu işi (bölüm 5) |
| 103 | KISMEN | `kvkk_erasure_log`, `actions/kvkk.ts`, `app/ayarlar/cop-kutusu` (90 gün), cron `operational-retention` | ELE | Akış var; "yasal zorunluluk kontrolü" metni yazılmaz |
| 104-106 | KISMEN | Gelen: `app/api/webhooks/{meta,netgsm-sms}`, `app/api/leads/[token]`. Giden webhook/API anahtarı yok; `lib/billing/plans.ts` "API ürün hazır olmadan eklenmez" der | ERTELE V4 | "100 entegrasyon" değil; kayıt defteri `integrations/registry.ts` yeterli. Marketplace ELE |
| 107 | KISMEN | `app/hizli` (`quick-capture.tsx`), `dashboard-quick-actions.tsx`, PWA + push. Foto/sesli not yok | BİRLEŞTİR (Ö-5) | Hızlı kayda "tapu fotoğrafı" eklenir; sesli not ELE (#108) |
| 108 | UYGUN DEĞİL | Sesli komut kaydı | ELE | RİSK (bölüm 5). Telefon dikte `PIYASA` F2 |
| 109 | KISMEN | `actions/property-media.ts` + `lib/ai/document-ocr.ts` | GELİŞTİR (Ö-5) | #46 ile aynı akış |
| 110 | KISMEN | `components/app/sw-register.tsx`, `lib/service-worker-cache-boundary.test.ts` (çevrimdışı önbellek bilinçli kapalı) | ELE | `PIYASA` §5.15 |
| 111 | VAR | `notifications`, `lib/notify.ts`, `components/app/push-subscribe.tsx`, `actions/notification-prefs.ts`, `lib/nav-badges.ts` | ELE | Zaten var |
| 112-113 | VAR | `app/arama-sonuclari`, `actions/search.ts`, `lib/palette-core.ts`, `saved_views` | ELE | Zaten var |
| 114 | VAR | `lib/nav-roles.ts` + `nav-config.ts` `tier` (sade/tam görünüm) | BİRLEŞTİR | "Smart, not stuffed" ilkesi mevcut; Modüller ekranı tamamlar |

### 1.8 Sayım

| Durum | Madde |
|---|---|
| KISMEN | 55 |
| VAR | 42 |
| UYGUN DEĞİL | 8 |
| YOK | 6 |
| BAŞKA AJANDA | 2 |
| Toplam | 113 |

| Karar | Madde |
|---|---|
| ELE | 59 |
| GELİŞTİR | 23 |
| BİRLEŞTİR | 13 |
| ERTELE V3 | 9 |
| ERTELE V4 | 7 |
| ENTEGRE ET | 2 |


---

## 2. Ayıklama

### 2.1 Seçme ilkeleri ve sonuç

Seçilen: kafa karıştırmayan, mevcut modüle SEKME/BÖLÜM olarak oturan, gerçek veriye dayanan, yerel mevzuatla çakışmayan.

| İlke | Uygulama |
|---|---|
| Yeni ana menü öğesi yasak | 0 yeni öğe; yeni yüzeyler mevcut sayfanın sekmesi, Ayarlar kartı veya Raporlar sekmesi |
| Sahte skor yasak | 6, 34, 40, 49 için: yalnız açıklanabilir, girdisi gerçek veri olan kural tabanlı sayı; formül ekranda; "AI lead skoru", "satılabilirlik skoru", "AI satın alma ihtimali", "tahmini kapanış tarihi", "satın alma olasılığı" adları ELE. Mevcut `lead-score.ts`, `customer-heat.ts`, `churn-risk.ts`, `seller-prediction.ts`, `deal-score.ts`, `property-health.ts`, `sale-diagnostics.ts`, `lib/team/advisor-metrics.ts` birleştirilir (Ö-2) |
| Hukuki metin yazılmaz | 19, 101-103: yalnız alan, izin kaydı, akış, yer tutucu |
| Resmi entegrasyon iddiası yok | 18-20: yalnız takip alanı ve şablon yer tutucu |
| Çifte tasarım yok | Başka belgede olan (7, 8: uzmanlık spec; 59-61, 64: `PIYASA` yapma listesi; ofisten ofise büyüme: organik plan) yeniden yazılmadı |

### 2.2 ChatGPT'nin 10 başlıklı menüsü ile mevcut 9 başlık

| ChatGPT başlığı | Mevcut karşılık (`nav-config.ts`) | Sonuç |
|---|---|---|
| Ana Sayfa | Bugün > Ana ekran | Aynı |
| Müşteriler | Müşteriler > Müşteriler, Talepler | Aynı |
| Portföyler | Portföy > Portföyler | Aynı |
| Fırsatlar | Anlaşmalar > Anlaşmalar (pano) + Talepler > Eşleşme | Ayrı başlık gereksiz (Anlaşmalar zaten pipeline) |
| Takvim | İletişim > Randevular | Aynı |
| Mesajlar | İletişim > Gelen Kutusu | Aynı |
| İşlemler | Anlaşmalar (+ Teklifler, Sözleşmeler) | Aynı |
| Pazarlama | İletişim > Kampanyalar; Portföy > Açık Ev, Sunumlar, Portal Kontrol | Ayrı başlık açılmaz: bu 4 iş zaten ait oldukları iş başlığında |
| Finans | Finans | Aynı |
| Raporlar | Performans > Raporlar | Aynı |
| Emlaksoft AI (altta) | Bugün > AI Asistan | Aynı |
| Ofis sahibi ek: Ekip, Performans, Lead Dağıtımı, Komisyonlar, Şubeler, Yetkiler, Ayarlar | Ofis > Ekip Merkezi (Genel, Kıyas, KPI, Lig, Hedefler, Devir), Ayarlar (Aday yakalama, Roller), Franchise sekmesi | Uyumsuz yerde mevcut yapı korunur: ChatGPT'nin ek başlıkları ayrı menü olursa "Ofis" başlığı bölünür, 9 başlık ilkesi bozulur |
| Müşteri menüsü (Ana Sayfa, Gayrimenkuller, Favoriler, Randevular, Teklifler, Belgeler, Danışmanım) | Müşteri portalı tek sayfa, bölüm çapaları (`/musteri-portali/[token]`) | Menü değil sayfa bölümü; V3'te bölüm eklenir (#38) |

Sonuç: 10 başlık önerisi benimsenmez; 9 başlık korunur.

### 2.3 Menü bütçesi (41 → 36, yol/URL değişmez)

Bugün: Bugün 3, Müşteriler 5, Portföy 8, Anlaşmalar 3, İletişim 4, Finans 3, Performans 4, Araçlar 3, Ofis 8 = 41. Öneri (yalnız `nav-config.ts` `tabs` düzenlemesi; sayfa yolları aynı, eski bağlantılar çalışır; uygulama Ö-1'in nav entegrasyonunda):

| Birleşim | Çıkan menü öğesi |
|---|---|
| Müşteriler sekmeleri: Müşteriler / Akıllı Listeler / Tavsiyeler | -2 |
| Anlaşmalar sekmeleri: Anlaşmalar / Kayıp nedenleri | -1 |
| Portföyler sekmeleri: Portföyler / Anahtar Takibi / Sunumlar | -2 |
| Toplam | 41 - 5 = 36 |

"Ofis kurulumu" (Bugün) kurulum turu belgesinin alanındadır, dokunulmadı. Modüller kartı Ayarlar sayfasında KART olur (menü öğesi değil). Kapatılan modül menüyü ayrıca küçültür.

---

## 3. Dış bağımlılıklar ve Emlakfiyati sınırı

### 3.1 Dış bağımlılık tablosu

| Bağımlılık | Altyapı hazır mı (kanıt) | Sahibin hesap/anlaşma kararı gerekir mi |
|---|---|---|
| WhatsApp Cloud API | Evet, kısmen: `lib/messaging/whatsapp-cloud.ts`, `tenant-providers.ts`, `api/webhooks/meta`, registry `whatsapp`; `FEATURE_BACKLOG` G8: giden şablon hesap bekliyor | Evet: Meta Business hesabı, şablon onayı; açık uçlu bot yasak, yapılandırılmış + insana devir |
| SMS (Netgsm) | Evet: `lib/messaging/netgsm.ts`, `api/webhooks/netgsm-sms`, registry `netgsm` | Hesap bilgisi tenant/platform ayarında |
| Telefon santrali / çağrı kaydı | Hayır (`calls` elle not; `ai/call-summary.ts` nottan) | Evet: santral sağlayıcısı + ses kaydı aydınlatması (V4) |
| Gmail/Outlook OAuth | Hayır | Evet: OAuth uygulama kaydı/doğrulama, güvenlik değerlendirmesi (V4) |
| E-imza sağlayıcı | SMS OTP var (`lib/otp-hmac.ts`, `/imza`); nitelikli imza yok | Evet: sağlayıcı sözleşmesi + hukuki görüş (`PIYASA` K8) |
| Portal XML/API (sahibinden, hepsiemlak, emlakjet) | İskelet: `lib/integrations/portals/index.ts`, `portal_listings` teyit | Evet: resmi sözleşme/anahtar (`PIYASA` K1/K2); kazıma yok |
| Harita | `app/portfoyler/map-view.tsx` (lat/lng); harita sağlayıcısı/kütüphanesi doğrulanmadı | Katman eklemek için hayır; sağlayıcı değişirse evet |
| STT / transkript | Hayır (`openai-client.ts` yalnız chat/vision) | Evet (`PIYASA` K5) |
| OpenAI | Evet: `lib/ai/openai-client.ts` + `redact.ts`, anahtar `platform_settings` → env | Hayır (var); kullanım/kredi K2 + kredi defteri |
| Endeksa / Tapusor | Evet: `integrations/endeksa.ts`, `tapusor.ts`; anahtar yoksa atlanır | Anahtar sahibin |
| Emlakfiyati | Hayır (ayrı proje; API bilinmiyor) | Evet: bölüm 3.2 |
| iyzico | Evet (`lib/billing/iyzico.ts`) | Var |
| e-fatura/e-makbuz | İskelet: `lib/efatura.ts` | Evet (`PIYASA` K7) |

### 3.2 Emlakfiyati arayüz sınırı (TASLAK)

Durum: Emlakfiyati ayrı bir projedir; gerçek API adresi, kimlik doğrulama, alan adları, kota ve fiyatlandırma BİLİNMİYOR. Aşağıdakiler Emlaksoft'un KENDİ tarafının tarif ettiği sözleşme önerisidir; hiçbir uç nokta/alan adı Emlakfiyati'ndan alınmış değildir.

**Sınır noktası.** Mevcut `lib/valuation.ts` kaynak listesi (`ValuationSource {name, weight, value, note}`) üzerinden çalışır; Endeksa/Tapusor aynı kalıpta. Emlakfiyati dördüncü kaynak olarak `lib/integrations/emlakfiyati/{contract.ts, client.ts}` ile takılır (Ö-6). `client.ts` yapılandırılmamışsa `null` döner ve çağıran sessizce atlar (Endeksa deseni). Ofis emsal motoru en yüksek ağırlıkta KALIR; Emlakfiyati ağırlığı sahibin kararıdır.

**İstek (Emlaksoft → sağlayıcı), kişisel veri YOK:**
```
ValuationRequest {
  requestId: string            // idempotency, Emlaksoft üretir
  subject: {
    province: string; district: string; neighborhood?: string
    propertyType: string; transactionType: "sale" | "rent"
    grossSqm?: number; netSqm?: number; rooms?: string
    floor?: number; buildingAge?: number; heating?: string; facade?: string
    ada?: string; parsel?: string
  }
  options?: { wantRange?: boolean; wantComparables?: boolean }
}
```
Gönderilmeyenler: müşteri adı, telefon, e-posta, adres satırı, tenant adı. `tenantId` yerine tek yönlü karma `tenantRef` (kota için; sağlayıcı isterse).

**Yanıt (sağlayıcı → Emlaksoft), `zod` ile doğrulanır; bilinmeyen alan atılır, eksik zorunlu alan = kaynak atlanır:**
```
ValuationResponse {
  estimate: { low?: number; mid: number; high?: number; currency: "TRY"; pricePerSqm?: number }
  confidence?: { level?: string; basis?: string; sampleSize?: number }
  comparables?: { label: string; price: number; sqm?: number; asOf?: string }[]
  asOf: string                  // veri tarihi
  provider: { name: string; version?: string }
  methodologyNote?: string
}
```
Eşleme: `ValuationSource { name: "Emlakfiyati", weight: <ayar>, value: estimate.mid, note: methodologyNote ?? "" }`; `sampleSize` az ise güven puanı düşer (`valuationEvidenceConfidence` mantığı). Kaynak adı `valuations.sources` jsonb'a yazılır; sağlayıcı yanıtı ham saklanmaz (yalnız özet).

**Yetki.** Çağrı yalnız sunucuda: `requirePermission("valuation", "create")`; paket kilidi mevcut sayfa kapısında (Değerleme her pakette açık). Modül kapalıysa (`valuation`) çağrı yapılmaz.

**Kota.** (1) Sağlayıcı kotası ve (2) ofis başına aylık sayaç. Plan/katalog alanı (K2'nin yeni alanları) varsa sayaç sınırı oradan okunur; yoksa `platform_settings` anahtarı. Aşım: kullanıcıya "bu ay hakkınız doldu", çağrı yapılmaz. Sayaç kaynağı K2 kredi/kota modelidir; AI kredisi ile aynı defter (`account_credit_ledger`, organik plan §3.1) kullanılabilir, burada ayrı defter açılmaz.

**Güvenlik/dayanıklılık.** `lib/external-fetch.ts` + `integrations/provider-url.ts` izinli host listesi; zaman aşımı ve yanıt boyutu sınırı (Endeksa ile aynı); kimlik bilgisi `platform_settings`/`tenant_integration_secrets` (düz metin env yalnız geliştirmede); `integrations/registry.ts`'e "emlakfiyati" kaydı `setup_required` → yalnız gerçek bağlantı doğrulanınca `configured`.

**Ters yön (#76): Emlakfiyati sayfasından ofise değerleme talebi (lead).** Emlaksoft'un mevcut `app/api/leads/[token]` ve `public_lead_consent_events` desenine benzer: imzalı (HMAC) istek, alanlar: taşınmaz özeti, iletişim (ad, telefon) YALNIZ açık rıza bayrağı + rıza metni sürüm numarası ile; rıza yoksa kayıt oluşmaz; hangi ofise gideceği (slug) ve ofis seçimi politikası sahibin kararıdır. Aydınlatma/rıza METNİ yazılmaz.

**Sahibin sağlaması gereken liste:** (1) Emlakfiyati'nın gerçek API belgesi (adres, kimlik doğrulama, alanlar, hata kodları, sürümleme); (2) ticari anlaşma (kullanım koşulları, kota, fiyat, veri saklama/atıf kuralı); (3) kişisel veri rolleri (Emlakfiyati veri sorumlusu mu, işleyen mi; lead aktarımı rızası); (4) test/üretim anahtarları; (5) ağırlık politikası; (6) ofis seçimi ve lead dağıtım kuralı; (7) marka/atıf ("Emlakfiyati verisi" gösterimi).

---

## 4. Modüller (aç/kapa) tasarımı

### 4.1 Kavram ve sınırlar

- **Yetki = kim** (`permissions.ts`, `requireModulePage`); **paket = ne satın alındı** (`page-gates.ts`); **modül = ofiste açık mı** (yeni). Etkin erişim = yetki VE paket VE modül açık. Üçü ayrı eksendir; biri diğerini değiştirmez.
- Kavram karışmasın: `AppModule` (28 izin anahtarı, çok sayfayı kapsar; ör. `settings` Otomasyon, Belge, Denetim, Ayarlar'ı birlikte kapsar) ile ürün alanı `FeatureKey` aynı şey DEĞİLDİR. Modüller ekranı `FeatureKey` kullanır, her biri rota ön ekleriyle `AppModule`'lere eşlenir.
- Çekirdek ve sistem alanları kapatılamaz. Veri silinmez; yalnız gizlenir ve işlem üretmez.
- **K2 uyumu.** K2'nin yeni katalog alanları (fiyat/plan/kupon/AI kredisi) bu dalda henüz yok (main'de `lib/billing/plans.ts` `PlanDef` + `plan_entitlements`). Tasarım onlara bağımlı değil: kartın "pakette var mı" bilgisi yalnız `PLAN_GATES`'ten türetilir (`modulePlanRequirement(key)` tek fonksiyon); K2 katalog modül/özellik listesi eklerse yalnız bu fonksiyon o alana yönlendirilir. AI kredisi: `ai_assistant` kapalıysa AI çağrısı yapılmaz, kredi harcanmaz; kredi ölçümü ayrı defterde (`unit='ai'`), modül tablosu fiyat/kredi tutmaz.

### 4.2 Modül envanteri (anahtar, rotalar, bağlı iş, bağımlılık)

Çekirdek/sistem (kapatılamaz): `customers` (Müşteriler, Talepler + Eşleşme: `/app/musteriler`, `/app/talepler`, `/app/eslestirme` alias), `properties` (`/app/portfoyler`), `appointments` (`/app/randevular`), `tasks` (`/app/gorevler`), `deals` (`/app/anlasmalar`, Komisyon/Kazanç: `/app/komisyon`, `/app/cuzdan`), `inbox` (`/app/gelen-kutusu`, `/app/arama` alias; WhatsApp/SMS/lead girişleri buraya akar, bu yüzden çekirdek), `dashboard` (`/app`, `/app/performansim`, `/app/brifing`), `system` (`/app/ayarlar/**`, `/app/abonelik`, `/app/yardim`, `/app/destek`, `/app/uyum`, `/app/denetim`, bildirimler, `/app/bildirimler`, `/app/baslangic`). Uyum ve Denetim kapatılamaz (KVKK/İYS kaydı ve güvenlik izi).

Kapatılabilir (25):

| Anahtar | Ad | Rotalar / menü öğesi | Bağlı cron / otomasyon | Bağımlı olduğu | Kapatınca etkilenenler |
|---|---|---|---|---|---|
| `offers` | Teklifler | `/app/teklifler` | otomasyon tetikleyicisi `offer_received` | `deals` | Malik portalında teklif bölümü, anlaşmada teklif sekmesi gizlenir |
| `contracts` | Sözleşmeler ve e-imza | `/app/sozlesmeler`, `/imza/[token]` | - | - | Bekleyen imza linkleri "kapalı" sayfası gösterir; müşteri kartı "Belgeler ve imza"da sözleşme sayısı gizlenir |
| `rentals` | Kiralama ve kira artışı | `/app/kiralama`, `/app/kira-artis` | cron `kira-tahakkuk` | `properties` | Tahakkuk üretilmez; portföyde kira bölümü gizlenir |
| `open_house` | Açık Ev | `/app/acik-ev`, `/acik-ev-kayit/**` | - | `customers`, `demands` | Public kayıt "kapalı" sayfası |
| `portals` | Portal Kontrol | `/app/portallar` | cron `portal-teyit` | `properties` | `leak` kapanmalı veya uyarı |
| `leak` | Kaçan komisyonlar | `/app/kayip-kacak` | cron `leak-sla` | `portals` | Ana ekran "kayıp-kaçak" bloğu gizlenir |
| `campaigns` | Kampanyalar | `/app/kampanyalar` | cron `campaign-delivery` | Uyum (İYS, çekirdek) | Toplu gönderim durur (zamanlanmış olanlar gönderilmez, silinmez) |
| `expenses` | Giderler ve Aidat | `/app/giderler`, `/app/aidat` | - | - | Raporlarda gider/kâr-zarar bölümü gizlenir; muhasebe rolünün çekirdeği boşalır (uyarı) |
| `network` | Ofisler Arası Ağ | `/app/ag` | - | `properties`, `demands` | Paylaşımdaki ilanlar gizlenir (silinmez) |
| `projects` | Proje Satışı | `/app/projeler` | cron `proje-vade` | - | Ana ekran kiralama-proje bloğunun proje kısmı gizlenir |
| `foreign_sale` | Yabancıya Satış | `/app/yabanci-satis` | - | `properties` | - |
| `valuation` | Değerleme ve Hesaplayıcılar | `/app/degerleme`, `/app/hesaplayici`, public değerleme sayfaları | - | geo, emsal motoru | Public "evim ne kadar eder" ve rapor bağlantıları kapalı sayfa; Danışman çekirdeğinden Değerleme düşer |
| `reports` | Raporlar | `/app/raporlar` (Ofis, Talep-arz, Memnuniyet), `/app/bolge-analizi` | cron `bolge-snapshot`, `haftalik-ozet` | tüm veri | Ofis sahibi çekirdeğinden Raporlar düşer |
| `team_perf` | Ekip performansı | `/app/ekip/kiyas`, `/app/danisman-kpi`, `/app/lig`, `/app/hedefler` | cron `lig-snapshot` | `reports` verisi | Ekip Merkezi "Genel" ve "Devir" kalır; ana ekran hedef kartı gizlenir |
| `franchise` | Şube ve Franchise | `/app/franchise` | - | `team_perf` | - |
| `approvals` | Onay akışları | `/app/onaylar` | - | `deals` | Bekleyen onaylar durur, ana ekran "karar bekleyenler" onay satırı gizlenir (uyarı: bekleyen varsa kapatma engellenir) |
| `automation` | Otomasyon ve iş akışları | `/app/otomasyonlar`, `/app/ayarlar/is-akislari` | cron `otomasyon`, olay tetikleyicileri | tetiklendiği modüller | Kurallar ve playbook'lar çalıştırılmaz (silinmez) |
| `documents` | Belge Merkezi | `/app/belgeler` | - | - | Müşteri/portföy kartlarındaki dosya sekmeleri çekirdek olarak KALIR |
| `ai_assistant` | AI Asistan | `/app/asistan`, `/api/ai/tenant-chat` | `gunluk-ozet` AI cümlesi (özet çekirdek kalır, yalnız AI kısmı) | OpenAI anahtarı | AI çağrısı yapılmaz, kredi harcanmaz |
| `tv_board` | Ofis Panosu (TV) | `/app/pano-tv` | - | `reports`, `team_perf` | - |
| `smart_lists` | Akıllı Listeler ve Tavsiyeler | `/app/akilli-listeler`, `/app/tavsiyeler`, `/tavsiye/[token]` | - | `customers` | Public tavsiye bağlantıları kapalı sayfa |
| `lost_sales` | Kayıp nedenleri | `/app/kayip-satis` | - | `deals` | - |
| `keys` | Anahtar Takibi | `/app/portfoyler/anahtarlar` | cron `anahtar-gecikme` | `properties` | - |
| `presentations` | Sunumlar | `/app/portfoyler/sunumlar`, `/sunum/[token]`, `/paylas` | - | `properties` | Aktif sunum linkleri kapalı sayfa |
| `vitrin` | Vitrin ve danışman sayfaları | `/vitrin/[slug]`, `/danisman/[slug]`, `/randevu-al` (menü öğesi yok; ayarı Ofis ayarlarında) | cron `vitrin-alarm`, `vitrin-eslesme` | `properties` | Public sayfalar kapalı; sitemap'ten çıkar |
| `client_portals` | Müşteri ve malik portalı | `/musteri-portali/[token]`, `/malik-portali/[token]` | - | `appointments`, `offers` | Linkler kapalı sayfa |

Not: Ana ekran blokları (`app/_home/*`) ve Ekip Merkezi sekmeleri kendi anahtarına bağlanır; Ekip Merkezi'nin kendisi (`team` izni) çekirdektir.

Bağımlılık grafı (A → B: A, B'ye bağlı; B kapalıyken A açılamaz): `leak → portals`; `franchise → team_perf`; `tv_board → reports`; `offers, approvals, lost_sales → deals(çekirdek)`; `client_portals` uyarı: `offers` kapalıysa malik teklif bölümü olmaz. Kapatma anında "bunlar da etkilenir" listesi bu grafın TERSİNDEN üretilir (örn. `portals` kapatılırken `leak` listelenir; onayla "ikisini de kapat" ya da iptal).

### 4.3 Ekran: `/app/ayarlar/moduller`

- Erişim: ofis sahibi ve genel müdür (`requireModulePage("settings", "/app/ayarlar/moduller")`, rol kontrolü `owner|gm`). Ayarlar sayfasına kart (`app/ayarlar/page.tsx` `cards` listesi), menü öğesi değil.
- Üstte **ofis tipi ön ayarı** (4 kart, tek tıkla "Uygula": önce önizleme "şunlar kapanacak / açılacak", onay): 
  - **Konut ağırlıklı**: kapalı `projects`, `foreign_sale`, `franchise`, `tv_board`; kalan açık.
  - **Arsa ve ticari**: kapalı `open_house`, `rentals`, `campaigns`, `tv_board`, `franchise`; açık `foreign_sale`, `projects`, `network`, `presentations`, `valuation`.
  - **Kiralama ve mülk yönetimi**: açık `rentals`, `expenses`, `contracts`, `documents`, `keys`, `client_portals`, `campaigns`; kapalı `projects`, `foreign_sale`, `network`, `franchise`, `portals`, `leak`, `open_house`.
  - **Franchise ve çok şubeli**: açık `team_perf`, `franchise`, `approvals`, `tv_board`, `reports`, `network`; hepsi pakete bağlı olarak (pakette yoksa kilitli kalır).
  Ön ayar çekirdeğe ve platform kilitli modüllere dokunmaz. Ön ayar kalıcı kimlik değildir (saklanmaz; sonuç satırlarıdır). Demo paketleri (`konut`, `ticari`, `arsa`) ve Kurulum sihirbazı "mode" adımı ile AYNI soru olur: kurulumda seçilen paket ön ayarı da önerir (tek soru, iki ayrı sorgu yok).
- Altta modül kartları, 6 grup (Satış süreci, İletişim ve pazarlama, Portföy araçları, Finans ve raporlar, Ekip, Gelişmiş): her kart: ad, 1-2 cümle sade Türkçe ("Ne işe yarar"), açma-kapama anahtarı, "Bağımlılıklar" satırı, rozet: Çekirdek (kilitli, anahtar yok), Pakette yok (kilitli + "Yükselt" bağlantısı `/app/paket?ozellik=…`), Platform tarafından kapatıldı/açıldı (kilitli). Varsayılan: hepsi açık (mevcut davranış).
- Kapatma akışı: "Bu modülü kapatırsanız: menüden ve aramadan gizlenir, ana ekranda görünmez, otomasyon/bildirim üretmez. Verileriniz silinmez; istediğinizde açabilirsiniz." + etkilenen modül listesi + "Kapat". Bekleyen iş varsa (açık onay, aktif sözleşme imzası, zamanlanmış kampanya) kapatma ÖNCE uyarı verir ve sayıyı filtreli listeye bağlar (sıfır çıkmaz kuralı).
- Her kapatma/açma `audit_logs` olayı (`module.toggle`, değer: anahtar + eski/yeni; kullanıcı).

### 4.4 Kapalıyken davranış (kabul listesi)

| Yüzey | Davranış |
|---|---|
| Menü | `visibleSections` içinde öğe/sekme elenir; "Daha fazla" listesinde de yok (`moreSections`). Sade görünüm çekirdek listesi (`nav-roles.ts`) değişmez: çekirdek zaten kapatılamaz |
| Komut paleti | `palette-core.ts` `visibleSections` kullandığı için "Git" otomatik; "Eylemler" (`/yeni` listesi, 16 öğe) href'e göre süzülür |
| Ana ekran | Her blok bir `FeatureKey`'e bağlı (`HOME_BLOCK_FEATURE` tablosu): ör. `kiralama-proje.tsx` (rentals/projects), `kayip-kacak.tsx` (leak), `karar-bekleyenler.tsx` (approvals/offers), `hedef-karti.tsx` (team_perf) |
| Doğrudan URL | 404 DEĞİL: `/app/modul-kapali?modul=<anahtar>` sayfası: "Bu modül kapalı. Ayarlardan açabilirsiniz" (sahip/GM için "Modüllere git" düğmesi; diğerleri için "yöneticinize söyleyin") |
| Public token sayfaları | Veri dönmez; "Bu özellik ofis tarafından kapatılmıştır" sayfası, `noindex` |
| Server action | Yazma action'ları `requirePermission(mod, action, { feature })` ile modül açıklığını da doğrular (yalnız sayfa kapısı yetmez: formu doğrudan POST'lamak engellenir) |
| Cron / otomasyon | Cron'lar tenant başına tek sorguyla kapalı anahtarları alır, kapalı modülün işini atlar (`heartbeat` yine yazılır). `dispatchAutomationEvent` kapalı modülün tetikleyicisini tetiklemez. Bildirim (`notify`) türü kapalı modüle aitse yazılmaz |
| Arama / rapor | `actions/search.ts` ve `lib/reporting` kapalı modülün varlık türünü ve bölümünü dışlar |
| Veri | Silinmez; yeniden açınca olduğu gibi döner. Export tam dışa aktarımda (`/api/export/<varlık>`) kapalı modül verisi de yetkili kullanıcıya açık kalır (veri sahipliği) |

### 4.5 Depolama ve tek kapı

Mevcut tenant ayar deposu: ortak `settings jsonb` yoktur; ayarlar `tenants` üzerinde tek tek sütundur (`matching_weights jsonb`, `lead_capture_enabled`, `logo_url`, filigran sütunları) ve `tenants` üstünde yaşam döngüsü koruma tetikleyicisi (`guard_tenant_lifecycle_fields`) vardır. Ayrı `tenant_integrations` tablosu entegrasyon içindir. Bu nedenle `tenants`'a sütun yerine **yeni küçük tablo** önerilir: ofis kapatmayı ve platform kilidini aynı satırda tutar, RLS ile ofis sahibi platform kilidini aşamaz, denetim doğal olur.

Migration taslağı (UYGULANMAZ; önerilen ad `20260816001700_tenant_modules.sql`; sonraki serbest numara, organik plan taslağı `20260816001200`, spec `…001300-001600`):
```sql
create table if not exists public.tenant_modules (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  module_key text not null check (module_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  enabled boolean not null,
  locked_by_platform boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, module_key)
);
alter table public.tenant_modules enable row level security;
-- okuma: kendi ofisi
create policy tenant_modules_select on public.tenant_modules for select
  using (tenant_id = (select public.current_tenant_id()));
-- yazma: yalnız sahip/genel müdür ve kilitsiz satır (platform kilidini ofis aşamaz)
create policy tenant_modules_write on public.tenant_modules for insert
  with check (tenant_id = (select public.current_tenant_id())
    and (select public.current_profile_role()) in ('owner','gm') and not locked_by_platform);
create policy tenant_modules_update on public.tenant_modules for update
  using (tenant_id = (select public.current_tenant_id()) and not locked_by_platform
    and (select public.current_profile_role()) in ('owner','gm'))
  with check (tenant_id = (select public.current_tenant_id()) and not locked_by_platform);
-- silme yok; platform kilidi service_role (admin) ile yazılır
revoke all on public.tenant_modules from anon;
```
Sözleşme: satır YOKSA modül AÇIK. Anahtar doğrulaması uygulamada (`FeatureKey` kayıt defteri), DB'de yalnız biçim. `current_profile_role` ve `current_tenant_id` mevcut yardımcılar (migrations). Rollback dosyası (`supabase/rollbacks/`) ve `rls-audit` kabulü paketle gelir. Şema yokken kod: tablo yok hatası (`42P01` / PostgREST "tablo bulunamadı") tüm modüllerin AÇIK sayılmasına düşer ve bir kez loglanır; böylece kod migration'dan önce yayınlanabilir.

Tek kapı (`lib/modules/`, YENİ):
- `registry.ts`: `FeatureKey` listesi, ad/açıklama/grup, rota ön ekleri, çekirdek bayrağı, bağımlılık grafı, home-blok eşlemesi, `featureForHref(href)` (en uzun ön ek; `findGate` deseni), `modulePlanRequirement(key)` (`PLAN_GATES`'ten).
- `state.ts`: `getTenantModuleState(tenantId)` React `cache()` ile istek başına TEK sorgu (mevcut `lib/cache/request.ts` ilkesi: istekler arası paylaşım yok, bayat yetki riski yok). `isModuleEnabled(tenantId, key)` bunun üzerinde. Sıcak yol maliyeti: layout + sayfa aynı istekte paylaşır. İstekler arası önbellek gerekirse `unstable_cache` + etiket `tenant-modules:<tenantId>` ve toggle action'ında `updateTag` (Server Action içinde geçerli; `lib/revalidate.ts` aynı kuralı belgeliyor); ilk sürümde gerekmez.
- `guard.ts`: `assertModuleEnabled(key)` (sayfa: yönlendirme, action: hata sonucu).
- Entegrasyon noktaları (küçük, tek satırlık, Ö-1 sahibi): `requireModulePage(mod, href)` içinde yetki + paket kontrolünden SONRA `featureForHref(href)` → kapalıysa `redirect("/app/modul-kapali?...")`; `nav-config.ts` `visibleSections`/`moreSections` süzgeci (öğe yolundan `featureForHref`, `NavItem`'a alan eklemeden); `palette-core.ts` Eylemler süzgeci; `app/_home` blok yükleyicileri; `requirePermission` seçeneği; cron'larda `getDisabledModulesByTenant()` toplu okuma; `actions/search.ts`; `lib/reporting`. Sıra: oturum → yetki → paket → modül.
- Yetki ilişkisi: modül açık olsa da kullanıcının izni yoksa menüde görünmez; izni olsa da modül kapalıysa görünmez. Sade görünüm (rol) ayrı eksen: kullanıcı tercihi, yalnız görünürlüğü daraltır; modül kapalıyken sade görünümün "Daha fazla" listesinde de yoktur.
- Sözleşme testleri (pakete dahil): her kapatılabilir rotanın sayfası `requireModulePage(mod, href)` ile `href` geçirir (paket kilidinin mevcut sınırlaması: href verilmeyen sayfa kilitlenmez; test bunu yakalar); modül kapalı action testi; kayıt defterindeki her rota gerçek sayfa dosyasına karşılık gelir; çekirdek kapatılamaz.

Admin: Ofis 360 > Yönetim sekmesine (`app/admin/tenants/[id]/office-management.tsx`, bölüm kimlikleri `yonetim-*`) "Modüller" bölümü: ofis bazlı zorunlu aç/kapa (`locked_by_platform=true` yazar, ofis kullanıcısı o kartı değiştiremez, rozet "Platform"), kilidi kaldır, ofisin mevcut durumunu gör. Yazma service_role gerektirdiği için `createAdminClient` kabul listesine ve `docs/security/` envanterine eklenir (`audit-admin-client.ts --write`); işlem `platform_audit_logs` + ofis `audit_logs`.

---

## 5. Hukuki/etik riskli maddeler (ayrı işaret)

| # | Madde | Neden riskli | Karar |
|---|---|---|---|
| 59, 60, 61, 64 | Rakip ilan takibi, fiyat alarmı, satıldı tahmini, portföy avcısı | Portal veri kazıma: kullanım şartı ve hukuki risk; ROADMAP kazıma yasağı; `PIYASA` §5.1 | ELE. Meşru karşılık: kendi ilanlarınızın portal kapanışı + lisanslı Endeksa/Tapusor |
| 51 | Danışman canlı durum takibi | Çalışan gözetimi; "ekibi izle ama gözetleme" ilkesi (`PERSONA_OFIS_SAHIBI` İ2) | ELE; izin takvimi yeterli |
| 87 | Arama kaydı analizi ile çalışan koçluğu | Ses kaydı + çalışan izleme | ELE; mevcut KPI koçu kalır |
| 27 | AI santral / arama kaydı transkripti | Ses kaydı kişisel veri, dış bağımlılık | ERTELE V4 |
| 108 | Sesli komut kaydı | Ses kaydı kişisel veri, STT dış bağımlılık, doğruluk verisi yok | ELE |
| 93 | Banka lead / kredi motoru | Finansal ürün aracılığı ve kişisel veri aktarımı; hukuki durum doğrulanmadı | ELE; hesaplayıcı kalır |
| 18-20 | EİDS, yetki sözleşmesi şablonları, e-imza | Resmi doğrulama/entegrasyon iddiası YOK; hukuki metin YAZILMAZ; SMS onayının hukuki niteliği doğrulanmadı | Yalnız takip alanı ve yer tutucu |
| 101-103 | KVKK metinleri | Hukuki metin YAZILMAZ; ChatGPT'nin karar numarası iddiası doğrulanmadı | Yalnız alan/izin kaydı/akış |
| 25-26, 31 | WhatsApp otomatik cevap, otonom lead ajanı | Açık uçlu bot politikası, İYS izni, yanlış mesaj riski | Taslak + insan gönderir; otonom ELE |
| 99-100 | Veri hırsızlığı koruması, "kim gördü" günlüğü | Sert güvenlik; gözetim; sahibin onayı gerekir | ERTELE V3, sahibin kararı |
| 70, 16 | Sosyal medya yayını, AI fotoğraf/sanal mobilya | Platform kuralları; sanal içerik etiketi (doğrulanmadı) | ELE / ERTELE |

---

## 6. Uygulama paketleri

Genel kurallar: dosya sahipliği çakışmaz (her paket YENİ klasör sahibidir); mevcut dosyalara yalnız belirtilen küçük entegrasyon noktası; yeni ana menü öğesi yok; yeni modül değil, `FeatureKey` kayıtları (Ö-1); migration forward-only, `check:migrations` + RLS audit + rollback; AI çağrıları yalnız `lib/ai/openai-client.ts`; telefon/e-posta alanları `PhoneInput`/`EmailInput`; saat `lib/clock.ts`; her ekranda sıfır çıkmaz metrik ve Türkçe boş durum. Başka ajanların kapsamı (`PIYASA` Paket A-E, organik plan Paket A-H, uzmanlık spec P-*) tekrar edilmez.

### V2 (şimdi)

**Ö-1 Modüller (aç/kapa).** Anahtar: yok (altyapı).
- Yeni sahiplik: `src/lib/modules/**`, `src/app/app/ayarlar/moduller/**`, `src/app/app/modul-kapali/**`, `src/app/admin/tenants/[id]/module-panel.tsx`, `src/app/actions/modules.ts`, migration `…tenant_modules.sql` + rollback.
- Adımlar: (1) migration taslağı ve RLS testi; (2) `registry.ts` 25+çekirdek kayıt, `state.ts`, `guard.ts`; (3) Modüller ekranı + ön ayarlar + kapatma uyarısı; (4) tek satırlık entegrasyonlar (bölüm 4.5); (5) menü bütçesi birleşimi (bölüm 2.3, aynı `nav-config.ts` düzenlemesinde); (6) admin Yönetim bölümü; (7) sözleşme testleri.
- Kabul: tablo yokken tüm modüller açık; kapatılan modül menüde/palette/ana ekranda/aramada/raporda yok; doğrudan URL "modül kapalı" sayfası (404 değil); cron kapalı modülü atlar; action kapalıyken reddeder; çekirdek kapatılamaz; veri silinmez; platform kilidini ofis değiştiremez (RLS testi); `audit_logs` olayı; tip/lint/test/build yeşil; `audit-admin-client` kabul listesi güncel.
- Dış bağımlılık: yok. Şema: evet (1 tablo).

**Ö-2 Müşteri zekâsı: ısı, etiket, akıllı liste.** Anahtar: `customers` (çekirdek) + `smart_lists`.
- Yeni sahiplik: `src/lib/customer-intel/**` (birleşik "Müşteri ısısı" açıklama modeli: `lead-score`, `customer-heat`, `churn-risk`, `seller-prediction` çıktılarını tek biçime çeviren saf katman; mevcut dosyalar DEĞİŞMEZ), `src/app/app/akilli-listeler/hazir-listeler.ts` (YENİ dosya: tekrar aktifleşenler, yetkisi bitenler, eski alıcı = olası satıcı).
- Adımlar: ısı kartı (puan + "neden" satırları + formül bağlantısı); hazır liste kuralları; meslek + "kim getirdi" alanı (`customers` migration gerekmez: `custom` alan yoksa küçük kolon, karar uygulamada); Müşteriler sekmesine Akıllı Listeler (menü bütçesi).
- Kabul: her sayı bir formülün çıktısı ve girdileri ekranda; "AI" ifadesi yok; liste sayıları filtreli listeye gider; boş durum anlamlı.
- Dış bağımlılık: yok. Şema: küçük/yok.

**Ö-3 Lead hızı.** Anahtar: `reports` (rapor sekmesi) + çekirdek.
- Yeni sahiplik: `src/lib/lead-speed/**` (ilk yanıt = müşteri kaydı ile ilk `communications`/`calls` kaydı arası; çalışma saati dışı hariç), `src/app/app/raporlar/lead-hizi/**` (Raporlar sekmesi). `gamification-query.ts:296` null alanı bu hesapla beslenir (tek satır).
- Adımlar: ölçüm fonksiyonu + test; danışman bazlı ortalama + gecikenler listesi; sahibe istisna bildirimi (`notify`, eşik ayarı); `PERSONA_OFIS_SAHIBI` #8 ile tek iş.
- Kabul: ölçülemeyen kayıt "veri yok" yazılır, 0 sayılmaz; eşik ofis ayarı; otomatik devir BU pakette yok (spec yedek zinciri).
- Dış bağımlılık: yok. Şema: yok (türetilir).

**Ö-4 AI cevap taslağı ve asistan araçları.** Anahtar: `ai_assistant`, `inbox` (çekirdek).
- Yeni sahiplik: `src/lib/ai/reply-draft.ts`, `src/app/actions/reply-draft.ts`, `src/app/app/gelen-kutusu/reply-draft-button.tsx`; asistan araç tanımı `src/lib/ai/tools/search-demands.ts` (YENİ, mevcut `ai-advisor.ts`'ye tek satır kayıt).
- Adımlar: gelen WhatsApp/SMS iletisine "cevap taslağı öner" (redact → `openai-client`, taslak düzenlenebilir, İNSAN gönderir); toplu eşleşme gönderimi (#11) mevcut sunum + şablon + İYS kontrolü; asistana talep/portföy sorgu aracı (yalnız okuma, yetki kapsamında).
- Kabul: kişisel veri maskesiz gitmez (sözleşme testi); otomatik gönderim yok; AI anahtarı yoksa düğme görünmez; kapalı `ai_assistant` iken çağrı yok.
- Dış bağımlılık: OpenAI (hazır), WhatsApp Cloud (hesap sahibin). Şema: yok.

**Ö-5 Malik bağı, yetki takip alanı, tapu fotoğrafı.** Anahtar: `properties` (çekirdek).
- Yeni sahiplik: migration `…property_owner_link.sql` (`properties.owner_customer_id` nullable FK + indeks; mevcut verilere dokunmaz), `src/lib/property-owner/**`, `src/app/app/portfoyler/[id]/owner-link.tsx` (YENİ), `src/app/app/portfoyler/yeni/title-deed-fill.tsx` (YENİ; `document-ocr.ts` + kullanıcı onayı). EİDS takip alanları `features jsonb` içine (taşınmaz no, yetkilendiren malik adı, kademeli uyarı 30/7/1 mevcut `auth_expiring` otomasyonuna parametre).
- Adımlar: malik bağı alanı + müşteri kartında "malik olduğu taşınmazlar"; malik portalı sayaç kartı Ö-7 ile; tapu fotoğrafı düğmesi (PIYASA Paket D'nin evrak linki AYRI; burada yalnız form doldurma); yetki takip alanı gösterimi.
- Kabul: PostgREST gömmesi FK adıyla (`postgrest-embed-hint-contract` testi); RLS audit; kimlik görseli OCR'a gitmez; "EİDS'ten doğrulandı" ifadesi hiçbir yerde yok (yalnız "kayıtlı bilgi").
- Dış bağımlılık: OpenAI. Şema: evet (1 kolon).

**Ö-6 Emlakfiyati arayüz sınırı (iskelet).** Anahtar: `valuation`.
- Yeni sahiplik: `src/lib/integrations/emlakfiyati/{contract.ts, client.ts, contract.test.ts}`; registry kaydı (`integrations/registry.ts` tek satır, durum `setup_required`).
- Adımlar: bölüm 3.2 şeması `zod` + sahte yanıtlarla birim testi; `valuation.ts` kaynak listesine koşullu ekleme (tek satır); kota sayacı arayüzü.
- Kabul: yapılandırılmamışsa hiçbir davranış değişmez; hiçbir gerçek URL/alan adı sabitlenmez; PII sözleşme testi.
- Dış bağımlılık: Emlakfiyati (sahibin sağlaması; bölüm 3.2 listesi). Şema: yok/küçük.
- Başlama koşulu: sahibin API belgesi ve anlaşması gelmeden yalnız sözleşme+test; canlı çağrı kodu yazılmaz.

### V3 (sonra)

**Ö-7 Gösterim sonrası, satış sonrası, portal metrikleri.** Anahtar: `reports`, `automation`, `client_portals`.
- Yeni sahiplik: `src/lib/post-showing/**` (gösterim sonrası 1-5 ilgi puanı → talep), `src/app/anket/` mevcut sayfaya dokunmadan `src/app/gosterim-geri-bildirim/[token]/**` (YENİ), `src/lib/playbooks-after-sale.ts` (şablon verisi; `playbook-templates.ts`'e tek satır), malik portalı sayaç kartı `src/app/malik-portali/[token]/stats-card.tsx` (YENİ; `listing_views`), Google yorum bağlantısı alanı (tenant ayarı; `PIYASA` F6 ile aynı, tek uygulama).
- Kabul: "AI ihtimal" yok; sayaçlar gerçek `listing_views`; ofis Google URL'si yoksa bağlantı gösterilmez.
- Dış bağımlılık: yok (Google yorum URL'si ofisin). Şema: küçük (geri bildirim alanı).

**Ö-8 Pazar istatistiği, uyum alanları, güvenlik alarmı.** Anahtar: `reports`; `compliance` sistem çekirdeği.
- Yeni sahiplik: `src/lib/market-stats/**` ("benzer n kapanışta ortalama X gün", n eşiği, `region_stats_history`), `src/lib/compliance-fields/**` (İYS/izin kanalı ayrımı alanları, yalnız kayıt), CMA sunumuna emsal bölümü (`presentations` içine tek bölüm), toplu dışa aktarma/görüntüleme eşik alarmı (`src/lib/export-guard/**`).
- Kabul: eşik altı sayı gösterilmez; uyum alanlarında metin yok; alarm eşiği ofis ayarı ve sahibin açık onayıyla etkinleşir.
- Dış bağımlılık: yok. Şema: küçük.
- Başlama koşulu: sahibin kararları (bölüm 7 #8, #9).

Sıra: Ö-1 önce (diğer paketler `FeatureKey` kaydı ister); Ö-2..Ö-5 paralel; Ö-6 sahibin belgesine bağlı; Ö-7, Ö-8 V3.
Çakışma notu: `nav-config.ts`, `requireModulePage`, `palette-core.ts` küçük entegrasyonları yalnız Ö-1'e aittir. Spec P-HAVUZ/P-TUR ve PIYASA Paket D ile ortak dosya yok; ortak nokta `document-ocr.ts` (Ö-5 yalnız çağırır, değiştirmez).

---

## 7. Sahibin kararı gerekenler

1. Emlakfiyati: API belgesi, ticari anlaşma, kota/fiyat, kişisel veri rolleri, lead ofis seçimi, kaynak ağırlığı, atıf (bölüm 3.2 listesi).
2. WhatsApp Business hesabı ve şablon onayı (cevap taslağı gönderimi için); toplu eşleşme gönderiminde hangi kanal.
3. EİDS: resmi doğrulamanın ne olacağı (elle takip mi, ileride resmi erişim mi); "kayıtlı bilgi" ifadesinin yeterliliği; hukukçu görüşü. Resmi doğrulama için gereken: resmi erişim/anlaşma ve hukuki görüş (kodla çözülmez).
4. Yetki/yer gösterme/aracılık sözleşmeleri: metni kim yazacak (hukukçu); sistem yalnız değişken sözlüğü ve ofisin yüklediği metni tutar.
5. E-imza: SMS onayının yeterliliği ve nitelikli imza gereksinimi hukuki görüş; sağlayıcı seçimi.
6. KVKK/İYS metinleri ve kanal bazlı izin ayrımının kapsamı (hukukçu).
7. Menü birleşimi (bölüm 2.3: 41 → 36) kabul mü; Ofis kurulumu öğesi kurulum turu belgesiyle birlikte karara bağlanmalı.
8. Toplu dışa aktarma/görüntüleme alarmı ve cihaz yönetimi: etkinleştirilsin mi (sert güvenlik önlemi; önceki kararla onaysız eklenmez), eşikler.
9. "Kim gördü" okuma günlüğü: istenir mi (yazma yükü, çalışan gizliliği).
10. Ön ayarların içeriği (bölüm 4.3) ve modüllerin varsayılan durumu; "Uyum" ve "Denetim"in kapatılamaz olması; Gelen Kutusu'nun çekirdek sayılması.
11. Platform tarafından zorunlu modül kilidi politikası (hangi paket hangi modülü kilitler); K2 katalogu ile modül/paket eşlemesi netleşince `modulePlanRequirement` yönlendirmesi.
12. Telefon santrali/çağrı kaydı, Gmail/Outlook, portal XML/API, STT: V4'e bırakmak mı, erken ticari görüşme mi.
13. Satış süresi istatistiği için en az örnek sayısı (n) eşiği.
14. Malik-müşteri bağı için mevcut `properties` kayıtlarının geriye dönük doldurulması (elle mi, içe aktarma mı).

---

## 8. Elenenler ve nedeni

| Madde | Neden |
|---|---|
| 7, 8 (burada) | Uzmanlık/havuz spec'inde var; mükerrer |
| 10, 12, 14, 15, 24, 41, 44, 47-50, 52-54, 58, 62, 67-68, 72-73, 77, 82-86, 88, 91, 94-95, 98, 103, 111-113 | Zaten var (bölüm 1 kanıtı); yeni iş yok |
| 20 (sağlayıcı), 31, 70, 74 (builder), 81, 92 | Dış bağımlılık/ürün riski/kafa karıştırıcı; yerine mevcut karşılık |
| 25-26 onaysız otomatik gönderim ayarı | Açık uçlu bot politikası, İYS, yanlış mesaj riski |
| 51, 59-61, 64, 87, 93, 108 | Hukuki/etik risk (bölüm 5) |
| 55-56 kasa/banka | Muhasebe programı işi |
| 6 "AI lead skoru", 34 "satılabilirlik skoru", 40 "tahmini kapanış tarihi", 22 "AI satın alma ihtimali", 49 tek /100 danışman skoru, 12 "AI en iyi 3" | Sahte skor yasağı; yalnız açıklanabilir kural tabanlı gösterimler |
| 3 (aile/medeni durum alanları), 5 ("30 gün içinde alır" tahmin etiketi) | Veri/ihtiyaç yok, form şişirir |
| 110 çevrimdışı mod | Bilinçli fail-closed önbellek kararı |
| ChatGPT'nin 10 başlıklı menüsü ve ayrı başlıklar | Mevcut 9 başlık korunur |
