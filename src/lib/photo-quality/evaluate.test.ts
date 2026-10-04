import { describe, expect, it } from "vitest";
import { evaluatePhotoQuality, isPhotoGap, PHOTO_THRESHOLDS, type PhotoMedia } from "./evaluate";

let seq = 0;
function photo(over: Partial<PhotoMedia> = {}): PhotoMedia {
  seq += 1;
  return {
    id: `m${seq}`,
    kind: "image",
    is_cover: false,
    file_size: 400_000 + seq * 1000,
    file_type: "image/jpeg",
    file_name: `foto-${seq}.jpg`,
    sort_order: seq,
    ...over,
  };
}

const status = (r: ReturnType<typeof evaluatePhotoQuality>, id: string) => r.checks.find((c) => c.id === id)?.status;

describe("evaluatePhotoQuality", () => {
  it("fotoğraf yoksa sayı ve kapak uyarısı verir, gap true", () => {
    const r = evaluatePhotoQuality([]);
    expect(status(r, "count")).toBe("warn");
    expect(status(r, "cover")).toBe("warn");
    expect(r.gap).toBe(true);
    expect(r.checks.find((c) => c.id === "count")?.detail).toMatch(/Hiç fotoğraf yok/);
  });

  it("yeterli sayı + kapak + sağlıklı dosyalar: uyarı yok", () => {
    const media = [photo({ is_cover: true }), photo(), photo(), photo(), photo()];
    const r = evaluatePhotoQuality(media);
    expect(r.photoCount).toBe(5);
    expect(r.warned).toBe(0);
    expect(r.gap).toBe(false);
    // Boyut verisi yok: üç kontrol ölçülemedi olarak bildirilir
    expect(r.notMeasured).toBe(3);
    expect(status(r, "resolution")).toBe("na");
  });

  it("5'ten az fotoğraf ne kadar eksik olduğunu söyler", () => {
    const r = evaluatePhotoQuality([photo({ is_cover: true }), photo()]);
    const c = r.checks.find((x) => x.id === "count")!;
    expect(c.status).toBe("warn");
    expect(c.detail).toContain("2 fotoğraf var");
    expect(c.suggestion).toContain("3 fotoğraf daha");
    expect(r.gap).toBe(true);
  });

  it("kapak yoksa en büyük dosyayı önerir", () => {
    const big = photo({ file_size: 9_000_000, file_name: "buyuk.jpg" });
    const r = evaluatePhotoQuality([photo(), big, photo(), photo(), photo()]);
    const c = r.checks.find((x) => x.id === "cover")!;
    expect(c.status).toBe("warn");
    expect(c.suggestion).toContain("buyuk.jpg");
    expect(c.mediaIds).toEqual([big.id]);
  });

  it("küçük dosyaları ölçülen boyutla raporlar", () => {
    const tiny = photo({ file_size: 30 * 1024, file_name: "kucuk.jpg" });
    const r = evaluatePhotoQuality([photo({ is_cover: true }), tiny, photo(), photo(), photo()]);
    const c = r.checks.find((x) => x.id === "small")!;
    expect(c.status).toBe("warn");
    expect(c.detail).toContain("30 KB");
    expect(c.detail).toContain("kucuk.jpg");
    expect(c.mediaIds).toEqual([tiny.id]);
  });

  it("aynı boyutlu dosyaları olası yinelenen sayar ve sezgiyi belirtir", () => {
    const a = photo({ file_size: 555_555, file_name: "a.jpg" });
    const b = photo({ file_size: 555_555, file_name: "b.jpg" });
    const r = evaluatePhotoQuality([photo({ is_cover: true }), a, b, photo(), photo()]);
    const c = r.checks.find((x) => x.id === "duplicate")!;
    expect(c.status).toBe("warn");
    expect(c.detail).toContain("a.jpg");
    expect(c.detail).toContain("dosya boyutuna dayanır");
  });

  it("özet (sha256) varsa içeriğe göre eşler, boyut sezgisi kullanmaz", () => {
    const a = photo({ sha256: "x", file_size: 1_000_000 });
    const b = photo({ sha256: "x", file_size: 1_000_001 });
    const c = photo({ sha256: "y", file_size: 1_000_000 });
    const r = evaluatePhotoQuality([a, b, c, photo({ sha256: "z" }), photo({ sha256: "w" })]);
    const d = r.checks.find((x) => x.id === "duplicate")!;
    expect(d.status).toBe("warn");
    expect(d.mediaIds?.sort()).toEqual([a.id, b.id].sort());
    expect(d.detail).not.toContain("dosya boyutuna dayanır");
  });

  it("ölçülmüş boyutla çözünürlük, dikey/yatay ve oran kontrolü çalışır", () => {
    const media = [
      photo({ is_cover: true, width: 4000, height: 3000 }),
      photo({ width: 800, height: 600 }),
      photo({ width: 3000, height: 4000 }),
      photo({ width: 8000, height: 2000 }),
      photo({ width: 4000, height: 3000 }),
    ];
    const r = evaluatePhotoQuality(media);
    expect(status(r, "resolution")).toBe("warn");
    expect(r.checks.find((c) => c.id === "resolution")?.detail).toContain("800x600");
    expect(status(r, "orientation")).toBe("warn");
    expect(status(r, "aspect")).toBe("warn");
    expect(r.notMeasured).toBe(0);
  });

  it("tümü yatay ve yüksek çözünürlük ise geçer", () => {
    const media = Array.from({ length: 5 }, (_, i) => photo({ is_cover: i === 0, width: 4000, height: 3000 }));
    const r = evaluatePhotoQuality(media);
    expect(status(r, "resolution")).toBe("pass");
    expect(status(r, "orientation")).toBe("pass");
    expect(status(r, "aspect")).toBe("pass");
  });

  it("belge görüntüleri ve video/tur kapsam dışı", () => {
    const media = [
      photo({ is_cover: true }),
      photo(),
      photo(),
      photo(),
      photo({ is_document: true }),
      photo({ kind: "video" }),
    ];
    const r = evaluatePhotoQuality(media);
    expect(r.photoCount).toBe(4);
    expect(status(r, "count")).toBe("warn");
  });

  it("GIF uyarısı", () => {
    const r = evaluatePhotoQuality([photo({ is_cover: true, file_type: "image/gif" }), photo(), photo(), photo(), photo()]);
    expect(status(r, "format")).toBe("warn");
  });

  it("deterministik: aynı girdi aynı sonuç, puan alanı yok", () => {
    const media = [photo({ is_cover: true }), photo()];
    expect(evaluatePhotoQuality(media)).toEqual(evaluatePhotoQuality(media));
    expect(Object.keys(evaluatePhotoQuality(media))).not.toContain("score");
  });
});

describe("isPhotoGap", () => {
  it("eşik ve kapak kuralı rapordaki gap ile aynıdır", () => {
    expect(isPhotoGap(PHOTO_THRESHOLDS.minPhotos, true)).toBe(false);
    expect(isPhotoGap(PHOTO_THRESHOLDS.minPhotos - 1, true)).toBe(true);
    expect(isPhotoGap(10, false)).toBe(true);
  });
});
