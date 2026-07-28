/**
 * Filigran (watermark) — SAF yardımcılar.
 *
 * İlan fotoğraflarına ofis logosu/adı basmak için gereken ayar doğrulaması ve
 * konum/ölçek matematiği. Burada DOM/canvas YOK: hem sunucuda (ayar kaydı,
 * doğrulama) hem istemcide (canvas çizimi, canlı önizleme) aynı fonksiyonlar
 * kullanılır ve birim testle kilitlenir.
 *
 * Damgalama istemcide, yükleme anında yapılır (sunucuda sharp yok) — orijinal
 * dosya diskte bozulmaz, yalnızca yüklenen kopya damgalanır.
 */

export const WATERMARK_MODES = ["logo", "text", "both"] as const;
export type WatermarkMode = (typeof WATERMARK_MODES)[number];

export const WATERMARK_POSITIONS = ["sag-alt", "sol-alt", "orta", "sag-ust", "sol-ust"] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export const WATERMARK_POSITION_LABEL: Record<WatermarkPosition, string> = {
  "sol-ust": "Sol üst",
  "sag-ust": "Sağ üst",
  orta: "Orta",
  "sol-alt": "Sol alt",
  "sag-alt": "Sağ alt",
};

export const WATERMARK_MODE_LABEL: Record<WatermarkMode, string> = {
  logo: "Yalnız logo",
  text: "Yalnız metin",
  both: "Logo + metin",
};

export type WatermarkSettings = {
  /** Filigran basılsın mı? */
  enabled: boolean;
  mode: WatermarkMode;
  position: WatermarkPosition;
  /** %0 (görünmez) – %100 (tam opak) */
  opacity: number;
  /** Filigran genişliği = görsel genişliğinin %'si (5–40) */
  scale: number;
  /** Metin modunda basılacak yazı (boşsa ofis adı kullanılır) */
  text?: string;
  /** Kenar boşluğu = kısa kenarın %'si (0–20) */
  marginPct?: number;
};

/** Ayar hiç kaydedilmemişse geçerli olan set — kapalı başlar (sessiz sürpriz yok). */
export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: false,
  mode: "both",
  position: "sag-alt",
  opacity: 65,
  scale: 18,
  text: "",
  marginPct: 3,
};

export const WATERMARK_LIMITS = {
  opacity: { min: 0, max: 100 },
  scale: { min: 5, max: 40 },
  marginPct: { min: 0, max: 20 },
} as const;

/** Sayıya çevirir; NaN/Infinity/boş → null. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

/**
 * Herhangi bir girdiyi (DB jsonb, form verisi, elle yazılmış JSON) geçerli bir
 * ayar nesnesine indirger. Bilinmeyen mod/konum ve aralık dışı sayılar
 * varsayılana/sınıra çekilir — bozuk kayıt asla çizim kodunu patlatmaz.
 */
export function sanitizeWatermarkSettings(input: unknown): WatermarkSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  const mode = WATERMARK_MODES.includes(raw.mode as WatermarkMode)
    ? (raw.mode as WatermarkMode)
    : DEFAULT_WATERMARK.mode;
  const position = WATERMARK_POSITIONS.includes(raw.position as WatermarkPosition)
    ? (raw.position as WatermarkPosition)
    : DEFAULT_WATERMARK.position;

  const opacity = num(raw.opacity);
  const scale = num(raw.scale);
  const marginPct = num(raw.marginPct);

  // "false"/"0" gibi string değerler de kapalı sayılır (form verisi güvenliği).
  const enabledRaw = raw.enabled;
  const enabled =
    typeof enabledRaw === "boolean"
      ? enabledRaw
      : typeof enabledRaw === "string"
        ? ["true", "1", "on", "evet"].includes(enabledRaw.toLowerCase())
        : DEFAULT_WATERMARK.enabled;

  const text = typeof raw.text === "string" ? raw.text.trim().slice(0, 80) : "";

  return {
    enabled,
    mode,
    position,
    opacity: clamp(
      opacity ?? DEFAULT_WATERMARK.opacity,
      WATERMARK_LIMITS.opacity.min,
      WATERMARK_LIMITS.opacity.max,
    ),
    scale: clamp(scale ?? DEFAULT_WATERMARK.scale, WATERMARK_LIMITS.scale.min, WATERMARK_LIMITS.scale.max),
    text,
    marginPct: clamp(
      marginPct ?? DEFAULT_WATERMARK.marginPct ?? 3,
      WATERMARK_LIMITS.marginPct.min,
      WATERMARK_LIMITS.marginPct.max,
    ),
  };
}

export type WatermarkBoxInput = {
  imgW: number;
  imgH: number;
  /** Filigran kaynağının doğal genişliği (logo görseli veya ölçülmüş metin) */
  markW: number;
  markH: number;
  position: WatermarkPosition;
  /** Görsel genişliğinin %'si */
  scale: number;
  /** Kısa kenarın %'si */
  marginPct?: number;
};

export type WatermarkBox = { x: number; y: number; w: number; h: number };

/**
 * Filigranın çizileceği dikdörtgeni hesaplar.
 *
 * - Genişlik `scale`'den gelir (görsel genişliğinin %'si), yükseklik filigranın
 *   kendi en/boy oranını KORUR — logo asla ezilmez.
 * - Kutu, kenar boşlukları düşüldükten sonra kalan alana sığmıyorsa orantılı
 *   küçültülür (dikey/panorama görsellerde taşma olmaz).
 * - "orta" konumunda kenar boşluğu uygulanmaz, kutu tam ortalanır.
 * - Çıktı tam sayıdır (canvas'ta yarım piksel bulanıklığı olmasın diye).
 */
export function computeWatermarkBox({
  imgW,
  imgH,
  markW,
  markH,
  position,
  scale,
  marginPct = DEFAULT_WATERMARK.marginPct ?? 3,
}: WatermarkBoxInput): WatermarkBox {
  const W = Math.max(0, num(imgW) ?? 0);
  const H = Math.max(0, num(imgH) ?? 0);
  if (W <= 0 || H <= 0) return { x: 0, y: 0, w: 0, h: 0 };

  // Bozuk/eksik filigran ölçüsü → kare varsayılır (bölme hatası yerine makul çıktı)
  const mw = Math.max(1, num(markW) ?? 1);
  const mh = Math.max(1, num(markH) ?? 1);
  const ratio = mh / mw;

  const s = clamp(num(scale) ?? DEFAULT_WATERMARK.scale, WATERMARK_LIMITS.scale.min, WATERMARK_LIMITS.scale.max);
  const mp = clamp(num(marginPct) ?? 3, WATERMARK_LIMITS.marginPct.min, WATERMARK_LIMITS.marginPct.max);
  const margin = (Math.min(W, H) * mp) / 100;

  let w = (W * s) / 100;
  let h = w * ratio;

  // Kenar boşlukları düşülünce kalan kullanılabilir alan
  const maxW = Math.max(1, W - 2 * margin);
  const maxH = Math.max(1, H - 2 * margin);
  if (w > maxW) {
    w = maxW;
    h = w * ratio;
  }
  if (h > maxH) {
    h = maxH;
    w = h / ratio;
  }

  let x: number;
  let y: number;
  switch (position) {
    case "sol-ust":
      x = margin;
      y = margin;
      break;
    case "sag-ust":
      x = W - margin - w;
      y = margin;
      break;
    case "sol-alt":
      x = margin;
      y = H - margin - h;
      break;
    case "orta":
      x = (W - w) / 2;
      y = (H - h) / 2;
      break;
    case "sag-alt":
    default:
      x = W - margin - w;
      y = H - margin - h;
      break;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
  };
}
