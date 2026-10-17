#!/usr/bin/env node
/**
 * GÖRSEL KÜTÜPHANESİ — fotoğraf derleme adımı (docs/design/GORSEL_KUTUPHANE.md).
 *
 * Ne yapar: aşağıdaki SOURCES listesindeki Unsplash fotoğraflarını (yalnız "Unsplash License" ile ücretsiz olanlar;
 * Unsplash+ / premium ASLA) indirir, EXIF/meta verisini atarak AVIF + WebP duyarlı varyantlar üretir
 * (public/img/hero/<id>-<hash>-<w>.{avif,webp}), küçük bulanık LQIP + baskın renk hesaplar ve iki dosyayı yeniden yazar:
 *   - src/lib/media/hero-photos.ts  (makinece okunur manifest; ELLE DÜZENLENMEZ)
 *   - public/img/LICENSES.md        (lisans/künye kaydı)
 *
 * Dosya adındaki kısa özet (hash) kaynak bayt + işlem ayarlarından gelir → içerik değişirse ad değişir; /img/* bu yüzden
 * 1 yıl `immutable` önbelleklenir (next.config.ts headers).
 *
 * Çalıştırma: node scripts/media/build-hero-photos.mjs
 * Kaynak önbelleği: $HERO_PHOTO_CACHE (varsayılan: işletim sistemi geçici dizini). Orijinaller depoya girmez.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "public/img/hero");
const MANIFEST = path.join(ROOT, "src/lib/media/hero-photos.ts");
const LICENSES = path.join(ROOT, "public/img/LICENSES.md");
const CACHE = process.env.HERO_PHOTO_CACHE ?? path.join(os.tmpdir(), "emlaksoft-hero-photos");
const DOWNLOADED = "2026-10-16";
/** İşlem ayarı değişirse sürümü artır → tüm adlar (ve önbellekler) yenilenir. */
const PIPELINE = "v1:avif50e4:webp74e5:lqip24";

/** Genişlik kademeleri: hero tam ekran, wide geniş kart/şerit, card küçük kart. */
const TIERS = { hero: [640, 1280, 1920, 2560], wide: [640, 1280, 1920], card: [640, 1280] };

const UNSPLASH_LICENSE = { name: "Unsplash License", url: "https://unsplash.com/license" };

/**
 * page: unsplash.com/photos/<page>; image: images.unsplash.com/<image>. focal = CSS object-position.
 * Hepsi sayfasında "Free to use under the Unsplash License" olarak doğrulandı (2026-10-16); logo/marka/yazı yok,
 * kişi portresi yok (anahtar karelerinde yalnız el).
 */
const SOURCES = [
  { id: "villa-gece-havuz", theme: "villa", tier: "hero", focal: "50% 55%", page: "hnFmQgrmLt4", image: "photo-1678889284769-b7dcbec1f082", by: "Igor Savelev", user: "isavelev", alt: "Gece aydınlatılmış modern villa ve önündeki havuz" },
  { id: "villa-gun-batimi", theme: "villa", tier: "hero", focal: "45% 50%", page: "so3wgJLwDxo", image: "photo-1544984243-ec57ea16fe25", by: "Roberto Nickson", user: "rpnickson", alt: "Gün batımında havuzlu modern villa terası" },
  { id: "villa-havuz-aksam", theme: "villa", tier: "wide", focal: "60% 50%", page: "4bW1uBe4KJc", image: "photo-1750271329214-a7dbce880e85", by: "sidath vimukthi", user: "sidathkc", alt: "Akşam ışıklarıyla aydınlanan villa ve havuz başı" },
  { id: "istanbul-kiz-kulesi", theme: "skyline", tier: "hero", focal: "45% 65%", page: "9FkQpB2rVjw", image: "photo-1636537511494-c3e558e0702b", by: "Ibrahim Uzun", user: "ibuzn", alt: "Gün batımında Kız Kulesi ve İstanbul Boğazı" },
  { id: "istanbul-kopru-gece", theme: "skyline", tier: "hero", focal: "50% 55%", page: "xaqR7pVPixg", image: "photo-1605625289654-20fc4c455d66", by: "Fatmanur Şimşek", user: "fatmanursimsek", alt: "Alacakaranlıkta Boğaz köprüsü ve şehir ışıkları" },
  { id: "istanbul-havadan-kopru", theme: "skyline", tier: "hero", focal: "40% 60%", page: "aSVQ_wMEPTY", image: "photo-1738334383330-cce0db3cdee1", by: "Ahmet Kahveci", user: "kahveci", alt: "Akşam saatlerinde İstanbul'un havadan görünümü ve köprü" },
  { id: "salon-aksam-isigi", theme: "interior", tier: "wide", focal: "50% 60%", page: "DS9Xc7AWmwQ", image: "photo-1680416124510-5eae1beca412", by: "Christian", user: "axcreativeagency", alt: "Sıcak akşam ışığında açık mutfaklı lüks salon" },
  { id: "salon-genis-pencere", theme: "interior", tier: "wide", focal: "55% 55%", page: "LqGf5UvHCZ8", image: "photo-1757924461488-ef9ad0670978", by: "Aalo Lens", user: "aalolens", alt: "Geniş pencereli modern daire salonu" },
  { id: "site-cephe-gun-batimi", theme: "complex", tier: "card", focal: "60% 40%", page: "4453DIQWtsQ", image: "photo-1624204386084-dd8c05e32226", by: "Tobias Wilden", user: "tobiasw", alt: "Pembe gökyüzünü yansıtan cam balkonlu konut sitesi" },
  { id: "ofis-toplanti-salonu", theme: "office", tier: "wide", focal: "50% 60%", page: "GWe0dlVD9e0", image: "photo-1431540015161-0bf868a2d407", by: "Benjamin Child", user: "bchild311", alt: "Şehir manzaralı geniş toplantı odası" },
  { id: "ofis-toplanti-masasi", theme: "office", tier: "card", focal: "50% 55%", page: "swIospf1Puo", image: "photo-1745920770891-b46fc1799646", by: "ZEIN ZAIN", user: "inal_03", alt: "Toplantıya hazır modern ofis salonu" },
  { id: "arsa-havadan-yol", theme: "land", tier: "card", focal: "50% 50%", page: "TbwnUGV4kok", image: "photo-1488354028423-039ac1e23357", by: "Ricardo Gomez Angel", user: "rgaleriacom", alt: "Yolların ayırdığı tarım arazilerinin havadan görünümü" },
  { id: "arsa-havadan-yesil", theme: "land", tier: "card", focal: "50% 50%", page: "GURzQwO8Li0", image: "photo-1515259387710-51e175f9ec6d", by: "oleks film", user: "oleks_film", alt: "Ağaçlarla çevrili yeşil parsellerin havadan görünümü" },
  { id: "dukkan-bos-magaza", theme: "commercial", tier: "card", focal: "50% 55%", page: "A1bMeaftZi4", image: "photo-1783700085825-1df197a49f40", by: "ULISES RAMIREZ", user: "ulises_rplt", alt: "Ahşap tezgâhlı boş, modern ticari mağaza alanı" },
  { id: "anahtar-elde", theme: "keys", tier: "card", focal: "55% 45%", page: "Ebj87ehFNNU", image: "photo-1722487631997-cf1e0f92c2c4", by: "Jakub Żerdzicki", user: "jakubzerdzicki", alt: "Elde tutulan ev anahtarı demeti" },
  { id: "anahtar-teslim-kapi", theme: "keys", tier: "card", focal: "65% 40%", page: "bqUZEAeWuok", image: "photo-1741156386380-0236c72eb6f9", by: "Jakub Żerdzicki", user: "jakubzerdzicki", alt: "Yeni evin girişinde uzatılan anahtar" },
];

async function source(s) {
  await mkdir(CACHE, { recursive: true });
  const max = Math.max(...TIERS[s.tier]);
  const file = path.join(CACHE, `${s.image}-${max}.jpg`);
  if (existsSync(file)) return readFile(file);
  // images.unsplash.com: Unsplash'in kendi CDN'i (API'nin `urls.raw` adresi); en büyük kademe kadar, yüksek kalite.
  const res = await fetch(`https://images.unsplash.com/${s.image}?w=${max}&q=92&fm=jpg&fit=max`);
  if (!res.ok) throw new Error(`${s.id}: indirme ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  return buf;
}

const hex = (n) => n.toString(16).padStart(2, "0");

async function build(s) {
  const src = await source(s);
  const hash = createHash("sha256").update(src).update(PIPELINE).digest("hex").slice(0, 8);
  const meta = await sharp(src).metadata();
  const widths = TIERS[s.tier].filter((w) => w <= (meta.width ?? 0));
  const files = [];
  for (const w of widths) {
    // sharp varsayılan olarak EXIF/ICC dışı meta veriyi yazmaz (withMetadata çağrılmıyor) → meta veri temiz.
    const base = sharp(src).rotate().resize({ width: w, withoutEnlargement: true });
    const avif = await base.clone().avif({ quality: 50, effort: 4 }).toBuffer();
    const webp = await base.clone().webp({ quality: 74, effort: 5 }).toBuffer();
    for (const [ext, buf] of [["avif", avif], ["webp", webp]]) {
      const name = `${s.id}-${hash}-${w}.${ext}`;
      await writeFile(path.join(OUT_DIR, name), buf);
      files.push({ name, bytes: buf.length });
    }
  }
  const largest = await sharp(src).rotate().resize({ width: widths.at(-1), withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
  const lqipBuf = await sharp(src).rotate().resize({ width: 24 }).modulate({ saturation: 1.15 }).webp({ quality: 40 }).toBuffer();
  const { dominant } = await sharp(src).stats();
  return {
    ...s,
    hash,
    widths,
    width: largest.info.width,
    height: largest.info.height,
    color: `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`,
    lqip: `data:image/webp;base64,${lqipBuf.toString("base64")}`,
    files,
  };
}

function manifestTs(items) {
  const rows = items.map((p) => `  {
    id: ${JSON.stringify(p.id)},
    theme: ${JSON.stringify(p.theme)},
    alt: ${JSON.stringify(p.alt)},
    focal: ${JSON.stringify(p.focal)},
    color: ${JSON.stringify(p.color)},
    width: ${p.width},
    height: ${p.height},
    hash: ${JSON.stringify(p.hash)},
    widths: [${p.widths.join(", ")}],
    lqip: ${JSON.stringify(p.lqip)},
    credit: { provider: "Unsplash", photographer: ${JSON.stringify(p.by)}, profileUrl: ${JSON.stringify(`https://unsplash.com/@${p.user}`)}, pageUrl: ${JSON.stringify(`https://unsplash.com/photos/${p.page}`)}, license: "Unsplash License", licenseUrl: "https://unsplash.com/license" },
  },`).join("\n");
  return `/**
 * GÖRSEL KÜTÜPHANESİ — fotoğraf manifesti. OTOMATİK ÜRETİLİR: \`node scripts/media/build-hero-photos.mjs\`.
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
${rows}
] as const satisfies readonly HeroPhotoMeta[];

export type HeroPhotoId = (typeof HERO_PHOTOS)[number]["id"];

const BY_ID = new Map<string, HeroPhotoMeta>(HERO_PHOTOS.map((p) => [p.id, p]));

export function heroPhoto(id: HeroPhotoId): HeroPhotoMeta {
  const p = BY_ID.get(id);
  if (!p) throw new Error(\`Bilinmeyen fotoğraf: \${id}\`);
  return p;
}

export function heroPhotoUrl(p: HeroPhotoMeta, width: number, ext: "avif" | "webp"): string {
  return \`/img/hero/\${p.id}-\${p.hash}-\${width}.\${ext}\`;
}

export function heroPhotoSrcSet(p: HeroPhotoMeta, ext: "avif" | "webp", maxWidth = Infinity): string {
  const ws = p.widths.filter((w, i) => w <= maxWidth || i === 0);
  return ws.map((w) => \`\${heroPhotoUrl(p, w, ext)} \${w}w\`).join(", ");
}

export function heroPhotosByTheme(theme: HeroPhotoTheme): HeroPhotoMeta[] {
  return HERO_PHOTOS.filter((p) => p.theme === theme);
}
`;
}

function licensesMd(items) {
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  const rows = items
    .map((p) => `| \`${p.id}\` | Unsplash | [${p.page}](https://unsplash.com/photos/${p.page}) | [${p.by}](https://unsplash.com/@${p.user}) | [${UNSPLASH_LICENSE.name}](${UNSPLASH_LICENSE.url}) | ${DOWNLOADED} | ${p.width}×${p.height} | ${kb(p.files.reduce((a, f) => a + f.bytes, 0))} |`)
    .join("\n");
  return `# Görsel lisans kaydı (public/img)

Bu klasördeki fotoğrafların kaynağı ve lisansı. OTOMATİK ÜRETİLİR (\`node scripts/media/build-hero-photos.mjs\`); kayıt
manifestle (\`src/lib/media/hero-photos.ts\`) aynı kaynaktan yazılır.

## Lisans özeti

**Unsplash License** (${UNSPLASH_LICENSE.url}): fotoğraflar ticari ve ticari olmayan amaçlarla ücretsiz kopyalanabilir,
değiştirilebilir, dağıtılabilir ve kullanılabilir; izin ya da atıf **zorunlu değildir** (yine de künye aşağıda ve
manifestte tutulur). Kısıtlar: fotoğraflar değiştirilmeden tek başına satılamaz; Unsplash'e benzer/rakip bir hizmet
kurmak için toplu derlenemez. **Unsplash+** (premium) görseller bu lisansta DEĞİLDİR ve kullanılmaz — her fotoğrafın
sayfasında "Free to use under the Unsplash License" ibaresi indirme tarihinde doğrulanmıştır.

Ek seçim kuralları: görünür marka/logo/yazı içeren kare yok; tanınabilir kişi portresi yok (anahtar karelerinde yalnız
el); orijinal EXIF/konum meta verisi varyantlardan silinmiştir.

## Fotoğraflar

| ID | Sağlayıcı | Fotoğraf sayfası | Fotoğrafçı | Lisans | İndirme | Boyut (en büyük) | Varyantlar toplamı |
|---|---|---|---|---|---|---|---|
${rows}

Toplam: ${kb(items.reduce((a, p) => a + p.files.reduce((b, f) => b + f.bytes, 0), 0))}.

## Diğer dosyalar

\`public/img/\` altındaki SVG çizimler (\`src/components/ui/illustrations\`, \`src/components/ui/art\`) projede üretilmiştir;
üçüncü taraf lisansı yoktur.
`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  // Eski varyantlar (adı değişenler) temizlenir: klasör tamamen bu betiğin çıktısıdır.
  for (const f of await readdir(OUT_DIR)) await rm(path.join(OUT_DIR, f));
  const items = [];
  for (const s of SOURCES) {
    const p = await build(s);
    items.push(p);
    console.log(`${p.id.padEnd(24)} ${p.width}x${p.height} ${p.widths.join("/")} ${Math.round(p.files.reduce((a, f) => a + f.bytes, 0) / 1024)} KB`);
  }
  await writeFile(MANIFEST, manifestTs(items));
  // Demo ilan fotoğraflarının bloğu (build-demo-photos.mjs yazar) korunur: "## Diğer dosyalar"dan önce yeniden eklenir.
  const prev = existsSync(LICENSES) ? await readFile(LICENSES, "utf8") : "";
  const demo = prev.match(/<!-- demo-photos:start -->[\s\S]*?<!-- demo-photos:end -->/)?.[0];
  const md = licensesMd(items);
  await writeFile(LICENSES, demo ? md.replace("## Diğer dosyalar", `${demo}\n\n## Diğer dosyalar`) : md);
  let total = 0;
  for (const f of await readdir(OUT_DIR)) total += (await stat(path.join(OUT_DIR, f))).size;
  console.log(`toplam ${(total / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
