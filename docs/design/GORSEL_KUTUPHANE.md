# Görsel kütüphanesi (v4)

v4 referans tasarımı (alacakaranlıkta şehir + modern villa hero, "Kurulumunu tamamla" kartında villa, ekip listesinde
avatarlar) için lisansı temiz fotoğraf, ikon ve hareketli çizim seti. Tek kaynaklar:

| Ne | Nerede |
|---|---|
| Fotoğraf derleme betiği (kaynak listesi burada) | `scripts/media/build-hero-photos.mjs` |
| Fotoğraf manifesti (OTOMATİK, elle düzenlenmez) | `src/lib/media/hero-photos.ts` |
| Fotoğraf varyantları | `public/img/hero/<id>-<hash>-<w>.{avif,webp}` |
| Lisans kaydı (OTOMATİK) | `public/img/LICENSES.md` |
| Fotoğraf bileşeni | `src/components/ui/art/hero-photo.tsx` (`<HeroPhoto>`) |
| Marka ikonları + v4 ton karoları | `src/components/ui/icons/brand-icons.ts` (`BRAND_ICONS`, `V4_ICON_TILES`) |
| Hareketli boş durum çizimleri | `src/components/ui/illustrations/index.tsx` + `src/app/motion.css` (`.ill-*`) |
| Demo ilan fotoğrafları (setler, manifest) | `scripts/media/build-demo-photos.mjs`, `src/lib/media/demo-photos.ts` — bkz. "Demo ilan fotoğrafları" |
| Sözleşme testleri | `src/lib/media/hero-photos.test.ts`, `src/lib/icon-contract.test.ts`, `src/components/ui/illustrations/illustrations.test.ts` |

## Fotoğraflar — hangi ekrana hangisi

Hepsi Unsplash, **Unsplash License** (ticari kullanım serbest, atıf zorunlu değil; Unsplash+ kullanılmaz). Künye ve
indirme tarihi `public/img/LICENSES.md`'de.

| Ekran / yer | Fotoğraf `id` | Not |
|---|---|---|
| Ana sayfa hero (v4, karanlık/akşam) | `istanbul-kopru-gece` veya `istanbul-havadan-kopru` | `overlay="left"`, `priority`, `sizes="100vw"` |
| Ana sayfa hero (villa vurgulu) | `villa-gece-havuz` | Referanstaki "şehir + villa" havası; `focal` sağa kaydırılabilir |
| Hero gün dönümü (sabah/öğle selamı) | `istanbul-kiz-kulesi` | Gün batımı tonu; açık temada da sıcak |
| "Kurulumunu tamamla" kartı | `villa-gun-batimi` (dikey) | Kart sağında `layout="fill"`, `overlay="none"`, `maxWidth={1280}` |
| Portföy / ilan boş durumu, ilk ilan sihirbazı | `villa-havuz-aksam` | |
| Konut / daire kartları, vitrin örneği | `salon-aksam-isigi`, `salon-genis-pencere` | |
| Site / proje (konut projeleri) | `site-cephe-gun-batimi` | |
| Ekip, ofis, toplantı, randevu ekranları | `ofis-toplanti-salonu`, `ofis-toplanti-masasi` | Yüz yok |
| Arsa / tarla portföyü | `arsa-havadan-yol`, `arsa-havadan-yesil` | |
| Ticari (dükkan/mağaza) portföyü | `dukkan-bos-magaza` | |
| Anlaşma kapanışı, teslim, kira başlangıcı | `anahtar-elde`, `anahtar-teslim-kapi` | Yalnız el |

Ekip listesindeki avatarlar fotoğraf DEĞİLDİR: gerçek kişi fotoğrafı yalnız kullanıcının kendi yüklemesidir; yoksa
`avatar-art.tsx` baş harf/çizim üretir (kişilik hakkı: stok yüz kullanılmaz).

## `<HeroPhoto>` kullanımı

```tsx
import { HeroPhoto } from "@/components/ui/art/hero-photo";

// Hero: ilk ekranın büyük görseli (LCP) — sayfada EN ÇOK BİR priority
<section className="relative h-[420px] overflow-hidden rounded-3xl">
  <HeroPhoto photo="istanbul-kopru-gece" decorative priority overlay="left" sizes="100vw" className="absolute inset-0" />
  <div className="relative z-10 p-8 text-white">İyi akşamlar…</div>
</section>

// Kart: yerleşim genişliğini `sizes` ile söyle, büyük varyantı `maxWidth` ile kes
<div className="relative h-40 w-56 overflow-hidden rounded-2xl">
  <HeroPhoto photo="villa-gun-batimi" decorative sizes="224px" maxWidth={1280} />
</div>
```

- `overlay`: `bottom` | `left` | `full` | `vignette` — metin kontrastı için koyu degrade; renk `--hero-scrim`
  (RGB üçlüsü, varsayılan `8 15 32`) ile temalanır.
- `decorative`: atmosfer görseli → `alt=""` + `aria-hidden`. Anlam taşıyorsa manifestteki Türkçe `alt` kullanılır
  (`alt` ile geçersiz kılınabilir).
- Yüklenirken baskın renk + 24 px bulanık LQIP zemin görünür; istemci JS'i yoktur (sunucu bileşeni).
- `next/image` kullanılmaz: varyantlar derleme adımında hazırdır, ikinci optimizasyon gereksizdir.
- Önbellek: `/img/hero/*` 1 yıl `immutable` (`next.config.ts`); ad içerik özeti taşıdığından güvenlidir.

## Yeni fotoğraf ekleme

1. Fotoğrafı **unsplash.com** üzerinde seç. Kurallar: sayfada "Free to use under the Unsplash License" yazmalı
   (Unsplash+ / "premium" / plus.unsplash.com adresli olanlar YASAK); görünür logo, marka, yazı, plaka yok; tanınabilir
   yüz odakta değil. Pexels (Pexels License) da uygundur; betiğe sağlayıcı alanı eklenerek genişletilir.
2. `scripts/media/build-hero-photos.mjs` içindeki `SOURCES` dizisine bir satır ekle: `id` (kebab-case Türkçe),
   `theme`, `tier` (`hero` 640–2560, `wide` 640–1920, `card` 640–1280), `focal` (CSS object-position), `page`
   (unsplash.com/photos/<page>), `image` (images.unsplash.com/<image> — sayfadaki görsel adresinden), `by`, `user`, `alt`.
3. `node scripts/media/build-hero-photos.mjs` çalıştır (orijinaller `$HERO_PHOTO_CACHE` ya da sistem geçici
   dizininde önbelleklenir, depoya girmez). Betik `public/img/hero/`'yu baştan yazar, manifesti ve `LICENSES.md`'yi
   yeniler, toplamı yazdırır. Bütçe: tüm klasör < 12 MB (test kilitler).
4. `npx vitest run src/lib/media` yeşil olmalı; görsel, manifest ve lisans kaydı aynı commit'te gider.

Fotoğrafı kaldırmak: `SOURCES`'tan sil, betiği yeniden çalıştır, kullanıldığı yerleri güncelle (tsc `HeroPhotoId`
tipinden yakalar).

## Demo ilan fotoğrafları

Demo ofisin (`npm run seed:demo`) her ilanı gerçek, yüksek kaliteli fotoğraflarla dolu görünsün diye ayrı bir kütüphane:
aynı mülke ait olabilecek karelerden oluşan **ilan setleri**. Hero kütüphanesiyle aynı boru hattı ve lisans yaklaşımı.

| Ne | Nerede |
|---|---|
| Derleme betiği (SETS = set metası, PHOTOS = kaynak listesi) | `scripts/media/build-demo-photos.mjs` |
| Manifest (OTOMATİK, elle düzenlenmez) | `src/lib/media/demo-photos.ts` |
| Varyantlar | `public/img/demo/<id>-<hash>-<w>.{avif,webp}` — AVIF 480/960/1600, WebP 480/960 |
| Lisans kaydı (OTOMATİK blok) | `public/img/LICENSES.md` içinde `<!-- demo-photos:start -->` … `<!-- demo-photos:end -->` |
| Sözleşme testi | `src/lib/media/demo-photos.test.ts` |

**Setler (22):** İstanbul rezidans 2+1 (Ataşehir) ve 3+1 (Maslak), Moda deniz manzaralı 3+1, Beşiktaş Boğaz manzaralı
2+1, Başakşehir havuzlu site 3+1, Bodrum/Yalıkavak, Çeşme/Alaçatı taş, Beykoz bahçeli, Kaş ve Fethiye villaları, Urla
müstakil ev, Şişli rezidans penthouse, Sarıyer Boğaz yalısı, Ayvalık yazlık, Beşiktaş öğrenciye uygun eşyalı 1+1, üç
ofis (Maslak plaza, Kadıköy butik, Levent boş kat), iki dükkan (Nişantaşı cadde, Moda kafe) ve iki arsa (Urla zeytinlik,
Silivri imarlı). Konut setlerinde kapak (dış cephe) + salon + mutfak + yatak odası + banyo + balkon/manzara bulunur
(test kilitler); ticari setler ofis/dükkan iç mekânı ve bina, arsalar 3–4 karedir.

Her set metası: Türkçe başlık önerisi, `propertyType` (`daire`/`rezidans`/`villa`/`mustakil`/`yali`/`yazlik`/`ofis`/
`dukkan`/`arsa`), `listingType` (`satilik`/`kiralik`), oda sayısı, önerilen m², il/ilçe ve **tam TL** fiyat bandı
(`period: "toplam"` satış, `"aylik"` kira). Bölge ve fiyatlar yalnız demo önerisidir; fotoğraf o ilçede çekilmiş değildir.

```ts
import { demoPhotoSets, demoPhotoUrl, demoPhotoSrcSet } from "@/lib/media/demo-photos";

for (const { meta, cover, photos } of demoPhotoSets()) {
  // meta.title, meta.priceBand.min … ; photos[0] === cover
  const kapak = demoPhotoUrl(cover, 960, "webp");          // /img/demo/<id>-<hash>-960.webp
  const srcset = demoPhotoSrcSet(cover, "avif");           // 480w, 960w, 1600w
}
```

- `demoPhotoUrl(p, w, fmt)` istenen genişliği o biçimde var olan en yakın (≤) varyanta indirir: WebP'de 1600 yoktur,
  `demoPhotoUrl(p, 1600, "webp")` 960'ı döner. `<picture>`'da AVIF önce, WebP yedek; `<img src>` için WebP 960.
- Her fotoğrafta `alt` (Türkçe), `kind` (`exterior`, `living`, `kitchen`, `bedroom`, `bathroom`, `balcony`, `view`,
  `pool`, `garden`, `office`, `shop`, `land`, `building`), `focal`, baskın `color`, 24 px `lqip` ve `credit`
  (fotoğrafçı, profil, fotoğraf sayfası, lisans) vardır.
- Seçim kuralları hero ile aynı + : filigranlı, düşük çözünürlüklü ya da kişi odaklı kare yok; okunur marka/plaka yok;
  Türkiye/Akdeniz/Avrupa havası ABD banliyösüne tercih edilir. Mümkün olduğunda bir setin iç mekânları aynı
  fotoğrafçının aynı çekiminden gelir (ör. Prydumano, Aquilion, Polina Kuzovkova, Frames For Your Heart, Declan Sun).
- Bütçe (test kilitler): klasör ≤ 45 MB (Docker imajına girer), AVIF 1600 ortalaması ≤ 180 KB, AVIF 480 ≤ 60 KB.

Yeni set/fotoğraf: unsplash.com'da "Free to use under the Unsplash License" olduğunu doğrula (Unsplash+ görseller
images.unsplash.com'da 404 döner, betik durur), `SETS`'e set metasını, `PHOTOS`'a satırları ekle (setin ilk satırı
kapak; `id` = `<set>-<nn>-<kind>` otomatik), sonra `node scripts/media/build-demo-photos.mjs` (orijinaller
`$DEMO_PHOTO_CACHE` ya da sistem geçici dizininde, depoya girmez) ve `npx vitest run src/lib/media`. Görseller, manifest
ve lisans kaydı aynı commit'te gider. Hero betiği `LICENSES.md`'yi yeniden yazarken demo bloğunu korur.

## İkonlar

Marka ikon seti lucide ızgarasındadır (24 px, `currentColor`, tek %16 duotone katman); çizgi kalınlığı tüm uygulamada
`globals.css` kuralıyla **1,75**'tir. v4 referansının her kavramı için ikon + ton karosu `V4_ICON_TILES`'tadır:

| Kavram | İkon | Ton |
|---|---|---|
| Ajanda | `AjandaIcon` | brand |
| Onaylar | `OnayIcon` | warn |
| Gelen kutusu | `GelenKutusuIcon` | brand |
| İlanlar & Portal | `IlanPortalIcon` | gold |
| Mülk yönetimi | `MulkYonetimiIcon` | neutral |
| Gelen arama | `GelenAramaIcon` | brand |
| Portal teyit | `PortalTeyitIcon` | gold |
| Sistem sağlığı | `SistemSagligiIcon` | success |
| Kurulum | `KurulumIcon` | brand |
| Bugün ofiste | `OfisteIcon` | success |

```tsx
import { IconChip, V4_ICON_TILES } from "@/components/ui/icons";
const t = V4_ICON_TILES.sistemSagligi;
<IconChip icon={t.icon} tone={t.tone} />
```

Menü sözlüğü (`src/lib/icons.ts` `ICONS`) bu adımda DEĞİŞTİRİLMEDİ; menü ikonunu v4 ikonuna geçirmek ayrı, bilinçli
bir değişikliktir (ikon sözleşme testi eşlemeyi kilitler). Yeni ikon: `brand-icons.ts`'e `createLucideIcon("es-…")`
ile ekle, `BRAND_ICONS`'a kaydet; sözleşme (tek duotone, ham renk yok, < 1100 bayt, sunucu serileştirmesi) otomatik
denetlenir.

## Hareketli boş durum çizimleri

`<Illustration kind="…" />` veya `EmptyState illustration="…"`. Yeni üçlü:

| `kind` | Ne zaman |
|---|---|
| `anahtarTeslim` | Teslim edilen mülk / kapanmış anlaşma yokken; kira başlangıcı |
| `ilanYayinda` | Yayında ilan yokken, ilk ilan yayınlandığında |
| `hedefeUlasildi` | Hedef/kota tamamlandığında, "hepsi bitti" durumları |

Renk ton sınıfından (`currentColor`) ve yüzey token'larından gelir → koyu/açık temada kendiliğinden uyar. Hareket
yalnız `motion.css` içinde, `prefers-reduced-motion: no-preference` bloğundadır (`ill-swing`, `ill-pulse`, `ill-pop`,
yeni `ill-rise` yayın dalgası ve `ill-spark` ışıltı); reduced-motion'da ve yumuşak gezinmede (`data-soft-nav`) durağandır.
Her çizim < 6 KB gz (test).
