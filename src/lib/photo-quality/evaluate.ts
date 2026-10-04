/**
 * İlan fotoğraf kalite denetimi (F3) — SUNUCU tarafı, yalnız kayıtlı metadata ile, saf fonksiyon.
 *
 * Görüntü işleme kütüphanesi YOK ve puan YOK: her kontrol ölçülen bir değere ve tek bir eşiğe dayanır,
 * sonuç "geçti / uyarı / ölçülemedi" olarak ve gerekçesiyle gösterilir. Eşikler ofis ayarı değil, burada
 * tek yerde sabittir ve ayarlanabilir TAHMİNDİR (portal eşikleri doğrulanmadı).
 *
 * `property_media` şemasında genişlik/yükseklik/özet kolonu YOKTUR; bu nedenle çözünürlük, oran ve dikey/yatay
 * kontrolleri yalnız kayıtta ölçülmüş değer varsa çalışır, yoksa "ölçülemedi" olarak açıkça bildirilir.
 * Belge/tapu görüntüleri (is_document) kapsam dışıdır.
 */

export const PHOTO_THRESHOLDS = {
  /** Önerilen asgari fotoğraf sayısı (tahmin; portal kuralı değil). */
  minPhotos: 5,
  /** Bu boyutun altındaki dosyalar büyük olasılıkla düşük çözünürlüktür. */
  smallFileBytes: 120 * 1024,
  /** Ölçülmüş genişlik/yükseklik için asgari uzun/kısa kenar (piksel). */
  minLongEdge: 1200,
  minShortEdge: 800,
  /** Bu orandan uzun/ince görseller alışılmadık sayılır. */
  maxAspect: 2.5,
} as const;

export type PhotoMedia = {
  id: string;
  kind: string;
  is_cover: boolean;
  file_size: number | null;
  file_type: string | null;
  file_name: string | null;
  sort_order: number;
  is_document?: boolean | null;
  /** Şemada yok; ileride/ölçüm varsa. */
  width?: number | null;
  height?: number | null;
  sha256?: string | null;
};

export type CheckStatus = "pass" | "warn" | "na";

export type PhotoCheck = {
  id: "count" | "cover" | "small" | "duplicate" | "resolution" | "orientation" | "aspect" | "format";
  status: CheckStatus;
  title: string;
  /** Ölçülen değer ve eşik — her uyarı gerekçelidir. */
  detail: string;
  /** Yalnız uyarıda: ne yapılmalı. */
  suggestion?: string;
  /** İlgili fotoğraf kimlikleri (listede vurgulamak için). */
  mediaIds?: string[];
};

export type PhotoQualityReport = {
  photoCount: number;
  checks: PhotoCheck[];
  passed: number;
  warned: number;
  /** Ölçülemeyen kontrol sayısı (şemada veri yok). */
  notMeasured: number;
  /** Kapak yok veya sayı eşiğin altında: "foto eksik" listesi/filtresi bu kuralı kullanır. */
  gap: boolean;
};

function isPhoto(m: PhotoMedia): boolean {
  return m.kind === "image" && !m.is_document;
}

function name(m: PhotoMedia): string {
  return m.file_name?.trim() || "adsız dosya";
}

function kb(n: number): string {
  return `${Math.round(n / 1024)} KB`;
}

function list(items: PhotoMedia[], max = 4): string {
  const shown = items.slice(0, max).map(name).join(", ");
  return items.length > max ? `${shown} ve ${items.length - max} dosya daha` : shown;
}

export function evaluatePhotoQuality(media: PhotoMedia[]): PhotoQualityReport {
  const T = PHOTO_THRESHOLDS;
  const photos = media.filter(isPhoto).sort((a, b) => a.sort_order - b.sort_order);
  const checks: PhotoCheck[] = [];

  // 1) Sayı
  const missing = Math.max(0, T.minPhotos - photos.length);
  checks.push(
    photos.length >= T.minPhotos
      ? { id: "count", status: "pass", title: "Fotoğraf sayısı", detail: `${photos.length} fotoğraf var (önerilen en az ${T.minPhotos}).` }
      : {
          id: "count",
          status: "warn",
          title: "Fotoğraf sayısı",
          detail: photos.length === 0 ? `Hiç fotoğraf yok (önerilen en az ${T.minPhotos}).` : `${photos.length} fotoğraf var, önerilen en az ${T.minPhotos}.`,
          suggestion: `${missing} fotoğraf daha ekleyin: dış cephe, salon, mutfak, banyo ve yatak odası.`,
        },
  );

  // 2) Kapak
  const cover = photos.find((p) => p.is_cover);
  if (cover) {
    checks.push({ id: "cover", status: "pass", title: "Kapak fotoğrafı", detail: `Kapak seçili: ${name(cover)}.`, mediaIds: [cover.id] });
  } else if (photos.length === 0) {
    checks.push({ id: "cover", status: "warn", title: "Kapak fotoğrafı", detail: "Fotoğraf olmadığı için kapak da yok.", suggestion: "Önce fotoğraf yükleyin; ilk yüklenen kapak olarak seçilebilir." });
  } else {
    const biggest = photos.reduce((a, b) => ((b.file_size ?? 0) > (a.file_size ?? 0) ? b : a));
    checks.push({
      id: "cover",
      status: "warn",
      title: "Kapak fotoğrafı",
      detail: "Kapak fotoğrafı seçilmemiş; listelerde ve vitrinde boş görsel çıkar.",
      suggestion: `Bir fotoğrafı kapak yapın (öneri: en büyük dosya, ${name(biggest)}${biggest.file_size ? `, ${kb(biggest.file_size)}` : ""}).`,
      mediaIds: [biggest.id],
    });
  }

  // 3) Küçük dosya
  const small = photos.filter((p) => p.file_size != null && p.file_size < T.smallFileBytes);
  checks.push(
    small.length === 0
      ? { id: "small", status: "pass", title: "Dosya boyutu", detail: `Hiçbir fotoğraf ${kb(T.smallFileBytes)} altında değil.` }
      : {
          id: "small",
          status: "warn",
          title: "Küçük dosyalar",
          detail: `${small.length} fotoğraf ${kb(T.smallFileBytes)} altında (ölçülen: ${small.slice(0, 3).map((p) => kb(p.file_size ?? 0)).join(", ")}): ${list(small)}. Küçük dosya çoğunlukla düşük çözünürlük demektir.`,
          suggestion: "Bu fotoğrafları özgün, sıkıştırılmamış hâliyle yeniden yükleyin.",
          mediaIds: small.map((p) => p.id),
        },
  );

  // 4) Yinelenen: özet varsa özetle, yoksa aynı boyut + aynı tür
  const hasHash = photos.some((p) => p.sha256);
  const groups = new Map<string, PhotoMedia[]>();
  for (const p of photos) {
    const key = p.sha256 ? `h:${p.sha256}` : p.file_size ? `s:${p.file_size}:${p.file_type ?? ""}` : null;
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  const dupMedia = dupGroups.flat();
  checks.push(
    dupGroups.length === 0
      ? { id: "duplicate", status: "pass", title: "Yinelenen fotoğraf", detail: hasHash ? "Aynı içerikli fotoğraf yok." : "Aynı boyutta ve türde iki dosya yok." }
      : {
          id: "duplicate",
          status: "warn",
          title: "Olası yinelenen fotoğraf",
          detail: `${dupGroups.length} grup ${hasHash ? "aynı içerikli" : "birebir aynı boyutlu"} dosya: ${dupGroups.map((g) => list(g, 3)).join(" | ")}.${hasHash ? "" : " (Tespit dosya boyutuna dayanır, içerik karşılaştırılmadı.)"}`,
          suggestion: "Gerçekten aynıysa birini silin; farklı kareyse bu uyarıyı yok sayın.",
          mediaIds: dupMedia.map((p) => p.id),
        },
  );

  // 5-7) Boyut tabanlı kontroller: yalnız ölçülmüş değerle
  const measured = photos.filter((p) => (p.width ?? 0) > 0 && (p.height ?? 0) > 0);
  if (measured.length === 0) {
    const why = "Görsel boyutu (piksel) kayıtlı değil; bu kontrol ölçülemedi.";
    checks.push({ id: "resolution", status: "na", title: "Çözünürlük", detail: why });
    checks.push({ id: "orientation", status: "na", title: "Dikey / yatay", detail: why });
    checks.push({ id: "aspect", status: "na", title: "En-boy oranı", detail: why });
  } else {
    const low = measured.filter((p) => Math.max(p.width!, p.height!) < T.minLongEdge || Math.min(p.width!, p.height!) < T.minShortEdge);
    checks.push(
      low.length === 0
        ? { id: "resolution", status: "pass", title: "Çözünürlük", detail: `${measured.length} fotoğrafın hepsi en az ${T.minLongEdge}x${T.minShortEdge} piksel.` }
        : {
            id: "resolution",
            status: "warn",
            title: "Düşük çözünürlük",
            detail: `${low.length}/${measured.length} fotoğraf ${T.minLongEdge}x${T.minShortEdge} pikselin altında: ${low.slice(0, 3).map((p) => `${name(p)} (${p.width}x${p.height})`).join(", ")}.`,
            suggestion: "Daha yüksek çözünürlükte çekin veya orijinal dosyayı yükleyin.",
            mediaIds: low.map((p) => p.id),
          },
    );
    const portrait = measured.filter((p) => p.height! > p.width!);
    const landscape = measured.filter((p) => p.width! >= p.height!);
    checks.push(
      portrait.length > 0 && landscape.length > 0
        ? {
            id: "orientation",
            status: "warn",
            title: "Dikey ve yatay karışık",
            detail: `${landscape.length} yatay, ${portrait.length} dikey fotoğraf var; galeride kırpılma/boşluk oluşur.`,
            suggestion: "Mümkünse tüm kareleri yatay çekin.",
            mediaIds: (portrait.length <= landscape.length ? portrait : landscape).map((p) => p.id),
          }
        : { id: "orientation", status: "pass", title: "Dikey / yatay", detail: portrait.length ? "Tümü dikey." : "Tümü yatay." },
    );
    const odd = measured.filter((p) => {
      const r = Math.max(p.width!, p.height!) / Math.min(p.width!, p.height!);
      return r > T.maxAspect;
    });
    checks.push(
      odd.length === 0
        ? { id: "aspect", status: "pass", title: "En-boy oranı", detail: `Hiçbir fotoğraf ${T.maxAspect}:1 orandan uzun değil.` }
        : {
            id: "aspect",
            status: "warn",
            title: "Alışılmadık oran",
            detail: `${odd.length} fotoğraf ${T.maxAspect}:1 oranından uzun/ince: ${list(odd)}.`,
            suggestion: "Panoramik kareler portal kapaklarında kırpılır; standart oranda bir kare ekleyin.",
            mediaIds: odd.map((p) => p.id),
          },
    );
  }

  // 8) Biçim
  const gifs = photos.filter((p) => p.file_type === "image/gif");
  checks.push(
    gifs.length === 0
      ? { id: "format", status: "pass", title: "Dosya biçimi", detail: "Fotoğraflar JPEG/PNG/WebP." }
      : {
          id: "format",
          status: "warn",
          title: "GIF biçimi",
          detail: `${gifs.length} fotoğraf GIF: ${list(gifs)}. GIF fotoğraf için uygun değildir (256 renk).`,
          suggestion: "JPEG olarak yeniden yükleyin.",
          mediaIds: gifs.map((p) => p.id),
        },
  );

  const countCheck = checks.find((c) => c.id === "count");
  const coverCheck = checks.find((c) => c.id === "cover");
  return {
    photoCount: photos.length,
    checks,
    passed: checks.filter((c) => c.status === "pass").length,
    warned: checks.filter((c) => c.status === "warn").length,
    notMeasured: checks.filter((c) => c.status === "na").length,
    gap: countCheck?.status === "warn" || coverCheck?.status === "warn",
  };
}

/**
 * "Foto eksik" kuralı — liste filtresi için yalnız sayı + kapak (hafif). Rapordaki `gap` ile aynı mantık.
 */
export function isPhotoGap(photoCount: number, hasCover: boolean): boolean {
  return photoCount < PHOTO_THRESHOLDS.minPhotos || !hasCover;
}
