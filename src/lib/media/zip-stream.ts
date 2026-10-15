import { trParts } from "@/lib/clock";
import { crc32 } from "@/lib/listing-control/server/extension-zip";
import { FLOOR_PLAN_TAG, normalizeCaption, normalizeRoomTag } from "@/lib/media/room-tags";

/**
 * Akışla ZIP yazıcı (toplu medya indirme, PF-09). Bağımlılıksız; her giriş SAKLANIR (method 0): JPEG/PNG/WebP zaten
 * sıkıştırılmış, DEFLATE yalnız CPU harcar. Girişler sırayla üretilir; bellekte aynı anda yalnız tek dosyanın baytı ve
 * merkezi dizin (giriş başına ~100 bayt) tutulur. ZIP64 yok: çağıran toplam boyutu 4 GB'ın çok altında sınırlar.
 * CRC/biçim `listing-control/server/extension-zip.ts` ile aynıdır (`listZipEntries` testte okur).
 */

export type ZipStreamEntry = { name: string; data: Uint8Array };

const ZIP32_LIMIT = 0xffff_fff0;

/** JS tarihi → DOS saat/tarih (Türkiye duvar saati, dakika hassasiyeti; 1980 öncesi 1980'e çekilir). */
export function dosDateTime(d: Date): { time: number; date: number } {
  const p = trParts(d.getTime());
  const year = Math.max(1980, Math.min(2107, p.year));
  return {
    time: (p.hour << 11) | (p.minute << 5),
    date: ((year - 1980) << 9) | ((p.month + 1) << 5) | p.day,
  };
}

export function assertSafeZipEntryName(name: string): void {
  if (!name || name.length > 200 || name.startsWith("/") || name.includes("..") || name.includes("\\")) {
    throw new Error(`Geçersiz ZIP girişi: ${name}`);
  }
}

/**
 * Girişleri sırayla okuyup ZIP baytlarını akış olarak verir. `entries` tükenince merkezi dizin + EOCD yazılır.
 * Bir giriş üretilirken hata olursa akış hata ile kapanır (yarım ZIP istemcide bozuk dosya olarak görünür; çağıran
 * hataları girişe çevirmeden önce yakalar ve o dosyayı atlar).
 */
export function createZipStream(
  entries: AsyncIterable<ZipStreamEntry>,
  opts: { modifiedAt?: Date } = {},
): ReadableStream<Uint8Array> {
  const { time, date } = dosDateTime(opts.modifiedAt ?? new Date(Date.UTC(1980, 0, 1, 12)));
  const iterator = entries[Symbol.asyncIterator]();
  const centrals: Buffer[] = [];
  let offset = 0;
  let count = 0;
  let finished = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      const next = await iterator.next();
      if (next.done) {
        finished = true;
        const central = Buffer.concat(centrals);
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(count, 8);
        end.writeUInt16LE(count, 10);
        end.writeUInt32LE(central.length, 12);
        end.writeUInt32LE(offset, 16);
        controller.enqueue(new Uint8Array(Buffer.concat([central, end])));
        controller.close();
        return;
      }
      const { name: rawName, data } = next.value;
      assertSafeZipEntryName(rawName);
      const name = Buffer.from(rawName, "utf8");
      const body = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      if (offset + 30 + name.length + body.length > ZIP32_LIMIT || count >= 0xffff) {
        throw new Error("ZIP boyut sınırı aşıldı.");
      }
      const crc = crc32(body);

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6); // UTF-8 ad
      local.writeUInt16LE(0, 8); // stored
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(body.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);

      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x0800, 8);
      central.writeUInt16LE(0, 10);
      central.writeUInt16LE(time, 12);
      central.writeUInt16LE(date, 14);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(body.length, 20);
      central.writeUInt32LE(body.length, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE(offset, 42);
      centrals.push(central, name);

      offset += 30 + name.length + body.length;
      count += 1;
      controller.enqueue(new Uint8Array(Buffer.concat([local, name])));
      controller.enqueue(new Uint8Array(body));
    },
    async cancel() {
      finished = true;
      await iterator.return?.();
    },
  });
}

// ---------------------------------------------------------------------------
// Dosya adları: "01-salon.jpg", "02-mutfak.jpg", "07-kat-plani.png"
// ---------------------------------------------------------------------------

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** Türkçe metni dosya adına uygun ASCII parçaya çevirir ("Yatak Odası 2" → "yatak-odasi-2"). */
export function slugifyFilePart(value: string, max = 40): string {
  const folded = value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  return folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export function mediaFileExtension(fileType: string | null | undefined, fileName: string | null | undefined): string {
  const byMime = fileType ? EXT_BY_MIME[fileType.toLowerCase()] : undefined;
  if (byMime) return byMime;
  const m = /\.([a-z0-9]{2,5})$/i.exec(fileName ?? "");
  const ext = m?.[1]?.toLowerCase();
  return ext === "jpeg" ? "jpg" : ext && Object.values(EXT_BY_MIME).includes(ext) ? ext : "jpg";
}

export type ZipNameInput = {
  room_tag?: string | null;
  caption?: string | null;
  file_type?: string | null;
  file_name?: string | null;
};

/**
 * Sıralı listeye ZIP giriş adı verir: iki haneli sıra + açıklama/oda etiketi ("01-salon.jpg"); etiketsiz görsel
 * yalnız sıra ("03.jpg"). Kat planı "kat-plani" adını alır. Aynı ad iki kez çıkamaz (sıra öneki zaten tekil).
 */
export function buildZipEntryNames(items: readonly ZipNameInput[]): string[] {
  const width = Math.max(2, String(items.length).length);
  return items.map((m, i) => {
    const seq = String(i + 1).padStart(width, "0");
    const tag = normalizeRoomTag(m.room_tag);
    const caption = normalizeCaption(m.caption);
    const label =
      tag === FLOOR_PLAN_TAG
        ? ["kat-plani", caption ? slugifyFilePart(caption, 30) : ""].filter(Boolean).join("-")
        : slugifyFilePart(caption ?? (tag ? tag.replace(/_/g, "-") : ""));
    const ext = mediaFileExtension(m.file_type, m.file_name);
    return label ? `${seq}-${label}.${ext}` : `${seq}.${ext}`;
  });
}

/** İndirilen ZIP'in adı: portföy kodu/başlığından ("PF-1024-fotograflar.zip"). */
export function zipDownloadName(code: string | null | undefined, title: string | null | undefined, watermarked: boolean): string {
  const base = (code ?? "").trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || slugifyFilePart(title ?? "", 40) || "portfoy";
  return `${base}-fotograflar${watermarked ? "-filigranli" : ""}.zip`;
}
