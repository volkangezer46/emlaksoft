import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { listZipEntries } from "@/lib/listing-control/server/extension-zip";
import {
  buildZipEntryNames,
  createZipStream,
  dosDateTime,
  mediaFileExtension,
  slugifyFilePart,
  zipDownloadName,
  type ZipStreamEntry,
} from "./zip-stream";

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function* gen(entries: ZipStreamEntry[]) {
  for (const e of entries) yield e;
}

describe("createZipStream", () => {
  it("sıralı, açılabilir ZIP üretir (adlar ve baytlar korunur)", async () => {
    const a = new TextEncoder().encode("birinci görsel");
    const b = new Uint8Array(70_000).map((_, i) => i % 251);
    const zip = await collect(
      createZipStream(gen([{ name: "02-mutfak.jpg", data: b }, { name: "01-salon.jpg", data: a }]), {
        modifiedAt: new Date(Date.UTC(2026, 9, 19, 7, 30, 0)),
      }),
    );
    // Yazılan sıra korunur (alfabetik değil, galeri sırası).
    expect(listZipEntries(zip).map((e) => e.name)).toEqual(["02-mutfak.jpg", "01-salon.jpg"]);
    const files = unzipSync(new Uint8Array(zip));
    expect(new TextDecoder().decode(files["01-salon.jpg"])).toBe("birinci görsel");
    expect(Buffer.from(files["02-mutfak.jpg"]).equals(Buffer.from(b))).toBe(true);
  });

  it("boş liste geçerli boş ZIP; güvensiz ad reddedilir", async () => {
    const empty = await collect(createZipStream(gen([])));
    expect(listZipEntries(empty)).toEqual([]);
    await expect(collect(createZipStream(gen([{ name: "../x.jpg", data: new Uint8Array(1) }])))).rejects.toThrow();
  });

  it("DOS tarih/saat", () => {
    const { date, time } = dosDateTime(new Date(Date.UTC(2026, 9, 19, 7, 30, 8))); // TR 10:30
    expect(date >> 9).toBe(46);
    expect((date >> 5) & 0xf).toBe(10);
    expect(date & 0x1f).toBe(19);
    expect(time >> 11).toBe(10);
    expect((time >> 5) & 0x3f).toBe(30);
    expect(time & 0x1f).toBe(0);
  });
});

describe("ZIP dosya adları", () => {
  it("sıra + açıklama/etiket; kat planı; uzantı MIME'dan", () => {
    expect(
      buildZipEntryNames([
        { room_tag: "salon", file_type: "image/jpeg" },
        { caption: "Ebeveyn Banyosu", room_tag: "banyo", file_type: "image/webp" },
        { file_type: null, file_name: "IMG_1.JPEG" },
        { room_tag: "kat_plani", file_type: "image/png" },
        { room_tag: "yatak_odasi", file_type: "image/jpeg" },
      ]),
    ).toEqual(["01-salon.jpg", "02-ebeveyn-banyosu.webp", "03.jpg", "04-kat-plani.png", "05-yatak-odasi.jpg"]);
  });

  it("100+ görselde üç hane", () => {
    const names = buildZipEntryNames(Array.from({ length: 120 }, () => ({ file_type: "image/jpeg" })));
    expect(names[0]).toBe("001.jpg");
    expect(names[119]).toBe("120.jpg");
  });

  it("slug ve indirme adı", () => {
    expect(slugifyFilePart("Çatı Katı Şömine ğüı")).toBe("cati-kati-somine-gui");
    expect(mediaFileExtension("image/gif", null)).toBe("gif");
    expect(mediaFileExtension(null, "x.exe")).toBe("jpg");
    expect(zipDownloadName("PF-1024", "x", false)).toBe("PF-1024-fotograflar.zip");
    expect(zipDownloadName(null, "Moda'da 3+1 Daire", true)).toBe("moda-da-3-1-daire-fotograflar-filigranli.zip");
    expect(zipDownloadName(null, null, false)).toBe("portfoy-fotograflar.zip");
  });
});
