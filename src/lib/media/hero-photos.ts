/**
 * GÖRSEL KÜTÜPHANESİ — fotoğraf manifesti. OTOMATİK ÜRETİLİR: `node scripts/media/build-hero-photos.mjs`.
 * Elle düzenleme; kaynağı ve yeni fotoğraf ekleme adımları için docs/design/GORSEL_KUTUPHANE.md.
 * Dosyalar: public/img/hero/<id>-<hash>-<w>.{avif,webp} (1 yıl immutable önbellek). Lisans kaydı: public/img/LICENSES.md.
 */

export type HeroPhotoTheme = "villa" | "skyline" | "interior" | "complex" | "office" | "land" | "commercial" | "keys";

export type HeroPhotoMeta = {
  id: string;
  theme: HeroPhotoTheme;
  /** Türkçe alternatif metin (dekoratif kullanımda boş alt verilir; bkz. <HeroPhoto decorative>). */
  alt: string;
  /** CSS object-position — kırpmada korunacak odak. */
  focal: string;
  /** Baskın renk (yükleme zemini). */
  color: string;
  /** En büyük varyantın boyutu (en-boy oranı için). */
  width: number;
  height: number;
  hash: string;
  widths: readonly number[];
  /** ~24 px bulanık önizleme (data URL; CSP img-src data: izinli). */
  lqip: string;
  credit: { provider: "Unsplash"; photographer: string; profileUrl: string; pageUrl: string; license: "Unsplash License"; licenseUrl: string };
};

export const HERO_PHOTOS = [
  {
    id: "villa-gece-havuz",
    theme: "villa",
    alt: "Gece aydınlatılmış modern villa ve önündeki havuz",
    focal: "50% 55%",
    color: "#081848",
    width: 2560,
    height: 1707,
    hash: "5330d98c",
    widths: [640, 1280, 1920, 2560],
    lqip: "data:image/webp;base64,UklGRrAAAABXRUJQVlA4IKQAAABwBACdASoYABAAPu1iqU2ppaOiMAgBMB2JbACdMoADYHjyyHshPiFVzKKe6AD+8Mz5zxbL/puIPwY1keN5Jy6SgvxsxCfi3jU6iOHefk7XJ762WMHFpO7C27Ix/fkG0jcfyTZhR5/RCfxWlbYM8NQ+7ns7xNJXCJgOfW3oGfI3PhvsYHhQ3YX+hgywROvEH1McB0DMYCCuXB0cJVF9OhvofpkAAA==",
    credit: { provider: "Unsplash", photographer: "Igor Savelev", profileUrl: "https://unsplash.com/@isavelev", pageUrl: "https://unsplash.com/photos/hnFmQgrmLt4", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "villa-gun-batimi",
    theme: "villa",
    alt: "Gün batımında havuzlu modern villa terası",
    focal: "45% 50%",
    color: "#180818",
    width: 2560,
    height: 3840,
    hash: "5b930380",
    widths: [640, 1280, 1920, 2560],
    lqip: "data:image/webp;base64,UklGRrAAAABXRUJQVlA4IKQAAACQBQCdASoYACQAPulgqE2pJaQiNVgIASAdCWYAqlwWbqCNsiizV2gZ5LgAuzHyAaDXEbF0AAD+5eZ/+pwRxkz4V3TOaxZx0gvlxXfw+GyHLYcDbewtad6wLjny/lrt4lhuMl87vFBFXTEYDqnGaSuGWUF9DL2r44lpKz9iRjOHPw9k50QMLYIaKnS3i87zg2HgtxAmhK1urnWtE/9/QiGB7JMkAA==",
    credit: { provider: "Unsplash", photographer: "Roberto Nickson", profileUrl: "https://unsplash.com/@rpnickson", pageUrl: "https://unsplash.com/photos/so3wgJLwDxo", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "villa-havuz-aksam",
    theme: "villa",
    alt: "Akşam ışıklarıyla aydınlanan villa ve havuz başı",
    focal: "60% 50%",
    color: "#080808",
    width: 1920,
    height: 1280,
    hash: "61241ea4",
    widths: [640, 1280, 1920],
    lqip: "data:image/webp;base64,UklGRsQAAABXRUJQVlA4ILgAAACQBACdASoYABAAPu1iqU2ppaQiMAgBMB2JbACsH8J8ABNJljvX5exl3ovx9AAA/vQnzrGSvq477ItlpL0AQfh/O4wys4jWiXxMuEglU2mo86FOQjOqjY3hk4DInJ7JmGbwB+y1IGSHmbcQ9D20Tt86b4RPcIa27Jfxr0QQlFZl0vKBfxPC+tcJb+5rjIt8dCXXemWCOnnG/pA8lBYNwIoDP85AnkSTyriBQTP5UkgQmX3ZsOP9pYAA",
    credit: { provider: "Unsplash", photographer: "sidath vimukthi", profileUrl: "https://unsplash.com/@sidathkc", pageUrl: "https://unsplash.com/photos/4bW1uBe4KJc", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "istanbul-kiz-kulesi",
    theme: "skyline",
    alt: "Gün batımında Kız Kulesi ve İstanbul Boğazı",
    focal: "45% 65%",
    color: "#0898c8",
    width: 2560,
    height: 1707,
    hash: "26f2349c",
    widths: [640, 1280, 1920, 2560],
    lqip: "data:image/webp;base64,UklGRqAAAABXRUJQVlA4IJQAAABQBQCdASoYABAAPu1iqU2ppaOiMAgBMB2JbACdMoMYPYE//7VFv/3IABW2JebtiKj8kiAA/R0UCKuJ29oGDWStdE4xVNK2OrssbFmq0h1buX//5AczPnpPqBpO+mYM6viGYyCG3CseEK3oWO5IDotAo2WJ1HRqUXDmMc36KJXi/opQFfduiu+g96t2zL10N/ieAAAA",
    credit: { provider: "Unsplash", photographer: "Ibrahim Uzun", profileUrl: "https://unsplash.com/@ibuzn", pageUrl: "https://unsplash.com/photos/9FkQpB2rVjw", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "istanbul-kopru-gece",
    theme: "skyline",
    alt: "Alacakaranlıkta Boğaz köprüsü ve şehir ışıkları",
    focal: "50% 55%",
    color: "#080808",
    width: 2560,
    height: 1707,
    hash: "ba1710ed",
    widths: [640, 1280, 1920, 2560],
    lqip: "data:image/webp;base64,UklGRnIAAABXRUJQVlA4IGYAAACwAwCdASoYABAAPu1iqk2ppaQiMAgBMB2JYgCdACHXYvb0N1UBgAD8f1oFZeu61MvgaeskbgcuWFG1tnxSDBPiMxtm1Sm8Kp+3kArtcrO+I0+DPGSK2934Cr4MQfwgr1UaIFewgAA=",
    credit: { provider: "Unsplash", photographer: "Fatmanur Şimşek", profileUrl: "https://unsplash.com/@fatmanursimsek", pageUrl: "https://unsplash.com/photos/xaqR7pVPixg", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "istanbul-havadan-kopru",
    theme: "skyline",
    alt: "Akşam saatlerinde İstanbul'un havadan görünümü ve köprü",
    focal: "40% 60%",
    color: "#080808",
    width: 2560,
    height: 1920,
    hash: "89f42897",
    widths: [640, 1280, 1920, 2560],
    lqip: "data:image/webp;base64,UklGRooAAABXRUJQVlA4IH4AAAAwBACdASoYABIAPuVgpk2pJaOiMAwBIByJYgCBoAjjaeuYb0X6xiTgCAAA/up5u6pkGt6Y/icDgGAU0BqoOdL5bRXk5zYqUS5vawfMGfZ76h51lmitez7UMYaHNFbvD0EvTf3PhSr0CdLebyHwebdl83mllzLtoAQVK+IAAAA=",
    credit: { provider: "Unsplash", photographer: "Ahmet Kahveci", profileUrl: "https://unsplash.com/@kahveci", pageUrl: "https://unsplash.com/photos/aSVQ_wMEPTY", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "salon-aksam-isigi",
    theme: "interior",
    alt: "Sıcak akşam ışığında açık mutfaklı lüks salon",
    focal: "50% 60%",
    color: "#080808",
    width: 1920,
    height: 1080,
    hash: "205da644",
    widths: [640, 1280, 1920],
    lqip: "data:image/webp;base64,UklGRqIAAABXRUJQVlA4IJYAAACwBACdASoYAA4APu1iqU2ppaOiMAgBMB2JYgCdMoRwACoSs6mzPXWea51E9tWAAM3yhNX6J4pUur/4MshwxT8CpmR4LWiQSxdy0rZi2VorQCKmZstsrvcw3nHByk61Cyw3/zmj7rmiPQw7JFilQh6EUycID2UFGWi+CGhAjmGgEzG+wtO4AmVPfTA9/OHVj4WggiSAAAA=",
    credit: { provider: "Unsplash", photographer: "Christian", profileUrl: "https://unsplash.com/@axcreativeagency", pageUrl: "https://unsplash.com/photos/DS9Xc7AWmwQ", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "salon-genis-pencere",
    theme: "interior",
    alt: "Geniş pencereli modern daire salonu",
    focal: "55% 55%",
    color: "#a8a898",
    width: 1920,
    height: 1280,
    hash: "cfebaabd",
    widths: [640, 1280, 1920],
    lqip: "data:image/webp;base64,UklGRq4AAABXRUJQVlA4IKIAAAAwBACdASoYABAAPu1iqU2ppaOiMAgBMB2JYwC06YxOyVyE+rX0pluNaAAAzcBKOl39iu8ClqKqWoXjZ2TevATv3v9XRwHvbyA3f7ePxw8Isi2rwoAlzTqFJpeIMR4MnbiWZDpWOX0eROP2eOMOeUJ4GYMsc/64eCWccI1MzpfeOem+zf9XjaNLFguoQVF9j46PGV+szzKQR3Y9zrp8bzTUwAA=",
    credit: { provider: "Unsplash", photographer: "Aalo Lens", profileUrl: "https://unsplash.com/@aalolens", pageUrl: "https://unsplash.com/photos/LqGf5UvHCZ8", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "site-cephe-gun-batimi",
    theme: "complex",
    alt: "Pembe gökyüzünü yansıtan cam balkonlu konut sitesi",
    focal: "60% 40%",
    color: "#080818",
    width: 1280,
    height: 854,
    hash: "c84fea22",
    widths: [640, 1280],
    lqip: "data:image/webp;base64,UklGRpQAAABXRUJQVlA4IIgAAAAwBACdASoYABAAPu1iqk2ppaQiMAgBMB2JZACdAYxY4Kx0W8ootS7G+wAA/rFnax2kVZmG86kGWDt4uYffxUZ7QFuriTkIdJ7RydX1qi3BijRVtvXVZQCgHmTCjPIA5ryHG0Hkj8aKO7C+lDFw2ybUCFWtkZHn/DK6dWbP9anEvxssygbIY/AA",
    credit: { provider: "Unsplash", photographer: "Tobias Wilden", profileUrl: "https://unsplash.com/@tobiasw", pageUrl: "https://unsplash.com/photos/4453DIQWtsQ", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "ofis-toplanti-salonu",
    theme: "office",
    alt: "Şehir manzaralı geniş toplantı odası",
    focal: "50% 60%",
    color: "#f8f8f8",
    width: 1920,
    height: 1280,
    hash: "f0a570c8",
    widths: [640, 1280, 1920],
    lqip: "data:image/webp;base64,UklGRowAAABXRUJQVlA4IIAAAAAwBACdASoYABAAPu1iqU2ppaQiMAgBMB2JYwCdACLXCnlZFv0xZMgEWcAA/Zz1A1/8qu0vWTlGHwX7CdYsR9rb6TpwFn8r5rp7K97qtZQhRqd3wf4ANecGk6i7aqaHbzS8RKF43PNfJvx2mD1cq8J9WyU7cHpEJ1iFkmrxOEIAAA==",
    credit: { provider: "Unsplash", photographer: "Benjamin Child", profileUrl: "https://unsplash.com/@bchild311", pageUrl: "https://unsplash.com/photos/GWe0dlVD9e0", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "ofis-toplanti-masasi",
    theme: "office",
    alt: "Toplantıya hazır modern ofis salonu",
    focal: "50% 55%",
    color: "#080808",
    width: 1280,
    height: 853,
    hash: "d256438b",
    widths: [640, 1280],
    lqip: "data:image/webp;base64,UklGRq4AAABXRUJQVlA4IKIAAABQBACdASoYABAAPu1iqU2ppaOiMAgBMB2JaAC7AYw6tbXxVkmROw7Dxi4AAM4k5GKSR82tOwZ43+jwQJygz4/36Kw7/QW4v1Y6Mw70ZK7cs7IPa4xJnRJdZafdM9V9IHQmhdvSQa2mPdaSrwHt6CPxKwTNipgtV64wzeUtBFAe1CFeF0l3n10wOcLnqwSG/7Ztqqngw9GY/SXF/4+1MBZAAAA=",
    credit: { provider: "Unsplash", photographer: "ZEIN ZAIN", profileUrl: "https://unsplash.com/@inal_03", pageUrl: "https://unsplash.com/photos/swIospf1Puo", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "arsa-havadan-yol",
    theme: "land",
    alt: "Yolların ayırdığı tarım arazilerinin havadan görünümü",
    focal: "50% 50%",
    color: "#082808",
    width: 1280,
    height: 960,
    hash: "440c930a",
    widths: [640, 1280],
    lqip: "data:image/webp;base64,UklGRqgAAABXRUJQVlA4IJwAAAAQBQCdASoYABIAPu1osFAppaUiqAqpMB2JbACdMoABgl0gbDBunOuZTDEBfk1RvQ6wAP6+U9BWWxsj41rTvfXJ3Wy1g48pzH52vw3KgEl3fI7hcXBL9ilGiwwZaZi++LbT2OiH2h4utbECaMN7r7QX7g9n+h0t1qGHUxMHsO/grJZtlQJ/grJZthAYmcCdFQqXSjUiDhDQRUAAAAA=",
    credit: { provider: "Unsplash", photographer: "Ricardo Gomez Angel", profileUrl: "https://unsplash.com/@rgaleriacom", pageUrl: "https://unsplash.com/photos/TbwnUGV4kok", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "arsa-havadan-yesil",
    theme: "land",
    alt: "Ağaçlarla çevrili yeşil parsellerin havadan görünümü",
    focal: "50% 50%",
    color: "#182818",
    width: 1280,
    height: 960,
    hash: "2b462cfb",
    widths: [640, 1280],
    lqip: "data:image/webp;base64,UklGRpwAAABXRUJQVlA4IJAAAAAQBQCdASoYABIAPu1mqk8ppaOiKA1RMB2JQBOmcdg1TJEO7KOp39D7WOM8Gj2SOgoAAP7i+uWFECnbxN+GxTktAiBnaQKeNcyTkJ6q5PNAdEw1OQOa8wh0GvuZLVwon+ls3dCBE8J1lyG1ZgqucCBI3TiySKQUxPynFnpWTuWT/zBGX4ZOnllKtmUkNcQAAAA=",
    credit: { provider: "Unsplash", photographer: "oleks film", profileUrl: "https://unsplash.com/@oleks_film", pageUrl: "https://unsplash.com/photos/GURzQwO8Li0", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "dukkan-bos-magaza",
    theme: "commercial",
    alt: "Ahşap tezgâhlı boş, modern ticari mağaza alanı",
    focal: "50% 55%",
    color: "#080808",
    width: 1280,
    height: 720,
    hash: "a160ef80",
    widths: [640, 1280],
    lqip: "data:image/webp;base64,UklGRp4AAABXRUJQVlA4IJIAAAAwBACdASoYAA4APu1iqU2ppaOiMAgBMB2JZgCdMoACp60O/BAGIv05sdwA/trCr/FOvhUBwMyK9Ir/0SSCdp9z5bIbRR5YZstkqsvNbl7JewnBrJAdHaDpSUzvI8IHRvZNrANwgvFNZRsd96jdWxQ4wUa1bx9n64Q2so6bhzikvn19p4oNeBG1bgAEF/5AcUAAAA==",
    credit: { provider: "Unsplash", photographer: "ULISES RAMIREZ", profileUrl: "https://unsplash.com/@ulises_rplt", pageUrl: "https://unsplash.com/photos/A1bMeaftZi4", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "anahtar-elde",
    theme: "keys",
    alt: "Elde tutulan ev anahtarı demeti",
    focal: "55% 45%",
    color: "#584838",
    width: 1280,
    height: 854,
    hash: "69f7e38d",
    widths: [640, 1280],
    lqip: "data:image/webp;base64,UklGRpgAAABXRUJQVlA4IIwAAACQBACdASoYABAAPu1iqU2ppaOiMAgBMB2JZgCdMoADgtcxs9hOmEw2WCiDDwAA9kd50tOAwKrEyNMEknUirkjE2+J/lhPwHTesbBrC237vumlEv/FZ1CztXlOYq+7ZsRe8z2BVO1dG5R97M55HstPfGi9uR+c8339TcOHtcUqYzSQmOTkRsgv3kCAAAA==",
    credit: { provider: "Unsplash", photographer: "Jakub Żerdzicki", profileUrl: "https://unsplash.com/@jakubzerdzicki", pageUrl: "https://unsplash.com/photos/Ebj87ehFNNU", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
  {
    id: "anahtar-teslim-kapi",
    theme: "keys",
    alt: "Yeni evin girişinde uzatılan anahtar",
    focal: "65% 40%",
    color: "#f8f8f8",
    width: 1280,
    height: 854,
    hash: "3b42f930",
    widths: [640, 1280],
    lqip: "data:image/webp;base64,UklGRngAAABXRUJQVlA4IGwAAACwAwCdASoYABAAPu1iqU2ppaOiMAgBMB2JbACdMoADMun+IoIiAAD82LAMI5MtsJsqYtgaX346xFuMBNS92EZzuZrRNu8gL7/gebWB7sJOpC/+ejgYVMk2bfCvrn+Cx7fIMaD2FWHGJj4lcAA=",
    credit: { provider: "Unsplash", photographer: "Jakub Żerdzicki", profileUrl: "https://unsplash.com/@jakubzerdzicki", pageUrl: "https://unsplash.com/photos/bqUZEAeWuok", license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },
] as const satisfies readonly HeroPhotoMeta[];

export type HeroPhotoId = (typeof HERO_PHOTOS)[number]["id"];

const BY_ID = new Map<string, HeroPhotoMeta>(HERO_PHOTOS.map((p) => [p.id, p]));

export function heroPhoto(id: HeroPhotoId): HeroPhotoMeta {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`Bilinmeyen fotoğraf: ${id}`);
  return p;
}

export function heroPhotoUrl(p: HeroPhotoMeta, width: number, ext: "avif" | "webp"): string {
  return `/img/hero/${p.id}-${p.hash}-${width}.${ext}`;
}

export function heroPhotoSrcSet(p: HeroPhotoMeta, ext: "avif" | "webp", maxWidth = Infinity): string {
  const ws = p.widths.filter((w, i) => w <= maxWidth || i === 0);
  return ws.map((w) => `${heroPhotoUrl(p, w, ext)} ${w}w`).join(", ");
}

export function heroPhotosByTheme(theme: HeroPhotoTheme): HeroPhotoMeta[] {
  return HERO_PHOTOS.filter((p) => p.theme === theme);
}
