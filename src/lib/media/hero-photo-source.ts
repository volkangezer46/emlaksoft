/**
 * KAHRAMAN FOTOĞRAFI KAYNAĞI (arayüz) — /app ana ekranı ve kabuğun fotoğraflı yüzeyleri bu tek işlevden okur.
 *
 * Zincir (çağıran uygular): `getHeroPhoto(tema)` → ofisin yayındaki portföy fotoğrafı → SVG çizim. Seçilmiş fotoğraf
 * kütüphanesi (public/img/hero/*, `src/lib/media/hero-photos.ts` manifesti) birleşene dek işlev `null` döner; böylece
 * ofis fotoğrafı/çizim yolu bugün de eksiksiz çalışır ve kütüphane geldiğinde yalnız bu dosya bağlanır (çağıranlar değişmez).
 *
 * Kurallar: dosyalar aynı kökenden servis edilir (CSP `img-src 'self'`), boyut bilgisi verilir (CLS 0), `alt` dekoratif
 * kullanımda boş bırakılır (başlık `title` ile verilir). Saf ve senkron: istek turu yok, sunucu ve istemcide çağrılabilir.
 */
export type HeroPhotoTheme =
  /** Ana ekran kahramanı: alacakaranlıkta modern villa (sol tarafı yazı için sakin). */
  | "hero-villa-dusk"
  /** "Kurulumunu tamamla" kartının sağındaki villa görseli. */
  | "setup-villa"
  /** Danışman ana ekranı kahramanı (sıcak iç mekân / şehir). */
  | "hero-advisor"
  /** Muhasebe ana ekranı kahramanı (sakin ofis). */
  | "hero-accounting"
  /** Boş durum / ilk kurulum görselleri. */
  | "empty-office";

export type HeroPhoto = {
  /** Aynı kökenden mutlak yol (ör. `/img/hero/villa-dusk-1600.webp`). */
  src: string;
  /** Duyarlı kaynaklar (`640w, 1280w, 1920w`); yoksa yalnız `src`. */
  srcSet?: string;
  /** Doğal boyut (en/boy oranı ve CLS için). */
  width: number;
  height: number;
  /** Fotoğrafın adı/kaynağı (title, telif satırı). */
  title: string;
  /** Odak noktası (`object-position`), ör. "70% 55%": yazı solda kaldığı için ev sağda tutulur. */
  focus?: string;
  /** Baskın ton (fotoğraf inmeden önceki zemin rengi; yer tutucu). */
  tint?: string;
};

/**
 * Tema → görsel kütüphanesi kimlikleri (main'deki `src/lib/media/hero-photos.ts` manifesti; docs/design/GORSEL_KUTUPHANE.md).
 * Gün saatine duyarlı: gece/akşam sahnesinde ilk kimlik, gündüz ikincisi. Birleşmede `getHeroPhoto` bu tabloyu manifestten
 * çözer (src = 1920 WebP, srcSet = manifest genişlikleri, focus = `focal`, tint = `color`).
 */
export const HERO_PHOTO_PLAN: Record<HeroPhotoTheme, { night: string; day: string }> = {
  "hero-villa-dusk": { night: "villa-gece-havuz", day: "villa-havuz-aksam" },
  "setup-villa": { night: "villa-gun-batimi", day: "site-cephe-gun-batimi" },
  "hero-advisor": { night: "salon-aksam-isigi", day: "salon-genis-pencere" },
  "hero-accounting": { night: "ofis-toplanti-salonu", day: "ofis-toplanti-masasi" },
  "empty-office": { night: "anahtar-teslim-kapi", day: "anahtar-elde" },
};

/**
 * Temaya uygun seçilmiş fotoğraf. Kütüphane bu dala birleşene dek `null` (çağıran ofis fotoğrafına, o da yoksa çizime
 * düşer). Birleşmede: `heroPhoto(HERO_PHOTO_PLAN[theme][opts.scene === "day" ? "day" : "night"])` ile manifestten okunur.
 */
export function getHeroPhoto(theme: HeroPhotoTheme, opts: { scene?: "day" | "dusk" | "night" } = {}): HeroPhoto | null {
  void theme;
  void opts;
  return null;
}
