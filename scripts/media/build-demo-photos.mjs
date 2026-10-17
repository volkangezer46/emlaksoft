#!/usr/bin/env node
/**
 * DEMO İLAN FOTOĞRAFLARI — derleme adımı (docs/design/GORSEL_KUTUPHANE.md › "Demo ilan fotoğrafları").
 *
 * Ne yapar: aşağıdaki SETS (ilan setleri) ve PHOTOS listesindeki Unsplash fotoğraflarını (yalnız "Unsplash License";
 * Unsplash+ / premium ASLA — premium görseller images.unsplash.com'dan zaten 404 döner, betik bunu hata sayar) indirir,
 * meta veriyi atarak AVIF + WebP duyarlı varyantlar üretir (public/img/demo/<id>-<hash>-<w>.{avif,webp}), 24 px LQIP ve
 * baskın renk hesaplar ve şunları yeniden yazar:
 *   - src/lib/media/demo-photos.ts  (makinece okunur manifest; ELLE DÜZENLENMEZ — demo verisi tohumu bunu okur)
 *   - public/img/LICENSES.md        (yalnız <!-- demo-photos:start --> … <!-- demo-photos:end --> bloğu)
 *
 * Varyantlar: AVIF 480/960/1600, WebP 480/960 (WebP yalnız AVIF desteklemeyen eski tarayıcılar için yedek; 1600 WebP
 * Docker imajında ~20 MB yer tutacağı için üretilmez). Dosya adındaki özet kaynak bayt + işlem ayarından gelir →
 * /img/demo/* 1 yıl `immutable` önbelleklenir (next.config.ts).
 *
 * Çalıştırma: node scripts/media/build-demo-photos.mjs
 * Kaynak önbelleği: $DEMO_PHOTO_CACHE (varsayılan: işletim sistemi geçici dizini). Orijinaller depoya girmez.
 * İndirilen dosyalar güvenilmeyen veridir: yalnız sharp ile görüntü olarak çözülür (JPEG değilse hata).
 * Görüntü işleme CPU-yoğun: fotoğraflar sırayla işlenir.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "public/img/demo");
const MANIFEST = path.join(ROOT, "src/lib/media/demo-photos.ts");
const LICENSES = path.join(ROOT, "public/img/LICENSES.md");
const CACHE = process.env.DEMO_PHOTO_CACHE ?? path.join(os.tmpdir(), "emlaksoft-demo-photos");
const DOWNLOADED = "2026-10-17";
/** İşlem ayarı değişirse sürümü artır → tüm adlar (ve önbellekler) yenilenir. */
const PIPELINE = "v1:src2000q90:avif54e5:webp74e5:lqip24";
const AVIF_WIDTHS = [480, 960, 1600];
const WEBP_WIDTHS = [480, 960];
const SRC_WIDTH = 2000;
const MARK_START = "<!-- demo-photos:start -->";
const MARK_END = "<!-- demo-photos:end -->";

/**
 * İlan setleri: her set AYNI mülke ait olabilecek 5–8 kare (arsa 3–4). Setin ilk fotoğrafı kapaktır.
 * priceBand tam TL; period "aylik" = kiralık aylık bedel, "toplam" = satış fiyatı. Bölge/fiyat yalnız demo önerisidir.
 */
const SETS = [
  { id: "ist-atasehir-2p1", title: "Ataşehir'de yeni rezidansta 2+1, otoparklı ve güvenlikli", propertyType: "rezidans", listingType: "satilik", rooms: "2+1", areaM2: 105, city: "İstanbul", district: "Ataşehir", priceBand: { min: 9_500_000, max: 13_500_000, period: "toplam" } },
  { id: "ist-maslak-3p1", title: "Maslak'ta site içinde balkonlu 3+1 rezidans dairesi", propertyType: "rezidans", listingType: "satilik", rooms: "3+1", areaM2: 155, city: "İstanbul", district: "Sarıyer", priceBand: { min: 16_000_000, max: 23_000_000, period: "toplam" } },
  { id: "kadikoy-moda-3p1", title: "Moda'da deniz manzaralı, yüksek tavanlı 3+1", propertyType: "daire", listingType: "satilik", rooms: "3+1", areaM2: 140, city: "İstanbul", district: "Kadıköy", priceBand: { min: 21_000_000, max: 30_000_000, period: "toplam" } },
  { id: "besiktas-bogaz-2p1", title: "Beşiktaş'ta Boğaz manzaralı, yenilenmiş 2+1", propertyType: "daire", listingType: "satilik", rooms: "2+1", areaM2: 110, city: "İstanbul", district: "Beşiktaş", priceBand: { min: 18_000_000, max: 26_000_000, period: "toplam" } },
  { id: "basaksehir-site-3p1", title: "Başakşehir'de havuzlu sitede 3+1 aile dairesi", propertyType: "daire", listingType: "satilik", rooms: "3+1", areaM2: 145, city: "İstanbul", district: "Başakşehir", priceBand: { min: 10_500_000, max: 15_500_000, period: "toplam" } },
  { id: "bodrum-yalikavak-villa", title: "Yalıkavak'ta özel havuzlu, deniz manzaralı 4+1 villa", propertyType: "villa", listingType: "satilik", rooms: "4+1", areaM2: 320, city: "Muğla", district: "Bodrum", priceBand: { min: 48_000_000, max: 85_000_000, period: "toplam" } },
  { id: "cesme-alacati-tas-villa", title: "Alaçatı'da havuzlu taş villa, bahçeli ve otantik", propertyType: "villa", listingType: "satilik", rooms: "4+1", areaM2: 260, city: "İzmir", district: "Çeşme", priceBand: { min: 32_000_000, max: 55_000_000, period: "toplam" } },
  { id: "beykoz-bahceli-villa", title: "Beykoz'da geniş bahçeli, havuzlu müstakil villa", propertyType: "villa", listingType: "satilik", rooms: "5+1", areaM2: 380, city: "İstanbul", district: "Beykoz", priceBand: { min: 28_000_000, max: 42_000_000, period: "toplam" } },
  { id: "urla-mustakil-ev", title: "Urla'da bahçeli, havuz başı pergolalı müstakil ev", propertyType: "mustakil", listingType: "satilik", rooms: "4+1", areaM2: 210, city: "İzmir", district: "Urla", priceBand: { min: 14_000_000, max: 21_000_000, period: "toplam" } },
  { id: "sisli-rezidans-penthouse", title: "Şişli'de şehir manzaralı teraslı dubleks penthouse", propertyType: "rezidans", listingType: "satilik", rooms: "4+1", areaM2: 290, city: "İstanbul", district: "Şişli", priceBand: { min: 42_000_000, max: 70_000_000, period: "toplam" } },
  { id: "sariyer-bogaz-yali", title: "Sarıyer'de Boğaz'a sıfır, bahçeli tarihi yalı", propertyType: "yali", listingType: "satilik", rooms: "7+2", areaM2: 650, city: "İstanbul", district: "Sarıyer", priceBand: { min: 280_000_000, max: 600_000_000, period: "toplam" } },
  { id: "maslak-plaza-ofis", title: "Maslak'ta plaza katında toplantı odalı kiralık ofis", propertyType: "ofis", listingType: "kiralik", rooms: null, areaM2: 450, city: "İstanbul", district: "Sarıyer", priceBand: { min: 180_000, max: 320_000, period: "aylik" } },
  { id: "kadikoy-butik-ofis", title: "Kadıköy'de metroya yakın, düzenli butik ofis", propertyType: "ofis", listingType: "satilik", rooms: "4+1", areaM2: 120, city: "İstanbul", district: "Kadıköy", priceBand: { min: 9_000_000, max: 14_000_000, period: "toplam" } },
  { id: "levent-bos-ofis-kati", title: "Levent'te boş teslim, kolonlu kiralık ofis katı", propertyType: "ofis", listingType: "kiralik", rooms: null, areaM2: 900, city: "İstanbul", district: "Beşiktaş", priceBand: { min: 350_000, max: 600_000, period: "aylik" } },
  { id: "nisantasi-cadde-dukkan", title: "Nişantaşı'nda cadde üstü vitrinli kiralık dükkan", propertyType: "dukkan", listingType: "kiralik", rooms: null, areaM2: 85, city: "İstanbul", district: "Şişli", priceBand: { min: 150_000, max: 260_000, period: "aylik" } },
  { id: "moda-kafe-dukkan", title: "Moda'da kafe olarak işletilen kiralık dükkan", propertyType: "dukkan", listingType: "kiralik", rooms: null, areaM2: 140, city: "İstanbul", district: "Kadıköy", priceBand: { min: 95_000, max: 160_000, period: "aylik" } },
  { id: "urla-zeytinlik", title: "Urla'da yola cepheli, verimli zeytinlik", propertyType: "arsa", listingType: "satilik", rooms: null, areaM2: 12_500, city: "İzmir", district: "Urla", priceBand: { min: 7_500_000, max: 12_000_000, period: "toplam" } },
  { id: "silivri-imarli-arsa", title: "Silivri'de konut imarlı, yatırımlık arsa", propertyType: "arsa", listingType: "satilik", rooms: null, areaM2: 1_000, city: "İstanbul", district: "Silivri", priceBand: { min: 4_500_000, max: 7_500_000, period: "toplam" } },
  { id: "ayvalik-yazlik", title: "Ayvalık'ta denize yürüme mesafesinde taş yazlık", propertyType: "yazlik", listingType: "satilik", rooms: "3+1", areaM2: 135, city: "Balıkesir", district: "Ayvalık", priceBand: { min: 9_000_000, max: 14_500_000, period: "toplam" } },
  { id: "besiktas-ogrenci-1p1", title: "Beşiktaş'ta üniversiteye yakın eşyalı 1+1", propertyType: "daire", listingType: "kiralik", rooms: "1+1", areaM2: 55, city: "İstanbul", district: "Beşiktaş", priceBand: { min: 26_000, max: 38_000, period: "aylik" } },
  { id: "kas-deniz-manzarali-villa", title: "Kaş'ta gün batımına bakan, havuzlu 3+1 villa", propertyType: "villa", listingType: "satilik", rooms: "3+1", areaM2: 220, city: "Antalya", district: "Kaş", priceBand: { min: 26_000_000, max: 40_000_000, period: "toplam" } },
  { id: "fethiye-modern-villa", title: "Fethiye'de körfez manzaralı modern havuzlu villa", propertyType: "villa", listingType: "satilik", rooms: "4+1", areaM2: 280, city: "Muğla", district: "Fethiye", priceBand: { min: 30_000_000, max: 48_000_000, period: "toplam" } },
];

/**
 * page: unsplash.com/photos/<page>; image: images.unsplash.com/<image>. Hepsi sayfasında "Free to use under the
 * Unsplash License" (2026-10-17). Seçim: görünür marka/logo/plaka yok, kişi odakta yok, filigran yok; Akdeniz/Ege/
 * Avrupa havası ABD banliyösüne tercih edildi. focal verilmezse "50% 50%".
 */
const PHOTOS = [
  { set: "ist-atasehir-2p1", kind: "exterior", page: "051Zf03x5rQ", image: "photo-1785428245224-8b87e46aba51", by: "Aalo Lens", user: "aalolens", alt: "Gün ışığında yeşillikli cepheye sahip modern rezidans binası" },
  { set: "ist-atasehir-2p1", kind: "living", page: "VZ2z8ozzy10", image: "photo-1738168246881-40f35f8aba0a", by: "Prydumano Design", user: "prydumanodesign", alt: "Yeşil köşe koltuklu, yerden tavana pencereli aydınlık salon" },
  { set: "ist-atasehir-2p1", kind: "living", page: "vYlmRFIsCIk", image: "photo-1738168279272-c08d6dd22002", by: "Prydumano Design", user: "prydumanodesign", alt: "Oturma grubu ve yemek masasının bir arada olduğu açık plan salon" },
  { set: "ist-atasehir-2p1", kind: "kitchen", page: "t0uOEEuAy1M", image: "photo-1738168362059-44a0b8a80b39", by: "Prydumano Design", user: "prydumanodesign", alt: "Ceviz dolaplı, yemek masalı modern mutfak" },
  { set: "ist-atasehir-2p1", kind: "living", page: "vXMbcO1mRBY", image: "photo-1738168266307-1d1515cbca2b", by: "Prydumano Design", user: "prydumanodesign", alt: "Çalışma odası olarak düzenlenmiş, raflı oda" },
  { set: "ist-atasehir-2p1", kind: "bedroom", page: "H2NpsZJe2IA", image: "photo-1678978866819-306ed8608e7f", by: "Le Quan", user: "mrkheu", alt: "Gri tonlarda modern ebeveyn yatak odası" },
  { set: "ist-atasehir-2p1", kind: "bathroom", page: "mLx6oMw32PI", image: "photo-1661107259637-4e1c55462428", by: "serjan midili", user: "s_midili", alt: "Ahşap dolaplı, mermer görünümlü modern banyo" },
  { set: "ist-atasehir-2p1", kind: "balcony", page: "iqGUN6GIl78", image: "photo-1776363116182-51694a04a1d5", by: "Aalo Lens", user: "aalolens", alt: "Şehir manzaralı, salıncak koltuklu balkon" },
  { set: "ist-maslak-3p1", kind: "exterior", page: "SITomRvMTXk", image: "photo-1785428685200-f0b28f94f4fe", by: "Aalo Lens", user: "aalolens", alt: "Gün doğumunda ağaçlar arasında yükselen modern rezidans" },
  { set: "ist-maslak-3p1", kind: "living", page: "kE6Luqa4bBQ", image: "photo-1737898415581-7dea57a1905b", by: "Prydumano Design", user: "prydumanodesign", alt: "Mutfakla birleşen açık plan salon ve yemek alanı" },
  { set: "ist-maslak-3p1", kind: "living", page: "1Uw-a7Os5rk", image: "photo-1737898378296-94dc316cd443", by: "Prydumano Design", user: "prydumanodesign", alt: "Cam bölmeli, sarkıt aydınlatmalı yemek alanı" },
  { set: "ist-maslak-3p1", kind: "kitchen", page: "KyWwFZkcaUU", image: "photo-1737898418666-9fe3ea568265", by: "Prydumano Design", user: "prydumanodesign", alt: "Mermer görünümlü ada tezgâhlı mutfak ve yemek masası" },
  { set: "ist-maslak-3p1", kind: "bedroom", page: "AbpUMLnJso4", image: "photo-1710224002849-a76ea1068b0d", by: "David Kristianto", user: "davidkristianto", alt: "Geniş pencereli, şehir manzaralı yatak odası" },
  { set: "ist-maslak-3p1", kind: "bathroom", page: "TWj0qbJn4zI", image: "photo-1603825491103-bd638b1873b0", by: "Raquel Navalon Alvarez", user: "rnavalon86", alt: "Duşakabinli, ahşap dolaplı modern banyo" },
  { set: "ist-maslak-3p1", kind: "balcony", page: "nAQmBTv6JWo", image: "photo-1758194403577-a9e4dbfbade1", by: "Aalo Lens", user: "aalolens", alt: "Yeşil alan ve şehir manzaralı geniş balkon" },
  { set: "kadikoy-moda-3p1", kind: "exterior", page: "vICX4XWmByk", image: "photo-1749558690276-1adc8a2970e4", by: "ilpadre", user: "ilpadre", alt: "Denize bakan klasik İstanbul apartmanları" },
  { set: "kadikoy-moda-3p1", kind: "living", page: "gREquCUXQLI", image: "photo-1522708323590-d24dbb6b0267", by: "deborah cortelazzi", user: "deborah_cortelazzi", alt: "Açık mutfaklı, yüksek tavanlı aydınlık salon" },
  { set: "kadikoy-moda-3p1", kind: "living", page: "OtXADkUh3-I", image: "photo-1583847268964-b28dc8f51f92", by: "Minh Pham", user: "minhphamdesign", alt: "Pencere önünde açık renkli oturma köşesi" },
  { set: "kadikoy-moda-3p1", kind: "kitchen", page: "UDDULE_eIBY", image: "photo-1588854337221-4cf9fa96059c", by: "Lotus Design N Print", user: "lotusdnp", alt: "Beyaz dolaplı, adalı klasik mutfak" },
  { set: "kadikoy-moda-3p1", kind: "bedroom", page: "bhoMFZB_6Bg", image: "photo-1758060215425-303300b1c7e2", by: "Clay Banks", user: "claybanks", alt: "Kemerli pencereli, çalışma masalı yatak odası" },
  { set: "kadikoy-moda-3p1", kind: "bathroom", page: "1AF5hP6F4tI", image: "photo-1629079447777-1e605162dc8d", by: "Steven Ungermann", user: "steveungermann", alt: "Çift lavabolu, duşakabinli beyaz banyo" },
  { set: "kadikoy-moda-3p1", kind: "balcony", page: "uH8GHfmgS3Y", image: "photo-1696854649609-1fd6e5abf87f", by: "Bjorn Agerbeek", user: "bjornagerbeek", alt: "Ferforje korkuluklu balkondan deniz ve ada manzarası" },
  { set: "kadikoy-moda-3p1", kind: "view", page: "wYrV1KuR-nY", image: "photo-1695110284238-de12f5e7b2fc", by: "Victoria Golysheva", user: "golysheva", alt: "Çatılar üzerinden deniz ve şehir manzarası" },
  { set: "besiktas-bogaz-2p1", kind: "exterior", page: "c_Phj_lH7nQ", image: "photo-1612293509840-afb0f18d417b", by: "Onur Binay", user: "onurbinay", alt: "Renkli cepheli tarihi İstanbul apartmanları" },
  { set: "besiktas-bogaz-2p1", kind: "living", page: "6spmqj2OSLk", image: "photo-1666585607888-3f6fe0b323d8", by: "S.Group Official", user: "sgroup", alt: "Deniz manzaralı, geniş camlı salon" },
  { set: "besiktas-bogaz-2p1", kind: "kitchen", page: "VgyN_CWXQVM", image: "photo-1617228069096-4638a7ffc906", by: "Cat Han", user: "figmentprints", alt: "Bahçeye bakan geniş pencereli modern mutfak" },
  { set: "besiktas-bogaz-2p1", kind: "bedroom", page: "imUfzHlHPDc", image: "photo-1778731525592-ea6ecbe78b3d", by: "Franco Debartolo", user: "francotheshooter", alt: "Fransız balkonlu aydınlık yatak odası" },
  { set: "besiktas-bogaz-2p1", kind: "bathroom", page: "9OKuf13OidA", image: "photo-1763485956310-55f3c0e822d5", by: "Peter Muniz", user: "petepxl", alt: "Taş dokulu duvarlı, ahşap dolaplı banyo" },
  { set: "besiktas-bogaz-2p1", kind: "balcony", page: "N1DlQkl2V2c", image: "photo-1769869173719-997e7be14a56", by: "Gábor Szűts", user: "szutsi", alt: "Sürme camlı balkondan deniz ve sahil manzarası" },
  { set: "besiktas-bogaz-2p1", kind: "view", page: "wlEnY1yEudc", image: "photo-1716207271325-73410b33a3c5", by: "Aslı Yaren Peker", user: "asliyarenpeker", alt: "Boğaz kıyısındaki yalılar ve yeşil sırtlar" },
  { set: "basaksehir-site-3p1", kind: "exterior", page: "LaFGZ3HO_Z8", image: "photo-1772409345810-c9f86e17b816", by: "Umut Tülüoğlu", user: "umut_tulu", alt: "Havuzlu ve sosyal alanlı konut sitesi" },
  { set: "basaksehir-site-3p1", kind: "pool", page: "77C9Np7HFzg", image: "photo-1762539744669-cb85948f1675", by: "Dora Abruzzese", user: "doragrok99", alt: "Site içindeki geniş açık yüzme havuzu" },
  { set: "basaksehir-site-3p1", kind: "living", page: "x3mSC1WnWhc", image: "photo-1633505899118-4ca6bd143043", by: "Spacejoy", user: "spacejoy", alt: "Açık renk kanepeli, aydınlık salon" },
  { set: "basaksehir-site-3p1", kind: "living", page: "w1ylyAGtdiA", image: "photo-1633505412556-82c0921e8f4a", by: "Spacejoy", user: "spacejoy", alt: "Yeşil manzaraya açılan yemek alanı" },
  { set: "basaksehir-site-3p1", kind: "kitchen", page: "G7sE2S4Lab4", image: "photo-1507089947368-19c1da9775ae", by: "Aaron Huber", user: "aahubs", alt: "Beyaz dolaplı, adalı geniş mutfak" },
  { set: "basaksehir-site-3p1", kind: "bedroom", page: "IARlbQa6Kc8", image: "photo-1633505765486-e404bbbec654", by: "Spacejoy", user: "spacejoy", alt: "Lacivert yastıklı, aydınlık ebeveyn yatak odası" },
  { set: "basaksehir-site-3p1", kind: "bathroom", page: "g51F6-WYzyU", image: "photo-1584622650111-993a426fbf0a", by: "Lotus Design N Print", user: "lotusdnp", alt: "Duşakabinli, geniş tezgâhlı banyo" },
  { set: "basaksehir-site-3p1", kind: "balcony", page: "L6qeLZGySzM", image: "photo-1774685110793-e427dfa87467", by: "Hardik Panchal", user: "hardik0507", alt: "Ahşap zeminli, oturma gruplu balkon" },
  { set: "bodrum-yalikavak-villa", kind: "exterior", page: "2d4lAQAlbDA", image: "photo-1512917774080-9991f1c4c750", by: "Frames For Your Heart", user: "framesforyourheart", alt: "Özel havuzlu beyaz modern villa" },
  { set: "bodrum-yalikavak-villa", kind: "pool", page: "mR1CIDduGLc", image: "photo-1600596542815-ffad4c1539a9", by: "Frames For Your Heart", user: "framesforyourheart", alt: "Güneşli havuz başı ve villanın teraslı cephesi" },
  { set: "bodrum-yalikavak-villa", kind: "living", page: "kToEIcYPky4", image: "photo-1601086540476-7d9fa9dd6023", by: "Frames For Your Heart", user: "framesforyourheart", alt: "Merdivenli, yüksek tavanlı yemek ve oturma alanı" },
  { set: "bodrum-yalikavak-villa", kind: "living", page: "doSeeEgedZg", image: "photo-1601002257790-ebe0966a85ae", by: "Frames For Your Heart", user: "framesforyourheart", alt: "Sarı koltuklu, beyaz köşe takımlı salon" },
  { set: "bodrum-yalikavak-villa", kind: "kitchen", page: "f1kidLb-tw0", image: "photo-1786053538161-501fbdd89629", by: "asd asd", user: "asd32123", alt: "Terasa açılan adalı beyaz mutfak" },
  { set: "bodrum-yalikavak-villa", kind: "bedroom", page: "FqqiAvJejto", image: "photo-1512918728675-ed5a9ecdebfd", by: "Frames For Your Heart", user: "framesforyourheart", alt: "Kapitoneli başlıklı geniş ebeveyn yatak odası" },
  { set: "bodrum-yalikavak-villa", kind: "bathroom", page: "6TY_WrJTwSI", image: "photo-1521783593447-5702b9bfd267", by: "Chastity Cortijo", user: "chastityco", alt: "Serbest duran küvetli, taş duvarlı banyo" },
  { set: "bodrum-yalikavak-villa", kind: "view", page: "ekpJ4wqf2io", image: "photo-1571666402424-c17d7e0cf0dd", by: "Nabih El Boustani", user: "nounouis", alt: "Sonsuzluk havuzu ve koy manzarası" },
  { set: "cesme-alacati-tas-villa", kind: "exterior", page: "ar6XJWyZKqw", image: "photo-1787868377879-98168d69cfe2", by: "Babi Kacharava", user: "babikacharava", alt: "Havuzlu, taş avlulu Ege tarzı müstakil villa" },
  { set: "cesme-alacati-tas-villa", kind: "pool", page: "bCepRCYTtu4", image: "photo-1758026164848-0a9fb178c070", by: "Maurits Bausenhart", user: "maur1ts", alt: "Şemsiyeli havuz başı ve taş ev" },
  { set: "cesme-alacati-tas-villa", kind: "living", page: "F9g66btBoig", image: "photo-1785708434653-e6b8a3d776d1", by: "David Marquez", user: "mark_ez_estudio", alt: "Ahşap kirişli, kemerli beyaz oturma alanı" },
  { set: "cesme-alacati-tas-villa", kind: "living", page: "6viJObrmnBw", image: "photo-1505577058444-a3dab90d4253", by: "Maria Orlova", user: "orlovamaria", alt: "Kemerli, desenli karo zeminli oturma odası" },
  { set: "cesme-alacati-tas-villa", kind: "kitchen", page: "YABErdnJPGc", image: "photo-1628797285815-453c1d0d21e3", by: "Sosey Interiors", user: "soseyinteriors", alt: "Ahşap adalı rustik mutfak" },
  { set: "cesme-alacati-tas-villa", kind: "bedroom", page: "hFce375mV-A", image: "photo-1612365228448-4ad44e105dc5", by: "laura adai", user: "lauraadaiphoto", alt: "Ahşap kepenkli pencereye bakan beyaz yatak odası" },
  { set: "cesme-alacati-tas-villa", kind: "bathroom", page: "PibraWHb4h8", image: "photo-1507652313519-d4e9174996dd", by: "Jared Rice", user: "jareddrice", alt: "Taş duvarlı, serbest küvetli banyo" },
  { set: "cesme-alacati-tas-villa", kind: "view", page: "tr3DOiV8H-k", image: "photo-1787868377767-aa776025c986", by: "Babi Kacharava", user: "babikacharava", alt: "Terastan yeşil koy ve deniz manzarası" },
  { set: "beykoz-bahceli-villa", kind: "exterior", page: "WaC-JFfF21M", image: "photo-1706808849780-7a04fbac83ef", by: "Salman Saqib", user: "salmansaqib", alt: "Geniş çim bahçeli, havuzlu modern villa" },
  { set: "beykoz-bahceli-villa", kind: "living", page: "y8j0gmhtS-4", image: "photo-1773578978637-c9771e7a9913", by: "Clay Banks", user: "claybanks", alt: "Yüksek pencereli açık plan salon ve yemek alanı" },
  { set: "beykoz-bahceli-villa", kind: "kitchen", page: "TDXF1KUyyTk", image: "photo-1788217158679-5f7a52049ecc", by: "Clay Banks", user: "claybanks", alt: "Ceviz dolaplı, adalı modern mutfak" },
  { set: "beykoz-bahceli-villa", kind: "living", page: "DYlnqMbIN7o", image: "photo-1788217207676-32adde8bc0f3", by: "Clay Banks", user: "claybanks", alt: "Bahçeye açılan aydınlık yemek alanı" },
  { set: "beykoz-bahceli-villa", kind: "bedroom", page: "yOs9Zc5JvTw", image: "photo-1788217023349-ad7763845844", by: "Clay Banks", user: "claybanks", alt: "Banyolu ebeveyn yatak odası" },
  { set: "beykoz-bahceli-villa", kind: "bathroom", page: "Fuguvv3goCA", image: "photo-1771681278369-e2a5480b8c29", by: "Clay Banks", user: "claybanks", alt: "Mermer duvarlı, yuvarlak aynalı banyo" },
  { set: "beykoz-bahceli-villa", kind: "garden", page: "yP02OVtq-Ig", image: "photo-1633330948542-0b3bdeefcdb3", by: "Tile Merchant Ireland", user: "tilemerchant", alt: "Oturma gruplu, peyzajlı arka bahçe" },
  { set: "urla-mustakil-ev", kind: "exterior", page: "P21wf6KAykw", image: "photo-1628012209120-d9db7abf7eab", by: "Felix", user: "felifox", alt: "Beyaz kübik mimarili müstakil ev" },
  { set: "urla-mustakil-ev", kind: "garden", page: "MYCyemg32zk", image: "photo-1632210370137-4088c0e38de6", by: "Spacejoy", user: "spacejoy", alt: "Havuz kenarında pergolalı açık yemek alanı" },
  { set: "urla-mustakil-ev", kind: "living", page: "EVjqpcn79AM", image: "photo-1632829882891-5047ccc421bc", by: "Spacejoy", user: "spacejoy", alt: "Şömineli, açık renk salon" },
  { set: "urla-mustakil-ev", kind: "living", page: "TZ_Aj8a5SW8", image: "photo-1632210826643-9ff7e84be2f9", by: "Spacejoy", user: "spacejoy", alt: "Koyu duvarlı, ahşap masalı yemek odası" },
  { set: "urla-mustakil-ev", kind: "kitchen", page: "-aDGbdTsBZg", image: "photo-1600489000022-c2086d79f9d4", by: "Collov Home Design", user: "collovhome", alt: "Antrasit dolaplı U mutfak" },
  { set: "urla-mustakil-ev", kind: "bedroom", page: "M95SWsUIXTE", image: "photo-1632210702485-e1841e30752a", by: "Spacejoy", user: "spacejoy", alt: "Ahşap başlıklı yatak odası" },
  { set: "urla-mustakil-ev", kind: "bathroom", page: "L4iRkKL5dng", image: "photo-1631889993959-41b4e9c6e3c5", by: "Backbone", user: "bkbn", alt: "Küvetli, ahşap çıta detaylı banyo" },
  { set: "sisli-rezidans-penthouse", kind: "exterior", page: "PaALC1kpp34", image: "photo-1785406986975-ce155f3dd542", by: "Aalo Lens", user: "aalolens", alt: "Akşam ışıklarıyla aydınlanan rezidans kulesi" },
  { set: "sisli-rezidans-penthouse", kind: "living", page: "Ez7fz5mavj0", image: "photo-1776362355123-ca966d36e29c", by: "Aalo Lens", user: "aalolens", alt: "Çift yükseklikte tavanlı, merdivenli dubleks salon" },
  { set: "sisli-rezidans-penthouse", kind: "living", page: "yxO8YG082v8", image: "photo-1758448511322-8bfc73daf606", by: "Aalo Lens", user: "aalolens", alt: "Köşe koltuklu, şehir manzaralı salon" },
  { set: "sisli-rezidans-penthouse", kind: "kitchen", page: "xCAMk7wFZC4", image: "photo-1785535573585-8f962fa3cda5", by: "Franco Debartolo", user: "francotheshooter", alt: "Mermer adalı lüks mutfak" },
  { set: "sisli-rezidans-penthouse", kind: "bedroom", page: "vz9IbCAXHKQ", image: "photo-1644057501622-dfa7dd26dbfb", by: "Ali Moradi", user: "3dartistmoradi", alt: "Koyu tonlarda lüks ebeveyn yatak odası" },
  { set: "sisli-rezidans-penthouse", kind: "bathroom", page: "N03PjHWOEFA", image: "photo-1733426107854-ee00a25d72a7", by: "Murad Kerimli", user: "frankkip", alt: "Serbest küvetli, gün ışığı alan banyo" },
  { set: "sisli-rezidans-penthouse", kind: "balcony", page: "JAC8RFKgTlU", image: "photo-1758193431353-87812fbff5cd", by: "Aalo Lens", user: "aalolens", alt: "Şehir manzaralı çatı terası" },
  { set: "sisli-rezidans-penthouse", kind: "building", page: "pt0nGH-NvoA", image: "photo-1758448500688-3ababa93fd67", by: "Aalo Lens", user: "aalolens", alt: "Mermer resepsiyonlu rezidans lobisi" },
  { set: "sariyer-bogaz-yali", kind: "exterior", page: "FsZ2Arcqwxc", image: "photo-1785634953247-1b7d4b3ca2b2", by: "Far Chinberdiev", user: "fardevio", alt: "Boğaz kıyısında bahçeli tarihi yalılar" },
  { set: "sariyer-bogaz-yali", kind: "living", page: "tRQGuk9YvEA", image: "photo-1782803432396-e168aa0e54a1", by: "Maverick Frame", user: "maverickframe", alt: "Su manzaralı, geniş beyaz salon" },
  { set: "sariyer-bogaz-yali", kind: "living", page: "xiLYm9lDrmE", image: "photo-1763506425614-cdfee3349eff", by: "Philippe BONTEMPS", user: "philippeb", alt: "Kemerli pencereli, klasik mobilyalı salon" },
  { set: "sariyer-bogaz-yali", kind: "kitchen", page: "ilbLEHMhxMA", image: "photo-1769326541248-5e09a8ace25b", by: "Puscas Adryan", user: "adryan_studio", alt: "Mermer tezgâhlı klasik beyaz mutfak" },
  { set: "sariyer-bogaz-yali", kind: "bedroom", page: "hCU4fimRW-c", image: "photo-1560185893-a55cbc8c57e8", by: "Francesca Tosolini", user: "fromitaly", alt: "Ahşap parkeli geniş yatak odası" },
  { set: "sariyer-bogaz-yali", kind: "bathroom", page: "M6a_MWnHJd4", image: "photo-1781344334947-60c704bafd51", by: "Ibrar Tariq", user: "stellar_shotsstudio", alt: "Çift lavabolu, serbest küvetli banyo" },
  { set: "sariyer-bogaz-yali", kind: "view", page: "8g6oAh1YSLI", image: "photo-1778083403380-7dfc7082b4d5", by: "Tarik Sami", user: "tarik_sami", alt: "Boğaz sırtlarındaki köşkler ve yalılar" },
  { set: "maslak-plaza-ofis", kind: "building", page: "Wm8opOd-MDE", image: "photo-1621831337128-35676ca30868", by: "Kenrick Baksh", user: "kenrick", alt: "Cam cepheli modern ofis binası" },
  { set: "maslak-plaza-ofis", kind: "building", page: "DfzzpBRZCT0", image: "photo-1587702068694-a909ef4aa346", by: "Darshan Patel", user: "darshanp9", alt: "Şehir manzaralı bina lobisi" },
  { set: "maslak-plaza-ofis", kind: "office", page: "xaGFrbbJuAo", image: "photo-1765371512971-9d4da531d004", by: "Caroline Badran", user: "___atmos", alt: "Toplantı alanı ve çalışma masaları bulunan ofis" },
  { set: "maslak-plaza-ofis", kind: "office", page: "rr12y4qEbps", image: "photo-1764810815228-b7f9432eec5c", by: "john renzzel", user: "johnrenzzel", alt: "Ahşap kaplamalı toplantı odası" },
  { set: "maslak-plaza-ofis", kind: "office", page: "eHD8Y1Znfpk", image: "photo-1497366811353-6870744d04b2", by: "Nastuh Abootalebi", user: "sunday_digital", alt: "Geniş camlı, beton tavanlı toplantı salonu" },
  { set: "maslak-plaza-ofis", kind: "office", page: "yWwob8kwOCk", image: "photo-1497366754035-f200968a6e72", by: "Nastuh Abootalebi", user: "sunday_digital", alt: "Cam bölmeli ofis koridoru" },
  { set: "maslak-plaza-ofis", kind: "office", page: "wEi2LkDF8LY", image: "photo-1779700210487-a01758a3c55a", by: "Pavel Gromov", user: "lastmanpaul", alt: "Şehir manzaralı yönetim toplantı odası" },
  { set: "kadikoy-butik-ofis", kind: "building", page: "U6WuKgCYbKE", image: "photo-1543892607-04657ef3a279", by: "Matt Reames", user: "mattreames", alt: "Cam ve beton cepheli ofis binası" },
  { set: "kadikoy-butik-ofis", kind: "office", page: "zCQsBI7ZltQ", image: "photo-1572521165329-b197f9ea3da6", by: "Raj Rana", user: "theranaman", alt: "Kemerli pencereli açık ofis" },
  { set: "kadikoy-butik-ofis", kind: "office", page: "ULh0i2txBCY", image: "photo-1503423571797-2d2bb372094a", by: "Pawel Chu", user: "pawell", alt: "Cam duvarlı toplantı odası" },
  { set: "kadikoy-butik-ofis", kind: "office", page: "srTPWPbK0Dg", image: "photo-1715593949273-09009558300a", by: "Musemind UX Agency", user: "musemindagency", alt: "Ahşap detaylı yönetici odası" },
  { set: "kadikoy-butik-ofis", kind: "office", page: "Gdufctyvzjo", image: "photo-1525896544042-354764aa27e6", by: "Jean-Philippe Delberghe", user: "jipy32", alt: "Bekleme ve oturma alanı" },
  { set: "kadikoy-butik-ofis", kind: "office", page: "ohLMHYT25Y0", image: "photo-1692133226337-55e513450a32", by: "Brian Wangenheim", user: "brianwangenheim", alt: "Masalı ve raflı küçük ofis odası" },
  { set: "levent-bos-ofis-kati", kind: "building", page: "8UDnSkjGqGU", image: "photo-1707823942892-3316eeb091a0", by: "Declan Sun", user: "declansun", alt: "Cam cepheli plaza binası" },
  { set: "levent-bos-ofis-kati", kind: "office", page: "rM-x_2Lz3eo", image: "photo-1771678039697-be711cc352e0", by: "Declan Sun", user: "declansun", alt: "Kolonlu, boş ve aydınlık ofis katı" },
  { set: "levent-bos-ofis-kati", kind: "office", page: "jdsSkQNTPuo", image: "photo-1771678040129-477a44bd37ea", by: "Declan Sun", user: "declansun", alt: "Galerili boş ofis alanı" },
  { set: "levent-bos-ofis-kati", kind: "office", page: "0-ypHJxt1-w", image: "photo-1771678040857-51d00a11be7a", by: "Declan Sun", user: "declansun", alt: "Yüksek camlı boş kat" },
  { set: "levent-bos-ofis-kati", kind: "office", page: "jaIx3CaUKHE", image: "photo-1591899916532-fc91c9d7fc01", by: "Dimmis Vart", user: "dimmisvart", alt: "Asma tavanlı boş ofis katı" },
  { set: "nisantasi-cadde-dukkan", kind: "shop", page: "x2SdB_gN6wo", image: "photo-1634316010579-465525ebab20", by: "Maria Lupan", user: "luandmario", alt: "Boş vitrinli cadde dükkanı cephesi" },
  { set: "nisantasi-cadde-dukkan", kind: "shop", page: "Apw4z0D9xVE", image: "photo-1769107805465-bfd41863f1a0", by: "Caroline Badran", user: "___atmos", alt: "Askılı reyonlu butik mağaza içi" },
  { set: "nisantasi-cadde-dukkan", kind: "shop", page: "Q8G9oX_SsEM", image: "photo-1769107805412-90d9191d53e9", by: "Caroline Badran", user: "___atmos", alt: "Raflı teşhir duvarı" },
  { set: "nisantasi-cadde-dukkan", kind: "shop", page: "wNudbCFp78k", image: "photo-1769107805511-0bb7075fca27", by: "Caroline Badran", user: "___atmos", alt: "Aydınlık butik mağaza ve oturma köşesi" },
  { set: "nisantasi-cadde-dukkan", kind: "shop", page: "aGgmKntVLJQ", image: "photo-1783987597078-84d5ac51d518", by: "ULISES RAMIREZ", user: "ulises_rplt", alt: "Endüstriyel tavanlı geniş ticari alan" },
  { set: "moda-kafe-dukkan", kind: "shop", page: "cceRffKgi6k", image: "photo-1685602729695-0664ea4e5c06", by: "JIRAN FAMILY", user: "jiranfamily", alt: "Boş ve aydınlık kafe dükkanı" },
  { set: "moda-kafe-dukkan", kind: "shop", page: "ZimlF1xeZ8k", image: "photo-1613274554329-70f997f5789f", by: "Chesley McCarty", user: "thetangledtomato", alt: "Hasır avizeli kafe salonu" },
  { set: "moda-kafe-dukkan", kind: "shop", page: "m5D5dHWHfSk", image: "photo-1522126039546-182129aa0b93", by: "Ian Valerio", user: "iangvalerio", alt: "Pencere önü oturma alanlı mekân" },
  { set: "moda-kafe-dukkan", kind: "shop", page: "j6ERcKXdlXw", image: "photo-1728761390316-935ffeb3fbcc", by: "Dmitrii Filatov", user: "dmitrii_filatov", alt: "Ağaçlara bakan bar masalı mekân" },
  { set: "moda-kafe-dukkan", kind: "shop", page: "WdE9JhjDb0M", image: "photo-1689037676470-b72230d5236e", by: "Amy Vosters", user: "amyvosters", alt: "Vitrin dolaplı pastane-kafe tezgâhı" },
  { set: "urla-zeytinlik", kind: "land", page: "v8NbNY5OSbY", image: "photo-1642687791249-86d868e17746", by: "Kostas Morfiris", user: "kmorfiris", alt: "Yamaçta sıra sıra zeytin ağaçları" },
  { set: "urla-zeytinlik", kind: "land", page: "OJ1ZjwAsFbw", image: "photo-1728940823516-ff387be88638", by: "Bastian Cimander", user: "buzztea", alt: "Asırlık zeytin ağaçları" },
  { set: "urla-zeytinlik", kind: "land", page: "IcDGKBGUznc", image: "photo-1729237593616-1bcf891a5085", by: "Lachezar Asparuhov", user: "l_asp", alt: "Gölgeli zeytinlik içi" },
  { set: "urla-zeytinlik", kind: "land", page: "M6jXE5-WLKA", image: "photo-1697829234209-5497520a9fc6", by: "Marie P", user: "mpartt", alt: "Dağ manzaralı zeytin bahçesi" },
  { set: "silivri-imarli-arsa", kind: "land", page: "G_Xd4FOfTE8", image: "photo-1773299567657-a4bf83503ce5", by: "Ravisankar S", user: "ravisankarsq", alt: "Parsellenmiş arsaların havadan görünümü" },
  { set: "silivri-imarli-arsa", kind: "land", page: "xxhCDwEpXdw", image: "photo-1785300674642-52ff0f3bd20a", by: "Chris Grant", user: "christheisland", alt: "Yerleşime yakın yeşil arazi" },
  { set: "silivri-imarli-arsa", kind: "land", page: "VLXKpfJaYvY", image: "photo-1771131825971-af45a242808c", by: "Daniel Miksha", user: "danielmiksha", alt: "Tarım arazileri ve köy yolunun havadan görünümü" },
  { set: "ayvalik-yazlik", kind: "exterior", page: "_oAz7X5c9ww", image: "photo-1601882577311-929b09fcb34f", by: "Jim Makos", user: "jimmakos", alt: "Bahçe duvarlı, beyaz badanalı yazlık ev" },
  { set: "ayvalik-yazlik", kind: "exterior", page: "cmEaLm6qjvo", image: "photo-1773094800562-263193a9546f", by: "Raelle Cameron", user: "raegocreative", alt: "Mavi korkuluklu, çiçekli yazlık cephesi" },
  { set: "ayvalik-yazlik", kind: "living", page: "qFbauOaA9UY", image: "photo-1707484687082-9493754d389f", by: "Vangel Dimo", user: "vangeldimo", alt: "Deniz manzaralı, geniş camlı salon" },
  { set: "ayvalik-yazlik", kind: "kitchen", page: "LIx9GfMB6ZM", image: "photo-1529423374493-8b2f78fd2437", by: "Ellen Tanner", user: "ellentanner", alt: "Tabak raflı, klasik köy mutfağı" },
  { set: "ayvalik-yazlik", kind: "bedroom", page: "uXYHodDhiG4", image: "photo-1779870458288-95fd59cd2c5b", by: "Sang Ho", user: "hovansang18", alt: "Deniz manzaralı, iki yataklı oda" },
  { set: "ayvalik-yazlik", kind: "bathroom", page: "vTj_dmFGB1Y", image: "photo-1643949719317-4342d8d4031e", by: "Bilal Mansuri", user: "itsbilalmn", alt: "Gri taş görünümlü sade banyo" },
  { set: "ayvalik-yazlik", kind: "balcony", page: "ZGMeWNJJlAs", image: "photo-1689717887631-088197cdc2ca", by: "imren tutuncu", user: "irmikten", alt: "Korkuluklu balkondan deniz manzarası" },
  { set: "besiktas-ogrenci-1p1", kind: "exterior", page: "kKh9J8-UND4", image: "photo-1619994121345-b61cd610c5a6", by: "Hebert Marchesi", user: "boombertz", alt: "Balkonlu beyaz apartman cephesi" },
  { set: "besiktas-ogrenci-1p1", kind: "living", page: "hrY-pZqFGyI", image: "photo-1702014859908-d48b9b844240", by: "Aquilion Property", user: "aquilionproperty", alt: "Mutfaklı, çalışma köşeli yaşam alanı" },
  { set: "besiktas-ogrenci-1p1", kind: "living", page: "6SArDIlfn_A", image: "photo-1702014860012-e0139aae6f69", by: "Aquilion Property", user: "aquilionproperty", alt: "Televizyonlu oturma ve çalışma köşesi" },
  { set: "besiktas-ogrenci-1p1", kind: "kitchen", page: "KUG5LLnuTbo", image: "photo-1702014861373-527115231f8c", by: "Aquilion Property", user: "aquilionproperty", alt: "Yeşil seramik kaplı kompakt mutfak" },
  { set: "besiktas-ogrenci-1p1", kind: "bedroom", page: "qbhF5gOzhVU", image: "photo-1702014861736-d62834317c5e", by: "Aquilion Property", user: "aquilionproperty", alt: "Fransız pencereli aydınlık yatak odası" },
  { set: "besiktas-ogrenci-1p1", kind: "bathroom", page: "dZYYr4rO3DI", image: "photo-1702014860610-06a4c3f83381", by: "Aquilion Property", user: "aquilionproperty", alt: "Duşakabinli modern banyo" },
  { set: "kas-deniz-manzarali-villa", kind: "exterior", page: "a0mhcnwhgOE", image: "photo-1673147056688-4df20283643b", by: "Strvnge Films", user: "strvngefilmss", alt: "Doğayla çevrili havuzlu modern villa" },
  { set: "kas-deniz-manzarali-villa", kind: "living", page: "Z85GaA1NIm8", image: "photo-1668277156357-3e174dff9f1a", by: "Polina Kuzovkova", user: "p_kuzovkova", alt: "Cam duvarlı, deniz manzaralı salon" },
  { set: "kas-deniz-manzarali-villa", kind: "living", page: "BkKclhwXhmE", image: "photo-1668277155898-704a26a5cfa3", by: "Polina Kuzovkova", user: "p_kuzovkova", alt: "Deniz kabuğu avizeli oturma alanı" },
  { set: "kas-deniz-manzarali-villa", kind: "living", page: "TIgbwVzjQ80", image: "photo-1668277280345-f3949c1b6aa2", by: "Polina Kuzovkova", user: "p_kuzovkova", alt: "Ağaçlara bakan yemek alanı" },
  { set: "kas-deniz-manzarali-villa", kind: "kitchen", page: "hYb7kbu4x7E", image: "photo-1622372738946-62e02505feb3", by: "Kam Idris", user: "ka_idris", alt: "Ahşap ve antrasit tonlu mutfak adası" },
  { set: "kas-deniz-manzarali-villa", kind: "bedroom", page: "NTgJBVdHQC8", image: "photo-1729605412224-147d072d3667", by: "Antonio Araujo", user: "antonioaaaraujo", alt: "Gün batımına bakan cam duvarlı yatak odası" },
  { set: "kas-deniz-manzarali-villa", kind: "bathroom", page: "f61KO4nDeJA", image: "photo-1650894622076-e09ab837c502", by: "Alona Gross", user: "alonagrrr", alt: "Ahşap ve taş dokulu banyo" },
  { set: "kas-deniz-manzarali-villa", kind: "view", page: "fQ7UCoyOddE", image: "photo-1668277155756-0ebb2801f6b4", by: "Polina Kuzovkova", user: "p_kuzovkova", alt: "Pencereden gün batımında deniz" },
  { set: "fethiye-modern-villa", kind: "exterior", page: "Id7u0EkTjBE", image: "photo-1613977257363-707ba9348227", by: "John Fornander", user: "johnfo", alt: "Havuzlu beyaz modern villa" },
  { set: "fethiye-modern-villa", kind: "pool", page: "y3_AHHrxUBY", image: "photo-1613977257365-aaae5a9817ff", by: "John Fornander", user: "johnfo", alt: "Palmiyeli havuz başı ve villa terası" },
  { set: "fethiye-modern-villa", kind: "living", page: "-wzNB4Fsoa0", image: "photo-1613553483056-c8cb4c5d2a7b", by: "Marvin Meyer", user: "marvelous", alt: "Beton dokulu, geniş camlı oturma ve çalışma alanı" },
  { set: "fethiye-modern-villa", kind: "kitchen", page: "NDapMfAONIg", image: "photo-1778731660397-6a66493be391", by: "Franco Debartolo", user: "francotheshooter", alt: "Adalı, beyaz bar sandalyeli mutfak" },
  { set: "fethiye-modern-villa", kind: "bedroom", page: "fBdlytm6Hp8", image: "photo-1613553474179-e1eda3ea5734", by: "Marvin Meyer", user: "marvelous", alt: "Cam sürgülü kapılı yatak odası" },
  { set: "fethiye-modern-villa", kind: "bathroom", page: "asgkXxIQrPU", image: "photo-1763485956292-7b9bed7b3c10", by: "Peter Muniz", user: "petepxl", alt: "Kemerli aynalı, taş dokulu banyo" },
  { set: "fethiye-modern-villa", kind: "view", page: "6FRwt9vE368", image: "photo-1707075108813-edefd7b3308d", by: "Vangel Dimo", user: "vangeldimo", alt: "Havuz kenarından körfez manzarası" },
];

const KINDS = ["exterior", "living", "kitchen", "bedroom", "bathroom", "balcony", "view", "pool", "garden", "office", "shop", "land", "building"];

async function source(p) {
  await mkdir(CACHE, { recursive: true });
  const file = path.join(CACHE, `${p.image}-${SRC_WIDTH}.jpg`);
  if (existsSync(file)) return readFile(file);
  // images.unsplash.com: Unsplash'in kendi CDN'i (API'nin `urls.raw` adresi). Unsplash+ görseller burada 404'tür.
  const res = await fetch(`https://images.unsplash.com/${p.image}?w=${SRC_WIDTH}&q=90&fm=jpg&fit=max`);
  if (!res.ok) throw new Error(`${p.image}: indirme ${res.status} (Unsplash+ ya da kaldırılmış olabilir)`);
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  if (meta.format !== "jpeg") throw new Error(`${p.image}: beklenmeyen biçim ${meta.format}`);
  await writeFile(file, buf);
  return buf;
}

const hex = (n) => n.toString(16).padStart(2, "0");

async function build(p) {
  const src = await source(p);
  const hash = createHash("sha256").update(src).update(PIPELINE).digest("hex").slice(0, 8);
  const meta = await sharp(src).metadata();
  const fit = (ws) => ws.filter((w) => w <= (meta.width ?? 0));
  const widths = fit(AVIF_WIDTHS);
  const webpWidths = fit(WEBP_WIDTHS);
  if (widths.length < 2) throw new Error(`${p.id}: kaynak çok küçük (${meta.width}px)`);
  const files = [];
  for (const w of widths) {
    // sharp withMetadata çağrılmadıkça EXIF/konum yazmaz → varyantlar meta verisiz.
    const base = sharp(src).rotate().resize({ width: w, withoutEnlargement: true });
    const out = [["avif", await base.clone().avif({ quality: 54, effort: 5 }).toBuffer()]];
    if (webpWidths.includes(w)) out.push(["webp", await base.clone().webp({ quality: 74, effort: 5 }).toBuffer()]);
    for (const [ext, buf] of out) {
      const name = `${p.id}-${hash}-${w}.${ext}`;
      await writeFile(path.join(OUT_DIR, name), buf);
      files.push({ name, w, ext, bytes: buf.length });
    }
  }
  const largest = await sharp(src).rotate().resize({ width: widths.at(-1), withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
  const lqipBuf = await sharp(src).rotate().resize({ width: 24 }).modulate({ saturation: 1.15 }).webp({ quality: 40 }).toBuffer();
  const { dominant } = await sharp(src).stats();
  return {
    ...p,
    hash,
    widths,
    webpWidths,
    width: largest.info.width,
    height: largest.info.height,
    color: `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`,
    lqip: `data:image/webp;base64,${lqipBuf.toString("base64")}`,
    files,
  };
}

function withIds() {
  const counters = new Map();
  const setIds = new Set(SETS.map((s) => s.id));
  return PHOTOS.map((p) => {
    if (!setIds.has(p.set)) throw new Error(`Bilinmeyen set: ${p.set}`);
    if (!KINDS.includes(p.kind)) throw new Error(`Bilinmeyen tür: ${p.kind}`);
    const n = (counters.get(p.set) ?? 0) + 1;
    counters.set(p.set, n);
    return { ...p, id: `${p.set}-${String(n).padStart(2, "0")}-${p.kind}`, cover: n === 1, focal: p.focal ?? "50% 50%" };
  });
}

function manifestTs(items) {
  const credit = (p) => `{ provider: "Unsplash", photographer: ${JSON.stringify(p.by)}, profileUrl: ${JSON.stringify(`https://unsplash.com/@${p.user}`)}, pageUrl: ${JSON.stringify(`https://unsplash.com/photos/${p.page}`)}, license: "Unsplash License", licenseUrl: "https://unsplash.com/license" }`;
  const rows = items.map((p) => `  {
    id: ${JSON.stringify(p.id)},
    set: ${JSON.stringify(p.set)},
    kind: ${JSON.stringify(p.kind)},
    cover: ${p.cover},
    alt: ${JSON.stringify(p.alt)},
    focal: ${JSON.stringify(p.focal)},
    color: ${JSON.stringify(p.color)},
    width: ${p.width},
    height: ${p.height},
    hash: ${JSON.stringify(p.hash)},
    widths: [${p.widths.join(", ")}],
    webpWidths: [${p.webpWidths.join(", ")}],
    lqip: ${JSON.stringify(p.lqip)},
    credit: ${credit(p)},
  },`).join("\n");
  const sets = SETS.map((s) => {
    const photoIds = items.filter((p) => p.set === s.id).map((p) => p.id);
    return `  {
    id: ${JSON.stringify(s.id)},
    title: ${JSON.stringify(s.title)},
    propertyType: ${JSON.stringify(s.propertyType)},
    listingType: ${JSON.stringify(s.listingType)},
    rooms: ${JSON.stringify(s.rooms)},
    areaM2: ${s.areaM2},
    city: ${JSON.stringify(s.city)},
    district: ${JSON.stringify(s.district)},
    priceBand: { min: ${s.priceBand.min}, max: ${s.priceBand.max}, currency: "TRY", period: ${JSON.stringify(s.priceBand.period)} },
    coverId: ${JSON.stringify(photoIds[0])},
    photoIds: [${photoIds.map((id) => JSON.stringify(id)).join(", ")}],
  },`;
  }).join("\n");
  return `/**
 * DEMO İLAN FOTOĞRAFLARI — manifest. OTOMATİK ÜRETİLİR: \`node scripts/media/build-demo-photos.mjs\`. Elle düzenleme.
 * Kaynak listesi ve kurallar: betiğin SETS/PHOTOS dizileri + docs/design/GORSEL_KUTUPHANE.md ("Demo ilan fotoğrafları").
 * Dosyalar: public/img/demo/<id>-<hash>-<w>.{avif,webp} (1 yıl immutable önbellek). Lisans kaydı: public/img/LICENSES.md.
 *
 * Kullanım (demo tohumu): \`demoPhotoSets()\` her ilan setini meta + sıralı fotoğraflar (ilk = kapak) olarak döner.
 * AVIF 480/960/1600, WebP 480/960 (yedek). \`demoPhotoUrl\` istenen genişliği o biçimde var olan en yakın varyanta indirir.
 */

export type DemoPhotoKind =
  | "exterior"
  | "living"
  | "kitchen"
  | "bedroom"
  | "bathroom"
  | "balcony"
  | "view"
  | "pool"
  | "garden"
  | "office"
  | "shop"
  | "land"
  | "building";

export type DemoPropertyType = "daire" | "rezidans" | "villa" | "mustakil" | "yali" | "yazlik" | "ofis" | "dukkan" | "arsa";

export type DemoPhotoFormat = "avif" | "webp";

export type DemoPhotoMeta = {
  id: string;
  kind: DemoPhotoKind;
  /** Ait olduğu ilan seti (DEMO_PHOTO_SETS[].id). */
  set: string;
  /** Setin kapak fotoğrafı mı (her setin ilk karesi). */
  cover: boolean;
  /** Türkçe alternatif metin. */
  alt: string;
  /** CSS object-position — kırpmada korunacak odak. */
  focal: string;
  /** Baskın renk (yükleme zemini). */
  color: string;
  /** En büyük varyantın boyutu (en-boy oranı için). */
  width: number;
  height: number;
  hash: string;
  /** AVIF genişlikleri. */
  widths: readonly number[];
  /** WebP (yedek) genişlikleri — 1600 üretilmez. */
  webpWidths: readonly number[];
  /** ~24 px bulanık önizleme (data URL; CSP img-src data: izinli). */
  lqip: string;
  credit: { provider: "Unsplash"; photographer: string; profileUrl: string; pageUrl: string; license: "Unsplash License"; licenseUrl: string };
};

export type DemoPhotoSetMeta = {
  id: string;
  /** Türkçe ilan başlığı önerisi. */
  title: string;
  propertyType: DemoPropertyType;
  listingType: "satilik" | "kiralik";
  /** Oda sayısı ("3+1"); arsa/ofis/dükkan için null olabilir. */
  rooms: string | null;
  /** Önerilen brüt m² (arsa için arazi m²). */
  areaM2: number;
  city: string;
  district: string;
  /** Tam TL. period "toplam" = satış fiyatı, "aylik" = aylık kira. */
  priceBand: { min: number; max: number; currency: "TRY"; period: "toplam" | "aylik" };
  coverId: string;
  photoIds: readonly string[];
};

export const DEMO_PHOTOS = [
${rows}
] as const satisfies readonly DemoPhotoMeta[];

export const DEMO_PHOTO_SETS = [
${sets}
] as const satisfies readonly DemoPhotoSetMeta[];

export type DemoPhotoId = (typeof DEMO_PHOTOS)[number]["id"];
export type DemoPhotoSetId = (typeof DEMO_PHOTO_SETS)[number]["id"];

const BY_ID = new Map<string, DemoPhotoMeta>(DEMO_PHOTOS.map((p) => [p.id, p]));

export function demoPhoto(id: string): DemoPhotoMeta {
  const p = BY_ID.get(id);
  if (!p) throw new Error(\`Bilinmeyen demo fotoğrafı: \${id}\`);
  return p;
}

/** Biçimde var olan genişlikler (küçükten büyüğe). */
export function demoPhotoWidths(p: DemoPhotoMeta, fmt: DemoPhotoFormat): readonly number[] {
  return fmt === "avif" ? p.widths : p.webpWidths;
}

/** İstenen genişliğe en yakın (≤, yoksa en küçük) varyantın adresi. Örn. demoPhotoUrl(p, 960, "webp"). */
export function demoPhotoUrl(p: DemoPhotoMeta, width: number, fmt: DemoPhotoFormat): string {
  const ws = demoPhotoWidths(p, fmt);
  const w = [...ws].reverse().find((x) => x <= width) ?? ws[0];
  return \`/img/demo/\${p.id}-\${p.hash}-\${w}.\${fmt}\`;
}

export function demoPhotoSrcSet(p: DemoPhotoMeta, fmt: DemoPhotoFormat, maxWidth = Infinity): string {
  const ws = demoPhotoWidths(p, fmt).filter((w, i) => w <= maxWidth || i === 0);
  return ws.map((w) => \`\${demoPhotoUrl(p, w, fmt)} \${w}w\`).join(", ");
}

export type DemoPhotoSet = { meta: DemoPhotoSetMeta; cover: DemoPhotoMeta; photos: DemoPhotoMeta[] };

/** Tüm ilan setleri: meta + sıralı fotoğraflar (photos[0] === cover). */
export function demoPhotoSets(): DemoPhotoSet[] {
  return DEMO_PHOTO_SETS.map((meta) => {
    const photos = meta.photoIds.map((id) => demoPhoto(id));
    return { meta, cover: demoPhoto(meta.coverId), photos };
  });
}

export function demoPhotosBySet(setId: string): DemoPhotoMeta[] {
  return DEMO_PHOTOS.filter((p) => p.set === setId);
}
`;
}

function licensesBlock(items) {
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  const total = items.reduce((a, p) => a + p.files.reduce((b, f) => b + f.bytes, 0), 0);
  const rows = items
    .map((p) => `| \`${p.id}\` | Unsplash | [${p.page}](https://unsplash.com/photos/${p.page}) | [${p.by}](https://unsplash.com/@${p.user}) | [Unsplash License](https://unsplash.com/license) | ${DOWNLOADED} | ${p.width}×${p.height} | ${kb(p.files.reduce((a, f) => a + f.bytes, 0))} |`)
    .join("\n");
  return `${MARK_START}
## Demo ilan fotoğrafları (public/img/demo)

OTOMATİK ÜRETİLİR (\`node scripts/media/build-demo-photos.mjs\`; manifest \`src/lib/media/demo-photos.ts\`). Aynı
**Unsplash License** ve seçim kuralları geçerlidir (Unsplash+ yok; logo/marka/plaka yok; kişi odakta değil; EXIF
silinmiş). ${SETS.length} ilan seti, ${items.length} fotoğraf; varyantlar AVIF 480/960/1600 + WebP 480/960.

| ID | Sağlayıcı | Fotoğraf sayfası | Fotoğrafçı | Lisans | İndirme | Boyut (en büyük) | Varyantlar toplamı |
|---|---|---|---|---|---|---|---|
${rows}

Toplam: ${kb(total)}.
${MARK_END}`;
}

async function writeLicenses(items) {
  const block = licensesBlock(items);
  const current = existsSync(LICENSES) ? await readFile(LICENSES, "utf8") : "# Görsel lisans kaydı (public/img)\n";
  const start = current.indexOf(MARK_START);
  const end = current.indexOf(MARK_END);
  let next;
  if (start >= 0 && end > start) next = current.slice(0, start) + block + current.slice(end + MARK_END.length);
  else {
    // Blok yoksa "## Diğer dosyalar" bölümünden önce eklenir (hero betiği bloğu korur).
    const other = current.indexOf("## Diğer dosyalar");
    next = other >= 0 ? `${current.slice(0, other)}${block}\n\n${current.slice(other)}` : `${current.trimEnd()}\n\n${block}\n`;
  }
  await writeFile(LICENSES, next);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  // Klasör tamamen bu betiğin çıktısıdır: eski (adı değişen) varyantlar silinir.
  for (const f of await readdir(OUT_DIR)) await rm(path.join(OUT_DIR, f));
  const items = [];
  for (const p of withIds()) {
    const built = await build(p);
    items.push(built);
    console.log(`${built.id.padEnd(44)} ${built.width}x${built.height} ${Math.round(built.files.reduce((a, f) => a + f.bytes, 0) / 1024)} KB`);
  }
  const hashes = new Set(items.map((p) => p.hash));
  if (hashes.size !== items.length) throw new Error("Aynı kaynak iki kez kullanılmış (yinelenen özet)");
  await writeFile(MANIFEST, manifestTs(items));
  await writeLicenses(items);
  let total = 0;
  const byKey = {};
  for (const f of items.flatMap((p) => p.files)) {
    total += f.bytes;
    const k = `${f.ext}-${f.w}`;
    byKey[k] = byKey[k] ?? { n: 0, bytes: 0 };
    byKey[k].n++;
    byKey[k].bytes += f.bytes;
  }
  for (const [k, v] of Object.entries(byKey)) console.log(`${k.padEnd(10)} ort. ${Math.round(v.bytes / v.n / 1024)} KB (${v.n} dosya)`);
  const onDisk = (await Promise.all((await readdir(OUT_DIR)).map(async (f) => (await stat(path.join(OUT_DIR, f))).size))).reduce((a, b) => a + b, 0);
  console.log(`${SETS.length} set, ${items.length} fotoğraf, toplam ${(total / 1024 / 1024).toFixed(2)} MB (diskte ${(onDisk / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
