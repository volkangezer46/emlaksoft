# Sihirbaz planı (2026-10)

Sahip isteği: "Uygun mantıklı işler (satış, kiralama vb.) sihirbaz şeklinde, son teknoloji premium, kolay ve mantıklı."

## Hangi akış sihirbaz olur

| Akış | Karar | Neden |
|---|---|---|
| Satış (müşteri → portföy → fiyat/komisyon → teklif) | **Sihirbaz** `/app/anlasmalar/yeni` | Sıralı karar, canlı komisyon hesabı, birden çok kayıt (anlaşma + oran + teklif) |
| Satışı kapat (Kazanıldı / Kaybedildi) | **Sihirbaz** anlaşma detayı "Kapanış" sekmesi | Para, onay (WP2), portföy durumu ve evrak tek onayda |
| Kiralama (mülk → kiracı → koşullar → teslim) | **Sihirbaz** `/app/kiralama/yeni` | Kira + kiralık anlaşma + komisyon + ilk tahakkuk + teslim birlikte |
| Portföy ekleme | Mevcut sekmeli kabuk (`TabbedFormShell`, `.tfs-layout`) kalır | Sıra serbest, 5 sekme; zorunlu sıra yok. Görsel dil (altın ilerleme, özet) aynı belirteçlerden |
| Yeni müşteri + talep, randevu | Sonraki tur (kısa 2–3 adım) | Bugünkü sekmeli form tek ekranda bitiyor; sihirbaz değeri düşük |
| Kira artışı, masraf talebi, gerçek kullanıma geçiş | Sihirbaz DEĞİL | Tek karar, tek alan (pencere/satır içi yeterli) |

## Ortak çatı: `src/components/ui/wizard/`

- `engine.ts` (saf): adım listesi (`when` koşullu, `optional` atlanabilir), `navigationGuard` (geri serbest, ileri atlama aradaki
  geçersiz adımda durur), `stepStatuses` (tamam / şimdiki / sıradaki / hatalı / atlandı), `wizardProgress`, taslak kodlama
  (`emlaksoft:draft:v1:{kullanıcı}:sihirbaz-{id}`, yalnız beyaz liste + hassas olmayan alanlar, 7 gün), gönderim planı `runPlan`.
- `zod-step.ts`: adım doğrulaması `zod/mini` şemasıyla (istemci paketi hafif).
- `wizard.tsx`: adım başlığı (numara/ikon, altın ilerleme), "Özet ve onay" (her adım için Düzenle), "Taslağı sürdür" bandı,
  "Kaydet ve çık", klavye (Enter = İleri, Alt+←/→, Ctrl+Enter), odak yönetimi ve duyuru, masaüstü canlı özet paneli, telefonda
  kompakt numaralar + yapışkan alt çubuk (`fab-bar`, `--mbar-h`, ekran klavyesinde akışa döner), açık/koyu tema belirteçleri.
- Gönderim: TEK "Onayla" MEVCUT action'ları sırayla çağırır; iş kuralı kopyalanmaz. Bir görev düşerse tamamlananlar işaretli
  kalır, "Yeniden dene" yalnız kalanları çalıştırır, "Kalanı atla, kayda git" bağlantısı verilir. Yönetici onayı bekleyen
  işlem hata değil durum olarak gösterilir; bilgiler taslakta saklanır.

## Akışlar, adımlar, akıllı ön dolgu

**Satış sihirbazı** — Müşteri · Portföy · Fiyat ve komisyon · Belgeler ve teklif (isteğe bağlı) · Özet.
- `?customer=&property=&demand=` (eş adlar dahil) ön seçer; taraflar geldiyse doğrudan Fiyat adımı açılır.
- "Önerilen" portföyler (müşterinin talebi/açık işleri) kart olarak; ön seçili müşterinin açık anlaşması varsa mükerrer uyarısı.
- Tür portföyün işlem türünden önerilir; "Liste fiyatını yaz"; oran portföyde yoksa (portföy düzenleme izniyle) girilir.
- Yan panel: liste fiyatına oran, komisyon (KDV hariç / KDV / tahsil), ofis paylaşım kuralıyla danışman/ofis payı (tam ₺).
- Plan: `createPipelineDeal` → (gerekirse) `updatePropertyCommissionRate` → (istenirse) `createOffer`.

**Satışı kapat** — Nihai fiyat · Komisyon ve paylar (para görünmüyorsa yok) · Portföy durumu · Sözleşme ve vade (isteğe bağlı) · Özet.
- Paylar ofis varsayılanıyla gelir; satır ekle/sil, toplam ≤ %100, canlı tutar.
- Portföy adımı ön koşul listesi (`wonReadiness`) + "Satıldı olsun" onayı; bağlı sözleşmeler, "Sözleşme hazırla", evrak dosyası.
- Plan: (değiştiyse) `updateDeal` → (yoksa) oran → `updateDealStage(won)` (atomik: aşama + komisyon + portföy) →
  `getDealCommissionRef` + `updateCommissionSplits` → (istenirse) tahsilat görevi. Danışman/takım lideri vb.: Kazanıldı onaya
  düşer (durum), onay gelince aynı düğmeyle tamamlanır; paylaşım onaya düşerse kapanış biter, not düşülür.
- Kaybedildi: Kayıp nedeni · Geri kazanım takibi (isteğe bağlı) · Özet. Kapanmış anlaşmada "Kapanış sonrası" görünümü (paylar,
  vade, evrak, anket) kalır. Pano ve "Geçiş" menüsü yine `?sekme=kapanis&sonuc=` ile buraya gelir.

**Kiralama sihirbazı** — Mülk · Kiracı · Kira koşulları · Teslim (isteğe bağlı) · Özet.
- `?property=&customer=&tutar=`, `?anlasma=` (kiralık anlaşmadan), `?basvuru=` (onaylı başvuru) korunur.
- Kiracı: mevcut müşteri, hızlı yeni kayıt (`PhoneInput`/`EmailInput`, mükerrer kapısı) ya da onaylı başvuru (kefil taşınır).
- Koşullar: kira, vade günü, depozito, aidat, başlangıç (bitiş bir yıl önerilir), TÜFE / sabit artış kuralı, kullanım + stopaj,
  "hizmet bedelini kiracı öder", "ilk tahakkuku şimdi aç". Artış kuralı ve aidat ayrı sütun olmadığı için kira notuna yazılır.
- Yan panel: taşınma maliyeti (ilk kira + depozito + ilk aidat + KDV dahil hizmet bedeli), yıllık bedel, stopaj ve malike net.
- Plan: (yeni kiracı) `createCustomer` → (yoksa) oran → `createRental` (atomik) → `createRentCharge` (başlangıç ayı) →
  (teslim) `saveInspection` taslağı, `setRentalProcessStep(keys|utilities)`.

## Yetki ve kapsam

Sayfa kapıları ve WP2 veri kapsamı aynen: danışman yalnız kendi müşterisiyle anlaşma açar (kapsam dışı müşteride kart), kapanış
yalnız düzenleme + komisyon oluşturma izniyle, oran yalnız portföy düzenleme izniyle, teslim adımı kira düzenleme izniyle görünür.
Para (komisyon, paylar) yalnız `showMoney` iken. Son karar her zaman sunucu action'ındadır.

## Bütçe

Sihirbaz rotaları `scripts/check-bundle-budget.ts`'te kendi (başlangıç) eşikleriyle; kapanış sihirbazı anlaşma detayında
`next/dynamic` ile ayrı parça. Telefon kuralları PhoneInput içinde dinamik.
